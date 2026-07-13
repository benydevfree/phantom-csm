import Router from '@koa/router'
import { db } from '../db'
import { publish } from '../rabbitmq'

const router = new Router({ prefix: '/subscriptions' })

router.post('/', async (ctx) => {
  try {
    const { user_id, plan } = ctx.request.body as { user_id: string; plan: 'free' | 'pro' | 'enterprise' }

    await db.query(
      'UPDATE subscriptions SET status = \'cancelled\' WHERE user_id = $1 AND status = \'active\'',
      [user_id]
    )

    const result = await db.query(
      'INSERT INTO subscriptions (user_id, plan, max_sessions) VALUES ($1, $2, $3) RETURNING *',
      [user_id, plan, plan === 'free' ? 1 : plan === 'pro' ? 10 : 100]
    )

    await publish('subscription.created', result.rows[0])
    ctx.status = 201
    ctx.body = result.rows[0]
  } catch (err) {
    ctx.status = 500
    ctx.body = { error: String(err) }
  }
})

export default router
