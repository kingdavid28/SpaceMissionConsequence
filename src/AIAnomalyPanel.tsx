/**
 * AI Anomaly Predictions Panel
 * Shows trend-based early-warning predictions derived from sensor history.
 */
import { useMemo } from 'react'
import { useTelemetry } from './telemetry'
import { detectAnomalies, type AnomalyPrediction } from './ai'

const sevColor: Record<string, string> = {
  critical: '#ff3b3b',
  warning: '#f5a623',
  watch: '#00d4ff',
}

const sevBg: Record<string, string> = {
  critical: 'rgba(255,59,59,0.07)',
  warning: 'rgba(245,166,35,0.06)',
  watch: 'rgba(0,212,255,0.05)',
}

const sevBorder: Record<string, string> = {
  critical: 'rgba(255,59,59,0.35)',
  warning: 'rgba(245,166,35,0.28)',
  watch: 'rgba(0,212,255,0.22)',
}

function TrendArrow({ trend }: { trend: AnomalyPrediction['trend'] }) {
  const symbol = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→'
  const color = trend === 'rising' ? '#f5a623' : trend === 'falling' ? '#00d4ff' : '#5a7a9a'
  return <span style={{ color, fontFamily: 'var(--font-mono)', fontSize: 14 }}>{symbol}</span>
}

function AnomalyRow({ pred }: { pred: AnomalyPrediction }) {
  const timeLabel = pred.estimatedTimeToBreachMin !== null
    ? `~${pred.estimatedTimeToBreachMin} min`
    : pred.severity === 'critical' ? 'NOW' : '—'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '9px 12px',
      background: sevBg[pred.severity],
      border: `1px solid ${sevBorder[pred.severity]}`,
      borderRadius: 2,
    }}>
      {/* Severity badge */}
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: sevColor[pred.severity],
        padding: '2px 5px',
        border: `1px solid ${sevBorder[pred.severity]}`,
        borderRadius: 2,
        flexShrink: 0,
        marginTop: 1,
        minWidth: 58,
        textAlign: 'center',
      }}>
        {pred.severity}
      </span>

      {/* Content */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: sevColor[pred.severity],
          }}>
            {pred.label} <TrendArrow trend={pred.trend} />
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: sevColor[pred.severity],
          }}>
            {pred.currentValue.toFixed(pred.unit === '%' && pred.currentValue > 1 ? 1 : 3)}{pred.unit}
          </span>
        </div>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          margin: 0,
          lineHeight: 1.5,
        }}>
          {pred.message}
        </p>
      </div>

      {/* Time to breach */}
      <div style={{
        flexShrink: 0,
        textAlign: 'right',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', letterSpacing: '0.08em' }}>
          T-BREACH
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 15,
          color: pred.estimatedTimeToBreachMin !== null && pred.estimatedTimeToBreachMin <= 10
            ? '#ff3b3b'
            : sevColor[pred.severity],
          fontWeight: 700,
        }}>
          {timeLabel}
        </span>
      </div>
    </div>
  )
}

export default function AIAnomalyPanel() {
  const { trends } = useTelemetry()

  const predictions = useMemo(() => {
    if (!trends) return []
    return detectAnomalies(trends)
  }, [trends])

  if (predictions.length === 0) {
    return (
      <div style={{
        padding: '12px 14px',
        background: 'rgba(0,255,157,0.04)',
        border: '1px solid rgba(0,255,157,0.15)',
        borderRadius: 2,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: '#00ff9d',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ opacity: 0.7 }}>◉</span>
        <span>No anomalies detected — all sensor trends nominal</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
          letterSpacing: '0.08em',
        }}>
          {predictions.length} trend{predictions.length !== 1 ? 's' : ''} flagged — sorted by severity
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          padding: '1px 5px',
          background: 'rgba(0,212,255,0.06)',
          border: '1px solid rgba(0,212,255,0.18)',
          borderRadius: 2,
          color: 'var(--color-primary)',
          letterSpacing: '0.08em',
        }}>
          LINEAR REGRESSION
        </span>
      </div>
      {predictions.map(p => <AnomalyRow key={p.sensor} pred={p} />)}
    </div>
  )
}
