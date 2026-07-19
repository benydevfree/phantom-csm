import 'dotenv/config'
import { redis } from './redis'
import { subscribe } from './rabbitmq'
import { scrapeJobOffer } from './scraper'
import { scrapeLinkedInProfile, LinkedInRateLimitError, LinkedInAuthError } from './linkedin-scraper'
import { db } from './db'
import { logger } from './logger'
import { analyzeOfferCriteria } from './llm'
import { scoreContact } from './scoring'

const log = logger.child({ component: 'worker' })

export async function handleSessionCreated(data: any) {
  const jobLog = log.child({ sessionId: data.id, queue: 'session.created' })
  jobLog.info('Session received — starting processing')

  const jobChannel = `job:${data.id}`

  await new Promise(r => setTimeout(r, 2000))
  await redis.publish(jobChannel, JSON.stringify({ status: 'processing', progress: 25 }))
  jobLog.debug({ progress: 25 }, 'Session processing progress')

  await new Promise(r => setTimeout(r, 2000))
  await redis.publish(jobChannel, JSON.stringify({ status: 'processing', progress: 75 }))
  jobLog.debug({ progress: 75 }, 'Session processing progress')

  await new Promise(r => setTimeout(r, 1000))
  await redis.publish(jobChannel, JSON.stringify({ status: 'done', progress: 100, data }))
  jobLog.info({ progress: 100 }, 'Session processed successfully')
}

export async function handleSubscriptionCreated(data: any) {
  log.info({ subscriptionId: data.id, queue: 'subscription.created' }, 'Subscription event received')
}

export async function handleScrapeRequested(data: any) {
  const { jobId, url } = data
  const jobLog = log.child({ jobId, url, queue: 'scrape.requested' })
  jobLog.info('Scrape job started')

  await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['scraping', jobId])

  try {
    const result = await scrapeJobOffer(url)
    jobLog.info({ title: result.title }, 'Scrape completed successfully')

    await db.query(
      'UPDATE prospects SET status = $1, enriched_data = $2 WHERE job_id = $3',
      ['done', JSON.stringify(result), jobId]
    )
  } catch (err) {
    jobLog.error({ err }, 'Scrape failed')
    await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['error', jobId])
  }
}

export async function handleLinkedInScrapeRequested(data: any) {
  const { jobId, url, proxy } = data
  const jobLog = log.child({ jobId, url, queue: 'linkedin.scrape.requested' })
  jobLog.info('LinkedIn scrape job started')

  await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['scraping', jobId])

  try {
    const result = await scrapeLinkedInProfile(url, proxy)
    jobLog.info({ name: result.name }, 'LinkedIn scrape completed')

    await db.query(
      'UPDATE prospects SET status = $1, enriched_data = $2 WHERE job_id = $3',
      ['done', JSON.stringify(result), jobId]
    )
  } catch (err) {
    if (err instanceof LinkedInRateLimitError) {
      jobLog.warn({ retryAfterMs: err.retryAfterMs }, 'LinkedIn rate limit — marking for retry')
      await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['rate_limited', jobId])
    } else if (err instanceof LinkedInAuthError) {
      jobLog.warn('LinkedIn auth wall hit — profile requires login')
      await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['auth_required', jobId])
    } else {
      jobLog.error({ err }, 'LinkedIn scrape failed')
      await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['error', jobId])
    }
  }
}

export async function handleOfferAnalyzeRequested(data: any) {
  const { offerId } = data
  const jobLog = log.child({ offerId, queue: 'offer.analyze.requested' })
  jobLog.info('Offer analysis started')

  const offerResult = await db.query('SELECT * FROM offers WHERE id = $1', [offerId])
  if (offerResult.rows.length === 0) {
    jobLog.error('Offer not found')
    return
  }
  const offer = offerResult.rows[0]

  await db.query("UPDATE offers SET status = 'analyzing' WHERE id = $1", [offerId])

  try {
    const criteria = await analyzeOfferCriteria(offer)
    await db.query(
      "UPDATE offers SET discriminant_criteria = $1, status = 'done' WHERE id = $2",
      [JSON.stringify(criteria), offerId]
    )
    jobLog.info({ criteriaCount: criteria.length }, 'Offer analysis complete')
  } catch (err) {
    jobLog.error({ err }, 'Offer analysis failed')
    await db.query("UPDATE offers SET status = 'error' WHERE id = $1", [offerId])
  }
}

export async function handleContactsScoreRequested(data: any) {
  const { offerId, tenantId } = data
  const jobLog = log.child({ offerId, tenantId, queue: 'contacts.score.requested' })
  jobLog.info('Contacts scoring started')

  const offerResult = await db.query(
    "SELECT * FROM offers WHERE id = $1 AND status = 'done' AND discriminant_criteria IS NOT NULL",
    [offerId]
  )
  if (offerResult.rows.length === 0) {
    jobLog.error('Offer not ready for scoring')
    return
  }
  const offer = offerResult.rows[0]
  const criteria = offer.discriminant_criteria

  const contactsResult = await db.query(
    'SELECT * FROM contacts WHERE tenant_id = $1',
    [tenantId]
  )
  const contacts = contactsResult.rows

  for (let i = 0; i < contacts.length; i += 100) {
    const batch = contacts.slice(i, i + 100)
    for (const contact of batch) {
      const { score, matched } = scoreContact(contact, criteria)
      await db.query(
        `INSERT INTO contact_scores (tenant_id, contact_id, offer_id, score, matched_criteria, computed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (tenant_id, contact_id, offer_id)
         DO UPDATE SET score = $4, matched_criteria = $5, computed_at = NOW()`,
        [tenantId, contact.id, offerId, score, JSON.stringify(matched)]
      )
    }
  }

  jobLog.info({ total: contacts.length }, 'Contacts scoring complete')
}

export async function startWorker() {
  await subscribe('session.created', 'q.session.created', handleSessionCreated)
  await subscribe('subscription.created', 'q.subscription.created', handleSubscriptionCreated)
  await subscribe('scrape.requested', 'q.scrape.requested', handleScrapeRequested)
  await subscribe('linkedin.scrape.requested', 'q.linkedin.scrape.requested', handleLinkedInScrapeRequested)
  await subscribe('offer.analyze.requested', 'q.offer.analyze.requested', handleOfferAnalyzeRequested)
  await subscribe('contacts.score.requested', 'q.contacts.score.requested', handleContactsScoreRequested)

  log.info('Worker listening on all queues')
}

if (process.env.NODE_ENV !== 'test') {
  startWorker().catch(err => log.error({ err }, 'Worker startup failed'))
}
