import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ── Playwright mock ────────────────────────────────────────────────────────
// Scraper now uses page.evaluate() for all extraction (confirmed via DOM inspection).
// page.locator() is only used for h1 (name).

const mockPage = vi.hoisted(() => ({
  addInitScript: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn(),
  url: vi.fn().mockReturnValue('https://www.linkedin.com/in/alice'),
  waitForSelector: vi.fn().mockResolvedValue(undefined),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn(),
  evaluate: vi.fn(),
  title: vi.fn(),
}))

const mockContext = vi.hoisted(() => ({
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
  addCookies: vi.fn().mockResolvedValue(undefined),
}))

const mockBrowser = vi.hoisted(() => ({
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn().mockResolvedValue(mockBrowser) },
}))

import { chromium } from 'playwright'
import {
  scrapeLinkedInProfile,
  LinkedInAuthError,
  LinkedInRateLimitError,
  LinkedInProfileNotFoundError,
} from '../linkedin-scraper'

// Default evaluate call sequence (order matches scraper implementation):
// 1. remove modal → void
// 2. { location, followers } → object
// 3. about → string
// 4. experience → array
// 5. education → array
// 6. recentPosts → array
function setupDefaultEvaluate() {
  mockPage.evaluate
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ location: 'Paris, France', followers: '10 k abonnés' })
    .mockResolvedValueOnce('Passionnée par les systèmes distribués.')
    .mockResolvedValueOnce([{ title: 'Senior Engineer', company: 'Acme Corp', duration: '2020 - aujourd\'hui' }])
    .mockResolvedValueOnce([{ school: 'Polytechnique', years: '2012 - 2015' }])
    .mockResolvedValueOnce([{ title: 'Mon premier article', date: '12 juil. 2026' }])
}

function makeLocator(text: string | null) {
  return {
    first: () => ({
      textContent: () => Promise.resolve(text),
    }),
  }
}

// Rate limiter is a module-level singleton — lastMs persists across tests.
// We use setSystemTime with an incrementing value (10s per test) so each call
// sees elapsed > 4000ms minGap without any real or virtual waiting.
let fakeNow = new Date('2030-01-01T00:00:00.000Z').getTime()

