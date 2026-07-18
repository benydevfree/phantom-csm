import { vi, describe, it, expect, beforeEach } from 'vitest'

// ── Playwright mock ────────────────────────────────────────────────────────
const mockPage = vi.hoisted(() => ({
  addInitScript: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn(),
  url: vi.fn().mockReturnValue('https://www.linkedin.com/in/alice'),
  waitForSelector: vi.fn().mockResolvedValue(undefined),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn(),
}))

const mockContext = vi.hoisted(() => ({
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
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

function makeLocator(text: string | null) {
  return {
    first: () => ({
      textContent: () => Promise.resolve(text),
    }),
  }
}

describe('scrapeLinkedInProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default: successful page load
    mockPage.goto.mockResolvedValue({ status: () => 200 })
    mockPage.url.mockReturnValue('https://www.linkedin.com/in/alice')
    mockPage.locator.mockImplementation((selector: string) => {
      const map: Record<string, string | null> = {
        'h1': 'Alice Dupont',
        '.text-body-medium.break-words': 'Senior Engineer @ Acme',
        '.text-body-small.inline.t-black--light.break-words': 'Paris, France',
        '#about ~ div .full-width': 'Passionnée par les systèmes distribués.',
        '#experience ~ div .mr1.t-bold span[aria-hidden="true"]': 'Senior Engineer',
        '#experience ~ div .t-14.t-normal span[aria-hidden="true"]': 'Acme Corp',
      }
      return makeLocator(map[selector] ?? null)
    })
  })

  it('returns a complete LinkedInProfile on success', async () => {
    const profile = await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')

    expect(profile).toMatchObject({
      name: 'Alice Dupont',
      headline: 'Senior Engineer @ Acme',
      location: 'Paris, France',
      about: 'Passionnée par les systèmes distribués.',
      currentPosition: 'Senior Engineer',
      currentCompany: 'Acme Corp',
      profileUrl: 'https://www.linkedin.com/in/alice',
    })
    expect(profile.scrapedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('injects the stealth script before navigation', async () => {
    await scrapeLinkedInProfile('https://www.linkedin.com/in/alice')

    // addInitScript must be called before goto
    const initOrder = mockPage.addInitScript.mock.invocationCallOrder[0]
    const gotoOrder = mockPage.goto.mock.invocationCallOrder[0]
    expect(initOrder).toBeLessThan(gotoOrder)
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
})
