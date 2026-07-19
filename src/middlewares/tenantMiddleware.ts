import type { Context, Next } from 'koa'

const PUBLIC_PATHS = new Set(['/health', '/metrics', '/login', '/auth/refresh'])

export const tenant = () => {
  return async (ctx: Context, next: Next) => {
    if (PUBLIC_PATHS.has(ctx.path)) return await next()

    const tenantId = ctx.state.user?.sub as string | undefined
    if (!tenantId) {
      ctx.status = 401
      ctx.body = { error: 'Missing tenant context' }
      return
    }

    ctx.state.tenantId = tenantId
    await next()
  }
}
