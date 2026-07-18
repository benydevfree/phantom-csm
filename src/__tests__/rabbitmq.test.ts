import { vi, describe, it, expect, beforeEach } from 'vitest'

// Hoisted so they're available inside vi.mock() factory
const mockChannel = vi.hoisted(() => ({
  assertExchange: vi.fn().mockResolvedValue({}),
  assertQueue: vi.fn().mockResolvedValue({}),
  bindQueue: vi.fn().mockResolvedValue({}),
  publish: vi.fn().mockReturnValue(true),
  consume: vi.fn(),
  ack: vi.fn(),
  close: vi.fn().mockResolvedValue({}),
}))

const mockConnection = vi.hoisted(() => ({
  createChannel: vi.fn(),
  close: vi.fn().mockResolvedValue({}),
}))

vi.mock('amqplib', () => ({
  default: { connect: vi.fn() },
}))

import amqp from 'amqplib'
import { publish, subscribe } from '../rabbitmq'

describe('RabbitMQ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnection.createChannel.mockResolvedValue(mockChannel)
    vi.mocked(amqp.connect).mockResolvedValue(mockConnection as any)
  })

  // ──────────────────────────────────────────
  // publish
  // ──────────────────────────────────────────
  describe('publish', () => {
    it('connects to RabbitMQ and declares the automation exchange', async () => {
      await publish('scrape.requested', { jobId: 'abc' })

      expect(amqp.connect).toHaveBeenCalledTimes(1)
      expect(mockChannel.assertExchange).toHaveBeenCalledWith('automation', 'topic', { durable: true })
    })

    it('sends the message to the correct exchange and routing key', async () => {
      await publish('scrape.requested', { jobId: 'abc', url: 'https://example.com' })

      expect(mockChannel.publish).toHaveBeenCalledWith(
        'automation',
        'scrape.requested',
        expect.any(Buffer),
        { persistent: true }
      )
    })

    it('serializes the payload as JSON in the message buffer', async () => {
      const payload = { jobId: 'xyz', url: 'https://test.com', userId: 'u-1' }
      await publish('scrape.requested', payload)

      const buf = vi.mocked(mockChannel.publish).mock.calls[0][2] as Buffer
      expect(JSON.parse(buf.toString())).toEqual(payload)
    })

    it('closes the channel and connection after each publish', async () => {
      await publish('session.created', { id: 'sess-1' })

      expect(mockChannel.close).toHaveBeenCalledTimes(1)
      expect(mockConnection.close).toHaveBeenCalledTimes(1)
    })

    it('supports any routing key', async () => {
      await publish('subscription.created', { id: 'sub-1' })

      expect(mockChannel.publish).toHaveBeenCalledWith(
        'automation',
        'subscription.created',
        expect.any(Buffer),
        expect.any(Object)
      )
    })
  })

  // ──────────────────────────────────────────
  // subscribe
  // ──────────────────────────────────────────
  describe('subscribe', () => {
    it('declares the exchange, queue, and binding', async () => {
      mockChannel.consume.mockImplementation(() => {})

      await subscribe('scrape.requested', 'q.scrape.requested', vi.fn())

      expect(mockChannel.assertExchange).toHaveBeenCalledWith('automation', 'topic', { durable: true })
      expect(mockChannel.assertQueue).toHaveBeenCalledWith('q.scrape.requested', { durable: true })
      expect(mockChannel.bindQueue).toHaveBeenCalledWith('q.scrape.requested', 'automation', 'scrape.requested')
    })

    it('calls the handler with parsed message data and acks on success', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      let consumer!: (msg: any) => Promise<void>

      mockChannel.consume.mockImplementation((_queue: string, fn: any) => { consumer = fn })

      await subscribe('scrape.requested', 'q.scrape.requested', handler)

      const payload = { jobId: 'msg-1', url: 'https://example.com' }
      const msg = { content: Buffer.from(JSON.stringify(payload)) }
      await consumer(msg)

      expect(handler).toHaveBeenCalledWith(payload)
      expect(mockChannel.ack).toHaveBeenCalledWith(msg)
    })

    it('does not call handler or ack on null message (consumer cancelled)', async () => {
      const handler = vi.fn()
      let consumer!: (msg: any) => Promise<void>

      mockChannel.consume.mockImplementation((_queue: string, fn: any) => { consumer = fn })

      await subscribe('session.created', 'q.session.created', handler)
      await consumer(null)

      expect(handler).not.toHaveBeenCalled()
      expect(mockChannel.ack).not.toHaveBeenCalled()
    })

    it('keeps the connection open (no close after subscribe)', async () => {
      mockChannel.consume.mockImplementation(() => {})

      await subscribe('session.created', 'q.session.created', vi.fn())

      expect(mockChannel.close).not.toHaveBeenCalled()
      expect(mockConnection.close).not.toHaveBeenCalled()
    })
  })
})
