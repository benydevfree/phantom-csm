import amqp from 'amqplib'

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://phantom:phantom@localhost:5672'


  async function getChannel() {
    const connection = await amqp.connect(RABBITMQ_URL)
    const channel = await connection.createChannel()
    await channel.assertExchange('automation', 'topic', { durable: true })
    return { connection, channel }
  }

export async function publish(routingKey: string, message: object) {
  const {connection, channel} = await getChannel()
  channel.publish('automation',routingKey, Buffer.from(JSON.stringify(message)), {persistent: true})
  await channel.close()
  await connection.close()
}

  export async function subscribe(routingKey: string, queueName: string, handler: (msg: object) => Promise<void>) {
  const {connection, channel} = await getChannel()
  await channel.assertQueue(queueName, { durable: true })
  await channel.bindQueue(queueName, 'automation', routingKey)
  channel.consume(queueName, async (msg) => {
    if (!msg) return
    const data = JSON.parse(msg.content.toString())
    await handler(data)
    channel.ack(msg)
  })
}

