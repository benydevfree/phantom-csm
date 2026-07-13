import Router from '@koa/router'
import jwt from 'jsonwebtoken'

const router = new Router()

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

export default router
