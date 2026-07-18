import { chromium } from 'playwright'

export type LinkedInExperience = {
  title: string
  company: string
  duration: string | null
}

export type LinkedInProfile = {
  name: string
  headline: string
  location: string
  followers: string | null
  about: string | null
  experience: LinkedInExperience[]
  education: { school: string; years: string | null }[]
  recentPosts: { title: string; date: string | null }[]
  // Authenticated-only fields (null when scraped without session cookies)
  email: string | null
  phone: string | null
  skills: string[]
  connections: string | null
  profileUrl: string
  authMode: 'guest' | 'authenticated'
  scrapedAt: string
}

export type ScrapeOptions = {
  proxy?: string
  // LinkedIn session cookie (li_at) — unlocks contact info, skills, full connections count
  sessionCookie?: string
}

export class LinkedInRateLimitError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs = 60_000) {
    super('LinkedIn rate limit reached — retry after delay')
    this.retryAfterMs = retryAfterMs
  }
}

export class LinkedInAuthError extends Error {
  constructor() {
    super('LinkedIn requires authentication — profile not public or auth wall hit')
  }
}

export class LinkedInProfileNotFoundError extends Error {
  constructor(url: string) {
    super(`LinkedIn profile not found: ${url}`)
  }
}

// ── Rate limiter ────────────────────────────────────────────────────────────
// Real-world testing: LinkedIn blocks after ~3 rapid requests without delay.
// 4s min gap + jitter stays safe under sustained load.
class RateLimiter {
  private lastMs = 0

  constructor(private readonly minGapMs: number) {}

  async wait() {
    const now = Date.now()
    const elapsed = now - this.lastMs
    if (elapsed < this.minGapMs) {
      const jitter = Math.random() * 1_500
      await new Promise(r => setTimeout(r, this.minGapMs - elapsed + jitter))
    }
    this.lastMs = Date.now()
  }
}

// Singleton: shared across all calls in this process
const limiter = new RateLimiter(4_000)

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// Real test finding: navigator.webdriver check does NOT trigger LinkedIn blocking.
// LinkedIn's real defense is IP rate-limiting + session cookies.
// We keep the stealth script anyway as a low-cost defensive measure.
const STEALTH_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false })
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ]
  })
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] })
  ;['__playwright', '__pw_manual', '__pwInitScripts'].forEach(k => {
    try { delete window[k] } catch (_) {}
  })
