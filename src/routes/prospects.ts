import Router from '@koa/router'
import { randomUUID } from 'crypto'
import { ProspectSchema } from '../types'
import { publish } from '../rabbitmq'
import { db } from '../db'

const router = new Router()

router.post('/prospects/scrape', async (ctx) => {
  try {
    const { url, userId } = ProspectSchema.parse(ctx.request.body)
    const jobId = randomUUID()

    await db.query(
      'INSERT INTO prospects (job_id, user_id, source_url, status) VALUES ($1, $2, $3, $4)',
      [jobId, userId, url, 'pending']
    )

    await publish('scrape.requested', { jobId, url, userId })

    ctx.status = 202
    ctx.body = { jobId, status: 'pending' }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.errors ?? err.message }
  }
})

export default router
