import type { Context, Next } from 'koa'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../logger'
import { httpRequestsTotal, httpDurationMs } from '../metrics'

export const log = () => {
  return async (ctx: Context, next: Next) => {
    const reqId = (ctx.headers['x-request-id'] as string) ?? uuidv4()
    const start = Date.now()

    // Attach child logger with reqId so every log in this request carries the correlation ID
    ctx.state.log = logger.child({ reqId })
    ctx.set('x-request-id', reqId)

    await next()

    const ms = Date.now() - start
    const level = ctx.status >= 500 ? 'error' : ctx.status >= 400 ? 'warn' : 'info'

    ctx.state.log[level]({
      method: ctx.method,
      path: ctx.path,
      status: ctx.status,
      duration_ms: ms,
      user_agent: ctx.headers['user-agent'],
    }, `${ctx.method} ${ctx.path} ${ctx.status}`)

    const labels = { method: ctx.method, path: ctx.path, status: String(ctx.status) }
    httpRequestsTotal.inc(labels)
    httpDurationMs.observe(labels, ms)
  }
}
