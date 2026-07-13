import Router from '@koa/router'
import Redis from 'ioredis'
import jwt from 'jsonwebtoken'
import { db } from './db'
import { publish } from './rabbitmq'

export const router = new Router()

router.get('/sessions', async (ctx) => {
  const { name } = ctx.query
  try {
   const result = name
      ? await db.query('SELECT * FROM sessions WHERE name ILIKE $1', [`%${name}%`])
      : await db.query('SELECT * FROM sessions')
  
       ctx.body = result.rows
  } catch (err) {
    console.error('DB error:', err)
    ctx.status = 500
    ctx.body = { error: String(err) }
  }
})

router.get('/sessions/:id/stream', async (ctx) => {
  ctx.set('Content-Type', 'text/event-stream')
  ctx.set('Cache-Control', 'no-cache')
  ctx.set('Connection', 'keep-alive')
  ctx.status = 200
  ctx.respond = false
  ctx.res.flushHeaders()

  console.log(`SSE ouvert pour job:${ctx.params.id}`)
  const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  await sub.subscribe(`job:${ctx.params.id}`)
  console.log(`Redis subscribed à job:${ctx.params.id}`)

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

router.get('/health', (ctx) => {
  ctx.body = { status: 'ok' }
})

router.post('/session', async (ctx) => {
  try {
    const { name, user_id } = ctx.request.body as { name: string; user_id: string }
    
    const subResult = await db.query(
      'SELECT max_sessions, sessions_used FROM subscriptions WHERE user_id = $1 and status = \'active\'',
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
      'UPDATE subscriptions SET sessions_used = sessions_used + 1 WHERE user_id = $1',
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

router.post('/login', async (ctx) => {
  const { username, password } = ctx.request.body as { username: string; password: string }
  if (username === 'admin@phantom.com' && password === 'phantom') {
    const token = jwt.sign({ username }, process.env.JWT_SECRET!, { expiresIn: '1h' })
    ctx.body = { token }
  } else {
    ctx.status = 401
    ctx.body = { error: 'Invalid credentials' }
  }
})



router.post('/subscription', async (ctx) => {
  try {
    const { user_id, plan } = ctx.request.body as { user_id: string; plan: 'free' | 'pro' | 'enterprise'; }


    await db.query(
      'UPDATE subscriptions SET status = \'cancelled\' WHERE user_id = $1 AND status = \'active\'',
      [user_id]
    )

    const result = await db.query(
      'INSERT INTO subscriptions (user_id, plan, max_sessions, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, plan, plan === 'free' ? 1 : plan === 'pro' ? 10 : 100, 'active']
    )

    await publish('subscription.created', result.rows[0])

    ctx.status = 201
    ctx.body = result.rows[0]
  } catch (err) {
    console.error('DB error:', err)
    ctx.status = 500
    ctx.body = { error: String(err) }
  }
})