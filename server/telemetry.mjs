import { WebSocketServer } from 'ws'
import http from 'node:http'

const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 4000

let state = {
  eclss: {
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
  },
}

let alerts = [
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

function fmtTime(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function step() {
  const now = new Date()
  const g = state.eclss.gauges
  const b = state.eclss.bars

  // Gauges
  g[0].value = clamp(g[0].value + (Math.random() - 0.5) * 0.05, 18, 22)
  g[0].status = g[0].value < 19.5 ? 'critical' : 'stable'

  g[1].value = clamp(g[1].value + (Math.random() - 0.5) * 0.005, 0.03, 0.3)
  g[1].status = g[1].value > 0.2 ? 'critical' : g[1].value > 0.08 ? 'warning' : 'stable'

  g[2].value = clamp(g[2].value + (Math.random() - 0.5) * 0.2, 20, 32)
  g[2].status = g[2].value > 30 ? 'critical' : g[2].value > 26 ? 'warning' : 'stable'

  g[3].value = clamp(g[3].value + (Math.random() - 0.48) * 0.3, 40, 95)
  g[3].status = g[3].value > 90 ? 'critical' : g[3].value > 80 ? 'warning' : 'stable'

  // Bars
  const scrub = b.find((x) => x.label === 'CO₂ Scrubber Load')
  scrub.percent = clamp(scrub.percent + 0.05, 0, 100)
  scrub.value = scrub.percent.toFixed(0)
  scrub.status = scrub.percent > 85 ? 'critical' : scrub.percent > 60 ? 'warning' : 'stable'

  const water = b.find((x) => x.label === 'Water Recovery')
  water.percent = clamp(water.percent + (Math.random() - 0.5) * 0.2, 70, 100)
  water.value = water.percent.toFixed(1)
  water.status = water.percent < 50 ? 'critical' : 'stable'

  const cabin = b.find((x) => x.label === 'Cabin Pressure')
  cabin.percent = clamp(cabin.percent + (Math.random() - 0.5) * 0.1, 75, 95)
  cabin.value = ((cabin.percent / 100) * 123.5).toFixed(1)
  cabin.status = cabin.percent < 70 ? 'critical' : 'stable'

  const n2 = b.find((x) => x.label === 'N₂ Partial Pressure')
  n2.percent = clamp(n2.percent + (Math.random() - 0.5) * 0.1, 70, 90)
  n2.value = ((n2.percent / 100) * 100).toFixed(1)
  n2.status = n2.percent < 60 ? 'critical' : 'stable'

  const cdra = b.find((x) => x.label === 'CDRA Cycle')
  cdra.percent = clamp(cdra.percent + 0.02, 0, 100)
  const cycle = Math.min(8, Math.max(0, Math.round(cdra.percent / 12.5)))
  cdra.value = `${cycle}/8`
  cdra.status = cycle >= 7 ? 'warning' : 'stable'

  const trace = b.find((x) => x.label === 'Trace Contaminants')
  trace.percent = clamp(trace.percent + (Math.random() - 0.5) * 0.5, 5, 35)
  trace.value = (trace.percent / 20).toFixed(1)
  trace.status = trace.percent > 25 ? 'warning' : 'stable'

  // Update the ECLSS alert in real time
  const timeOnly = fmtTime(now).split(' ')[1].slice(0, 8)
  alerts = alerts.map((a) => {
    if (a.system === 'ECLSS' && a.message.includes('CO₂ scrubber')) {
      return {
        ...a,
        level: scrub.status,
        message: `CO₂ scrubber LiOH canister at ${scrub.percent.toFixed(0)}% capacity`,
        prediction: `At current rate, canister depletion in ~${Math.max(1, Math.round((100 - scrub.percent) / 3))} hours`,
        time: timeOnly,
      }
    }
    return a
  })
}

const httpServer = http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('MCE telemetry server')
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  step()
  ws.send(JSON.stringify({ type: 'init', data: state, alerts }))

  const interval = setInterval(() => {
    step()
    ws.send(JSON.stringify({ type: 'telemetry', data: state, alerts }))
  }, 1000)

  ws.on('close', () => clearInterval(interval))
})

httpServer.listen(WS_PORT, () => {
  console.log(`MCE telemetry server running on ws://localhost:${WS_PORT}`)
})
