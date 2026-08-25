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

export interface TelemetryState {
  eclss: EclssData
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

const DEFAULT_STATE: TelemetryState = {
  eclss: DEFAULT_ECLSS,
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
              eclss: packet.eclss ?? prev.eclss,
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
