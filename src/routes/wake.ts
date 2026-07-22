import Router from '@koa/router'
import { Context } from 'koa'
import { spawnWake, updateSchedule, WakeTime } from '../cron'

const router = new Router()

function checkWakeToken(ctx: Context): boolean {
  const token = ctx.headers['authorization']?.split(' ')[1]
  if (!process.env.WAKE_TOKEN || token !== process.env.WAKE_TOKEN) {
    ctx.status = 401
    ctx.body = { error: 'Unauthorized' }
    return false
  }
  return true
}

// POST /wake — trigger a single claude wake (from iPhone Shortcut or manual)
router.post('/wake', (ctx) => {
  if (!checkWakeToken(ctx)) return

  const started_at = new Date().toISOString()
  spawnWake('POST /wake')
  console.log(`[wake] ${started_at} — claude wake triggered via HTTP`)

  ctx.status = 200
  ctx.body = { ok: true, started_at }
})

// PUT /wake/schedule — update cron schedule from CSM pattern analysis
// Body: { times: [{ dayOfWeek: 0-6, hour: 0-23, label?: string }] }
router.put('/wake/schedule', (ctx) => {
  if (!checkWakeToken(ctx)) return

  const body = ctx.request.body as { times?: unknown }

  if (!Array.isArray(body?.times)) {
    ctx.status = 400
    ctx.body = { error: 'Body must be { times: WakeTime[] }' }
    return
  }

  const times: WakeTime[] = (body.times as WakeTime[]).filter(
    (t) =>
      typeof t.dayOfWeek === 'number' &&
      t.dayOfWeek >= 0 &&
      t.dayOfWeek <= 6 &&
      typeof t.hour === 'number' &&
      t.hour >= 0 &&
      t.hour <= 23
  )

  updateSchedule(times)

  ctx.status = 200
  ctx.body = {
    ok: true,
    applied: times.length,
    updated_at: new Date().toISOString(),
  }
})

export default router
