import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockLogMethods = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../rabbitmq', () => ({ subscribe: vi.fn() }))
vi.mock('../redis', () => ({ redis: { publish: vi.fn() } }))
vi.mock('../scraper', () => ({ scrapeJobOffer: vi.fn() }))
vi.mock('../db', () => ({ db: { query: vi.fn() } }))
vi.mock('../logger', () => ({
  logger: {
    child: vi.fn(() => ({
      ...mockLogMethods,
      child: vi.fn(() => mockLogMethods),
    })),
  },
}))
vi.mock('../linkedin-scraper', async () => {
  const actual = await vi.importActual<typeof import('../linkedin-scraper')>('../linkedin-scraper')
  return {
    ...actual,
    scrapeLinkedInProfile: vi.fn(),
  }
})

import { handleLinkedInScrapeRequested } from '../worker'
import { scrapeLinkedInProfile, LinkedInRateLimitError, LinkedInAuthError } from '../linkedin-scraper'
import { db } from '../db'

const mockProfile = {
  name: 'Alice Dupont',
  headline: 'Senior Engineer @ Acme',
  location: 'Paris, France',
  about: 'Passionnée par les systèmes distribués.',
  currentPosition: 'Senior Engineer',
  currentCompany: 'Acme Corp',
  profileUrl: 'https://www.linkedin.com/in/alice-dupont',
  scrapedAt: '2026-07-18T00:00:00.000Z',
}

describe('handleLinkedInScrapeRequested', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('sets status to scraping then done on success', async () => {
    vi.mocked(scrapeLinkedInProfile).mockResolvedValue(mockProfile)

    await handleLinkedInScrapeRequested({ jobId: 'job-li-1', url: 'https://www.linkedin.com/in/alice-dupont' })

    const calls = vi.mocked(db.query).mock.calls
    expect(calls[0]).toEqual(['UPDATE prospects SET status = $1 WHERE job_id = $2', ['scraping', 'job-li-1']])
    expect(calls[1]).toEqual([
      'UPDATE prospects SET status = $1, enriched_data = $2 WHERE job_id = $3',
      ['done', JSON.stringify(mockProfile), 'job-li-1'],
    ])
  })

  it('passes the proxy option to the scraper', async () => {
    vi.mocked(scrapeLinkedInProfile).mockResolvedValue(mockProfile)

    await handleLinkedInScrapeRequested({
      jobId: 'job-proxy',
      url: 'https://www.linkedin.com/in/bob',
      proxy: 'http://user:pass@proxy.example.com:8080',
    })

    expect(vi.mocked(scrapeLinkedInProfile)).toHaveBeenCalledWith(
      'https://www.linkedin.com/in/bob',
      'http://user:pass@proxy.example.com:8080'
    )
  })

  it('sets status to rate_limited on LinkedInRateLimitError', async () => {
    vi.mocked(scrapeLinkedInProfile).mockRejectedValue(new LinkedInRateLimitError())

    await handleLinkedInScrapeRequested({ jobId: 'job-rl', url: 'https://www.linkedin.com/in/eve' })

    const lastCall = vi.mocked(db.query).mock.calls.slice(-1)[0]
    expect(lastCall).toEqual(['UPDATE prospects SET status = $1 WHERE job_id = $2', ['rate_limited', 'job-rl']])
  })

  it('sets status to auth_required on LinkedInAuthError', async () => {
    vi.mocked(scrapeLinkedInProfile).mockRejectedValue(new LinkedInAuthError())

    await handleLinkedInScrapeRequested({ jobId: 'job-auth', url: 'https://www.linkedin.com/in/charlie' })

    const lastCall = vi.mocked(db.query).mock.calls.slice(-1)[0]
    expect(lastCall).toEqual(['UPDATE prospects SET status = $1 WHERE job_id = $2', ['auth_required', 'job-auth']])
  })

  it('sets status to error on unknown exception', async () => {
    vi.mocked(scrapeLinkedInProfile).mockRejectedValue(new Error('unexpected timeout'))

    await handleLinkedInScrapeRequested({ jobId: 'job-err', url: 'https://www.linkedin.com/in/dave' })

    const lastCall = vi.mocked(db.query).mock.calls.slice(-1)[0]
    expect(lastCall).toEqual(['UPDATE prospects SET status = $1 WHERE job_id = $2', ['error', 'job-err']])
  })
})
