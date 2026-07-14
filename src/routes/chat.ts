import Router from '@koa/router'
import { spawn } from 'child_process'
import { db } from '../db'
import { publish } from '../rabbitmq'
import { randomUUID } from 'crypto'

const router = new Router()

const SYSTEM_PROMPT = `Tu es un assistant IA qui pilote des automations de scraping d'offres d'emploi (style PhantomBuster).
Tu as accès aux données de prospects scrapés ci-dessous.
Réponds toujours en français, de façon concise et structurée.

Si l'utilisateur te demande de scraper une URL, réponds avec un bloc JSON sur une ligne seule :
<action>{"type":"scrape","url":"<l'url>"}</action>

Sinon réponds normalement en te basant sur les données disponibles.`

async function loadContext(): Promise<string> {
  const res = await db.query(
    `SELECT job_id, source_url, status, enriched_data, created_at
     FROM prospects ORDER BY created_at DESC LIMIT 20`
  )
  if (res.rows.length === 0) return 'Aucun prospect en base pour le moment.'

  return res.rows.map((r) => {
    const d = r.enriched_data
    if (!d) return `- [${r.status}] ${r.source_url} (job: ${r.job_id})`
    return `- [${r.status}] ${d.title ?? '?'} | ${d.company ?? '?'} | ${d.location ?? '?'} | ${d.contractType ?? '?'} | Salaire: ${d.salary ?? 'N/A'}\n  URL: ${r.source_url}`
  }).join('\n')
}

async function callClaude(fullPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('claude', ['--print', '--model', 'claude-sonnet-4-6'], {
      env: { ...process.env },
      timeout: 60000,
      shell: true,
    })
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(stderr || `Claude exited with code ${code}`))
    })
    // On envoie le prompt via stdin pour éviter les limites d'args et les caractères spéciaux
    child.stdin.write(fullPrompt)
    child.stdin.end()
  })
}

router.post('/api/chat', async (ctx) => {
  const { messages, userId = 'user-anonymous' } = ctx.request.body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    userId?: string
  }

  ctx.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  ctx.status = 200
  ctx.respond = false

  const send = (data: object) => ctx.res.write(`data: ${JSON.stringify(data)}\n\n`)

  try {
    send({ type: 'status', message: 'Chargement du contexte...' })
    const context = await loadContext()

    const history = messages
      .map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
      .join('\n')

    const lastMessage = messages[messages.length - 1]?.content ?? ''

    const fullPrompt = `${SYSTEM_PROMPT}

## Données prospects disponibles
${context}

## Historique de la conversation
${history}

## Message actuel
${lastMessage}

Réponds maintenant :`

    send({ type: 'status', message: 'Claude réfléchit...' })
    const rawReply = await callClaude(fullPrompt)

    // Détecter une action scrape demandée par Claude
    const actionMatch = rawReply.match(/<action>(\{.*?\})<\/action>/s)
    let reply = rawReply.replace(/<action>.*?<\/action>/s, '').trim()
    let action = null

    if (actionMatch) {
      try {
        action = JSON.parse(actionMatch[1])
        if (action.type === 'scrape' && action.url) {
          const jobId = randomUUID()
          await db.query(
            'INSERT INTO prospects (job_id, user_id, source_url, status) VALUES ($1, $2, $3, $4)',
            [jobId, userId, action.url, 'pending']
          )
          await publish('scrape.requested', { jobId, url: action.url, userId })
          reply += `\n\n✅ Scrape lancé — job \`${jobId}\``
        }
      } catch {
        // si le JSON est malformé on ignore l'action
      }
    }

    send({ type: 'done', reply })
  } catch (err: any) {
    send({ type: 'error', message: err.message })
  } finally {
    ctx.res.end()
  }
})

export default router
