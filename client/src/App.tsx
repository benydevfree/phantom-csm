import { useState, useRef, useEffect } from 'react'
import Markdown from 'react-markdown'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type SSEEvent =
  | { type: 'status'; message: string }
  | { type: 'done'; reply: string }
  | { type: 'error'; message: string }

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Bonjour ! Je peux lister tes prospects, analyser des offres, ou lancer un scrape. Que veux-tu faire ?' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  async function send() {
    if (!input.trim() || loading) return

    const userMessage: Message = { role: 'user', content: input }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setStatus(null)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, userId: 'user-demo' }),
        // proxy Vite redirige /api → http://localhost:3000
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event: SSEEvent = JSON.parse(line.slice(6))

          if (event.type === 'status') setStatus(event.message)
          if (event.type === 'done') {
            setMessages((prev) => [...prev, { role: 'assistant', content: event.reply }])
            setStatus(null)
          }
          if (event.type === 'error') {
            setMessages((prev) => [...prev, { role: 'assistant', content: `❌ Erreur : ${event.message}` }])
            setStatus(null)
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${err.message}` }])
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 760, margin: '0 auto', padding: '0 16px' }}>
      <h2 style={{ padding: '16px 0', margin: 0, borderBottom: '1px solid #e5e7eb', fontSize: 16, fontWeight: 600 }}>
        🤖 Phantom Agent
      </h2>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%', padding: '10px 14px', borderRadius: 12,
              background: m.role === 'user' ? '#2563eb' : '#f3f4f6',
              color: m.role === 'user' ? '#fff' : '#111',
              fontSize: 14, lineHeight: 1.5,
            }}>
              {m.role === 'assistant'
                ? <div className="prose"><Markdown>{m.content}</Markdown></div>
                : m.content}
            </div>
          </div>
        ))}

        {status && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '8px 14px', borderRadius: 12, background: '#f3f4f6', color: '#6b7280', fontSize: 13, fontStyle: 'italic' }}>
              ⏳ {status}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '12px 0', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="Ex: liste mes prospects, scrape https://..."
          disabled={loading}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 8,
            border: '1px solid #d1d5db', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={send}
          disabled={loading}
          style={{
            padding: '10px 18px', borderRadius: 8, border: 'none',
            background: loading ? '#93c5fd' : '#2563eb', color: '#fff',
            fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Envoyer
        </button>
      </div>
    </div>
  )
}
