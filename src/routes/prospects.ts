import Router from '@koa/router'
import { randomUUID } from 'crypto'
import { ProspectSchema } from '../types'
import { publish } from '../rabbitmq'

const router = new Router()

router.post('/prospects/scrape', async (ctx) => {
  try {
    const { url, userId } = ProspectSchema.parse(ctx.request.body)
    const jobId = randomUUID()
    await publish('scrape.requested', { jobId, url, userId })
    ctx.status = 202
    ctx.body = { jobId, status: 'pending' }
  } catch (err: any) {
    ctx.status = 400
    ctx.body = { error: err.errors ?? err.message }
  }
})

export default router
