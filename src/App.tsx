import { useState, useEffect, useRef, useCallback } from 'react'
import { useTelemetry, type Alert, type AlertLevel, type TelemetryItem } from './telemetry'
import AISummaryPanel from './AISummaryPanel'
import AIAnomalyPanel from './AIAnomalyPanel'
import ProcedureQA from './ProcedureQA'
import { scoreDecisions, recommendResearchAction, activeProvider, type DecisionScore, type CrisisContext, type ResearchRecommendation } from './ai'
import { useToasts, ToastStack } from './Toast'
import { loadExperiments, sortedExperiments, DOMAIN_COLOR, DOMAIN_BG, type Experiment } from './nasaOsdr'

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = 'eclss' | 'power' | 'comms' | 'mission' | 'ai'

interface Decision {
  id: number
  label: string
  action: string
  consequence: string
  risk: AlertLevel
}

interface GuidanceStep {
  step: number
  instruction: string
  substep?: string
  confirmed: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(d: Date) {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function missionElapsed() {
  const epoch = new Date('2026-06-01T08:00:00Z').getTime()
  const now = Date.now()
  const diff = Math.floor((now - epoch) / 1000)
  const d = Math.floor(diff / 86400)
  const h = Math.floor((diff % 86400) / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `MET ${d.toString().padStart(3, '0')}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const alertColor: Record<AlertLevel, string> = {
  stable: '#00ff9d',
  warning: '#f5a623',
  critical: '#ff3b3b',
}

const alertBg: Record<AlertLevel, string> = {
  stable: 'rgba(0,255,157,0.06)',
  warning: 'rgba(245,166,35,0.08)',
  critical: 'rgba(255,59,59,0.1)',
}

const alertBorder: Record<AlertLevel, string> = {
  stable: 'rgba(0,255,157,0.25)',
  warning: 'rgba(245,166,35,0.35)',
  critical: 'rgba(255,59,59,0.45)',
}

// ── Gauge SVG ──────────────────────────────────────────────────────────────
function RadialGauge({
  value,
  max,
  label,
  unit,
  status,
  size = 88,
}: {
  value: number
  max: number
  label: string
  unit: string
  status: AlertLevel
  size?: number
}) {
  const r = (size - 12) / 2
  const circ = 2 * Math.PI * r
  const pct = Math.min(value / max, 1)
  const arc = pct * circ * 0.75
  const gap = circ - arc
  const rotation = -225
  const color = alertColor[status]
  const decimals = unit === '%' ? (max >= 1 ? 1 : 2) : 1
  const displayValue = value.toFixed(decimals)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: `rotate(${rotation}deg)` }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-track)"
            strokeWidth={5}
            strokeDasharray={`${circ * 0.75} ${circ}`}
            strokeLinecap="round"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeDasharray={`${arc} ${circ}`}
            strokeLinecap="round"
            className="gauge-ring"
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 17, color, lineHeight: 1 }}>
            {displayValue}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', marginTop: 1 }}>
            {unit}
          </span>
        </div>
      </div>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase' }}>
        {label}
      </span>
    </div>
  )
}

// ── Mini Bar Gauge ─────────────────────────────────────────────────────────
function BarGauge({ label, value, unit, percent, status }: TelemetryItem) {
  const color = alertColor[status]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color }}>
          {value} <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>{unit}</span>
        </span>
      </div>
      <div style={{ height: 4, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: color,
            borderRadius: 2,
            boxShadow: `0 0 8px ${color}`,
            transition: 'width 1s ease',
          }}
        />
      </div>
    </div>
  )
}

// ── Alert Card ─────────────────────────────────────────────────────────────
function AlertCard({ alert, compact }: { alert: Alert; compact?: boolean }) {
  const cls = alert.level === 'critical' ? 'alert-critical' : alert.level === 'warning' ? 'alert-warning' : ''
  return (
    <div
      className={`corner-clip-sm ${cls}`}
      style={{
        background: alertBg[alert.level],
        border: `1px solid ${alertBorder[alert.level]}`,
        padding: compact ? '8px 12px' : '12px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: alertColor[alert.level] }} />
      <div style={{ paddingLeft: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.15em',
              color: alertColor[alert.level],
              textTransform: 'uppercase',
              padding: '2px 5px',
              border: `1px solid ${alertBorder[alert.level]}`,
              borderRadius: 2,
            }}>
              {alert.level}
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: alertColor[alert.level] }}>
              {alert.system}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)' }}>{alert.time}</span>
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-card-foreground)', margin: '0 0 4px' }}>
          {alert.message}
        </p>
        {!compact && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: alertColor[alert.level], margin: 0, opacity: 0.85 }}>
            ⟶ {alert.prediction}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Panel wrapper ──────────────────────────────────────────────────────────
function Panel({ children, title, status, className = '', style = {} }: {
  children: React.ReactNode
  title?: string
  status?: AlertLevel
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={`corner-clip ${className}`}
      style={{
        background: 'var(--color-card)',
        border: `1px solid ${status ? alertBorder[status] : 'var(--color-border)'}`,
        overflow: 'hidden',
        ...style,
      }}
    >
      {title && (
        <div style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${status ? alertBorder[status] : 'var(--color-border)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--color-raised)',
        }}>
          {status && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: alertColor[status],
              boxShadow: `0 0 6px ${alertColor[status]}`,
              flexShrink: 0,
            }} className={status !== 'stable' ? (status === 'critical' ? 'alert-critical' : 'alert-warning') : ''} />
          )}
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-muted-foreground)',
          }}>
            {title}
          </span>
        </div>
      )}
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  )
}

// ── ECLSS Tab ──────────────────────────────────────────────────────────────
function EclssTab() {
  const { eclss } = useTelemetry()
  const { gauges, bars } = eclss
  const co2Scrubber = bars.find((b) => b.label === 'CO₂ Scrubber Load')

  return (
    <div className="mce-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Panel title="Atmosphere Composition" status="stable" style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 16, padding: '4px 0' }}>
          {gauges.map(g => <RadialGauge key={g.label} {...g} size={96} />)}
        </div>
      </Panel>

      <Panel title="Life Support Systems" status="stable">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bars.slice(0, 3).map(b => <BarGauge key={b.label} {...b} />)}
        </div>
      </Panel>

      <Panel title="Environmental Control" status="warning">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {bars.slice(3).map(b => <BarGauge key={b.label} {...b} />)}
        </div>
        <div style={{
          marginTop: 12, padding: '8px 10px',
          background: 'rgba(245,166,35,0.07)',
          border: '1px solid rgba(245,166,35,0.25)',
          borderRadius: 2,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: '#f5a623',
        }}>
          ⚠ CO₂ scrubber at {co2Scrubber ? co2Scrubber.value + '%' : '61%'} — schedule lithium hydroxide canister swap within 14 hrs
        </div>
      </Panel>

      <Panel title="ECLSS Event Log" style={{ gridColumn: 'span 2' }}>
        {[
          { t: '14:32:08', msg: 'Water recovery unit cycle completed — 2.3L recovered', lvl: 'stable' },
          { t: '13:58:44', msg: 'CO₂ partial pressure spike detected (0.42% → 0.51%) — transient', lvl: 'warning' },
          { t: '12:11:22', msg: 'Cabin humidity trending +3.2% over 2-hour window', lvl: 'warning' },
          { t: '09:04:51', msg: 'O₂ generation nominal — electrolysis rate 0.84 kg/day', lvl: 'stable' },
        ].map(e => (
          <div key={e.t} style={{
            display: 'flex', gap: 12, padding: '6px 0',
            borderBottom: '1px solid var(--color-border)',
            alignItems: 'flex-start',
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', flexShrink: 0, paddingTop: 1 }}>{e.t}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: e.lvl === 'stable' ? 'var(--color-card-foreground)' : alertColor[e.lvl as AlertLevel] }}>{e.msg}</span>
          </div>
        ))}
      </Panel>
    </div>
  )
}

// ── Power Tab ──────────────────────────────────────────────────────────────
function PowerTab() {
  const { power } = useTelemetry()
  const { batteries, totalChargePct, bat3Alert, loads, totalLoad } = power

  // Compute solar generation (static arrays — no solar sensor in server yet)
  const solarVals = [98.2, 96.8, 99.1, 97.4]
  const solarWatts = [18420, 18104, 18532, 18288]
  const totalGen = solarWatts.reduce((a, b) => a + b, 0)
  const netBalance = totalGen - totalLoad
  const netStr = (netBalance >= 0 ? '+' : '') + netBalance.toLocaleString()

  // Aggregate main power charge color
  const mainPowerStatus: AlertLevel =
    totalChargePct < 50 ? 'critical' : totalChargePct < 70 ? 'warning' : 'stable'

  // Worst battery status for Panel header
  const worstBatStatus: AlertLevel = batteries.some(b => b.status === 'critical')
    ? 'critical'
    : batteries.some(b => b.status === 'warning')
    ? 'warning'
    : 'stable'

  return (
    <div className="mce-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

      {/* ── Solar Array + Main Power Remaining ── */}
      <Panel title="Solar Array Output" status="stable" style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Main power radial gauge */}
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            padding: '10px 16px',
            background: alertBg[mainPowerStatus],
            border: `1px solid ${alertBorder[mainPowerStatus]}`,
            borderRadius: 2,
            minWidth: 112,
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>Main Power</span>
            <RadialGauge
              value={totalChargePct}
              max={100}
              label=""
              unit="%"
              status={mainPowerStatus}
              size={88}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', lineHeight: 1.3 }}>
              avg charge<br />across 4 batteries
            </span>
          </div>

          {/* Solar array cards */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
              {['SA-1A', 'SA-1B', 'SA-2A', 'SA-2B'].map((id, i) => (
                <div key={id} style={{
                  background: 'rgba(0,255,157,0.04)',
                  border: '1px solid rgba(0,255,157,0.15)',
                  borderRadius: 2,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{id}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: '#00ff9d', lineHeight: 1 }}>{solarVals[i]}<span style={{ fontSize: 12 }}>%</span></span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>{solarWatts[i].toLocaleString()} W</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 24, paddingTop: 12, borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
              {[
                { label: 'Total Generation',  value: totalGen.toLocaleString(),        unit: 'W' },
                { label: 'Total Consumption', value: totalLoad.toLocaleString(),        unit: 'W' },
                { label: 'Net Balance',        value: netStr,                            unit: 'W' },
                { label: 'Next Eclipse',       value: '01:42:17',                       unit: '' },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{s.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: s.value.startsWith('+') ? '#00ff9d' : s.value.startsWith('-') ? alertColor['warning'] : 'var(--color-foreground)' }}>
                    {s.value} <span style={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}>{s.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* ── Battery Status ── */}
      <Panel title="Battery Status" status={worstBatStatus}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {batteries.map(b => (
            <div key={b.id} style={{
              padding: '10px 12px',
              background: alertBg[b.status],
              border: `1px solid ${alertBorder[b.status]}`,
              borderRadius: 2,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', color: alertColor[b.status] }}>{b.id}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>
                  {b.temp.toFixed(1)}°C {b.status !== 'stable' && <span style={{ color: alertColor[b.status] }}>↑</span>}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--color-track)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  height: '100%', width: `${b.charge}%`,
                  background: alertColor[b.status],
                  borderRadius: 3,
                  boxShadow: `0 0 8px ${alertColor[b.status]}`,
                  transition: 'width 1s ease',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: alertColor[b.status] }}>{b.charge.toFixed(1)}%</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>{b.voltage.toFixed(1)}V · {b.current.toFixed(1)}A</span>
              </div>
            </div>
          ))}
          {bat3Alert.status !== 'stable' && (
            <div style={{
              padding: '8px 10px',
              background: alertBg[bat3Alert.status],
              border: `1px solid ${alertBorder[bat3Alert.status]}`,
              borderRadius: 2,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: alertColor[bat3Alert.status],
            }}>
              ⚠ BAT-3 temp +{bat3Alert.delta}°C above nominal — predicted failure window: T+{bat3Alert.hoursToFail}h
            </div>
          )}
        </div>
      </Panel>

      {/* ── Load Distribution ── */}
      <Panel title="Load Distribution" status="stable">
        <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
            Total Consumption
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--color-foreground)' }}>
            {(totalLoad / 1000).toFixed(1)} kW
          </span>
        </div>
        {loads.map(item => {
          const pct = Math.round((item.load / totalLoad) * 100)
          const barPct = Math.round((item.load / item.max) * 100)
          const barColor = barPct > 90 ? alertColor['critical'] : barPct > 75 ? alertColor['warning'] : 'rgba(0,212,255,0.7)'
          return (
            <div key={item.sys} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-card-foreground)' }}>{item.sys}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', gap: 8 }}>
                  <span style={{ color: 'var(--color-foreground)' }}>{(item.load / 1000).toFixed(1)} kW</span>
                  <span style={{ color: 'var(--color-muted-foreground)', fontSize: 11 }}>{pct}%</span>
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${barPct}%`,
                  background: barColor,
                  borderRadius: 2,
                  transition: 'width 1s ease',
                }} />
              </div>
            </div>
          )
        })}
      </Panel>
    </div>
  )
}

