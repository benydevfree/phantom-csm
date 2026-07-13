import Router from '@koa/router'
import Redis from 'ioredis'
import { db } from '../db'
import { publish } from '../rabbitmq'

const router = new Router({ prefix: '/sessions' })

router.get('/', async (ctx) => {
  try {
    const { name } = ctx.query
    const result = name
      ? await db.query('SELECT * FROM sessions WHERE name ILIKE $1 ORDER BY created_at DESC', [`%${name}%`])
      : await db.query('SELECT * FROM sessions ORDER BY created_at DESC')
    ctx.body = result.rows
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: String(err) }
  }
})

router.get('/:id/stream', async (ctx) => {
  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.status = 200
  ctx.respond = false
  ctx.res.flushHeaders()

  const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  await sub.subscribe(`job:${ctx.params.id}`)

  await new Promise<void>((resolve) => {
    sub.on('message', (_channel, message) => {
      ctx.res.write(`data: ${message}\n\n`)
      const { status } = JSON.parse(message)
      if (status === 'done') {
        ctx.res.end()
        sub.disconnect()
        resolve()
      }
    })
  })
})

router.post('/', async (ctx) => {
  try {
    const { name, user_id } = ctx.request.body as { name: string; user_id: string }

    const subResult = await db.query(
      'SELECT max_sessions, sessions_used FROM subscriptions WHERE user_id = $1 AND status = \'active\' ORDER BY created_at DESC LIMIT 1',
      [user_id]
    )

    if (subResult.rows.length === 0) {
      ctx.status = 404
      ctx.body = { error: 'Subscription not found' }
      return
    }

    const { max_sessions, sessions_used } = subResult.rows[0]

    if (sessions_used >= max_sessions) {
      ctx.status = 429
      ctx.body = { error: 'Session limit reached' }
      return
    }

    const result = await db.query(
      'INSERT INTO sessions (name, user_id) VALUES ($1, $2) RETURNING *',
      [name, user_id]
    )

    await db.query(
      'UPDATE subscriptions SET sessions_used = sessions_used + 1 WHERE user_id = $1 AND status = \'active\'',
      [user_id]
    )

    await publish('session.created', result.rows[0])
    ctx.status = 201
    ctx.body = result.rows[0]
  } catch (err) {
    console.error('DB error:', err)
    ctx.status = 500
    ctx.body = { error: String(err) }
  }
})

export default router
