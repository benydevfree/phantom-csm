import { Context, Next } from "koa"
import jwt from "jsonwebtoken"

export const auth = () => {
  return async (ctx: Context, next: Next) => {

    if (ctx.path === '/login' || ctx.path === '/auth/refresh' || ctx.path === '/health' || ctx.path === '/api/chat' || ctx.path === '/metrics') return await next()

  const authHeader = ctx.headers['authorization']
    if (!authHeader) {
      ctx.status = 401
      ctx.body = { error: 'Missing Authorization header' }
      return
    }
    
    let payload: Record<string, unknown>
    try {
      const token = authHeader.split(' ')[1]
      payload = jwt.verify(token, process.env.JWT_SECRET!) as Record<string, unknown>
    } catch {
      ctx.status = 403
      ctx.body = { error: 'Invalid token' }
      return
    }
    ctx.state.user = payload
    await next()

  

  
  }
}

