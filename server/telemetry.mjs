/**
 * MCE Telemetry Server — WebSocket + HTTP
 *
 * Emits realistic sensor drift on every tick (1 s).
 * Supports "anomaly injection" via HTTP POST /inject so the front-end
 * AI layer can request forced degradation scenarios.
 *
 * WS_PORT   env — default 4000
 * ANOMALY   env — comma-separated list of 'bat3|co2|comms|o2' to start
 *                 with a pre-seeded anomaly
 */

import { WebSocketServer } from 'ws'
import http from 'node:http'

const WS_PORT = process.env.WS_PORT ? Number(process.env.WS_PORT) : 4000
const TICK_MS = 1000

// ── Utility ────────────────────────────────────────────────────────────────
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function fmtUtcHms(d) {
  return d.toISOString().slice(11, 19)
}

function rand(min, max) {
  return min + Math.random() * (max - min)
}

// ── Sensor state ───────────────────────────────────────────────────────────
const sensor = {
  o2:       20.9,   // % (18-22 normal)
  co2:      0.04,   // % (0-0.08 normal, >0.2 critical)
  temp:     22.1,   // °C (20-26 normal)
  humidity: 74.0,   // % (<80 normal)
  pressure: 101.3,  // kPa (98-103 normal)
  n2:       79.1,   // kPa
  waterRec: 93.4,   // %
  scrub:    61.0,   // % load (climbs over time)
  cdra:     50.0,   // % cycle progress
  trace:    16.0,   // % (maps to ppm)
  // Power — all 4 batteries
  bat1Temp: 24.2,   // °C — nominal
  bat1Chg:  87.0,   // %
  bat2Temp: 24.8,   // °C — nominal
  bat2Chg:  91.0,   // %
  bat3Temp: 31.4,   // °C — anomaly: rising
  bat3Chg:  62.0,   // %
  bat4Temp: 23.9,   // °C — nominal
  bat4Chg:  94.0,   // %
  // Load distribution (Watts) — slow fluctuation
  loadEclss:  28400,
  loadThermal: 12200,
  loadGnc:     8800,
  loadComms:   6100,
  loadScience: 9400,
  loadCrew:    4012,
  // Comms — all three links
  tdrsEast: 94.0,   // % signal — nominal
  tdrsWest: 71.0,   // % signal — anomaly: degrading
  kuBand:   88.0,   // % signal — nominal
  // Crew vitals — 3 crew members
  crewAHr:   72.0,  // heart rate bpm
  crewASpO2: 98.0,  // %
  crewAFatigue: 22.0, // % fatigue (0=fresh, 100=exhausted)
  crewADuty:  6.5,  // hours on duty this shift
  crewBHr:   68.0,
  crewBSpO2: 97.5,
  crewBFatigue: 31.0,
  crewBDuty:  7.2,
  crewCHr:   75.0,
  crewCSpO2: 98.5,
  crewCFatigue: 18.0,
  crewCDuty:  5.8,
}

// History buffer for trend/prediction (last 60 ticks per key)
const HISTORY_LEN = 60
const history = {}
for (const key of Object.keys(sensor)) {
  history[key] = [sensor[key]]
}

function pushHistory(key, val) {
  history[key].push(val)
  if (history[key].length > HISTORY_LEN) history[key].shift()
}

// ── Anomaly flags ──────────────────────────────────────────────────────────
const anomalies = new Set(
  (process.env.ANOMALY || '').split(',').map((s) => s.trim()).filter(Boolean)
)