// ── Signal bar sparkline (stable visual, updates when signal changes) ──────
function SignalBars({ signal, color }: { signal: number; color: string }) {
  const bars = Array.from({ length: 12 }, (_, i) => {
    const threshold = (i / 12) * 100
    return threshold <= signal
  })
  return (
    <div style={{ height: 24, background: 'var(--color-fill-weak)', borderRadius: 2, overflow: 'hidden', marginBottom: 8, display: 'flex', alignItems: 'flex-end' }}>
      {bars.map((lit, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${20 + (i / 11) * 80}%`,
          background: color,
          opacity: lit ? 0.6 + (i / 12) * 0.4 : 0.1,
          margin: '0 0.5px',
          borderRadius: '1px 1px 0 0',
          transition: 'opacity 1s ease',
        }} />
      ))}
    </div>
  )
}

// ── Countdown hook — counts down from a fixed UTC target time ──────────────
function useCountdown(targetUtcHHMM: string): string {
  const [display, setDisplay] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const [hh, mm] = targetUtcHHMM.split(':').map(Number)
      const target = new Date(now)
      target.setUTCHours(hh, mm, 0, 0)
      if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1)
      const diff = Math.floor((target.getTime() - now.getTime()) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setDisplay(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [targetUtcHHMM])
  return display
}

// ── Ground station row with live countdown ─────────────────────────────────
function GsRow({ gs, aos, duration }: { gs: string; aos: string; duration: string }) {
  const countdown = useCountdown(aos.replace(' UTC', ''))
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: '1px solid var(--color-border)',
    }}>
      <div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-card-foreground)' }}>{gs}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>AOS {aos} · {duration}</div>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--color-primary)', textAlign: 'right' }}>
        {countdown}
      </div>
    </div>
  )
}

// ── Comms Tab ──────────────────────────────────────────────────────────────
function CommsTab({ isOffline }: { isOffline: boolean }) {
  const { comms } = useTelemetry()
  const { links: liveLinks, totalBw, allocation } = comms

  // In offline mode override all non-UHF links to critical/0
  const links = liveLinks.map(l => isOffline && l.id !== 'UHF EVA'
    ? { ...l, status: 'critical' as AlertLevel, signal: 0, bw: 0 }
    : l
  )
  const effectiveTotalBw = isOffline ? 0.04 : totalBw
  const worstLinkStatus: AlertLevel = links.some(l => l.status === 'critical') ? 'critical'
    : links.some(l => l.status === 'warning') ? 'warning' : 'stable'

  return (
    <div className="mce-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

      {/* ── Link Status + Total BW rollup ── */}
      <Panel title="Link Status" status={isOffline ? 'critical' : worstLinkStatus} style={{ gridColumn: 'span 2' }}>
        {/* Total bandwidth summary row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
            Total Available Bandwidth
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, color: isOffline ? alertColor['critical'] : alertColor[worstLinkStatus] }}>
            {effectiveTotalBw.toFixed(1)} <span style={{ fontSize: 13, color: 'var(--color-muted-foreground)' }}>Mbps</span>
          </span>
        </div>
        <div className="mce-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {links.map(l => (
            <div key={l.id} style={{
              padding: '12px',
              background: alertBg[l.status],
              border: `1px solid ${alertBorder[l.status]}`,
              borderRadius: 2,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: alertColor[l.status], marginBottom: 8 }}>{l.id}</div>
              <SignalBars signal={l.signal} color={alertColor[l.status]} />
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{l.signal}%</span>
                <span>{l.signal === 0 ? '--' : `${l.latency}ms`}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: alertColor[l.status], marginTop: 4 }}>
                {l.signal === 0 ? 'NO CARRIER' : `${l.bw.toFixed(1)} Mbps`}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── Ground Station Contact with live countdowns ── */}
      <Panel title="Ground Station Contact" status="stable">
        {[
          { gs: 'Houston MCC',  aos: '14:48 UTC', duration: '28 min' },
          { gs: 'Svalbard',     aos: '16:10 UTC', duration: '9 min'  },
          { gs: 'White Sands',  aos: '17:34 UTC', duration: '22 min' },
          { gs: 'Madrid DSN',   aos: '19:00 UTC', duration: '14 min' },
        ].map(g => <GsRow key={g.gs} {...g} />)}
      </Panel>

      {/* ── Bandwidth Allocation — live from telemetry ── */}
      <Panel title="Bandwidth Allocation" status="stable">
        <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
            Capacity Utilisation
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-foreground)' }}>
            {effectiveTotalBw.toFixed(1)} Mbps total
          </span>
        </div>
        {allocation.map(b => (
          <div key={b.type} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, alignItems: 'baseline' }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-card-foreground)' }}>{b.type}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--color-foreground)' }}>{b.bw.toFixed(1)} Mbps</span>
                <span style={{ fontSize: 11 }}>{b.pct}%</span>
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${b.pct}%`,
                background: b.pct >= 100 ? alertColor['warning'] : 'rgba(0,212,255,0.6)',
                borderRadius: 2,
                transition: 'width 1s ease',
              }} />
            </div>
          </div>
        ))}
      </Panel>
    </div>
  )
}

