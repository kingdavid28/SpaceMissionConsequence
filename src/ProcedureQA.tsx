/**
 * Procedure Q&A Assistant
 * Offline-capable chatbot backed by cached emergency procedures.
 * Optionally upgrades to watsonx/OpenAI when keys are present.
 */
import { useState, useRef, useEffect } from 'react'
import { askProcedure, type ProcedureAnswer } from './ai'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  ref?: string
  provider?: string
  ts: Date
}

const SUGGESTED_QUESTIONS = [
  'What do I do if CO₂ exceeds 0.5%?',
  'How do I respond to a battery thermal anomaly?',
  'Cabin pressure is dropping — what are the steps?',
  'We lost TDRS contact. What is the comms procedure?',
  'Humidity is above 90%. What action should I take?',
]

const PROVIDER_LABEL: Record<string, string> = {
  watsonx: 'IBM watsonx',
  openai: 'OpenAI',
  local: 'Offline Manual',
}

let msgIdCounter = 0
function nextId() { return ++msgIdCounter }

export default function ProcedureQA() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      role: 'assistant',
      text: 'Emergency Procedure Assistant online.\n\nAsk any question about spacecraft emergency procedures. I operate fully offline using the cached procedure manual.\n\nExample: "What do I do if CO₂ exceeds 0.5%?"',
      ts: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendQuestion(question: string) {
    if (!question.trim() || loading) return
    const q = question.trim()
    setInput('')

    setMessages(prev => [...prev, {
      id: nextId(), role: 'user', text: q, ts: new Date(),
    }])
    setLoading(true)

    try {
      const result: ProcedureAnswer = await askProcedure(q)
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'assistant',
        text: result.answer,
        ref: result.ref,
        provider: result.generatedBy,
        ts: new Date(),
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'assistant',
        text: 'Procedure lookup failed. Refer to the IFS binder or contact MCC via UHF 296.8 MHz.',
        ts: new Date(),
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 440 }}>
      {/* Suggested questions */}
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', gap: 6, flexWrap: 'wrap',
      }}>
        {SUGGESTED_QUESTIONS.map(q => (
          <button
            key={q}
            onClick={() => sendQuestion(q)}
            disabled={loading}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--color-primary)',
              background: 'rgba(0,212,255,0.05)',
              border: '1px solid rgba(0,212,255,0.2)',
              padding: '3px 7px',
              borderRadius: 2,
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.04em',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 3,
            }}
          >
            {/* Bubble */}
            <div style={{
              maxWidth: '88%',
              padding: '9px 12px',
              borderRadius: 2,
              background: msg.role === 'user'
                ? 'rgba(0,212,255,0.08)'
                : 'var(--color-raised)',
              border: msg.role === 'user'
                ? '1px solid rgba(0,212,255,0.25)'
                : '1px solid var(--color-border)',
            }}>
              <pre style={{
                fontFamily: msg.role === 'assistant' ? 'var(--font-mono)' : 'var(--font-body)',
                fontSize: 11,
                color: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-card-foreground)',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.6,
              }}>
                {msg.text}
              </pre>
            </div>

            {/* Meta */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {msg.role === 'assistant' && msg.ref && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  color: 'var(--color-primary)',
                  padding: '1px 5px',
                  background: 'rgba(0,212,255,0.06)',
                  border: '1px solid rgba(0,212,255,0.18)',
                  borderRadius: 2,
                  letterSpacing: '0.08em',
                }}>
                  {msg.ref}
                </span>
              )}
              {msg.role === 'assistant' && msg.provider && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9,
                  color: 'var(--color-muted-foreground)',
                  letterSpacing: '0.06em',
                }}>
                  via {PROVIDER_LABEL[msg.provider] ?? msg.provider}
                </span>
              )}
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-muted-foreground)' }}>
                {msg.ts.toISOString().slice(11, 19)} UTC
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)',
          }}>
            <span className="blink">▮</span>
            <span>Consulting procedure manual…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--color-border)',
        display: 'flex', gap: 8,
      }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendQuestion(input)}
          placeholder="Ask an emergency procedure question…"
          disabled={loading}
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--color-foreground)',
            background: 'var(--color-raised)',
            border: '1px solid var(--color-border)',
            padding: '7px 10px',
            borderRadius: 2,
            outline: 'none',
          }}
        />
        <button
          onClick={() => sendQuestion(input)}
          disabled={loading || !input.trim()}
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: input.trim() && !loading ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
            background: input.trim() && !loading ? 'var(--color-primary)' : 'var(--color-fill-weak)',
            border: '1px solid var(--color-border)',
            padding: '7px 14px',
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            borderRadius: 2,
            transition: 'all 0.2s ease',
          }}
        >
          ASK
        </button>
      </div>
    </div>
  )
}
