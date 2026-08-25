import { useState, useEffect, useRef } from 'react'
import { useTelemetry, type Alert, type AlertLevel, type TelemetryItem } from './telemetry'

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = 'eclss' | 'power' | 'comms' | 'mission'

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
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color, lineHeight: 1 }}>
            {value}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-muted-foreground)', marginTop: 1 }}>
            {unit}
          </span>
        </div>
      </div>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--color-muted-foreground)', textTransform: 'uppercase' }}>
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
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color }}>
          {value} <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>{unit}</span>
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
              fontSize: 9,
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
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: alertColor[alert.level] }}>
              {alert.system}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>{alert.time}</span>
        </div>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-card-foreground)', margin: '0 0 4px' }}>
          {alert.message}
        </p>
        {!compact && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: alertColor[alert.level], margin: 0, opacity: 0.85 }}>
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
            fontSize: 11,
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
          fontSize: 10,
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)', flexShrink: 0, paddingTop: 1 }}>{e.t}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: e.lvl === 'stable' ? 'var(--color-card-foreground)' : alertColor[e.lvl as AlertLevel] }}>{e.msg}</span>
          </div>
        ))}
      </Panel>
    </div>
  )
}

// ── Power Tab ──────────────────────────────────────────────────────────────
function PowerTab() {
  const batteries = [
    { id: 'BAT-1', charge: 87, temp: 24.2, status: 'stable' as AlertLevel, current: 12.4, voltage: 28.6 },
    { id: 'BAT-2', charge: 91, temp: 24.8, status: 'stable' as AlertLevel, current: 11.8, voltage: 28.9 },
    { id: 'BAT-3', charge: 62, temp: 31.4, status: 'warning' as AlertLevel, current: 14.2, voltage: 27.1 },
    { id: 'BAT-4', charge: 94, temp: 23.9, status: 'stable' as AlertLevel, current: 11.1, voltage: 29.1 },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Panel title="Solar Array Output" status="stable" style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {['SA-1A', 'SA-1B', 'SA-2A', 'SA-2B'].map((id, i) => {
            const vals = [98.2, 96.8, 99.1, 97.4]
            const watts = [18420, 18104, 18532, 18288]
            return (
              <div key={id} style={{
                background: 'rgba(0,255,157,0.04)',
                border: '1px solid rgba(0,255,157,0.15)',
                borderRadius: 2,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{id}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: '#00ff9d', lineHeight: 1 }}>{vals[i]}<span style={{ fontSize: 10 }}>%</span></span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>{watts[i].toLocaleString()} W</span>
              </div>
            )
          })}
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 24, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
          {[
            { label: 'Total Generation', value: '73,344', unit: 'W' },
            { label: 'Total Consumption', value: '68,912', unit: 'W' },
            { label: 'Net Balance', value: '+4,432', unit: 'W' },
            { label: 'Next Eclipse', value: '01:42:17', unit: '' },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>{s.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: s.value.startsWith('+') ? '#00ff9d' : 'var(--color-foreground)' }}>
                {s.value} <span style={{ fontSize: 10, color: 'var(--color-muted-foreground)' }}>{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Battery Status" status="warning">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {batteries.map(b => (
            <div key={b.id} style={{
              padding: '10px 12px',
              background: alertBg[b.status],
              border: `1px solid ${alertBorder[b.status]}`,
              borderRadius: 2,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: alertColor[b.status] }}>{b.id}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>{b.temp}°C {b.status === 'warning' && <span style={{ color: '#f5a623' }}>↑</span>}</span>
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
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: alertColor[b.status] }}>{b.charge}%</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>{b.voltage}V · {b.current}A</span>
              </div>
            </div>
          ))}
          <div style={{
            padding: '8px 10px',
            background: 'rgba(245,166,35,0.07)',
            border: '1px solid rgba(245,166,35,0.25)',
            borderRadius: 2,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: '#f5a623',
          }}>
            ⚠ BAT-3 temp +2°C above nominal — predicted failure window: T+8h
          </div>
        </div>
      </Panel>

      <Panel title="Load Distribution" status="stable">
        {[
          { sys: 'Life Support (ECLSS)', load: 28400, max: 35000 },
          { sys: 'Thermal Control', load: 12200, max: 15000 },
          { sys: 'Guidance & Navigation', load: 8800, max: 10000 },
          { sys: 'Communications', load: 6100, max: 8000 },
          { sys: 'Science Payloads', load: 9400, max: 12000 },
          { sys: 'Crew Quarters', load: 4012, max: 6000 },
        ].map(item => (
          <div key={item.sys} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--color-card-foreground)' }}>{item.sys}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)' }}>{(item.load / 1000).toFixed(1)} kW</span>
            </div>
            <div style={{ height: 4, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(item.load / item.max) * 100}%`,
                background: 'rgba(0,212,255,0.7)',
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

// ── Comms Tab ──────────────────────────────────────────────────────────────
function CommsTab({ isOffline }: { isOffline: boolean }) {
  const links = [
    { id: 'TDRS-East', status: isOffline ? 'critical' as AlertLevel : 'stable' as AlertLevel, latency: isOffline ? '--' : '640', bw: isOffline ? '--' : '72.1', signal: isOffline ? 0 : 94 },
    { id: 'TDRS-West', status: isOffline ? 'critical' as AlertLevel : 'warning' as AlertLevel, latency: isOffline ? '--' : '660', bw: isOffline ? '--' : '43.8', signal: isOffline ? 0 : 71 },
    { id: 'Ku-Band', status: isOffline ? 'critical' as AlertLevel : 'stable' as AlertLevel, latency: isOffline ? '--' : '644', bw: isOffline ? '--' : '50.0', signal: isOffline ? 0 : 88 },
    { id: 'UHF EVA', status: 'stable' as AlertLevel, latency: '2', bw: '0.04', signal: 96 },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Panel title="Link Status" status={isOffline ? 'critical' : 'stable'} style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {links.map(l => (
            <div key={l.id} style={{
              padding: '12px',
              background: alertBg[l.status],
              border: `1px solid ${alertBorder[l.status]}`,
              borderRadius: 2,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: alertColor[l.status], marginBottom: 8 }}>{l.id}</div>
              <div style={{ height: 24, background: 'var(--color-fill-weak)', borderRadius: 2, overflow: 'hidden', marginBottom: 8, display: 'flex', alignItems: 'flex-end' }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} style={{
                    flex: 1,
                    height: `${Math.random() * 80 + 20}%`,
                    background: alertColor[l.status],
                    opacity: l.signal === 0 ? 0.1 : 0.5 + (i / 12) * 0.5,
                    margin: '0 0.5px',
                    borderRadius: '1px 1px 0 0',
                  }} />
                ))}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{l.signal}%</span>
                <span>{l.latency}{l.latency !== '--' ? 'ms' : ''}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: alertColor[l.status], marginTop: 2 }}>
                {l.bw !== '--' ? `${l.bw} Mbps` : 'NO CARRIER'}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Ground Station Contact" status="stable">
        {[
          { gs: 'Houston MCC', next: '00:12:44', duration: '28 min', aos: '14:48 UTC' },
          { gs: 'Svalbard', next: '01:34:18', duration: '9 min', aos: '16:10 UTC' },
          { gs: 'White Sands', next: '02:58:01', duration: '22 min', aos: '17:34 UTC' },
          { gs: 'Madrid DSN', next: '04:22:55', duration: '14 min', aos: '19:00 UTC' },
        ].map(g => (
          <div key={g.gs} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 0', borderBottom: '1px solid var(--color-border)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--color-card-foreground)' }}>{g.gs}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>AOS {g.aos} · {g.duration}</div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-primary)', textAlign: 'right' }}>
              {g.next}
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="Bandwidth Allocation" status="stable">
        {[
          { type: 'Telemetry Downlink', alloc: 14.2, pct: 78 },
          { type: 'Video/Imagery', alloc: 22.8, pct: 63 },
          { type: 'Voice Comm', alloc: 2.4, pct: 100 },
          { type: 'Science Data', alloc: 18.6, pct: 44 },
          { type: 'Software Updates', alloc: 8.1, pct: 22 },
        ].map(b => (
          <div key={b.type} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--color-card-foreground)' }}>{b.type}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)' }}>{b.alloc} Mbps</span>
            </div>
            <div style={{ height: 4, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${b.pct}%`,
                background: 'rgba(0,212,255,0.6)',
                borderRadius: 2,
              }} />
            </div>
          </div>
        ))}
      </Panel>
    </div>
  )
}

