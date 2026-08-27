/**
 * AI Threat Summary Panel
 * Displays a plain-English narrative of the current threat picture,
 * auto-refreshes every 30 s or on demand.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTelemetry } from './telemetry'
import { naturalLanguageSummary, activeProvider, type AISummaryResult } from './ai'

const REFRESH_INTERVAL_MS = 30_000

const riskColor: Record<string, string> = {
  stable: '#00ff9d',
  warning: '#f5a623',
  critical: '#ff3b3b',
}

const riskBg: Record<string, string> = {
  stable: 'rgba(0,255,157,0.05)',
  warning: 'rgba(245,166,35,0.07)',
  critical: 'rgba(255,59,59,0.08)',
}

const riskBorder: Record<string, string> = {
  stable: 'rgba(0,255,157,0.22)',
  warning: 'rgba(245,166,35,0.3)',
  critical: 'rgba(255,59,59,0.4)',
}

const PROVIDER_LABEL: Record<string, string> = {
  watsonx: 'IBM watsonx',
  openai: 'OpenAI',
  local: 'Local Engine',
}

export default function AISummaryPanel() {
  const telemetry = useTelemetry()
  const [result, setResult] = useState<AISummaryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const r = await naturalLanguageSummary(telemetry.alerts, telemetry)
      setResult(r)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
    }
  }, [telemetry.alerts, telemetry])

  // Initial load + auto-refresh
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const risk = result?.overallRisk ?? 'stable'

  return (
    <div
      className="corner-clip-sm"
      style={{
        background: riskBg[risk],
        border: `1px solid ${riskBorder[risk]}`,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 14px',
        borderBottom: `1px solid ${riskBorder[risk]}`,
        background: 'rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: riskColor[risk],
            boxShadow: `0 0 6px ${riskColor[risk]}`,
            flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-muted-foreground)',
          }}>
            AI Mission Summary
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '1px 5px',
            background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.2)',
            borderRadius: 2,
            color: 'var(--color-primary)',
            letterSpacing: '0.08em',
          }}>
            {result ? PROVIDER_LABEL[result.generatedBy] : PROVIDER_LABEL[activeProvider()]}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastRefresh && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)' }}>
              {lastRefresh.toISOString().slice(11, 19)} UTC
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: loading ? 'var(--color-muted-foreground)' : 'var(--color-primary)',
              background: 'none',
              border: '1px solid var(--color-border)',
              padding: '2px 7px',
              cursor: loading ? 'not-allowed' : 'pointer',
              borderRadius: 2,
              letterSpacing: '0.1em',
            }}
          >
            {loading ? '...' : '↺ REFRESH'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px' }}>
        {loading && !result ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-muted-foreground)',
          }}>
            <span className="blink">▮</span>
            <span>Analyzing mission status…</span>
          </div>
        ) : result ? (
          <div>
            {/* Risk badge */}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: riskColor[risk],
              padding: '2px 6px',
              border: `1px solid ${riskBorder[risk]}`,
              borderRadius: 2,
              marginBottom: 8,
              display: 'inline-block',
            }}>
              {risk.toUpperCase()} RISK
            </span>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              lineHeight: 1.65,
              color: 'var(--color-card-foreground)',
              margin: '8px 0 0',
              whiteSpace: 'pre-wrap',
            }}>
              {result.narrative}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
