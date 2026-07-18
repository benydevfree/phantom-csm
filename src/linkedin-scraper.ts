import { chromium } from 'playwright'

export type LinkedInProfile = {
  name: string
  headline: string
  location: string
  about: string | null
  currentPosition: string | null
  currentCompany: string | null
  profileUrl: string
  scrapedAt: string
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
// Token bucket: one request per minGapMs (+ random jitter to avoid patterns)
class RateLimiter {
  private lastMs = 0

  constructor(private readonly minGapMs: number) {}

  async wait() {
    const now = Date.now()
    const elapsed = now - this.lastMs
    if (elapsed < this.minGapMs) {
      const jitter = Math.random() * 1_000
      await new Promise(r => setTimeout(r, this.minGapMs - elapsed + jitter))
    }
    this.lastMs = Date.now()
  }
}

// Singleton limiter: LinkedIn tolerates ~1 req / 3s before soft-blocking
const limiter = new RateLimiter(3_000)

// ── User-agent pool ─────────────────────────────────────────────────────────
// Rotate across realistic Chrome versions to reduce fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
]

function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

// ── CDP stealth init script ─────────────────────────────────────────────────
// Injected into every page before any JS runs (via page.addInitScript)
const STEALTH_SCRIPT = `
  // Remove webdriver flag — primary Selenium/Playwright detection vector
  Object.defineProperty(navigator, 'webdriver', { get: () => false })

  // Populate plugins array (headless Chrome has none by default)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
    ]
  })

  // Languages must match Accept-Language header
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] })

  // Remove CDP / Playwright runtime markers
  ;['__playwright', '__pw_manual', '__pwInitScripts'].forEach(k => {
    try { delete (window)[k] } catch (_) {}
  })
`

// ── Main scraper ────────────────────────────────────────────────────────────
export async function scrapeLinkedInProfile(url: string, proxy?: string): Promise<LinkedInProfile> {
  // Enforce rate limit before opening browser (blocks concurrent callers too)
  await limiter.wait()

  const browser = await chromium.launch({ headless: true })

  // Context is isolated per call — proxy, UA, viewport are all request-scoped
  const context = await browser.newContext({
    ...(proxy && { proxy: { server: proxy } }),
    userAgent: pickUserAgent(),
    // Randomise viewport to avoid identical-fingerprint detection
    viewport: {
      width: 1280 + Math.floor(Math.random() * 120),
      height: 800 + Math.floor(Math.random() * 80),
    },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // Accept-Language must match navigator.languages override
    extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7' },
  })

  const page = await context.newPage()

  // Apply stealth overrides before any page loads
  await page.addInitScript(STEALTH_SCRIPT)

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const finalUrl = page.url()

    // Auth wall detection — LinkedIn redirects unauthenticated requests
    if (
      finalUrl.includes('/login') ||
      finalUrl.includes('/authwall') ||
      finalUrl.includes('/checkpoint')
    ) {
      throw new LinkedInAuthError()
    }

    const status = response?.status() ?? 0

    if (status === 429) {
      throw new LinkedInRateLimitError()
    }

    if (status === 404) {
      throw new LinkedInProfileNotFoundError(url)
    }

    // Wait for at least the profile name heading
    await page.waitForSelector('h1', { timeout: 8_000 })

    // Small human-like pause before extracting (avoids "too fast" heuristics)
    await page.waitForTimeout(400 + Math.random() * 800)

    // ── Data extraction ───────────────────────────────────────────────────
    const name = await page
      .locator('h1').first()
      .textContent()
      .then(t => t?.trim() ?? '')

    // LinkedIn renders headline in a <div> directly below <h1>
    const headline = await page
      .locator('.text-body-medium.break-words').first()
      .textContent()
      .then(t => t?.trim() ?? '')
      .catch(() => '')

    const location = await page
      .locator('.text-body-small.inline.t-black--light.break-words').first()
      .textContent()
      .then(t => t?.trim() ?? '')
      .catch(() => '')

    // About section content (collapsed by default, but text is in the DOM)
    const about = await page
      .locator('#about ~ div .full-width').first()
      .textContent()
      .then(t => t?.trim() || null)
      .catch(() => null)

    // First experience entry — job title
    const currentPosition = await page
      .locator('#experience ~ div .mr1.t-bold span[aria-hidden="true"]').first()
      .textContent()
      .then(t => t?.trim() || null)
      .catch(() => null)

    // First experience entry — company
    const currentCompany = await page
      .locator('#experience ~ div .t-14.t-normal span[aria-hidden="true"]').first()
      .textContent()
      .then(t => t?.trim() || null)
      .catch(() => null)

    return {
      name,
      headline,
      location,
      about,
      currentPosition,
      currentCompany,
      profileUrl: url,
      scrapedAt: new Date().toISOString(),
    }
  } finally {
    await context.close()
    await browser.close()
  }
}
