import { describe, it, expect } from 'vitest'
import { tenant } from '../middlewares/tenantMiddleware'

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    path: '/contacts',
    status: 200,
    body: undefined as any,
    state: { user: undefined as any },
    ...overrides,
  } as any
}

describe('tenantMiddleware', () => {
  const middleware = tenant()
  const next = async () => {}

  it('skips /health', async () => {
    const ctx = makeCtx({ path: '/health', state: {} })
    await middleware(ctx, next)
    expect(ctx.status).toBe(200)
  })

  it('skips /metrics', async () => {
    const ctx = makeCtx({ path: '/metrics', state: {} })
    await middleware(ctx, next)
    expect(ctx.status).toBe(200)
  })

  it('skips /login', async () => {
    const ctx = makeCtx({ path: '/login', state: {} })
    await middleware(ctx, next)
    expect(ctx.status).toBe(200)
  })

  it('skips /auth/refresh', async () => {
    const ctx = makeCtx({ path: '/auth/refresh', state: {} })
    await middleware(ctx, next)
    expect(ctx.status).toBe(200)
  })

  it('returns 401 when user.sub is missing', async () => {
    const ctx = makeCtx({ path: '/contacts', state: { user: {} } })
    await middleware(ctx, next)
    expect(ctx.status).toBe(401)
    expect(ctx.body).toMatchObject({ error: 'Missing tenant context' })
  })

  it('returns 401 when ctx.state.user is undefined', async () => {
    const ctx = makeCtx({ path: '/contacts', state: {} })
    await middleware(ctx, next)
    expect(ctx.status).toBe(401)
  })

  it('injects tenantId from user.sub', async () => {
    const ctx = makeCtx({ path: '/contacts', state: { user: { sub: 'tenant-abc' } } })
    await middleware(ctx, next)
    expect(ctx.state.tenantId).toBe('tenant-abc')
    expect(ctx.status).toBe(200)
  })
})
