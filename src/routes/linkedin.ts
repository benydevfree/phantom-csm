import Router from '@koa/router'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { publish } from '../rabbitmq'
import { db } from '../db'

const router = new Router()

const LinkedInScrapeSchema = z.object({
  url: z.string().url().refine(u => u.includes('linkedin.com/in/'), {
    message: 'URL must be a LinkedIn profile URL (linkedin.com/in/...)',
  }),
  userId: z.string(),
  proxy: z.string().url().optional(),
})

router.post('/prospects/linkedin', async (ctx) => {
  try {
    const { url, userId, proxy } = LinkedInScrapeSchema.parse(ctx.request.body)
    const jobId = randomUUID()

    await db.query(
      'INSERT INTO prospects (job_id, user_id, source_url, status) VALUES ($1, $2, $3, $4)',
      [jobId, userId, url, 'pending']
    )

    await publish('linkedin.scrape.requested', { jobId, url, userId, proxy })

    ctx.status = 202
    ctx.body = { jobId, status: 'pending' }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.errors ?? err.message }
  }
})

export default router
