import Router from '@koa/router'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { db } from '../db'

const router = new Router()

router.post('/login', async (ctx) => {
  const { username, password } = ctx.request.body as { username: string; password: string }
  if (username === 'admin@phantom.com' && password === 'phantom') {
    const accessToken = jwt.sign({ username }, process.env.JWT_SECRET!, { expiresIn: '15m' })
    const refreshTokenId = randomUUID()
    
    await db.query(
      'INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [refreshTokenId, username, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
    )
    
    ctx.cookies.set('refreshToken', refreshTokenId, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'strict'
    })
    
    ctx.body = { accessToken }
  } else {
    ctx.status = 401
    ctx.body = { error: 'Invalid credentials' }
  }
})

router.post('/auth/refresh', async (ctx) => {
  const refreshTokenId = ctx.cookies.get('refreshToken')
  if (!refreshTokenId) {
    ctx.status = 401
    ctx.body = { error: 'Missing refresh token' }
    return
  }

  const result = await db.query(
    'SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = false AND expires_at > NOW()',
    [refreshTokenId]
  )

  if (result.rowCount === 0) {
    ctx.status = 403
    ctx.body = { error: 'Invalid or expired refresh token' }
    return
  }

  const userId = result.rows[0].user_id
  const accessToken = jwt.sign({ username: userId }, process.env.JWT_SECRET!, { expiresIn: '15m' })
  
  ctx.body = { accessToken }
})

export default router
