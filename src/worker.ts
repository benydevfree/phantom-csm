import 'dotenv/config'
import amqp from 'amqplib'
import { redis } from './redis'

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://phantom:phantom@localhost:5672'

async function startWorker() {
  const connection = await amqp.connect(RABBITMQ_URL)
  const channel = await connection.createChannel()
  await channel.assertQueue('session.created', { durable: true })
  await channel.assertQueue('subscription.created', { durable: true })

  console.log('👷 Worker en écoute sur session.created...')

  channel.consume('session.created', async (msg) => {
    if (!msg) return
    try {
      const session = JSON.parse(msg.content.toString())
      console.log('📨 Session reçue:', session)

      const jobChannel = `job:${session.id}`

      await new Promise(r => setTimeout(r, 10000))
      console.log('⏱ Délai terminé, publication...')
      await redis.publish(jobChannel, JSON.stringify({ status: 'processing', progress: 25 }))
      console.log('📤 25% publié')
      await new Promise(r => setTimeout(r, 1000))

      await redis.publish(jobChannel, JSON.stringify({ status: 'processing', progress: 75 }))
      console.log('📤 75% publié')
      await new Promise(r => setTimeout(r, 1000))

      await redis.publish(jobChannel, JSON.stringify({ status: 'done', progress: 100, session }))
      console.log('✅ done publié')

      channel.ack(msg)
    } catch (err) {
      console.error('Worker error:', err)
    }
  })

  console.log('👷 Worker en écoute sur subscription.created...')

  channel.consume('subscription.created', async (msg) => {
    if (!msg) return
    try {
      const subscription = JSON.parse(msg.content.toString())
      console.log('📨 Subscription reçue:', subscription)
      channel.ack(msg)
    } catch (err) {
      console.error('Worker error:', err)
    }
  })


  
}

startWorker()
