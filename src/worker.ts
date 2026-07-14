import 'dotenv/config'
import { redis } from './redis'
import { subscribe } from './rabbitmq'
import { scrapeJobOffer } from './scraper'
import { db } from './db'

async function startWorker() {
  await subscribe('session.created', 'q.session.created', async (data: any) => {
    console.log('📨 Session reçue:', data)

    const jobChannel = `job:${data.id}`

    await new Promise(r => setTimeout(r, 2000))
    await redis.publish(jobChannel, JSON.stringify({ status: 'processing', progress: 25 }))

    await new Promise(r => setTimeout(r, 2000))
    await redis.publish(jobChannel, JSON.stringify({ status: 'processing', progress: 75 }))

    await new Promise(r => setTimeout(r, 1000))
    await redis.publish(jobChannel, JSON.stringify({ status: 'done', progress: 100, data }))
    console.log(`✅ Session ${data.id} traitée`)
  })

  await subscribe('subscription.created', 'q.subscription.created', async (data: any) => {
    console.log('📨 Subscription reçue:', data)
  })

  await subscribe('scrape.requested', 'q.scrape.requested', async (data: any) => {
    const { jobId, url } = data
    console.log(`🕷️  Scrape démarré — job ${jobId} — ${url}`)

    await db.query('UPDATE prospects SET status = $1 WHERE job_id = $2', ['scraping', jobId])

    const result = await scrapeJobOffer(url)
    console.log(`✅ Scrape terminé — ${result.title}`)

    await db.query(
      'UPDATE prospects SET status = $1, enriched_data = $2 WHERE job_id = $3',
      ['done', JSON.stringify(result), jobId]
    )
  })

  console.log('👷 Worker en écoute...')
}

startWorker()
