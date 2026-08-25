/**
 * Toast notification system.
 *
 * Usage:
 *   const { toasts, pushToast, dismissToast } = useToasts()
 *   <ToastStack toasts={toasts} onDismiss={dismissToast} />
 *
 * Toasts auto-dismiss after `duration` ms (default 6000).
 * Critical toasts include role="alert" aria-live="assertive".
 */
import { useState, useEffect, useCallback, useRef } from 'react'

export type ToastLevel = 'stable' | 'warning' | 'critical' | 'info'

export interface Toast {
  id: number
  level: ToastLevel
  title: string
  body?: string
  duration: number
}

let _idCounter = 0
function nextId() { return ++_idCounter }

// ── Hook ───────────────────────────────────────────────────────────────────

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId()
    setToasts(prev => [...prev, { ...t, id }])
    return id
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, pushToast, dismissToast }
}

// ── Individual Toast ───────────────────────────────────────────────────────

const levelColor: Record<ToastLevel, string> = {
  critical: '#ff3b3b',
  warning:  '#f5a623',
  stable:   '#00ff9d',
  info:     '#00d4ff',
}

const levelBg: Record<ToastLevel, string> = {
  critical: 'rgba(255,59,59,0.12)',
  warning:  'rgba(245,166,35,0.10)',
  stable:   'rgba(0,255,157,0.07)',
  info:     'rgba(0,212,255,0.08)',
}

const levelBorder: Record<ToastLevel, string> = {
  critical: 'rgba(255,59,59,0.45)',
  warning:  'rgba(245,166,35,0.38)',
  stable:   'rgba(0,255,157,0.28)',
  info:     'rgba(0,212,255,0.30)',
}

const levelIcon: Record<ToastLevel, string> = {
  critical: '⚡',
  warning:  '⚠',
  stable:   '✓',
  info:     '◈',
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast
  onDismiss: (id: number) => void
}) {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Slide in
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  // Auto-dismiss
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true)
      setTimeout(() => onDismiss(toast.id), 300)
    }, toast.duration)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [toast.id, toast.duration, onDismiss])

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setExiting(true)
    setTimeout(() => onDismiss(toast.id), 300)
  }

  const color = levelColor[toast.level]

  return (
    <div
      role={toast.level === 'critical' || toast.level === 'warning' ? 'alert' : 'status'}
      aria-live={toast.level === 'critical' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="corner-clip-sm"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 14px',
        background: levelBg[toast.level],
        border: `1px solid ${levelBorder[toast.level]}`,
        boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px ${levelBorder[toast.level]}`,
        minWidth: 280,
        maxWidth: 400,
        transform: visible && !exiting ? 'translateX(0)' : 'translateX(calc(100% + 20px))',
        opacity: visible && !exiting ? 1 : 0,
        transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease',
        pointerEvents: 'all',
      }}
    >
      {/* Left accent bar */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 3, background: color, borderRadius: '2px 0 0 2px',
      }} />

      {/* Icon */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 14,
        color,
        flexShrink: 0,
        marginTop: 1,
        marginLeft: 4,
      }}>
        {levelIcon[toast.level]}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color,
          marginBottom: toast.body ? 3 : 0,
        }}>
          {toast.title}
        </div>
        {toast.body && (
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            color: 'var(--color-card-foreground)',
            lineHeight: 1.5,
          }}>
            {toast.body}
          </div>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-muted-foreground)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          padding: '0 2px',
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        ✕
      </button>

      {/* Progress bar */}
      <div style={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: 2,
        background: `linear-gradient(to right, ${color}, transparent)`,
        animation: `toast-progress ${toast.duration}ms linear forwards`,
        opacity: 0.4,
      }} />
    </div>
  )
}

// ── Stack ──────────────────────────────────────────────────────────────────

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div
      aria-label="Notifications"
      style={{
        position: 'fixed',
        top: 60,          // just below the 52px header
        right: 16,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