// ── Research Action Panel ──────────────────────────────────────────────────
function ResearchActionPanel({ experiments, crewMaxFatigue, alertSystems }: {
  experiments: Experiment[]
  crewMaxFatigue: number
  alertSystems: string[]
}) {
  const [rec, setRec] = useState<ResearchRecommendation | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await recommendResearchAction(experiments, crewMaxFatigue, alertSystems)
      setRec(result)
    } finally {
      setLoading(false)
    }
  }, [experiments, crewMaxFatigue, alertSystems])

  // Run on mount and whenever experiment set changes
  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const urgencyColor = rec?.urgency === 'immediate' ? alertColor['critical']
    : rec?.urgency === 'next-shift' ? alertColor['warning']
    : alertColor['stable']

  const urgencyBg = rec?.urgency === 'immediate' ? alertBg['critical']
    : rec?.urgency === 'next-shift' ? alertBg['warning']
    : alertBg['stable']

  const urgencyBorder = rec?.urgency === 'immediate' ? alertBorder['critical']
    : rec?.urgency === 'next-shift' ? alertBorder['warning']
    : alertBorder['stable']

  return (
    <div style={{
      padding: '12px 14px',
      background: rec ? urgencyBg : 'var(--color-raised)',
      border: `1px solid ${rec ? urgencyBorder : 'var(--color-border)'}`,
      borderRadius: 2,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
            Next Research Action
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            padding: '1px 5px',
            background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)',
            borderRadius: 2, color: 'var(--color-primary)', letterSpacing: '0.08em',
          }}>
            {rec ? `${rec.generatedBy === 'watsonx' ? 'IBM watsonx' : rec.generatedBy === 'openai' ? 'OpenAI' : 'Local Engine'}` : activeProvider() === 'watsonx' ? 'IBM watsonx' : activeProvider() === 'openai' ? 'OpenAI' : 'Local Engine'}
          </span>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: loading ? 'var(--color-muted-foreground)' : 'var(--color-primary)',
            background: 'none', border: '1px solid var(--color-border)',
            padding: '2px 7px', cursor: loading ? 'not-allowed' : 'pointer',
            borderRadius: 2, letterSpacing: '0.1em',
          }}
        >
          {loading ? '...' : '↺'}
        </button>
      </div>

      {loading && !rec ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-muted-foreground)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="blink">▮</span><span>Analyzing science priorities…</span>
        </div>
      ) : rec ? (
        <div>
          {/* Urgency badge */}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
            color: urgencyColor, padding: '2px 6px', border: `1px solid ${urgencyBorder}`,
            borderRadius: 2, display: 'inline-block', marginBottom: 8,
          }}>
            {rec.urgency.toUpperCase().replace('-', ' ')}
          </span>
          {/* Action */}
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.6, color: 'var(--color-card-foreground)', margin: '0 0 6px' }}>
            {rec.action}
          </p>
          {/* Rationale */}
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', margin: 0, lineHeight: 1.5 }}>
            {rec.rationale}
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ── Mission Tab ────────────────────────────────────────────────────────────
function MissionTab() {
  const { crew, alerts } = useTelemetry()

  // Load experiments from NASA OSDR (with offline fallback)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [dataSource, setDataSource] = useState<'live' | 'offline' | 'loading'>('loading')
  useEffect(() => {
    loadExperiments().then(exps => {
      setExperiments(sortedExperiments(exps))
      setDataSource(exps.some(e => e.isLive) ? 'live' : 'offline')
    })
  }, [])

  const sorted = sortedExperiments(experiments)
  const atRisk = sorted.filter(e => e.status === 'critical')
  const expStatus: AlertLevel = atRisk.length > 0 ? 'critical'
    : sorted.some(e => e.status === 'warning') ? 'warning' : 'stable'

  // Crew metrics for research recommendation
  const crewMaxFatigue = Math.max(0, ...crew.map(c => c.fatigue))
  const activeAlertSystems = alerts.filter(a => a.level !== 'stable').map(a => a.system)

  // Schedule events with UTC start times; derive status from real clock
  const scheduleEvents = [
    { utcH: 14, utcM: 0,  event: 'USOS Housekeeping (Node 1)',    crewLabel: 'Williams'         },
    { utcH: 14, utcM: 45, event: 'MSG-4 Experiment Run #12',      crewLabel: 'Borisenko'        },
    { utcH: 16, utcM: 30, event: 'EVA Suit Integrity Check',      crewLabel: 'Williams / Chen'  },
    { utcH: 18, utcM: 0,  event: 'MCC Houston Video Conference',  crewLabel: 'All Crew'         },
    { utcH: 20, utcM: 30, event: 'CFE-3 Data Downlink',           crewLabel: 'Chen'             },
    { utcH: 22, utcM: 0,  event: 'Crew Sleep Period',             crewLabel: 'All Crew'         },
  ]

  const [nowMin, setNowMin] = useState(() => {
    const n = new Date()
    return n.getUTCHours() * 60 + n.getUTCMinutes()
  })
  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date()
      setNowMin(n.getUTCHours() * 60 + n.getUTCMinutes())
    }, 10000)
    return () => clearInterval(t)
  }, [])

  const enriched = scheduleEvents.map((ev, i) => {
    const evMin = ev.utcH * 60 + ev.utcM
    const nextEvMin = i < scheduleEvents.length - 1
      ? scheduleEvents[i + 1].utcH * 60 + scheduleEvents[i + 1].utcM
      : 24 * 60
    let status: 'complete' | 'active' | 'upcoming'
    if (nowMin >= nextEvMin) status = 'complete'
    else if (nowMin >= evMin) status = 'active'
    else status = 'upcoming'
    const timeLabel = `${ev.utcH.toString().padStart(2, '0')}:${ev.utcM.toString().padStart(2, '0')} UTC`
    return { ...ev, timeLabel, status }
  })

  const colors    = { complete: '#5a7a9a', active: '#00d4ff', upcoming: 'var(--color-card-foreground)' } as const
  const dotColors = { complete: '#5a7a9a', active: '#00d4ff', upcoming: '#2a4a6a' } as const

  const crewOverallStatus: AlertLevel = crew.some(c => c.fatigueStatus === 'critical' || c.hrStatus === 'critical' || c.spo2Status === 'critical')
    ? 'critical'
    : crew.some(c => c.fatigueStatus === 'warning' || c.hrStatus === 'warning' || c.spo2Status === 'warning')
    ? 'warning' : 'stable'

  return (
    <div className="mce-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

      {/* ── Mission Schedule ── */}
      <Panel title="Mission Schedule" status="stable" style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {enriched.map(ev => (
            <div key={ev.timeLabel} style={{
              display: 'flex', gap: 12, alignItems: 'center',
              padding: '7px 0', borderBottom: '1px solid var(--color-border)',
              opacity: ev.status === 'complete' ? 0.5 : 1,
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: colors[ev.status], width: 72, flexShrink: 0 }}>{ev.timeLabel}</span>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: dotColors[ev.status],
                boxShadow: ev.status === 'active' ? '0 0 8px rgba(0,212,255,0.8)' : 'none',
              }} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: colors[ev.status], flex: 1 }}>{ev.event}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>{ev.crewLabel}</span>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── Crew Status ── */}
      <Panel title="Crew Status" status={crewOverallStatus}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {crew.map(c => {
            const worstMember: AlertLevel = [c.hrStatus, c.spo2Status, c.fatigueStatus].includes('critical')
              ? 'critical' : [c.hrStatus, c.spo2Status, c.fatigueStatus].includes('warning') ? 'warning' : 'stable'
            return (
              <div key={c.id} style={{ padding: '10px 12px', background: alertBg[worstMember], border: `1px solid ${alertBorder[worstMember]}`, borderRadius: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
                  <div>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', color: alertColor[worstMember] }}>{c.id}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', marginLeft: 8 }}>{c.role}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>
                    Duty {c.dutyHrs.toFixed(1)}h · Rest in {Math.max(0, c.restDue).toFixed(1)}h
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  <div style={{ padding: '6px 8px', background: 'var(--color-fill-weak)', borderRadius: 2 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 2 }}>Heart Rate</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: alertColor[c.hrStatus], lineHeight: 1 }}>{c.hr} <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>bpm</span></div>
                  </div>
                  <div style={{ padding: '6px 8px', background: 'var(--color-fill-weak)', borderRadius: 2 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 2 }}>SpO₂</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: alertColor[c.spo2Status], lineHeight: 1 }}>{c.spo2.toFixed(1)} <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>%</span></div>
                  </div>
                  <div style={{ padding: '6px 8px', background: 'var(--color-fill-weak)', borderRadius: 2 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 2 }}>Fatigue</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: alertColor[c.fatigueStatus], lineHeight: 1 }}>{c.fatigue.toFixed(0)} <span style={{ fontSize: 11, color: 'var(--color-muted-foreground)' }}>%</span></div>
                  </div>
                </div>
                <div style={{ marginTop: 8, height: 3, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${c.fatigue}%`, background: alertColor[c.fatigueStatus], borderRadius: 2, transition: 'width 2s ease' }} />
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* ── Active Experiments — from NASA OSDR ── */}
      <Panel title="Active Experiments" status={expStatus}>
        {/* Data source badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
            {sorted.length} experiment{sorted.length !== 1 ? 's' : ''} tracked
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            padding: '1px 6px',
            background: dataSource === 'live' ? 'rgba(0,255,157,0.07)' : 'rgba(90,122,154,0.12)',
            border: `1px solid ${dataSource === 'live' ? 'rgba(0,255,157,0.25)' : 'rgba(90,122,154,0.3)'}`,
            borderRadius: 2,
            color: dataSource === 'live' ? '#00ff9d' : 'var(--color-muted-foreground)',
            letterSpacing: '0.1em',
          }}>
            {dataSource === 'live' ? '◉ NASA OSDR LIVE' : dataSource === 'loading' ? 'LOADING…' : '◎ OFFLINE DATA'}
          </span>
        </div>

        {/* At-risk callout */}
        {atRisk.length > 0 && (
          <div style={{
            marginBottom: 10, padding: '8px 10px',
            background: alertBg['critical'], border: `1px solid ${alertBorder['critical']}`,
            borderRadius: 2, fontFamily: 'var(--font-mono)', fontSize: 12, color: alertColor['critical'],
          }}>
            ⚠ {atRisk.length} P1 experiment{atRisk.length > 1 ? 's' : ''} at critical risk: {atRisk.map(e => e.id).join(', ')} — immediate crew intervention required
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(e => (
            <div key={e.id} style={{
              padding: '10px 12px',
              background: alertBg[e.status],
              border: `1px solid ${alertBorder[e.status]}`,
              borderRadius: 2,
            }}>
              {/* Title row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  {/* ID + priority badge */}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: alertColor[e.status] }}>{e.id}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                      padding: '1px 4px',
                      background: e.priority === 'P1' ? 'rgba(255,59,59,0.1)' : e.priority === 'P2' ? 'rgba(245,166,35,0.1)' : 'rgba(90,122,154,0.1)',
                      border: `1px solid ${e.priority === 'P1' ? 'rgba(255,59,59,0.3)' : e.priority === 'P2' ? 'rgba(245,166,35,0.3)' : 'rgba(90,122,154,0.3)'}`,
                      color: e.priority === 'P1' ? '#ff3b3b' : e.priority === 'P2' ? '#f5a623' : '#5a7a9a',
                      borderRadius: 2,
                    }}>{e.priority}</span>
                    {/* Domain badge */}
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
                      padding: '1px 4px',
                      background: DOMAIN_BG[e.domain],
                      border: `1px solid ${DOMAIN_COLOR[e.domain].replace('0.8', '0.3')}`,
                      color: DOMAIN_COLOR[e.domain],
                      borderRadius: 2, whiteSpace: 'nowrap',
                    }}>{e.domain}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-card-foreground)' }}>{e.name}</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap', flexShrink: 0 }}>{e.eta}</span>
              </div>
              {/* Objective */}
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)',
                margin: '0 0 7px', lineHeight: 1.5,
              }}>
                {e.objective}
              </p>
              {/* Progress bar */}
              <div style={{ height: 3, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${e.progress}%`, background: alertColor[e.status], borderRadius: 2, transition: 'width 1s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: alertColor[e.status] }}>{e.progress}% complete</span>
                {e.isLive && (
                  <a href={e.sourceRef} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-primary)', textDecoration: 'none', letterSpacing: '0.08em' }}>
                    NASA OSDR ↗
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* ── Right column: Research Action + Orbital Parameters ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* AI Research Action Recommendation */}
        {experiments.length > 0 && (
          <ResearchActionPanel
            experiments={sorted}
            crewMaxFatigue={crewMaxFatigue}
            alertSystems={activeAlertSystems}
          />
        )}

        {/* Orbital Parameters */}
        <Panel title="Orbital Parameters" status="stable">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Altitude (Apo)',  value: '421.3 km' },
              { label: 'Altitude (Peri)', value: '418.7 km' },
              { label: 'Inclination',     value: '51.64°'   },
              { label: 'Period',          value: '92.68 min' },
              { label: 'Velocity',        value: '7.66 km/s' },
              { label: 'Revolutions',     value: '142,388'  },
            ].map(p => (
              <div key={p.label} style={{ padding: '8px 10px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 2 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--color-primary)' }}>{p.value}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ── Offline Guidance Overlay ────────────────────────────────────────────────
function OfflineGuidance({ onClose }: { onClose: () => void }) {
  const initialSteps: GuidanceStep[] = [
    { step: 1, instruction: 'Verify manual O₂ flow valve is in OPEN position', substep: 'Located on panel A7, Junction Connector J2', confirmed: false },
    { step: 2, instruction: 'Confirm CDR/PLT O₂ masks are donned and sealed', substep: 'Check seal integrity — green indicator light required', confirmed: false },
    { step: 3, instruction: 'Switch ECLSS to emergency backup mode', substep: 'Switch SW-14 on panel R14 — lift guard, flip to BACKUP', confirmed: false },
    { step: 4, instruction: 'Verify CO₂ scrubber LiOH canister is active', substep: 'Canister must show GREEN on temp strip — replace if not', confirmed: false },
    { step: 5, instruction: 'Report system status to MCC via UHF if available', substep: 'UHF is operational independent of TDRS — priority channel 296.8 MHz', confirmed: false },
    { step: 6, instruction: 'Begin 30-minute atmosphere monitoring cycle', substep: 'Record O₂ and CO₂ readings every 5 minutes in IFS log', confirmed: false },
  ]

  const [steps, setSteps] = useState(initialSteps)

  const confirm = (i: number) => {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, confirmed: true } : s))
  }

  const active = steps.findIndex(s => !s.confirmed)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'var(--color-overlay)',
      backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '14px 24px',
        borderBottom: '1px solid rgba(255,59,59,0.3)',
        background: 'rgba(255,59,59,0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            padding: '4px 10px',
            background: 'rgba(255,59,59,0.15)',
            border: '1px solid rgba(255,59,59,0.5)',
            borderRadius: 2,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: '#ff3b3b',
            letterSpacing: '0.15em',
          }} className="alert-critical">
            ◉ OFFLINE MODE ACTIVE
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-foreground)' }}>
            Emergency Atmosphere Procedure — EAP-04
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--color-muted-foreground)',
            background: 'none',
            border: '1px solid var(--color-border)',
            padding: '5px 12px',
            cursor: 'pointer',
            letterSpacing: '0.1em',
            borderRadius: 2,
          }}
        >
          CLOSE
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760, margin: '0 auto', width: '100%' }}>
        <div style={{
          padding: '10px 16px',
          background: 'rgba(245,166,35,0.07)',
          border: '1px solid rgba(245,166,35,0.3)',
          borderRadius: 2,
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          color: '#f5a623',
          marginBottom: 8,
        }}>
          Earth communications unavailable. Executing cached emergency procedure. Complete each step and confirm before proceeding.
        </div>

        {steps.map((s, i) => {
          const isActive = i === active
          const isDone = s.confirmed
          return (
            <div
              key={s.step}
              className={`corner-clip-sm`}
              style={{
                background: isDone ? 'rgba(0,255,157,0.04)' : isActive ? 'rgba(0,212,255,0.06)' : 'var(--color-raised)',
                border: `1px solid ${isDone ? 'rgba(0,255,157,0.2)' : isActive ? 'rgba(0,212,255,0.3)' : 'var(--color-track)'}`,
                padding: '14px 16px',
                display: 'flex', gap: 16, alignItems: 'flex-start',
                opacity: !isActive && !isDone ? 0.4 : 1,
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isDone ? 'rgba(0,255,157,0.15)' : isActive ? 'rgba(0,212,255,0.12)' : 'var(--color-fill-weak)',
                border: `1px solid ${isDone ? 'rgba(0,255,157,0.4)' : isActive ? 'rgba(0,212,255,0.4)' : 'var(--color-border)'}`,
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                color: isDone ? '#00ff9d' : isActive ? '#00d4ff' : 'var(--color-muted-foreground)',
              }}>
                {isDone ? '✓' : s.step}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: isDone ? '#00ff9d' : isActive ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
                  marginBottom: 4,
                }}>
                  {s.instruction}
                </div>
                {s.substep && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-muted-foreground)' }}>
                    ↳ {s.substep}
                  </div>
                )}
              </div>
              {isActive && (
                <button
                  onClick={() => confirm(i)}
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 13,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--color-primary)',
                    background: 'rgba(0,212,255,0.08)',
                    border: '1px solid rgba(0,212,255,0.4)',
                    padding: '6px 14px',
                    cursor: 'pointer',
                    borderRadius: 2,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  Confirm
                </button>
              )}
            </div>
          )
        })}

        {active === -1 && (
          <div style={{
            marginTop: 8,
            padding: '16px',
            background: 'rgba(0,255,157,0.06)',
            border: '1px solid rgba(0,255,157,0.3)',
            borderRadius: 2,
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: '#00ff9d',
            textAlign: 'center',
          }}>
            ✓ ALL STEPS CONFIRMED — ATMOSPHERE STABLE — LOG ENTRY CREATED
          </div>
        )}
      </div>
    </div>
  )
}