// ── Step: advance sensor state by one tick ─────────────────────────────────
function step() {
  const t = new Date()

  // O₂ — gentle drift; anomaly: slow leak
  const o2Drift = anomalies.has('o2') ? -0.015 : (Math.random() - 0.5) * 0.04
  sensor.o2 = clamp(sensor.o2 + o2Drift, 18, 22.5)

  // CO₂ — slow upward creep; anomaly: rapid climb
  const co2Drift = anomalies.has('co2') ? rand(0.002, 0.006) : (Math.random() - 0.48) * 0.003
  sensor.co2 = clamp(sensor.co2 + co2Drift, 0.03, 0.5)

  // Temp
  sensor.temp = clamp(sensor.temp + (Math.random() - 0.5) * 0.15, 20, 32)

  // Humidity — slight upward bias
  sensor.humidity = clamp(sensor.humidity + (Math.random() - 0.47) * 0.25, 40, 95)

  // Pressure
  sensor.pressure = clamp(sensor.pressure + (Math.random() - 0.5) * 0.08, 98, 104)
  sensor.n2 = clamp(sensor.n2 + (Math.random() - 0.5) * 0.08, 70, 85)

  // Water recovery
  sensor.waterRec = clamp(sensor.waterRec + (Math.random() - 0.5) * 0.15, 70, 100)

  // CO₂ scrubber load — monotonically increasing
  sensor.scrub = clamp(sensor.scrub + 0.04, 0, 100)

  // CDRA cycle
  sensor.cdra = clamp(sensor.cdra + 0.015, 0, 100)

  // Trace contaminants
  sensor.trace = clamp(sensor.trace + (Math.random() - 0.5) * 0.4, 5, 40)

  // Batteries — BAT-1, BAT-2, BAT-4 gentle nominal drift; BAT-3 anomaly
  sensor.bat1Temp = clamp(sensor.bat1Temp + (Math.random() - 0.5) * 0.06, 22, 28)
  sensor.bat1Chg  = clamp(sensor.bat1Chg  - rand(0.003, 0.008), 0, 100)
  sensor.bat2Temp = clamp(sensor.bat2Temp + (Math.random() - 0.5) * 0.06, 22, 28)
  sensor.bat2Chg  = clamp(sensor.bat2Chg  - rand(0.003, 0.008), 0, 100)
  const batDrift  = anomalies.has('bat3') ? rand(0.01, 0.05) : (Math.random() - 0.5) * 0.08
  sensor.bat3Temp = clamp(sensor.bat3Temp + batDrift, 24, 45)
  sensor.bat3Chg  = clamp(sensor.bat3Chg  - rand(0.005, 0.015), 0, 100)
  sensor.bat4Temp = clamp(sensor.bat4Temp + (Math.random() - 0.5) * 0.06, 22, 28)
  sensor.bat4Chg  = clamp(sensor.bat4Chg  - rand(0.003, 0.008), 0, 100)

  // Load distribution — gentle ±1% fluctuation per subsystem
  sensor.loadEclss   = clamp(sensor.loadEclss   + (Math.random() - 0.5) * 200, 24000, 33000)
  sensor.loadThermal = clamp(sensor.loadThermal + (Math.random() - 0.5) * 150, 10000, 15000)
  sensor.loadGnc     = clamp(sensor.loadGnc     + (Math.random() - 0.5) * 100,  7500, 10500)
  sensor.loadComms   = clamp(sensor.loadComms   + (Math.random() - 0.5) *  80,  5000,  8500)
  sensor.loadScience = clamp(sensor.loadScience + (Math.random() - 0.5) * 120,  7500, 12000)
  sensor.loadCrew    = clamp(sensor.loadCrew    + (Math.random() - 0.5) *  60,  3000,  5500)

  // Comms links — TDRS-East and Ku-Band nominal; TDRS-West anomaly
  sensor.tdrsEast = clamp(sensor.tdrsEast + (Math.random() - 0.5) * 0.2,  85, 100)
  const tdrsDrift = anomalies.has('comms') ? -rand(0.05, 0.2) : (Math.random() - 0.5) * 0.3
  sensor.tdrsWest = clamp(sensor.tdrsWest + tdrsDrift, 0, 100)
  sensor.kuBand   = clamp(sensor.kuBand   + (Math.random() - 0.5) * 0.25, 75, 100)

  // Crew vitals — slow physiological drift
  sensor.crewAHr      = clamp(sensor.crewAHr      + (Math.random() - 0.5) * 1.2, 58, 90)
  sensor.crewASpO2    = clamp(sensor.crewASpO2    + (Math.random() - 0.5) * 0.2, 95, 100)
  sensor.crewAFatigue = clamp(sensor.crewAFatigue + rand(0.005, 0.02),            0,  100)
  sensor.crewADuty    = clamp(sensor.crewADuty    + 1/3600,                       0,   16)
  sensor.crewBHr      = clamp(sensor.crewBHr      + (Math.random() - 0.5) * 1.2, 58, 90)
  sensor.crewBSpO2    = clamp(sensor.crewBSpO2    + (Math.random() - 0.5) * 0.2, 95, 100)
  sensor.crewBFatigue = clamp(sensor.crewBFatigue + rand(0.005, 0.02),            0,  100)
  sensor.crewBDuty    = clamp(sensor.crewBDuty    + 1/3600,                       0,   16)
  sensor.crewCHr      = clamp(sensor.crewCHr      + (Math.random() - 0.5) * 1.2, 58, 90)
  sensor.crewCSpO2    = clamp(sensor.crewCSpO2    + (Math.random() - 0.5) * 0.2, 95, 100)
  sensor.crewCFatigue = clamp(sensor.crewCFatigue + rand(0.005, 0.02),            0,  100)
  sensor.crewCDuty    = clamp(sensor.crewCDuty    + 1/3600,                       0,   16)

  // Push to history
  for (const key of Object.keys(sensor)) pushHistory(key, sensor[key])

  // Compute statuses
  const o2Status     = sensor.o2    < 19.5  ? 'critical' : sensor.o2 < 20 ? 'warning' : 'stable'
  const co2Status    = sensor.co2   > 0.2   ? 'critical' : sensor.co2 > 0.08 ? 'warning' : 'stable'
  const tempStatus   = sensor.temp  > 29    ? 'critical' : sensor.temp > 26 ? 'warning' : 'stable'
  const humStatus    = sensor.humidity > 90 ? 'critical' : sensor.humidity > 80 ? 'warning' : 'stable'
  const scrubStatus  = sensor.scrub > 85    ? 'critical' : sensor.scrub > 60 ? 'warning' : 'stable'
  const batStatus    = sensor.bat3Temp > 38 ? 'critical' : sensor.bat3Temp > 32 ? 'warning' : 'stable'
  const tdrsEastStatus = sensor.tdrsEast < 50 ? 'critical' : sensor.tdrsEast < 75 ? 'warning' : 'stable'
  const commsStatus    = sensor.tdrsWest < 30 ? 'critical' : sensor.tdrsWest < 60 ? 'warning' : 'stable'
  const kuBandStatus   = sensor.kuBand   < 50 ? 'critical' : sensor.kuBand   < 75 ? 'warning' : 'stable'
  const crewAFatStatus = sensor.crewAFatigue > 75 ? 'critical' : sensor.crewAFatigue > 50 ? 'warning' : 'stable'
  const crewBFatStatus = sensor.crewBFatigue > 75 ? 'critical' : sensor.crewBFatigue > 50 ? 'warning' : 'stable'
  const crewCFatStatus = sensor.crewCFatigue > 75 ? 'critical' : sensor.crewCFatigue > 50 ? 'warning' : 'stable'

  const cdraStep = Math.min(8, Math.max(0, Math.round(sensor.cdra / 12.5)))
  const traceVal = (sensor.trace / 20).toFixed(1)
  const timeStr = fmtUtcHms(t)

  // Build telemetry packet
  const eclss = {
    gauges: [
      { value: +sensor.o2.toFixed(2),       max: 25,  label: 'O₂ Level', unit: '%',  status: o2Status  },
      { value: +sensor.co2.toFixed(3),       max: 0.5, label: 'CO₂',     unit: '%',  status: co2Status },
      { value: +sensor.temp.toFixed(1),      max: 30,  label: 'Temp',    unit: '°C', status: tempStatus },
      { value: +sensor.humidity.toFixed(0),  max: 100, label: 'Humidity',unit: '%',  status: humStatus  },
    ],
    bars: [
      { label: 'Cabin Pressure',       value: sensor.pressure.toFixed(1), unit: 'kPa', percent: Math.round(((sensor.pressure - 95) / 10) * 100), status: sensor.pressure < 98 ? 'critical' : 'stable' },
      { label: 'N₂ Partial Pressure',  value: sensor.n2.toFixed(1),       unit: 'kPa', percent: Math.round(((sensor.n2 - 65) / 25) * 100),      status: sensor.n2 < 70 ? 'critical' : 'stable' },
      { label: 'Water Recovery',       value: sensor.waterRec.toFixed(1), unit: '%',   percent: Math.round(sensor.waterRec),                     status: sensor.waterRec < 50 ? 'critical' : 'stable' },
      { label: 'CO₂ Scrubber Load',    value: sensor.scrub.toFixed(0),    unit: '%',   percent: Math.round(sensor.scrub),                        status: scrubStatus },
      { label: 'CDRA Cycle',           value: `${cdraStep}/8`,            unit: 'hrs', percent: Math.round(sensor.cdra),                         status: cdraStep >= 7 ? 'warning' : 'stable' },
      { label: 'Trace Contaminants',   value: traceVal,                   unit: 'ppm', percent: Math.round(sensor.trace),                        status: sensor.trace > 25 ? 'warning' : 'stable' },
    ],
  }

  // Battery aggregate: weighted average charge across all 4
  const totalChg = (sensor.bat1Chg + sensor.bat2Chg + sensor.bat3Chg + sensor.bat4Chg) / 4
  const totalChgPct = Math.round(totalChg * 10) / 10

  // BAT-3 delta from 29°C baseline
  const batDelta = Math.max(0, sensor.bat3Temp - 29).toFixed(1)
  const hoursToFail = Math.max(0.5, ((45 - sensor.bat3Temp) / 0.25)).toFixed(1)

  // Total load
  const totalLoad = sensor.loadEclss + sensor.loadThermal + sensor.loadGnc + sensor.loadComms + sensor.loadScience + sensor.loadCrew

  const newAlerts = [
    {
      id: 1,
      level: batStatus,
      system: 'Power',
      message: `BAT-3 core temp elevated to ${sensor.bat3Temp.toFixed(1)}°C (+${batDelta}°C over baseline)`,
      prediction: `Battery temp rising → Main system failure in ${hoursToFail}h`,
      time: timeStr,
    },
    {
      id: 2,
      level: scrubStatus,
      system: 'ECLSS',
      message: `CO₂ scrubber LiOH canister at ${sensor.scrub.toFixed(0)}% capacity`,
      prediction: `At current rate, canister depletion in ~${Math.max(1, Math.round((100 - sensor.scrub) / 3))} hours`,
      time: timeStr,
    },
    {
      id: 3,
      level: commsStatus,
      system: 'Comms',
      message: `TDRS-West signal at ${sensor.tdrsWest.toFixed(0)}% nominal bandwidth`,
      prediction: sensor.tdrsWest < 50
        ? 'Signal critically low — uplink may drop within 20 min'
        : 'Solar weather event may cause further degradation',
      time: timeStr,
    },
    {
      id: 4,
      level: 'stable',
      system: 'Navigation',
      message: 'Attitude control nominal — gyro torques within spec',
      prediction: 'Next scheduled reboost in 18 days',
      time: timeStr,
    },
  ]

  // Power data packet
  const power = {
    batteries: [
      { id: 'BAT-1', charge: +sensor.bat1Chg.toFixed(1), temp: +sensor.bat1Temp.toFixed(1), status: sensor.bat1Temp > 38 ? 'critical' : sensor.bat1Temp > 32 ? 'warning' : 'stable', current: +(11.8 + (Math.random() - 0.5) * 0.4).toFixed(1), voltage: +(28.8 + (sensor.bat1Chg - 87) * 0.01 + (Math.random() - 0.5) * 0.05).toFixed(1) },
      { id: 'BAT-2', charge: +sensor.bat2Chg.toFixed(1), temp: +sensor.bat2Temp.toFixed(1), status: sensor.bat2Temp > 38 ? 'critical' : sensor.bat2Temp > 32 ? 'warning' : 'stable', current: +(11.5 + (Math.random() - 0.5) * 0.4).toFixed(1), voltage: +(28.9 + (sensor.bat2Chg - 91) * 0.01 + (Math.random() - 0.5) * 0.05).toFixed(1) },
      { id: 'BAT-3', charge: +sensor.bat3Chg.toFixed(1), temp: +sensor.bat3Temp.toFixed(1), status: batStatus,                                                                          current: +(14.0 + (Math.random() - 0.5) * 0.5).toFixed(1), voltage: +(27.0 + (sensor.bat3Chg - 62) * 0.01 + (Math.random() - 0.5) * 0.05).toFixed(1) },
      { id: 'BAT-4', charge: +sensor.bat4Chg.toFixed(1), temp: +sensor.bat4Temp.toFixed(1), status: sensor.bat4Temp > 38 ? 'critical' : sensor.bat4Temp > 32 ? 'warning' : 'stable', current: +(11.0 + (Math.random() - 0.5) * 0.4).toFixed(1), voltage: +(29.1 + (sensor.bat4Chg - 94) * 0.01 + (Math.random() - 0.5) * 0.05).toFixed(1) },
    ],
    totalChargePct: totalChgPct,
    bat3Alert: { delta: batDelta, hoursToFail, status: batStatus },
    loads: [
      { sys: 'Life Support (ECLSS)', load: Math.round(sensor.loadEclss),   max: 35000 },
      { sys: 'Thermal Control',      load: Math.round(sensor.loadThermal), max: 15000 },
      { sys: 'Guidance & Navigation',load: Math.round(sensor.loadGnc),     max: 10000 },
      { sys: 'Communications',       load: Math.round(sensor.loadComms),   max:  8000 },
      { sys: 'Science Payloads',     load: Math.round(sensor.loadScience), max: 12000 },
      { sys: 'Crew Quarters',        load: Math.round(sensor.loadCrew),    max:  6000 },
    ],
    totalLoad: Math.round(totalLoad),
  }

  // Comms data packet — bandwidth derived from signal % × max rated capacity
  // TDRS-East: 150 Mbps max, TDRS-West: 72 Mbps max, Ku-Band: 100 Mbps max, UHF EVA: 0.3 Mbps fixed
  const tdrsEastBw = +(sensor.tdrsEast / 100 * 150).toFixed(1)
  const tdrsWestBw = +(sensor.tdrsWest / 100 * 72).toFixed(1)
  const kuBandBw   = +(sensor.kuBand   / 100 * 100).toFixed(1)
  const uhfBw      = 0.04
  const totalBw    = +(tdrsEastBw + tdrsWestBw + kuBandBw + uhfBw).toFixed(1)

  const comms = {
    links: [
      { id: 'TDRS-East', status: tdrsEastStatus, signal: +sensor.tdrsEast.toFixed(0), bw: tdrsEastBw, latency: 640 },
      { id: 'TDRS-West', status: commsStatus,    signal: +sensor.tdrsWest.toFixed(0), bw: tdrsWestBw, latency: 660 },
      { id: 'Ku-Band',   status: kuBandStatus,   signal: +sensor.kuBand.toFixed(0),   bw: kuBandBw,   latency: 644 },
      { id: 'UHF EVA',   status: 'stable',       signal: 96,                          bw: uhfBw,      latency: 2   },
    ],
    totalBw,
    // Bandwidth allocation derived proportionally from total available
    allocation: [
      { type: 'Telemetry Downlink', bw: +(totalBw * 0.217).toFixed(1), pct: Math.round(sensor.tdrsEast * 0.78) },
      { type: 'Video / Imagery',    bw: +(totalBw * 0.348).toFixed(1), pct: Math.round(sensor.tdrsWest * 0.63 + sensor.tdrsEast * 0.1) > 100 ? 100 : Math.round(sensor.tdrsWest * 0.63 + sensor.tdrsEast * 0.1) },
      { type: 'Voice Comm',         bw: +(totalBw * 0.037).toFixed(1), pct: 100 },
      { type: 'Science Data',       bw: +(totalBw * 0.284).toFixed(1), pct: Math.round(sensor.kuBand * 0.44) },
      { type: 'Software Updates',   bw: +(totalBw * 0.124).toFixed(1), pct: Math.round(sensor.kuBand * 0.22 + sensor.tdrsEast * 0.05) },
    ],
  }

  // Crew data packet
  const hrStatus  = (hr) => hr > 85 ? 'warning' : hr < 60 ? 'warning' : 'stable'
  const spo2Status = (s) => s < 96 ? 'critical' : s < 97 ? 'warning' : 'stable'
  const crew = [
    {
      id: 'CDR Williams', role: 'Commander',
      hr: +sensor.crewAHr.toFixed(0), hrStatus: hrStatus(sensor.crewAHr),
      spo2: +sensor.crewASpO2.toFixed(1), spo2Status: spo2Status(sensor.crewASpO2),
      fatigue: +sensor.crewAFatigue.toFixed(1), fatigueStatus: crewAFatStatus,
      dutyHrs: +sensor.crewADuty.toFixed(1), restDue: +(8 - sensor.crewADuty).toFixed(1),
    },
    {
      id: 'PLT Borisenko', role: 'Pilot',
      hr: +sensor.crewBHr.toFixed(0), hrStatus: hrStatus(sensor.crewBHr),
      spo2: +sensor.crewBSpO2.toFixed(1), spo2Status: spo2Status(sensor.crewBSpO2),
      fatigue: +sensor.crewBFatigue.toFixed(1), fatigueStatus: crewBFatStatus,
      dutyHrs: +sensor.crewBDuty.toFixed(1), restDue: +(8 - sensor.crewBDuty).toFixed(1),
    },
    {
      id: 'MS1 Chen', role: 'Mission Specialist',
      hr: +sensor.crewCHr.toFixed(0), hrStatus: hrStatus(sensor.crewCHr),
      spo2: +sensor.crewCSpO2.toFixed(1), spo2Status: spo2Status(sensor.crewCSpO2),
      fatigue: +sensor.crewCFatigue.toFixed(1), fatigueStatus: crewCFatStatus,
      dutyHrs: +sensor.crewCDuty.toFixed(1), restDue: +(8 - sensor.crewCDuty).toFixed(1),
    },
  ]

  // Telemetry history snapshot for AI anomaly detection (last 30 ticks)
  const trends = {
    bat3Temp:   history.bat3Temp.slice(-30),
    co2:        history.co2.slice(-30),
    o2:         history.o2.slice(-30),
    humidity:   history.humidity.slice(-30),
    tdrsWest:   history.tdrsWest.slice(-30),
    scrub:      history.scrub.slice(-30),
  }

  return { eclss, power, comms, crew, alerts: newAlerts, trends }
}

