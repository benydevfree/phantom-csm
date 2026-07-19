import Router from '@koa/router'
import { db } from '../db'
import { parseLinkedInCsv } from '../csv-parser'

const router = new Router({ prefix: '/contacts' })

router.post('/import-csv', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const file = (ctx.request as any).files?.file
  if (!file) {
    ctx.status = 400
    ctx.body = { error: 'Missing file' }
    return
  }

  const fs = await import('fs')
  const content = fs.readFileSync(file.filepath ?? file.path, 'utf-8')
  const contacts = parseLinkedInCsv(content)

  if (contacts.length === 0) {
    ctx.body = { imported: 0, duplicates: 0, total: 0 }
    return
  }

  let imported = 0
  for (const c of contacts) {
    const result = await db.query(
      `INSERT INTO contacts (tenant_id, full_name, linkedin_url, email, company, headline, source, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, 'linkedin_csv', $7)
       ON CONFLICT (tenant_id, linkedin_url) WHERE linkedin_url IS NOT NULL DO NOTHING`,
      [tenantId, c.full_name || null, c.linkedin_url, c.email, c.company, c.position, JSON.stringify(c)]
    )
    imported += result.rowCount ?? 0
  }

  const total = contacts.length
  const duplicates = total - imported
  ctx.body = { imported, duplicates, total }
})

router.get('/', async (ctx) => {
  const tenantId = ctx.state.tenantId as string
  const page = Math.max(1, parseInt(ctx.query.page as string) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(ctx.query.limit as string) || 20))
  const offset = (page - 1) * limit

  const conditions: string[] = ['tenant_id = $1']
  const params: any[] = [tenantId]
  let paramIdx = 2

  if (ctx.query.sector) {
    conditions.push(`sector = $${paramIdx++}`)
    params.push(ctx.query.sector)
  }
  if (ctx.query.source) {
    conditions.push(`source = $${paramIdx++}`)
    params.push(ctx.query.source)
  }

  const where = conditions.join(' AND ')
  params.push(limit, offset)

  const result = await db.query(
    `SELECT *, COUNT(*) OVER() AS total_count
     FROM contacts
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    params
  )

  const total = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0
  const contacts = result.rows.map(({ total_count, ...row }) => row)
  ctx.body = { contacts, total, page, limit }
})

export default router