describe('scrapeLinkedInProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeNow += 10_000
    vi.useFakeTimers()
    vi.setSystemTime(fakeNow)

    // Default: successful page load
    mockPage.goto.mockResolvedValue({ status: () => 200 })
    mockPage.url.mockReturnValue('https://www.linkedin.com/in/alice')
    mockPage.title.mockResolvedValue('Alice Dupont - Senior Engineer @ Acme | LinkedIn')
    mockPage.locator.mockImplementation((selector: string) => {
      if (selector === 'h1') return makeLocator('Alice Dupont')
      return makeLocator(null)
    })

    setupDefaultEvaluate()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a complete LinkedInProfile on success', async () => {
    const profile = await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')

    expect(profile).toMatchObject({
      name: 'Alice Dupont',
      headline: 'Senior Engineer @ Acme',
      location: 'Paris, France',
      followers: '10 k abonnés',
      about: 'Passionnée par les systèmes distribués.',
      experience: [{ title: 'Senior Engineer', company: 'Acme Corp' }],
      education: [{ school: 'Polytechnique', years: '2012 - 2015' }],
      profileUrl: 'https://www.linkedin.com/in/alice',
    })
    expect(profile.scrapedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('extracts headline from page title (most reliable for guest view)', async () => {
    mockPage.title.mockResolvedValue('Bob Martin - Clean Code Advocate | LinkedIn')
    const profile = await scrapeLinkedInProfile('https://www.linkedin.com/in/bob')
    expect(profile.headline).toBe('Clean Code Advocate')
  })

  it('injects the stealth script before navigation', async () => {
    await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')

    const initOrder = mockPage.addInitScript.mock.invocationCallOrder[0]
    const gotoOrder = mockPage.goto.mock.invocationCallOrder[0]
    expect(initOrder).toBeLessThan(gotoOrder)
  })

  it('removes auth modal from DOM before extraction', async () => {
    await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    // First evaluate call is always the modal removal
    expect(mockPage.evaluate).toHaveBeenCalled()
    // Modal removal is call index 0 (returns undefined)
    expect(mockPage.evaluate.mock.results[0].value).resolves.toBeUndefined()
  })

  it('passes the proxy to newContext when provided', async () => {
    await scrapeLinkedInProfile('https://www.linkedin.com/in/alice', 'http://proxy.example.com:8080')

    expect(mockBrowser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ proxy: { server: 'http://proxy.example.com:8080' } })
    )
  })

  it('does not set proxy when none provided', async () => {
    await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')

    const contextOptions = mockBrowser.newContext.mock.calls[0][0]
    expect(contextOptions).not.toHaveProperty('proxy')
  })

  it('throws LinkedInAuthError when redirected to /login', async () => {
    mockPage.url.mockReturnValue('https://www.linkedin.com/login?session_redirect=...')

    await expect(
      scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    ).rejects.toBeInstanceOf(LinkedInAuthError)
  })

  it('throws LinkedInAuthError when redirected to /authwall', async () => {
    mockPage.url.mockReturnValue('https://www.linkedin.com/authwall?trk=...')

    await expect(
      scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    ).rejects.toBeInstanceOf(LinkedInAuthError)
  })

  it('throws LinkedInRateLimitError on HTTP 429', async () => {
    mockPage.goto.mockResolvedValue({ status: () => 429 })

    await expect(
      scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    ).rejects.toBeInstanceOf(LinkedInRateLimitError)
  })

  it('throws LinkedInProfileNotFoundError on HTTP 404', async () => {
    mockPage.goto.mockResolvedValue({ status: () => 404 })

    await expect(
      scrapeLinkedInProfile('https://www.linkedin.com/in/nobody')
    ).rejects.toBeInstanceOf(LinkedInProfileNotFoundError)
  })

  it('always closes context and browser — even on error', async () => {
    mockPage.url.mockReturnValue('https://www.linkedin.com/login')

    await expect(
      scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    ).rejects.toThrow()

    expect(mockContext.close).toHaveBeenCalledTimes(1)
    expect(mockBrowser.close).toHaveBeenCalledTimes(1)
  })

  // ── ScrapeOptions / authenticated mode ────────────────────────────────────

  it('sets authMode to guest when no sessionCookie provided', async () => {
    const profile = await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    expect(profile.authMode).toBe('guest')
  })

  it('sets authMode to authenticated and injects li_at cookie when sessionCookie provided', async () => {
    // Auth path calls 4 extra evaluate() calls (email, phone, skills, connections)
    mockPage.evaluate
      .mockResolvedValueOnce(null)         // email
      .mockResolvedValueOnce(null)         // phone
      .mockResolvedValueOnce([])           // skills
      .mockResolvedValueOnce(null)         // connections

    const profile = await scrapeLinkedInProfile(
      'https://www.linkedin.com/in/alice',
      { sessionCookie: 'AQEDATi…fakecookie' }
    )

    expect(profile.authMode).toBe('authenticated')
    expect(mockContext.addCookies).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'li_at',
        value: 'AQEDATi…fakecookie',
        domain: '.linkedin.com',
      }),
    ])
  })

  it('accepts ScrapeOptions with proxy string', async () => {
    await scrapeLinkedInProfile('https://www.linkedin.com/in/alice', {
      proxy: 'http://proxy.example.com:8080',
    })

    expect(mockBrowser.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ proxy: { server: 'http://proxy.example.com:8080' } })
    )
  })

  it('returns null email/phone/skills[] when in guest mode', async () => {
    const profile = await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')
    expect(profile.email).toBeNull()
    expect(profile.phone).toBeNull()
    expect(profile.skills).toEqual([])
    expect(profile.connections).toBeNull()
  })

  it('throws LinkedInAuthError when cookie is invalid (redirected to /login)', async () => {
    mockPage.url.mockReturnValue('https://www.linkedin.com/login?session_redirect=...')

    await expect(
      scrapeLinkedInProfile('https://www.linkedin.com/in/alice', {
        sessionCookie: 'expired_cookie',
      })
    ).rejects.toBeInstanceOf(LinkedInAuthError)
  })
})