// ── HTTP server (telemetry state + anomaly injection endpoint) ─────────────
const httpServer = http.createServer((req, res) => {
  const url = req.url || '/'
  const method = req.method || 'GET'

  // CORS for dev
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (url === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size, anomalies: [...anomalies] }))
    return
  }

  if (url === '/inject' && method === 'POST') {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      try {
        const { anomaly, active } = JSON.parse(body)
        if (active) anomalies.add(anomaly); else anomalies.delete(anomaly)
        console.log(`[MCE] anomaly inject: ${anomaly}=${active}  active=${[...anomalies]}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, anomalies: [...anomalies] }))
      } catch {
        res.writeHead(400)
        res.end('{"error":"invalid json"}')
      }
    })
    return
  }

  // Snapshot endpoint — used by AI service during SSR / pre-flight
  if (url === '/snapshot' && method === 'GET') {
    const snapshot = step()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(snapshot))
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('MCE telemetry server — ws://localhost:4000  |  GET /health  GET /snapshot  POST /inject')
})

// ── WebSocket server ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  const init = step()
  ws.send(JSON.stringify({ type: 'init', ...init }))

  const interval = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return
    const packet = step()
    ws.send(JSON.stringify({ type: 'telemetry', ...packet }))
  }, TICK_MS)

  ws.on('close', () => clearInterval(interval))
  ws.on('error', () => clearInterval(interval))
})

httpServer.listen(WS_PORT, () => {
  console.log(`[MCE] telemetry server  ws://localhost:${WS_PORT}`)
  console.log(`[MCE] health            http://localhost:${WS_PORT}/health`)
  console.log(`[MCE] snapshot          http://localhost:${WS_PORT}/snapshot`)
  console.log(`[MCE] inject anomaly    POST http://localhost:${WS_PORT}/inject  {"anomaly":"bat3","active":true}`)
  if (anomalies.size) console.log(`[MCE] starting with anomalies: ${[...anomalies].join(', ')}`)
})