// ── Crisis Decision Panel ───────────────────────────────────────────────────
function CrisisPanel({ onDismiss }: { onDismiss: () => void }) {
  const { eclss, alerts, trends } = useTelemetry()
  const [selected, setSelected] = useState<number | null>(null)
  const [aiScores, setAiScores] = useState<DecisionScore[] | null>(null)
  const [scoring, setScoring] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  const decisions: Decision[] = [
    {
      id: 1,
      label: 'Option Alpha',
      action: 'Shut down camera systems; maintain O₂ at full flow',
      consequence: 'Video monitoring lost for 4+ hours. Life support unaffected. Recommended for crew safety.',
      risk: 'stable',
    },
    {
      id: 2,
      label: 'Option Bravo',
      action: 'Reduce non-critical power draw by 18%; maintain communications',
      consequence: 'Science payloads offline. Comms preserved. BAT-3 temp stabilized within 30 min.',
      risk: 'warning',
    },
    {
      id: 3,
      label: 'Option Charlie',
      action: 'Switch primary bus to backup battery array',
      consequence: 'Full system continuity. Backup reserves at 62% — limited to 6.2-hour window before critical.',
      risk: 'critical',
    },
  ]

  // Auto-score on mount using live sensor state
  useEffect(() => {
    const o2Gauge = eclss.gauges.find(g => g.label === 'O₂ Level')
    const bat3Alert = alerts.find(a => a.system === 'Power')
    const batTrend = trends?.bat3Temp ?? []
    const slope = batTrend.length >= 2
      ? batTrend[batTrend.length - 1] - batTrend[batTrend.length - 2]
      : 0

    const ctx: CrisisContext = {
      bat3Temp: batTrend[batTrend.length - 1] ?? 31.4,
      bat3TempTrend: slope > 0.01 ? 'rising' : slope < -0.01 ? 'falling' : 'stable',
      scrubLoad: Number(eclss.bars.find(b => b.label === 'CO₂ Scrubber Load')?.value ?? 61),
      o2Level: o2Gauge?.value ?? 20.9,
      tdrsSignal: trends?.tdrsWest?.[trends.tdrsWest.length - 1] ?? 71,
      backupReserve: 62,
    }

    setScoring(true)
    scoreDecisions(ctx)
      .then(setAiScores)
      .finally(() => setScoring(false))

    void bat3Alert // consumed for context above
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const scoreMap = aiScores ? Object.fromEntries(aiScores.map(s => [s.id, s])) : {}

  // Focus the dialog on mount; restore focus on unmount
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => prev?.focus()
  }, [])

  // Keyboard: Escape → dismiss; 1/2/3 → select option; Enter → confirm
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onDismiss(); return }
      if (e.key === '1') setSelected(1)
      if (e.key === '2') setSelected(2)
      if (e.key === '3') setSelected(3)
      if (e.key === 'Enter' && selected !== null) onDismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, onDismiss])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="crisis-title"
      aria-describedby="crisis-desc"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'var(--color-overlay)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="corner-clip"
        style={{
          background: 'var(--color-card)',
          border: '1px solid rgba(255,59,59,0.4)',
          maxWidth: 660,
          width: '100%',
          boxShadow: '0 0 60px rgba(255,59,59,0.12)',
          maxHeight: '90vh',
          overflow: 'auto',
          outline: 'none',
        }}
      >
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(255,59,59,0.3)',
          background: 'rgba(255,59,59,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          position: 'sticky', top: 0, zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#ff3b3b', fontFamily: 'var(--font-mono)', fontSize: 13, letterSpacing: '0.15em' }} className="alert-critical">■ CRISIS DECISION REQUIRED</span>
          </div>
          <button onClick={onDismiss} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)', background: 'none', border: '1px solid var(--color-border)', padding: '5px 12px', cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>
            DEFER
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{
            padding: '10px 14px',
            background: 'rgba(255,59,59,0.07)',
            border: '1px solid rgba(255,59,59,0.25)',
            borderRadius: 2,
            marginBottom: 16,
          }}>
            <div id="crisis-title" style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#ff3b3b', marginBottom: 4, letterSpacing: '0.05em' }}>
              BAT-3 Temperature Anomaly — Predicted Main Bus Failure
            </div>
            <div id="crisis-desc" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-card-foreground)' }}>
              Battery temp rising at +0.25°C/hr. Projected failure: T+7h54m. Immediate load management required.
              <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                Keyboard: 1 / 2 / 3 to select · Enter to confirm · Esc to defer
              </span>
            </div>
          </div>

          {/* AI Scoring header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              color: 'var(--color-muted-foreground)',
            }}>
              Response Options
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              padding: '1px 5px',
              background: 'rgba(0,212,255,0.06)',
              border: '1px solid rgba(0,212,255,0.18)',
              borderRadius: 2, color: 'var(--color-primary)',
              letterSpacing: '0.08em',
            }}>
              {scoring ? 'AI SCORING…' : aiScores ? 'AI SCORED' : 'AI SCORING'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {decisions.map(d => {
              const score = scoreMap[d.id]
              const isRecommended = score?.recommended === true
              return (
                <button
                  key={d.id}
                  onClick={() => setSelected(d.id)}
                  style={{
                    textAlign: 'left',
                    background: selected === d.id ? alertBg[d.risk] : 'var(--color-fill)',
                    border: `1px solid ${selected === d.id ? alertBorder[d.risk] : isRecommended ? 'rgba(0,212,255,0.35)' : 'var(--color-border)'}`,
                    borderRadius: 2,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    outline: isRecommended && selected !== d.id ? '1px solid rgba(0,212,255,0.15)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0, minWidth: 64 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12, letterSpacing: '0.12em',
                      color: alertColor[d.risk],
                      padding: '3px 6px',
                      border: `1px solid ${alertBorder[d.risk]}`,
                      borderRadius: 2, width: '100%', textAlign: 'center',
                    }}>
                      {d.label}
                    </span>
                    {/* AI safety score bar */}
                    {score ? (
                      <div style={{ width: '100%' }}>
                        <div style={{ height: 4, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${score.score}%`,
                            background: score.score >= 80 ? '#00ff9d' : score.score >= 55 ? '#f5a623' : '#ff3b3b',
                            borderRadius: 2,
                            transition: 'width 0.6s ease',
                          }} />
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', textAlign: 'center', marginTop: 2 }}>
                          {score.score}/100
                        </div>
                        {isRecommended && (
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#00d4ff', textAlign: 'center', letterSpacing: '0.08em' }}>
                            ✓ AI REC
                          </div>
                        )}
                      </div>
                    ) : scoring ? (
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)' }} className="blink">…</div>
                    ) : null}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 3, letterSpacing: '0.03em' }}>
                      {d.action}
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--color-muted-foreground)', marginBottom: score?.rationale ? 4 : 0 }}>
                      {d.consequence}
                    </div>
                    {score?.rationale && (
                      <div style={{
                        fontFamily: 'var(--font-mono)', fontSize: 12,
                        color: '#00d4ff', opacity: 0.85,
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: 4, marginTop: 2,
                      }}>
                        ⟶ {score.rationale}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <button
            onClick={selected !== null ? onDismiss : undefined}
            style={{
              width: '100%',
              marginTop: 16,
              padding: '12px',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: selected !== null ? 'var(--color-primary-foreground)' : 'var(--color-muted-foreground)',
              background: selected !== null ? 'var(--color-primary)' : 'var(--color-fill-weak)',
              border: `1px solid ${selected !== null ? 'var(--color-primary)' : 'var(--color-border)'}`,
              cursor: selected !== null ? 'pointer' : 'not-allowed',
              borderRadius: 2,
              transition: 'all 0.2s ease',
            }}
          >
            {selected !== null ? `Confirm ${decisions[selected - 1].label}` : 'Select an Option'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('eclss')
  const [isOffline, setIsOffline] = useState(false)
  const [showGuidance, setShowGuidance] = useState(false)
  const [showCrisis, setShowCrisis] = useState(false)
  const [time, setTime] = useState(new Date())
  const [showInstall, setShowInstall] = useState(false)
  const installPromptRef = useRef<any>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark'
    const stored = localStorage.getItem('mce-theme') as 'light' | 'dark' | null
    if (stored) return stored
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('mce-theme', theme)
  }, [theme])

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      installPromptRef.current = e
      setShowInstall(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Handle PWA home-screen shortcut deep-links (?shortcut=crisis|procedures|ai)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const shortcut = params.get('shortcut')
    if (shortcut === 'crisis')     { setShowCrisis(true) }
    if (shortcut === 'procedures') { setTab('ai') }
    if (shortcut === 'ai')         { setTab('ai') }
  }, [])

  const { alerts, connected } = useTelemetry()
  const { toasts, pushToast, dismissToast } = useToasts()

  // Toast on new critical/warning alerts
  const prevAlertLevelsRef = useRef<Record<number, string>>({})
  const handleAlerts = useCallback(() => {
    const prev = prevAlertLevelsRef.current
    for (const a of alerts) {
      const wasLevel = prev[a.id]
      if (wasLevel !== a.level) {
        if (a.level === 'critical') {
          pushToast({
            level: 'critical',
            title: `${a.system} — Critical Alert`,
            body: a.message,
            duration: 8000,
          })
        } else if (a.level === 'warning' && wasLevel === 'stable') {
          pushToast({
            level: 'warning',
            title: `${a.system} — Warning`,
            body: a.message,
            duration: 6000,
          })
        }
      }
    }
    prevAlertLevelsRef.current = Object.fromEntries(alerts.map(a => [a.id, a.level]))
  }, [alerts, pushToast])

  useEffect(() => { handleAlerts() }, [handleAlerts])

  const tabs: { id: Tab; label: string; alertLevel: AlertLevel }[] = [
    { id: 'eclss', label: 'Life Support', alertLevel: 'warning' },
    { id: 'power', label: 'Power', alertLevel: 'critical' },
    { id: 'comms', label: 'Comms', alertLevel: isOffline ? 'critical' : 'warning' },
    { id: 'mission', label: 'Mission', alertLevel: 'stable' },
    { id: 'ai', label: 'AI Co-Pilot', alertLevel: 'stable' },
  ]

  return (
    <div className="hex-bg" style={{
      minHeight: '100vh',
      background: 'var(--color-background)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Hidden aria-live region for screen reader alert announcements */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
      >
        {alerts.filter(a => a.level === 'critical').map(a => a.message).join('. ')}
      </div>

      {/* Header */}
      <header className="mce-header" style={{
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-header)',
        backdropFilter: 'blur(12px)',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        height: 52,
        position: 'sticky',
        top: 0,
        zIndex: 50,
        flexShrink: 0,
      }}>
        {/* Logo / Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/pwa-icon.svg"
            alt="MCE logo"
            width={46}
            height={46}
            style={{ flexShrink: 0, display: 'block', filter: 'drop-shadow(0 0 6px rgba(0,212,255,0.55))' }}
          />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--color-foreground)', lineHeight: 1 }}>
              MCE
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', letterSpacing: '0.1em' }}>
              MISSION CONSEQUENCE ENGINE
            </div>
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />

        {/* MET Clock */}
        <div className="mce-met" style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-primary)', letterSpacing: '0.05em' }}>
          {missionElapsed()}
        </div>

        <div className="mce-utc" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-muted-foreground)' }}>
          {fmtTime(time)}
        </div>

        <div style={{ flex: 1 }} />

        {/* Install prompt */}
        {showInstall && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px',
            background: 'rgba(0,212,255,0.06)',
            border: '1px solid rgba(0,212,255,0.2)',
            borderRadius: 2,
          }}>
            <button
              onClick={async () => {
                if (installPromptRef.current) {
                  installPromptRef.current.prompt()
                  const { outcome } = await installPromptRef.current.userChoice
                  if (outcome === 'accepted') setShowInstall(false)
                  installPromptRef.current = null
                }
              }}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              ↓ Install App
            </button>
            <button
              onClick={() => setShowInstall(false)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Offline toggle */}
        <button
          onClick={() => {
            setIsOffline(!isOffline)
            if (!isOffline) setShowGuidance(true)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px',
            background: isOffline ? 'rgba(255,59,59,0.1)' : 'var(--color-raised)',
            border: `1px solid ${isOffline ? 'rgba(255,59,59,0.5)' : 'var(--color-border)'}`,
            cursor: 'pointer',
            borderRadius: 2,
            transition: 'all 0.3s ease',
          }}
        >
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isOffline ? '#ff3b3b' : '#00ff9d',
            boxShadow: `0 0 6px ${isOffline ? '#ff3b3b' : '#00ff9d'}`,
          }} className={isOffline ? 'alert-critical' : ''} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: isOffline ? '#ff3b3b' : '#00ff9d', letterSpacing: '0.1em' }}>
            {isOffline ? 'OFFLINE' : 'EARTH LINK'}
          </span>
          {/* Telemetry server connection dot */}
          <span
            title={connected ? 'Telemetry live' : 'Telemetry offline'}
            style={{
              width: 4, height: 4, borderRadius: '50%',
              background: connected ? '#00d4ff' : '#5a7a9a',
              boxShadow: connected ? '0 0 4px #00d4ff' : 'none',
              display: 'inline-block', marginLeft: 2,
            }}
          />
        </button>

        {/* Crisis button */}
        <button
          onClick={() => setShowCrisis(true)}
          className="corner-clip-sm alert-critical"
          style={{
            padding: '5px 12px',
            background: 'rgba(255,59,59,0.1)',
            border: '1px solid rgba(255,59,59,0.5)',
            cursor: 'pointer',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: '#ff3b3b',
          }}
        >
          ⚡ Crisis Decision
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          style={{
            padding: '5px 12px',
            background: 'var(--color-raised)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.1em',
            color: 'var(--color-foreground)',
            borderRadius: 2,
            transition: 'all 0.2s ease',
          }}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? 'LIGHT' : 'DARK'}
        </button>
      </header>

      <div className="mce-layout" style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar — Alerts */}
        <aside className="mce-sidebar" style={{
          width: 280,
          flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-sidebar)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
              Threat Alerts
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '2px 6px',
              background: 'rgba(255,59,59,0.12)',
              border: '1px solid rgba(255,59,59,0.3)',
              color: '#ff3b3b',
              borderRadius: 2,
            }}>
              {alerts.filter(a => a.level !== 'stable').length} ACTIVE
            </span>
          </div>
          <div className="mce-sidebar-alerts" style={{ flex: 1, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
               role="log" aria-label="Threat alerts" aria-live="polite">
            {alerts.map(a => <AlertCard key={a.id} alert={a} />)}
          </div>

          {/* Offline guidance trigger */}
          {isOffline && (
            <div style={{ padding: 10, borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
              <button
                onClick={() => setShowGuidance(true)}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'rgba(255,59,59,0.08)',
                  border: '1px solid rgba(255,59,59,0.35)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-display)',
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#ff3b3b',
                  borderRadius: 2,
                }}
                className="alert-critical"
              >
                ▶ Open Emergency Guidance
              </button>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Tabs */}
          <div className="mce-tabs" role="tablist" aria-label="Dashboard sections" style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-tabs)',
            flexShrink: 0,
          }}>
            {tabs.map(t => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`tabpanel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '12px 20px',
                    background: active ? 'rgba(0,212,255,0.05)' : 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${active ? 'var(--color-primary)' : 'transparent'}`,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    marginBottom: -1,
                  }}
                >
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: alertColor[t.alertLevel],
                    boxShadow: `0 0 5px ${alertColor[t.alertLevel]}`,
                    flexShrink: 0,
                  }} className={t.alertLevel === 'critical' ? 'alert-critical' : t.alertLevel === 'warning' ? 'alert-warning' : ''} />
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 13,
                    fontWeight: active ? 700 : 500,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: active ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
                  }}>
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div
            role="tabpanel"
            id={`tabpanel-${tab}`}
            aria-label={tabs.find(t => t.id === tab)?.label}
            style={{ flex: 1, overflow: 'auto', padding: 16 }}
          >
            {tab === 'eclss' && <EclssTab />}
            {tab === 'power' && <PowerTab />}
            {tab === 'comms' && <CommsTab isOffline={isOffline} />}
            {tab === 'mission' && <MissionTab />}
            {tab === 'ai' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* AI Mission Summary */}
                <AISummaryPanel />

                {/* Two-column: anomaly predictions + procedure Q&A */}
                <div className="mce-grid-ai" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Anomaly Predictions */}
                  <div className="corner-clip" style={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '8px 16px',
                      borderBottom: '1px solid var(--color-border)',
                      background: 'var(--color-raised)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f5a623', boxShadow: '0 0 6px #f5a623', flexShrink: 0 }} className="alert-warning" />
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
                        Predictive Anomaly Detection
                      </span>
                    </div>
                    <div style={{ padding: 16 }}>
                      <AIAnomalyPanel />
                    </div>
                  </div>

                  {/* Procedure Q&A */}
                  <div className="corner-clip" style={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}>
                    <div style={{
                      padding: '8px 16px',
                      borderBottom: '1px solid var(--color-border)',
                      background: 'var(--color-raised)',
                      display: 'flex', alignItems: 'center', gap: 8,
                      flexShrink: 0,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d4ff', boxShadow: '0 0 6px #00d4ff', flexShrink: 0 }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
                        Emergency Procedure Assistant
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: '1px 5px', background: 'rgba(0,255,157,0.06)', border: '1px solid rgba(0,255,157,0.2)', borderRadius: 2, color: '#00ff9d', letterSpacing: '0.08em', marginLeft: 'auto' }}>
                        OFFLINE READY
                      </span>
                    </div>
                    <ProcedureQA />
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Overlays */}
      {showGuidance && <OfflineGuidance onClose={() => setShowGuidance(false)} />}
      {showCrisis && <CrisisPanel onDismiss={() => setShowCrisis(false)} />}

      {/* Toast notifications */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