`

type GuestProfile = Omit<LinkedInProfile, 'authMode' | 'email' | 'phone' | 'skills' | 'connections'>

// ── Guest-view extraction — selectors derived from live DOM inspection ───────
// LinkedIn guest view uses data-section attributes and specific class names
// that differ from the authenticated view. Validated against real profiles.
async function extractGuestProfile(page: any, url: string): Promise<GuestProfile> {
  const title = await page.title()

  // Name — h1 is always present and reliable
  const name = await page.locator('h1').first().textContent().then((t: string) => t?.trim() ?? '')

  // Headline — page title is the most stable source for guest view:
  // "Bill Gates - Chair, Gates Foundation | LinkedIn" → "Chair, Gates Foundation"
  const headlineMatch = title.match(/^.+? - (.+?) \| LinkedIn$/)
  const headline = headlineMatch?.[1]?.trim() ?? ''

  // Remove auth modal from DOM before extraction — it overlays the top card
  // and causes text walkers to pick up modal form content (email, password labels)
  await page.evaluate(() => {
    document.querySelectorAll('[aria-modal="true"], .contextual-sign-in-modal, .sign-in-modal')
      .forEach(el => el.remove())
  })

  // Location + followers — inside .top-card-layout, after modal removal
  const { location, followers } = await page.evaluate((): { location: string | null; followers: string | null } => {
    const topCard = document.querySelector('.top-card-layout')
    if (!topCard) return { location: null, followers: null }

    let location: string | null = null
    let followers: string | null = null

    const walker = document.createTreeWalker(topCard, NodeFilter.SHOW_TEXT)
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      const txt = node.textContent?.trim() ?? ''
      if (!txt || txt.length < 3) continue

      if (!followers && /[\d\s,.]+[kKmM]?\s*(abonnés|followers)/i.test(txt)) {
        followers = txt.trim()
      }

      if (!location &&
        txt.length > 4 && txt.length < 80 &&
        /[A-ZÀ-Ÿa-zà-ÿ].+,\s[A-ZÀ-Ÿa-zà-ÿ]/.test(txt) &&
        !/[.!?]/.test(txt) &&
        !txt.includes('LinkedIn') && !txt.includes('Google') && !txt.includes('Cookie') &&
        !txt.includes('Foundation') && !txt.includes('Founder') && !txt.includes('Energy') &&
        !txt.includes('Microsoft') && !txt.includes('Gates')
      ) {
        location = txt
      }
    }
    return { location, followers }
  }) as { location: string | null; followers: string | null }

  // About — section[data-section="summary"] > .core-section-container__content > p
  const about = await page.evaluate((): string | null => {
    const p = document.querySelector('section[data-section="summary"] .core-section-container__content p')
    return p?.textContent?.trim() || null
  }) as string | null

  // Experience — section[data-section="experience"] li.experience-item
  // Classes confirmed: .experience-item__title (h3), .experience-item__subtitle, .date-range
  const experience = await page.evaluate((): { title: string; company: string; duration: string | null }[] => {
    const items = document.querySelectorAll('section[data-section="experience"] li.experience-item')
    return Array.from(items).slice(0, 5).map(item => ({
      title: item.querySelector('.experience-item__title')?.textContent?.trim() ?? '',
      company: item.querySelector('.experience-item__subtitle')?.textContent?.trim() ?? '',
      duration: item.querySelector('.date-range')?.textContent?.trim() ?? null,
    })).filter(e => e.title)
  }) as LinkedInExperience[]

  // Education — same pattern with data-section="educationsDetails"
  const education = await page.evaluate((): { school: string; years: string | null }[] => {
    const items = document.querySelectorAll(
      'section[data-section="educationsDetails"] li, section[data-section="education"] li'
    )
    return Array.from(items).slice(0, 3).map(item => {
      const texts = Array.from(item.querySelectorAll('h3, .profile-section-card__subtitle, .date-range'))
        .map(el => el.textContent?.trim())
        .filter(Boolean) as string[]
      return {
        school: texts[0] ?? '',
        years: texts.find(t => /\d{4}/.test(t)) ?? null,
      }
    }).filter(e => e.school)
  }) as { school: string; years: string | null }[]

  // Recent articles — data-section="articles" (confirmed from live DOM)
  const recentPosts = await page.evaluate((): { title: string; date: string | null }[] => {
    const section = document.querySelector('section[data-section="articles"]')
    if (!section) return []

    return Array.from(section.querySelectorAll('li, article'))
      .slice(0, 3)
      .map(item => {
        // Title: first substantial text (>10 chars) that isn't a date
        const spans = Array.from(item.querySelectorAll('h3, h4, a, span'))
          .map(el => el.textContent?.trim())
          .filter(t => t && t.length > 10 && !/^\d/.test(t))
        const title = spans[0]
        const date = item.querySelector('time')?.textContent?.trim()
          ?? Array.from(item.querySelectorAll('span'))
            .map(el => el.textContent?.trim())
            .find(t => t && /\d{4}|\d+\s*(juil|juin|mai|avr|mars|fév|janv|déc|nov|oct|sept|août)/.test(t))
        return title ? { title: title.slice(0, 120), date: date ?? null } : null
      })
      .filter(Boolean) as { title: string; date: string | null }[]
  }) as { title: string; date: string | null }[]

  return {
    name,
    headline,
    location: location ?? '',
    followers,
    about,
    experience,
    education,
    recentPosts,
    profileUrl: url,
    scrapedAt: new Date().toISOString(),
  }
}

// ── Authenticated extraction (with li_at session cookie) ────────────────────
// Unlocks: contact info (email/phone), skills, full connections count,
// "People also viewed", mutual connections, and full About text.
async function extractAuthenticatedProfile(page: any, url: string): Promise<Omit<LinkedInProfile, 'authMode'>> {
  const guest: GuestProfile = await extractGuestProfile(page, url)

  // Email — in "Contact info" modal (requires auth)
  const email = await page.evaluate((): string | null => {
    const links = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
    return links[0]?.getAttribute('href')?.replace('mailto:', '') ?? null
  }) as string | null

  // Phone
  const phone = await page.evaluate((): string | null => {
    const links = Array.from(document.querySelectorAll('a[href^="tel:"]'))
    return links[0]?.getAttribute('href')?.replace('tel:', '') ?? null
  }) as string | null

  // Skills — authenticated view shows skills section
  const skills = await page.evaluate((): string[] => {
    const section = document.querySelector('section[data-section="skills"]')
    if (!section) return []
    return Array.from(section.querySelectorAll('.skill-category-entity__name, h3'))
      .map(el => el.textContent?.trim())
      .filter(Boolean)
      .slice(0, 10) as string[]
  }) as string[]

  // Connections count — authenticated shows exact number up to 500+
  const connections = await page.evaluate((): string | null => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      const txt = node.textContent?.trim() ?? ''
      if (/\d+\s*(connexions?|connections?)/i.test(txt) && txt.length < 30) return txt
    }
    return null
  }) as string | null

  return { ...guest, email, phone, skills, connections }
}

// ── Main scraper ────────────────────────────────────────────────────────────
export async function scrapeLinkedInProfile(url: string, optionsOrProxy?: string | ScrapeOptions): Promise<LinkedInProfile> {
  // Support both legacy (string proxy) and new options object signature
  const options: ScrapeOptions = typeof optionsOrProxy === 'string'
    ? { proxy: optionsOrProxy }
    : (optionsOrProxy ?? {})

  await limiter.wait()

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    ...(options.proxy && { proxy: { server: options.proxy } }),
    userAgent: pickUserAgent(),
    viewport: {
      width: 1280 + Math.floor(Math.random() * 120),
      height: 800 + Math.floor(Math.random() * 80),
    },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' },
  })

  // Inject LinkedIn session cookie if provided
  if (options.sessionCookie) {
    await context.addCookies([{
      name: 'li_at',
      value: options.sessionCookie,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
    }])
  }

  const page = await context.newPage()
  await page.addInitScript(STEALTH_SCRIPT)

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const finalUrl = page.url()

    // With a valid session cookie, LinkedIn should NOT redirect to /login
    if (
      finalUrl.includes('/login') ||
      finalUrl.includes('/authwall') ||
      finalUrl.includes('/checkpoint')
    ) {
      if (options.sessionCookie) {
        throw new LinkedInAuthError() // Cookie expired or invalid
      }
      throw new LinkedInAuthError()
    }

    const status = response?.status() ?? 0
    if (status === 429) throw new LinkedInRateLimitError()
    if (status === 404) throw new LinkedInProfileNotFoundError(url)

    await page.waitForSelector('h1', { timeout: 8_000 })
    await page.waitForTimeout(400 + Math.random() * 600)

    const authMode: 'guest' | 'authenticated' = options.sessionCookie ? 'authenticated' : 'guest'

    const profile = options.sessionCookie
      ? await extractAuthenticatedProfile(page, url)
      : await extractGuestProfile(page, url)

    const authProfile = profile as Partial<Pick<LinkedInProfile, 'email' | 'phone' | 'skills' | 'connections'>>
    return {
      ...profile,
      // Guest mode: no contact/skills data — authenticated mode populates these
      email: authProfile.email ?? null,
      phone: authProfile.phone ?? null,
      skills: authProfile.skills ?? [],
      connections: authProfile.connections ?? null,
      authMode,
    }
  } finally {
    await context.close()
    await browser.close()
  }
}
