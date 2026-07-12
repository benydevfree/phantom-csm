import Router from '@koa/router'
import { db } from './db'

export const router = new Router()

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok' }
})

router.post('/session', async (ctx) => {
  try {
    const { name } = ctx.request.body as { name: string }
    const result = await db.query(
      'INSERT INTO sessions (name) VALUES ($1) RETURNING *',
      [name]
    )
    ctx.status = 201
    ctx.body = result.rows[0]
  } catch (err) {
    console.error('DB error:', err)
    ctx.status = 500
    ctx.body = { error: String(err) }
  }
})