// ── Mission Tab ────────────────────────────────────────────────────────────
function MissionTab() {
  const experiments = [
    { id: 'MSG-4', name: 'Microgravity Science Glovebox', status: 'stable' as AlertLevel, progress: 68, eta: '2026-08-22' },
    { id: 'HDEV-6', name: 'High Definition Earth Viewing', status: 'stable' as AlertLevel, progress: 100, eta: 'Complete' },
    { id: 'CFE-3', name: 'Capillary Flow Experiment', status: 'warning' as AlertLevel, progress: 34, eta: '2026-08-31' },
    { id: 'SSPCG', name: 'Space Station Processing Facility', status: 'stable' as AlertLevel, progress: 51, eta: '2026-09-04' },
    { id: 'VEGGIE', name: 'Vegetable Production System', status: 'critical' as AlertLevel, progress: 22, eta: 'At Risk' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Panel title="Mission Schedule" status="stable" style={{ gridColumn: 'span 2' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[
            { time: '14:00 UTC', event: 'USOS Housekeeping (Node 1)', crew: 'Williams', status: 'complete' },
            { time: '14:45 UTC', event: 'MSG-4 Experiment Run #12', crew: 'Borisenko', status: 'active' },
            { time: '16:30 UTC', event: 'EVA Suit Integrity Check', crew: 'Williams / Chen', status: 'upcoming' },
            { time: '18:00 UTC', event: 'MCC Houston Video Conference', crew: 'All Crew', status: 'upcoming' },
            { time: '20:30 UTC', event: 'CFE-3 Data Downlink', crew: 'Chen', status: 'upcoming' },
            { time: '22:00 UTC', event: 'Crew Sleep Period', crew: 'All Crew', status: 'upcoming' },
          ].map(ev => {
            const colors = { complete: '#5a7a9a', active: '#00d4ff', upcoming: 'var(--color-card-foreground)' }
            const dotColors = { complete: '#5a7a9a', active: '#00d4ff', upcoming: '#2a4a6a' }
            return (
              <div key={ev.time} style={{
                display: 'flex', gap: 12, alignItems: 'center',
                padding: '7px 0',
                borderBottom: '1px solid var(--color-border)',
                opacity: ev.status === 'complete' ? 0.5 : 1,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: colors[ev.status as keyof typeof colors], width: 72, flexShrink: 0 }}>{ev.time}</span>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: dotColors[ev.status as keyof typeof dotColors],
                  boxShadow: ev.status === 'active' ? '0 0 8px rgba(0,212,255,0.8)' : 'none',
                }} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: colors[ev.status as keyof typeof colors], flex: 1 }}>{ev.event}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>{ev.crew}</span>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Active Experiments" status="warning">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {experiments.map(e => (
            <div key={e.id} style={{ padding: '8px 10px', background: alertBg[e.status], border: `1px solid ${alertBorder[e.status]}`, borderRadius: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: alertColor[e.status], marginRight: 6 }}>{e.id}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--color-card-foreground)' }}>{e.name}</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>{e.eta}</span>
              </div>
              <div style={{ height: 3, background: 'var(--color-track)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${e.progress}%`,
                  background: alertColor[e.status],
                  borderRadius: 2,
                  transition: 'width 1s ease',
                }} />
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: alertColor[e.status], marginTop: 3 }}>{e.progress}%</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Orbital Parameters" status="stable">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Altitude (Apo)', value: '421.3 km' },
            { label: 'Altitude (Peri)', value: '418.7 km' },
            { label: 'Inclination', value: '51.64°' },
            { label: 'Period', value: '92.68 min' },
            { label: 'Velocity', value: '7.66 km/s' },
            { label: 'Revolutions', value: '142,388' },
          ].map(p => (
            <div key={p.label} style={{ padding: '8px 10px', background: 'var(--color-well)', border: '1px solid var(--color-border)', borderRadius: 2 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 2 }}>{p.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--color-primary)' }}>{p.value}</div>
            </div>
          ))}
        </div>
      </Panel>
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
            fontSize: 11,
            color: '#ff3b3b',
            letterSpacing: '0.15em',
          }} className="alert-critical">
            ◉ OFFLINE MODE ACTIVE
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--color-foreground)' }}>
            Emergency Atmosphere Procedure — EAP-04
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
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
          fontSize: 11,
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
                fontSize: 12,
                color: isDone ? '#00ff9d' : isActive ? '#00d4ff' : 'var(--color-muted-foreground)',
              }}>
                {isDone ? '✓' : s.step}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: isDone ? '#00ff9d' : isActive ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
                  marginBottom: 4,
                }}>
                  {s.instruction}
                </div>
                {s.substep && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted-foreground)' }}>
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
                    fontSize: 12,
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
            fontSize: 15,
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
  const [selected, setSelected] = useState<number | null>(null)

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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'var(--color-overlay)',
      backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div className="corner-clip" style={{
        background: 'var(--color-card)',
        border: '1px solid rgba(255,59,59,0.4)',
        maxWidth: 620,
        width: '100%',
        boxShadow: '0 0 60px rgba(255,59,59,0.12)',
      }}>
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid rgba(255,59,59,0.3)',
          background: 'rgba(255,59,59,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#ff3b3b', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em' }} className="alert-critical">■ CRISIS DECISION REQUIRED</span>
          </div>
          <button onClick={onDismiss} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)', background: 'none', border: '1px solid var(--color-border)', padding: '4px 10px', cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>
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
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: '#ff3b3b', marginBottom: 4, letterSpacing: '0.05em' }}>
              BAT-3 Temperature Anomaly — Predicted Main Bus Failure
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-card-foreground)' }}>
              Battery temp rising at +0.25°C/hr. Projected failure: T+7h54m. Immediate load management required.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {decisions.map(d => (
              <button
                key={d.id}
                onClick={() => setSelected(d.id)}
                style={{
                  textAlign: 'left',
                  background: selected === d.id ? alertBg[d.risk] : 'var(--color-fill)',
                  border: `1px solid ${selected === d.id ? alertBorder[d.risk] : 'var(--color-border)'}`,
                  borderRadius: 2,
                  padding: '12px 14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  color: alertColor[d.risk],
                  padding: '3px 6px',
                  border: `1px solid ${alertBorder[d.risk]}`,
                  borderRadius: 2,
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  {d.label}
                </span>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--color-foreground)', marginBottom: 3, letterSpacing: '0.03em' }}>
                    {d.action}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--color-muted-foreground)' }}>
                    {d.consequence}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <button
            onClick={selected !== null ? onDismiss : undefined}
            style={{
              width: '100%',
              marginTop: 16,
              padding: '12px',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 14,
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

  const { alerts } = useTelemetry()

  const tabs: { id: Tab; label: string; alertLevel: AlertLevel }[] = [
    { id: 'eclss', label: 'Life Support', alertLevel: 'warning' },
    { id: 'power', label: 'Power', alertLevel: 'critical' },
    { id: 'comms', label: 'Comms', alertLevel: isOffline ? 'critical' : 'warning' },
    { id: 'mission', label: 'Mission', alertLevel: 'stable' },
  ]

  return (
    <div className="hex-bg" style={{
      minHeight: '100vh',
      background: 'var(--color-background)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <header style={{
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
          <div style={{
            width: 30, height: 30,
            border: '1px solid rgba(0,212,255,0.4)',
            borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative',
          }}>
            <div style={{
              width: 14, height: 14,
              borderRadius: '50%',
              border: '2px solid rgba(0,212,255,0.8)',
              background: 'rgba(0,212,255,0.12)',
            }} />
            <div style={{
              position: 'absolute',
              inset: -1,
              borderRadius: '50%',
              border: '1px solid rgba(0,212,255,0.15)',
            }} />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--color-foreground)', lineHeight: 1 }}>
              MCE
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-muted-foreground)', letterSpacing: '0.1em' }}>
              MISSION CONSEQUENCE ENGINE
            </div>
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />

        {/* MET Clock */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-primary)', letterSpacing: '0.05em' }}>
          {missionElapsed()}
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-muted-foreground)' }}>
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
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              ↓ Install App
            </button>
            <button
              onClick={() => setShowInstall(false)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-muted-foreground)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
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
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: isOffline ? '#ff3b3b' : '#00ff9d', letterSpacing: '0.1em' }}>
            {isOffline ? 'OFFLINE' : 'EARTH LINK'}
          </span>
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
            fontSize: 11,
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
            fontSize: 10,
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

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar — Alerts */}
        <aside style={{
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
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)' }}>
              Threat Alerts
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              padding: '2px 6px',
              background: 'rgba(255,59,59,0.12)',
              border: '1px solid rgba(255,59,59,0.3)',
              color: '#ff3b3b',
              borderRadius: 2,
            }}>
              {alerts.filter(a => a.level !== 'stable').length} ACTIVE
            </span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                  fontSize: 12,
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
          <div style={{
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
                    fontSize: 12,
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
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {tab === 'eclss' && <EclssTab />}
            {tab === 'power' && <PowerTab />}
            {tab === 'comms' && <CommsTab isOffline={isOffline} />}
            {tab === 'mission' && <MissionTab />}
          </div>
        </main>
      </div>

      {/* Overlays */}
      {showGuidance && <OfflineGuidance onClose={() => setShowGuidance(false)} />}
      {showCrisis && <CrisisPanel onDismiss={() => setShowCrisis(false)} />}
    </div>
  )
}
