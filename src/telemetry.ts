import { createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { TrendData } from './ai'

export type AlertLevel = 'stable' | 'warning' | 'critical'

export interface Alert {
  id: number
  level: AlertLevel
  system: string
  message: string
  prediction: string
  time: string
}

export interface TelemetryItem {
  label: string
  value: string
  unit: string
  percent: number
  status: AlertLevel
}

export interface EclssGauge {
  value: number
  max: number
  label: string
  unit: string
  status: AlertLevel
}

export interface EclssData {
  gauges: EclssGauge[]
  bars: TelemetryItem[]
}

export interface BatteryUnit {
  id: string
  charge: number
  temp: number
  status: AlertLevel
  current: number
  voltage: number
}

export interface LoadItem {
  sys: string
  load: number
  max: number
}

export interface PowerData {
  batteries: BatteryUnit[]
  totalChargePct: number
  bat3Alert: { delta: string; hoursToFail: string; status: AlertLevel }
  loads: LoadItem[]
  totalLoad: number
}

export interface CommLink {
  id: string
  status: AlertLevel
  signal: number
  bw: number
  latency: number
}

export interface BwAlloc {
  type: string
  bw: number
  pct: number
}

export interface CommsData {
  links: CommLink[]
  totalBw: number
  allocation: BwAlloc[]
}

export interface CrewMember {
  id: string
  role: string
  hr: number
  hrStatus: AlertLevel
  spo2: number
  spo2Status: AlertLevel
  fatigue: number
  fatigueStatus: AlertLevel
  dutyHrs: number
  restDue: number
}

export interface TelemetryState {
  eclss: EclssData
  power: PowerData
  comms: CommsData
  crew: CrewMember[]
  alerts: Alert[]
  connected: boolean
  trends: TrendData | null
}

const DEFAULT_ECLSS: EclssData = {
  gauges: [
    { value: 20.9, max: 25, label: 'O₂ Level', unit: '%', status: 'stable' },
    { value: 0.04, max: 0.5, label: 'CO₂', unit: '%', status: 'stable' },
    { value: 22.1, max: 30, label: 'Temp', unit: '°C', status: 'stable' },
    { value: 74, max: 100, label: 'Humidity', unit: '%', status: 'warning' },
  ],
  bars: [
    { label: 'Cabin Pressure', value: '101.3', unit: 'kPa', percent: 82, status: 'stable' },
    { label: 'N₂ Partial Pressure', value: '79.1', unit: 'kPa', percent: 79, status: 'stable' },
    { label: 'Water Recovery', value: '93.4', unit: '%', percent: 93, status: 'stable' },
    { label: 'CO₂ Scrubber Load', value: '61', unit: '%', percent: 61, status: 'warning' },
    { label: 'CDRA Cycle', value: '4/8', unit: 'hrs', percent: 50, status: 'stable' },
    { label: 'Trace Contaminants', value: '0.8', unit: 'ppm', percent: 16, status: 'stable' },
  ],
}

const DEFAULT_ALERTS: Alert[] = [
  {
    id: 1,
    level: 'critical',
    system: 'Power',
    message: 'BAT-3 core temp elevated to 31.4°C (+2.1°C over baseline)',
    prediction: 'Battery temp +2°C → Main system failure in 7h 54m',
    time: '14:38:22',
  },
  {
    id: 2,
    level: 'warning',
    system: 'ECLSS',
    message: 'CO₂ scrubber LiOH canister at 61% capacity',
    prediction: 'At current rate, canister depletion in ~14 hours',
    time: '14:22:07',
  },
  {
    id: 3,
    level: 'warning',
    system: 'Comms',
    message: 'TDRS-West signal degraded — 71% nominal bandwidth',
    prediction: 'Solar weather event may cause further 20% drop in 3h',
    time: '13:58:44',
  },
  {
    id: 4,
    level: 'stable',
    system: 'Navigation',
    message: 'Attitude control nominal — gyro torques within spec',
    prediction: 'Next scheduled reboost in 18 days',
    time: '12:44:18',
  },
]

const DEFAULT_POWER: PowerData = {
  batteries: [
    { id: 'BAT-1', charge: 87.0, temp: 24.2, status: 'stable',  current: 12.4, voltage: 28.6 },
    { id: 'BAT-2', charge: 91.0, temp: 24.8, status: 'stable',  current: 11.8, voltage: 28.9 },
    { id: 'BAT-3', charge: 62.0, temp: 31.4, status: 'warning', current: 14.2, voltage: 27.1 },
    { id: 'BAT-4', charge: 94.0, temp: 23.9, status: 'stable',  current: 11.1, voltage: 29.1 },
  ],
  totalChargePct: 83.5,
  bat3Alert: { delta: '2.4', hoursToFail: '62.4', status: 'warning' },
  loads: [
    { sys: 'Life Support (ECLSS)', load: 28400, max: 35000 },
    { sys: 'Thermal Control',      load: 12200, max: 15000 },
    { sys: 'Guidance & Navigation',load:  8800, max: 10000 },
    { sys: 'Communications',       load:  6100, max:  8000 },
    { sys: 'Science Payloads',     load:  9400, max: 12000 },
    { sys: 'Crew Quarters',        load:  4012, max:  6000 },
  ],
  totalLoad: 68912,
}

const DEFAULT_COMMS: CommsData = {
  links: [
    { id: 'TDRS-East', status: 'stable',  signal: 94, bw: 141.0, latency: 640 },
    { id: 'TDRS-West', status: 'warning', signal: 71, bw:  51.1, latency: 660 },
    { id: 'Ku-Band',   status: 'stable',  signal: 88, bw:  88.0, latency: 644 },
    { id: 'UHF EVA',   status: 'stable',  signal: 96, bw:   0.04, latency: 2  },
  ],
  totalBw: 280.1,
  allocation: [
    { type: 'Telemetry Downlink', bw: 60.8,  pct: 73 },
    { type: 'Video / Imagery',    bw: 97.5,  pct: 54 },
    { type: 'Voice Comm',         bw: 10.4,  pct: 100 },
    { type: 'Science Data',       bw: 79.5,  pct: 39 },
    { type: 'Software Updates',   bw: 34.7,  pct: 24 },
  ],
}

const DEFAULT_CREW: CrewMember[] = [
  { id: 'CDR Williams',  role: 'Commander',         hr: 72, hrStatus: 'stable', spo2: 98.0, spo2Status: 'stable', fatigue: 22.0, fatigueStatus: 'stable', dutyHrs: 6.5, restDue: 1.5 },
  { id: 'PLT Borisenko', role: 'Pilot',              hr: 68, hrStatus: 'stable', spo2: 97.5, spo2Status: 'stable', fatigue: 31.0, fatigueStatus: 'stable', dutyHrs: 7.2, restDue: 0.8 },
  { id: 'MS1 Chen',      role: 'Mission Specialist', hr: 75, hrStatus: 'stable', spo2: 98.5, spo2Status: 'stable', fatigue: 18.0, fatigueStatus: 'stable', dutyHrs: 5.8, restDue: 2.2 },
]

const DEFAULT_STATE: TelemetryState = {
  eclss: DEFAULT_ECLSS,
  power: DEFAULT_POWER,
  comms: DEFAULT_COMMS,
  crew: DEFAULT_CREW,
  alerts: DEFAULT_ALERTS,
  connected: false,
  trends: null,
}

const TelemetryContext = createContext<TelemetryState | null>(null)

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TelemetryState>(DEFAULT_STATE)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket('ws://localhost:4000')

      ws.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }))
      }

      ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data)
          if (packet.type === 'init' || packet.type === 'telemetry') {
            setState((prev) => ({
              ...prev,
              eclss:  packet.eclss  ?? prev.eclss,
              power:  packet.power  ?? prev.power,
              comms:  packet.comms  ?? prev.comms,
              crew:   packet.crew   ?? prev.crew,
              alerts: packet.alerts ?? prev.alerts,
              trends: packet.trends ?? prev.trends,
            }))
          }
        } catch (err) {
          console.error('Invalid telemetry packet', err)
        }
      }

      ws.onclose = () => {
        setState((prev) => ({ ...prev, connected: false }))
        reconnectRef.current = setTimeout(connect, 2000)
      }

      ws.onerror = () => {
        setState((prev) => ({ ...prev, connected: false }))
      }

      return ws
    }

    const ws = connect()
    return () => {
      ws.close()
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
    }
  }, [])

  return createElement(TelemetryContext.Provider, { value: state }, children)
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext)
  if (!ctx) {
    throw new Error('useTelemetry must be used within a TelemetryProvider')
  }
  return ctx
}
