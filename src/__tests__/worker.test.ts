import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Hoisted mocks — run before any import
const mockLogMethods = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../rabbitmq', () => ({ subscribe: vi.fn() }))
vi.mock('../redis', () => ({ redis: { publish: vi.fn() } }))
vi.mock('../scraper', () => ({ scrapeJobOffer: vi.fn() }))
vi.mock('../db', () => ({ db: { query: vi.fn() } }))
vi.mock('../llm', () => ({ analyzeOfferCriteria: vi.fn() }))
vi.mock('../scoring', () => ({ scoreContact: vi.fn() }))
vi.mock('../logger', () => ({
  logger: {
    child: vi.fn(() => ({
      ...mockLogMethods,
      child: vi.fn(() => mockLogMethods),
    })),
  },
}))

import { handleSessionCreated, handleScrapeRequested, handleSubscriptionCreated, handleOfferAnalyzeRequested, handleContactsScoreRequested, startWorker } from '../worker'
import { redis } from '../redis'
import { scrapeJobOffer } from '../scraper'
import { db } from '../db'
import { subscribe } from '../rabbitmq'

const mockResult = {
  title: 'Développeur Senior',
  location: '75 - PARIS',
  company: 'Acme Corp',
  contractType: 'CDI',
  salary: '55k',
  description: 'Description courte.',
  sourceUrl: 'https://francetravail.fr/offre/123',
}

describe('Worker — consumers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ──────────────────────────────────────────
  // handleSessionCreated
  // ──────────────────────────────────────────
  describe('handleSessionCreated', () => {
    it('publishes 3 progress events to the correct Redis channel', async () => {
      const data = { id: 'sess-abc' }
      const promise = handleSessionCreated(data)
      await vi.runAllTimersAsync()
      await promise

      const publishMock = vi.mocked(redis.publish)
      expect(publishMock).toHaveBeenCalledTimes(3)

      const [call1, call2, call3] = publishMock.mock.calls
      expect(call1[0]).toBe('job:sess-abc')
      expect(JSON.parse(call1[1] as string)).toMatchObject({ status: 'processing', progress: 25 })
      expect(JSON.parse(call2[1] as string)).toMatchObject({ status: 'processing', progress: 75 })
      expect(JSON.parse(call3[1] as string)).toMatchObject({ status: 'done', progress: 100, data })
    })

    it('sends events in order: 25 → 75 → done', async () => {
      const progressSequence: number[] = []
      vi.mocked(redis.publish).mockImplementation(async (_channel, msg) => {
        progressSequence.push(JSON.parse(msg as string).progress)
        return 1
      })

      const promise = handleSessionCreated({ id: 'sess-order' })
      await vi.runAllTimersAsync()
      await promise

      expect(progressSequence).toEqual([25, 75, 100])
    })
  })

  // ──────────────────────────────────────────
  // handleScrapeRequested
  // ──────────────────────────────────────────
  describe('handleScrapeRequested', () => {
    beforeEach(() => {
      vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 1 } as any)
    })

    it('sets status to scraping before starting', async () => {
      vi.mocked(scrapeJobOffer).mockResolvedValue(mockResult)

      await handleScrapeRequested({ jobId: 'job-1', url: 'https://example.com' })

      const firstCall = vi.mocked(db.query).mock.calls[0]
      expect(firstCall).toEqual([
        'UPDATE prospects SET status = $1 WHERE job_id = $2',
        ['scraping', 'job-1'],
      ])
    })

    it('sets status to done with enriched_data on success', async () => {
      vi.mocked(scrapeJobOffer).mockResolvedValue(mockResult)

      await handleScrapeRequested({ jobId: 'job-ok', url: 'https://example.com' })

      const calls = vi.mocked(db.query).mock.calls
      expect(calls[1]).toEqual([
        'UPDATE prospects SET status = $1, enriched_data = $2 WHERE job_id = $3',
        ['done', JSON.stringify(mockResult), 'job-ok'],
      ])
    })

    it('sets status to error when scraper throws', async () => {
      vi.mocked(scrapeJobOffer).mockRejectedValue(new Error('page timeout'))

      await handleScrapeRequested({ jobId: 'job-fail', url: 'https://fail.com' })

      const calls = vi.mocked(db.query).mock.calls
      expect(calls).toHaveLength(2)
      expect(calls[1]).toEqual([
        'UPDATE prospects SET status = $1 WHERE job_id = $2',
        ['error', 'job-fail'],
      ])
    })

    it('calls scrapeJobOffer with the URL from the message', async () => {
      vi.mocked(scrapeJobOffer).mockResolvedValue(mockResult)

      await handleScrapeRequested({ jobId: 'job-url', url: 'https://francetravail.fr/offre/456' })

      expect(vi.mocked(scrapeJobOffer)).toHaveBeenCalledWith('https://francetravail.fr/offre/456')
    })

    it('never calls scrapeJobOffer twice on a single message', async () => {
      vi.mocked(scrapeJobOffer).mockResolvedValue(mockResult)

      await handleScrapeRequested({ jobId: 'job-once', url: 'https://example.com' })

      expect(vi.mocked(scrapeJobOffer)).toHaveBeenCalledTimes(1)
    })
  })

  // ──────────────────────────────────────────
  // handleSubscriptionCreated
  // ──────────────────────────────────────────
  describe('handleSubscriptionCreated', () => {
    it('does not throw on valid data', async () => {
      await expect(
        handleSubscriptionCreated({ id: 'sub-123', plan: 'pro' })
      ).resolves.toBeUndefined()
    })
  })

  // ──────────────────────────────────────────
  // startWorker
  // ──────────────────────────────────────────
  describe('startWorker', () => {
    it('subscribes to all 6 queues', async () => {
      vi.mocked(subscribe).mockResolvedValue(undefined as any)

      await startWorker()

      expect(subscribe).toHaveBeenCalledTimes(6)
      expect(subscribe).toHaveBeenCalledWith('session.created', 'q.session.created', handleSessionCreated)
      expect(subscribe).toHaveBeenCalledWith('subscription.created', 'q.subscription.created', handleSubscriptionCreated)
      expect(subscribe).toHaveBeenCalledWith('scrape.requested', 'q.scrape.requested', handleScrapeRequested)
      expect(subscribe).toHaveBeenCalledWith('linkedin.scrape.requested', 'q.linkedin.scrape.requested', expect.any(Function))
      expect(subscribe).toHaveBeenCalledWith('offer.analyze.requested', 'q.offer.analyze.requested', handleOfferAnalyzeRequested)
      expect(subscribe).toHaveBeenCalledWith('contacts.score.requested', 'q.contacts.score.requested', handleContactsScoreRequested)
    })
  })
})
