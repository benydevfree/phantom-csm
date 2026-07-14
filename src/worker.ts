import 'dotenv/config'
import { redis } from './redis'
import { subscribe } from './rabbitmq'

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

  console.log('👷 Worker en écoute...')
}

startWorker()
