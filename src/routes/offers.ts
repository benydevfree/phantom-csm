import Router from '@koa/router'
import { z } from 'zod'
import { db } from '../db'
import { publish } from '../rabbitmq'

const router = new Router({ prefix: '/offers' })

const CreateOfferSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  target_persona: z.string().optional(),
})

router.post('/', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const parsed = CreateOfferSchema.safeParse(ctx.request.body)
  if (!parsed.success) {
    ctx.status = 400
    ctx.body = { error: parsed.error.issues }
    return
  }
  const { name, description, target_persona } = parsed.data
  const result = await db.query(
    `INSERT INTO offers (tenant_id, name, description, target_persona)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, name, description ?? null, target_persona ?? null]
  )
  ctx.status = 201
  ctx.body = result.rows[0]
})

router.get('/', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const result = await db.query(
    `SELECT o.*, COUNT(cs.id) AS scored_contacts
     FROM offers o
     LEFT JOIN contact_scores cs ON cs.offer_id = o.id
     WHERE o.tenant_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [tenantId]
  )
  ctx.body = result.rows
})

router.get('/:id', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const result = await db.query(
    'SELECT * FROM offers WHERE id = $1 AND tenant_id = $2',
    [ctx.params.id, tenantId]
  )
  if (result.rows.length === 0) {
    ctx.status = 404
    ctx.body = { error: 'Offer not found' }
    return
  }
  ctx.body = result.rows[0]
})

router.delete('/:id', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const check = await db.query(
    'SELECT id FROM offers WHERE id = $1 AND tenant_id = $2',
    [ctx.params.id, tenantId]
  )
  if (check.rows.length === 0) {
    ctx.status = 404
    ctx.body = { error: 'Offer not found' }
    return
  }
  await db.query('DELETE FROM contact_scores WHERE offer_id = $1', [ctx.params.id])
  await db.query('DELETE FROM offers WHERE id = $1', [ctx.params.id])
  ctx.status = 204
})

router.get('/:id/contacts', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(ctx.query.limit as string) || 20))
  const offset = (page - 1) * limit

  const result = await db.query(
    `SELECT c.*, cs.score, cs.matched_criteria, cs.computed_at AS scored_at
     FROM contacts c
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id AND cs.offer_id = $2
     WHERE c.tenant_id = $1
     ORDER BY cs.score DESC NULLS LAST
     LIMIT $3 OFFSET $4`,
    [tenantId, ctx.params.id, limit, offset]
  )
  ctx.body = result.rows
})

router.post('/:id/analyze', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const check = await db.query(
    'SELECT id FROM offers WHERE id = $1 AND tenant_id = $2',
    [ctx.params.id, tenantId]
  )
  if (check.rows.length === 0) {
    ctx.status = 404
    ctx.body = { error: 'Offer not found' }
    return
  }
  await db.query("UPDATE offers SET status = 'pending' WHERE id = $1", [ctx.params.id])
  const jobId = `${ctx.params.id}-analyze`
  await publish('q.offer.analyze.requested', { jobId, offerId: ctx.params.id, tenantId })
  ctx.status = 202
  ctx.body = { jobId, status: 'pending' }
})

router.post('/:id/score-contacts', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const offerResult = await db.query(
    "SELECT * FROM offers WHERE id = $1 AND tenant_id = $2",
    [ctx.params.id, tenantId]
  )
  if (offerResult.rows.length === 0) {
    ctx.status = 404
    ctx.body = { error: 'Offer not found' }
    return
  }
  const offer = offerResult.rows[0]
  if (offer.status !== 'done') {
    ctx.status = 422
    ctx.body = { error: 'Offer analysis not complete' }
    return
  }
  const jobId = `${ctx.params.id}-score`
  await publish('q.contacts.score.requested', { jobId, offerId: ctx.params.id, tenantId })
  ctx.status = 202
  ctx.body = { jobId, status: 'pending' }
})

export default router
