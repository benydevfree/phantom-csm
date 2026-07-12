import amqp from 'amqplib'

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://phantom:phantom@localhost:5672'

export async function publish(queue: string, message: object) {
  const connection = await amqp.connect(RABBITMQ_URL)
  const channel = await connection.createChannel()
  await channel.assertQueue(queue, { durable: true })
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)))
  await channel.close()
  await connection.close()
}
