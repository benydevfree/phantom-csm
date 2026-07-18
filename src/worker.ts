import 'dotenv/config'
import { redis } from './redis'
import { subscribe } from './rabbitmq'
import { scrapeJobOffer } from './scraper'
import { scrapeLinkedInProfile, LinkedInRateLimitError, LinkedInAuthError } from './linkedin-scraper'
import { db } from './db'
import { logger } from './logger'

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

export async function startWorker() {
  await subscribe('session.created', 'q.session.created', handleSessionCreated)
  await subscribe('subscription.created', 'q.subscription.created', handleSubscriptionCreated)
  await subscribe('scrape.requested', 'q.scrape.requested', handleScrapeRequested)
  await subscribe('linkedin.scrape.requested', 'q.linkedin.scrape.requested', handleLinkedInScrapeRequested)

  log.info('Worker listening on all queues')
}

if (process.env.NODE_ENV !== 'test') {
  startWorker().catch(err => log.error({ err }, 'Worker startup failed'))
}
