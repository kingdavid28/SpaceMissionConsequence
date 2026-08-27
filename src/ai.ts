/**
 * MCE AI Service
 *
 * Provides five AI-powered capabilities:
 *  1. naturalLanguageSummary     — plain-English narrative of the current threat picture
 *  2. scoreDecisions             — rank crisis options given live sensor state
 *  3. detectAnomalies            — extrapolate sensor trends, surface early warnings
 *  4. askProcedure               — offline-capable Q&A against cached procedure manual
 *  5. recommendResearchAction    — next best research action given experiment + crew state
 *
 * Provider priority:
 *   VITE_AI_PROVIDER=watsonx | openai | local (default: local)
 *
 * For IBM watsonx:
 *   VITE_WATSONX_URL        — e.g. https://us-south.ml.cloud.ibm.com
 *   VITE_WATSONX_API_KEY    — IAM API key
 *   VITE_WATSONX_PROJECT_ID — project ID
 *   VITE_WATSONX_MODEL      — e.g. ibm/granite-13b-chat-v2  (default)
 *
 * For OpenAI:
 *   VITE_OPENAI_API_KEY
 *   VITE_OPENAI_MODEL       — e.g. gpt-4o (default)
 *
 * All functions fall back to a fully local, deterministic engine when
 * no API keys are configured — the app always works offline.
 */

import type { Alert, TelemetryState } from './telemetry'
import type { Experiment } from './nasaOsdr'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TrendData {
  bat3Temp: number[]
  co2: number[]
  o2: number[]
  humidity: number[]
  tdrsWest: number[]
  scrub: number[]
}

export interface AnomalyPrediction {
  sensor: string
  label: string
  currentValue: number
  unit: string
  trend: 'rising' | 'falling' | 'stable'
  ratePerMin: number
  predictedBreachValue: number
  estimatedTimeToBreachMin: number | null
  severity: 'watch' | 'warning' | 'critical'
  message: string
}

export interface DecisionScore {
  id: number
  label: string
  score: number           // 0–100, higher = safer
  rationale: string
  recommended: boolean
}

export interface AISummaryResult {
  narrative: string
  overallRisk: 'stable' | 'warning' | 'critical'
  generatedBy: 'watsonx' | 'openai' | 'local'
}

// ── Config ─────────────────────────────────────────────────────────────────

const WX_URL      = import.meta.env.VITE_WATSONX_URL         ?? ''
const WX_KEY      = import.meta.env.VITE_WATSONX_API_KEY     ?? ''
const WX_PROJECT  = import.meta.env.VITE_WATSONX_PROJECT_ID  ?? ''
const WX_MODEL    = import.meta.env.VITE_WATSONX_MODEL       ?? 'ibm/granite-13b-chat-v2'
const OAI_KEY     = import.meta.env.VITE_OPENAI_API_KEY      ?? ''
const OAI_MODEL   = import.meta.env.VITE_OPENAI_MODEL        ?? 'gpt-4o'

// Optional manual override — if absent, auto-detect by priority.
const PROVIDER_OVERRIDE = (import.meta.env.VITE_AI_PROVIDER ?? '') as string

/**
 * Priority 1 — IBM watsonx: all three credentials must be present.
 * Can be forced off by setting VITE_AI_PROVIDER=openai or VITE_AI_PROVIDER=local.
 */
function hasWatsonx(): boolean {
  if (PROVIDER_OVERRIDE && PROVIDER_OVERRIDE !== 'watsonx') return false
  return !!WX_URL && !!WX_KEY && !!WX_PROJECT
}

/**
 * Priority 2 — OpenAI: API key must be present.
 * Skipped if watsonx is available (unless VITE_AI_PROVIDER=openai forces it).
 */
function hasOpenAI(): boolean {
  if (PROVIDER_OVERRIDE && PROVIDER_OVERRIDE !== 'openai') return false
  if (!PROVIDER_OVERRIDE && hasWatsonx()) return false   // watsonx wins
  return !!OAI_KEY
}

/**
 * Returns a human-readable label for whichever provider will be used.
 * Useful for logging and UI badges before a call is made.
 */
export function activeProvider(): 'watsonx' | 'openai' | 'local' {
  if (hasWatsonx()) return 'watsonx'
  if (hasOpenAI())  return 'openai'
  return 'local'
}

// ── IBM watsonx IAM token cache ────────────────────────────────────────────

let _iamToken: string | null = null
let _iamExpiry = 0

async function getIamToken(): Promise<string> {
  if (_iamToken && Date.now() < _iamExpiry) return _iamToken
  const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(WX_KEY)}`,
  })
  if (!res.ok) throw new Error(`IAM token fetch failed: ${res.status}`)
  const data = await res.json()
  _iamToken = data.access_token as string
  _iamExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _iamToken
}

async function watsonxGenerate(prompt: string, maxTokens = 400): Promise<string> {
  const token = await getIamToken()
  const url = `${WX_URL}/ml/v1/text/generation?version=2023-05-29`
  const body = {
    model_id: WX_MODEL,
    project_id: WX_PROJECT,
    input: prompt,
    parameters: { max_new_tokens: maxTokens, temperature: 0.3, top_p: 0.9 },
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`watsonx generate failed: ${res.status}`)
  const data = await res.json()
  return (data.results?.[0]?.generated_text ?? '').trim()
}

async function openaiGenerate(systemPrompt: string, userPrompt: string, maxTokens = 400): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI generate failed: ${res.status}`)
  const data = await res.json()
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

// ── 1. Natural Language Alert Summary ─────────────────────────────────────

const SUMMARY_SYSTEM = `You are an AI co-pilot for a crewed spacecraft. 
Summarize the current mission threat picture in 3–4 concise sentences. 
Be factual, prioritize life-safety risks, and use plain English suitable for a crew member under stress.
Do not use bullet points. Do not say "I" or "as an AI". Be direct and actionable.`

function buildSummaryPrompt(alerts: Alert[], telemetry: TelemetryState, experiments?: Experiment[]): string {
  const activeAlerts = alerts.filter(a => a.level !== 'stable')
  const eclss = telemetry.eclss
  const o2 = eclss.gauges.find(g => g.label === 'O₂ Level')
  const co2 = eclss.gauges.find(g => g.label === 'CO₂')
  const scrub = eclss.bars.find(b => b.label === 'CO₂ Scrubber Load')

  const expLines = experiments && experiments.length > 0
    ? `\n- Active experiments: ${experiments.filter(e => e.status !== 'stable' || e.progress < 100).map(e => `${e.id} ${e.name} [${e.priority}/${e.status.toUpperCase()}] ${e.progress}%`).join(' | ')}`
    : ''

  const atRisk = experiments?.filter(e => e.status === 'critical') ?? []
  const atRiskLine = atRisk.length > 0
    ? `\n- At-risk experiments: ${atRisk.map(e => e.name).join(', ')}`
    : ''

  return `Current spacecraft status:
- Active alerts (${activeAlerts.length}): ${activeAlerts.map(a => `[${a.level.toUpperCase()}] ${a.system}: ${a.message}`).join(' | ')}
- O₂ level: ${o2?.value}% (nominal: 20.9%)
- CO₂: ${co2?.value}% (limit: 0.5%)
- CO₂ scrubber load: ${scrub?.value}%
- Predictions: ${activeAlerts.map(a => a.prediction).join(' | ')}${expLines}${atRiskLine}

Provide a 3-sentence mission status summary.`
}

function localSummary(alerts: Alert[], telemetry: TelemetryState): AISummaryResult {
  const critical = alerts.filter(a => a.level === 'critical')
  const warnings = alerts.filter(a => a.level === 'warning')
  const o2 = telemetry.eclss.gauges.find(g => g.label === 'O₂ Level')
  const co2 = telemetry.eclss.gauges.find(g => g.label === 'CO₂')

  let narrative = ''
  const overallRisk = critical.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : 'stable'

  if (critical.length > 0) {
    narrative = `CRITICAL: ${critical.map(a => `${a.system} — ${a.message}`).join('. ')}. `
  }
  if (warnings.length > 0) {
    narrative += `Active warnings: ${warnings.map(a => `${a.system} (${a.message.split(' ').slice(0, 6).join(' ')})`).join('; ')}. `
  }
  narrative += `Atmosphere reads O₂ ${o2?.value}%, CO₂ ${co2?.value}% — `
  narrative += overallRisk === 'stable'
    ? 'all systems within acceptable parameters. No immediate crew action required.'
    : overallRisk === 'warning'
    ? 'within safe limits but trending toward threshold. Monitor closely and prepare contingency actions.'
    : 'requires immediate crew attention. Refer to relevant emergency procedures.'

  return { narrative, overallRisk, generatedBy: 'local' }
}

export async function naturalLanguageSummary(
  alerts: Alert[],
  telemetry: TelemetryState,
  experiments?: Experiment[]
): Promise<AISummaryResult> {
  const overallRisk = alerts.some(a => a.level === 'critical') ? 'critical'
    : alerts.some(a => a.level === 'warning') ? 'warning' : 'stable'

  try {
    if (hasWatsonx()) {
      const prompt = `${SUMMARY_SYSTEM}\n\n${buildSummaryPrompt(alerts, telemetry, experiments)}`
      const narrative = await watsonxGenerate(prompt, 200)
      return { narrative, overallRisk, generatedBy: 'watsonx' }
    }
    if (hasOpenAI()) {
      const narrative = await openaiGenerate(SUMMARY_SYSTEM, buildSummaryPrompt(alerts, telemetry, experiments), 200)
      return { narrative, overallRisk, generatedBy: 'openai' }
    }
  } catch (err) {
    console.warn('[MCE AI] summary fell back to local:', err)
  }
  return localSummary(alerts, telemetry)
}

// ── 2. Decision Consequence Scoring ───────────────────────────────────────

export interface CrisisContext {
  bat3Temp: number
  bat3TempTrend: 'rising' | 'stable' | 'falling'
  scrubLoad: number
  o2Level: number
  tdrsSignal: number
  backupReserve: number
}

const SCORE_SYSTEM = `You are a spacecraft systems AI. Given the current sensor state and three crisis response options,
score each option 0-100 (100 = safest for crew). Return ONLY valid JSON: {"scores":[{"id":1,"score":85,"rationale":"..."},...]}.
Rationale must be one sentence. Prioritize crew life safety above mission continuity.`

function buildScorePrompt(ctx: CrisisContext): string {
  return `Sensor state:
- BAT-3 temp: ${ctx.bat3Temp.toFixed(1)}°C (${ctx.bat3TempTrend}), baseline 29°C
- CO₂ scrubber load: ${ctx.scrubLoad.toFixed(0)}%
- O₂ level: ${ctx.o2Level.toFixed(2)}%
- TDRS-West signal: ${ctx.tdrsSignal.toFixed(0)}%
- Backup battery reserve: ${ctx.backupReserve}%

Options:
1. Alpha: Shut down camera systems; maintain O₂ at full flow
2. Bravo: Reduce non-critical power draw 18%; maintain comms; BAT-3 temp stabilized in 30 min
3. Charlie: Switch primary bus to backup battery array (6.2h window at ${ctx.backupReserve}% reserve)

Score each option 0-100 for crew safety.`
}

function localScoreDecisions(ctx: CrisisContext): DecisionScore[] {
  // Heuristic scoring based on sensor state
  const batSevere   = ctx.bat3Temp > 38
  const commsWeak   = ctx.tdrsSignal < 50
  const o2Low       = ctx.o2Level < 20
  const reserveLow  = ctx.backupReserve < 50

  // Alpha — safest for life support, sacrifices cameras
  const alphaScore = o2Low ? 95 : batSevere ? 88 : 80
  // Bravo — balanced; degrades science but keeps comms
  const bravoScore = commsWeak ? 60 : batSevere ? 82 : 88
  // Charlie — uses reserves; risky if reserve is low
  const charlieScore = reserveLow ? 45 : batSevere ? 72 : 65

  const scores: DecisionScore[] = [
    { id: 1, label: 'Option Alpha', score: alphaScore, recommended: false,
      rationale: o2Low
        ? 'With O₂ trending low, preserving full flow is the highest-priority safety action.'
        : 'Eliminating camera power is the least-impact load reduction with zero life-safety cost.' },
    { id: 2, label: 'Option Bravo', score: bravoScore, recommended: false,
      rationale: commsWeak
        ? 'Comms are already degraded — further protecting bandwidth is secondary to stabilizing BAT-3.'
        : 'An 18% power reduction reliably stabilizes BAT-3 without sacrificing critical systems.' },
    { id: 3, label: 'Option Charlie', score: charlieScore, recommended: false,
      rationale: reserveLow
        ? `Backup reserves at ${ctx.backupReserve}% create a dangerously short operational window.`
        : 'Switching to backup maintains full continuity but burns reserves with no immediate failure prevented.' },
  ]

  const best = scores.reduce((a, b) => a.score > b.score ? a : b)
  best.recommended = true
  return scores
}

export async function scoreDecisions(ctx: CrisisContext): Promise<DecisionScore[]> {
  try {
    if (hasWatsonx()) {
      const prompt = `${SCORE_SYSTEM}\n\n${buildScorePrompt(ctx)}`
      const raw = await watsonxGenerate(prompt, 300)
      const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      if (Array.isArray(json.scores)) {
        const sorted = [...json.scores].sort((a, b) => b.score - a.score)
        return json.scores.map((s: { id: number; score: number; rationale: string }) => ({
          ...s,
          label: `Option ${['Alpha', 'Bravo', 'Charlie'][s.id - 1]}`,
          recommended: s.id === sorted[0].id,
        }))
      }
    }
    if (hasOpenAI()) {
      const raw = await openaiGenerate(SCORE_SYSTEM, buildScorePrompt(ctx), 300)
      const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      if (Array.isArray(json.scores)) {
        const sorted = [...json.scores].sort((a, b) => b.score - a.score)
        return json.scores.map((s: { id: number; score: number; rationale: string }) => ({
          ...s,
          label: `Option ${['Alpha', 'Bravo', 'Charlie'][s.id - 1]}`,
          recommended: s.id === sorted[0].id,
        }))
      }
    }
  } catch (err) {
    console.warn('[MCE AI] score fell back to local:', err)
  }
  return localScoreDecisions(ctx)
}

// ── 3. Predictive Anomaly Detection ───────────────────────────────────────

interface SensorDef {
  key: keyof TrendData
  label: string
  unit: string
  warnThreshold: number
  critThreshold: number
  direction: 'above' | 'below'   // breach is above or below threshold
}

const SENSOR_DEFS: SensorDef[] = [
  { key: 'bat3Temp',  label: 'BAT-3 Temperature', unit: '°C', warnThreshold: 32, critThreshold: 38, direction: 'above' },
  { key: 'co2',       label: 'CO₂ Level',         unit: '%',  warnThreshold: 0.08, critThreshold: 0.2, direction: 'above' },
  { key: 'o2',        label: 'O₂ Level',           unit: '%',  warnThreshold: 20, critThreshold: 19.5, direction: 'below' },
  { key: 'humidity',  label: 'Cabin Humidity',     unit: '%',  warnThreshold: 80, critThreshold: 90, direction: 'above' },
  { key: 'tdrsWest',  label: 'TDRS-West Signal',   unit: '%',  warnThreshold: 60, critThreshold: 30, direction: 'below' },
  { key: 'scrub',     label: 'CO₂ Scrubber Load',  unit: '%',  warnThreshold: 60, critThreshold: 85, direction: 'above' },
]

/**
 * Fit a linear trend to the last N data points using least-squares.
 * Returns slope (units/tick) and intercept.
 */
function linearTrend(data: number[]): { slope: number; intercept: number } {
  const n = data.length
  if (n < 2) return { slope: 0, intercept: data[0] ?? 0 }
  const xMean = (n - 1) / 2
  const yMean = data.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (data[i] - yMean)
    den += (i - xMean) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = yMean - slope * xMean
  return { slope, intercept }
}

export function detectAnomalies(trends: TrendData): AnomalyPrediction[] {
  const results: AnomalyPrediction[] = []

  for (const def of SENSOR_DEFS) {
    const data = trends[def.key]
    if (!data || data.length < 3) continue

    const current = data[data.length - 1]
    const { slope } = linearTrend(data)
    const ratePerMin = slope * 60   // ticks are 1s, so ×60

    // Determine breach threshold
    const isAbove = def.direction === 'above'
    const critBreached  = isAbove ? current >= def.critThreshold  : current <= def.critThreshold
    const warnBreached  = isAbove ? current >= def.warnThreshold  : current <= def.warnThreshold

    const trend: 'rising' | 'falling' | 'stable' =
      Math.abs(slope) < 0.0005 ? 'stable' : slope > 0 ? 'rising' : 'falling'

    // Compute time-to-breach for the NEXT threshold not yet breached
    let estimatedTimeToBreachMin: number | null = null
    let predictedBreachValue = isAbove ? def.critThreshold : def.critThreshold

    if (!critBreached) {
      const target = isAbove ? def.critThreshold : def.critThreshold
      const delta = target - current
      if ((isAbove && slope > 0) || (!isAbove && slope < 0)) {
        estimatedTimeToBreachMin = Math.round(Math.abs(delta / slope) / 60)
        predictedBreachValue = target
      }
    }

    // Only report if currently breached or trending toward threshold
    const trendingTowardWarn = isAbove
      ? (slope > 0 && current > def.warnThreshold * 0.85)
      : (slope < 0 && current < def.warnThreshold * 1.15)

    if (!warnBreached && !trendingTowardWarn) continue

    const severity: 'watch' | 'warning' | 'critical' = critBreached ? 'critical' : warnBreached ? 'warning' : 'watch'
    const trendStr = trend === 'rising' ? `↑ +${Math.abs(ratePerMin).toFixed(3)}/min` : trend === 'falling' ? `↓ -${Math.abs(ratePerMin).toFixed(3)}/min` : '→ stable'

    let message = `${def.label} at ${current.toFixed(def.unit === '%' && current > 1 ? 1 : 3)}${def.unit} (${trendStr})`
    if (estimatedTimeToBreachMin !== null) {
      message += ` — projected to breach ${def.critThreshold}${def.unit} in ~${estimatedTimeToBreachMin} min`
    } else if (critBreached) {
      message += ` — THRESHOLD EXCEEDED`
    }

    results.push({ sensor: def.key, label: def.label, currentValue: current, unit: def.unit, trend, ratePerMin, predictedBreachValue, estimatedTimeToBreachMin, severity, message })
  }

  // Sort: critical first, then by estimated time to breach ascending
  return results.sort((a, b) => {
    const sev = { critical: 0, warning: 1, watch: 2 }
    if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity]
    const ta = a.estimatedTimeToBreachMin ?? 999
    const tb = b.estimatedTimeToBreachMin ?? 999
    return ta - tb
  })
}

// ── 4. Procedure Q&A ──────────────────────────────────────────────────────

/**
 * Offline-capable emergency procedure knowledge base.
 * Stored in the module so it's bundled and always available without network.
 */
const PROCEDURES: Array<{ keywords: string[]; procedure: string; ref: string }> = [
  {
    keywords: ['co2', 'carbon dioxide', 'scrubber', 'lioh', 'lithium hydroxide'],
    ref: 'EAP-04 §2',
    procedure: `CO₂ Elevated Procedure:
1. Don O₂ masks if CO₂ >0.2% — check seal (green indicator light required).
2. Switch ECLSS to emergency backup mode: panel R14, switch SW-14 — lift guard, flip to BACKUP.
3. Replace LiOH canister if temp strip shows anything other than GREEN. Spare location: Node 1, locker A7-C.
4. Increase ventilation fan speed to MAX on panel A8.
5. Report to MCC via UHF (296.8 MHz) — TDRS outage does not affect UHF.
6. Record CO₂ readings every 5 min in IFS log until level returns below 0.08%.`,
  },
  {
    keywords: ['o2', 'oxygen', 'o₂', 'low oxygen', 'hypoxia'],
    ref: 'EAP-02 §1',
    procedure: `O₂ Low Procedure:
1. Verify manual O₂ flow valve OPEN — panel A7, connector J2.
2. Activate O₂ generation backup: OGS panel, switch OGS-BU to ON.
3. Don O₂ masks immediately if level drops below 19.5%.
4. Seal affected module hatches to conserve supply in remaining modules.
5. Contact MCC; request emergency O₂ resupply schedule confirmation.
6. Monitor cabin O₂ every 2 min; log readings in IFS.`,
  },
  {
    keywords: ['battery', 'bat-3', 'bat3', 'power', 'temperature', 'thermal'],
    ref: 'PWR-07 §3',
    procedure: `Battery Thermal Anomaly Procedure:
1. Immediately reduce non-critical loads: science payloads, camera systems (save BAT-3 from overload).
2. Switch BAT-3 to bypass mode: DCSU panel, BCDU-3 switch → BYPASS.
3. Increase thermal radiator flow: TCS panel, RAD-B → MAX FLOW.
4. Monitor BAT-3 temp every 5 min. If >42°C, isolate and switch to backup bus.
5. Notify MCC of load-shedding status and BAT-3 temp trajectory.
6. If temp continues rising >1°C per 10 min after load shed, execute bus transfer.`,
  },
  {
    keywords: ['comms', 'communication', 'tdrs', 'signal', 'offline', 'blackout', 'lost contact'],
    ref: 'COMM-03 §1',
    procedure: `Communications Loss Procedure:
1. Switch to UHF backup: radio panel, UHF-1 → ACTIVE (channel 296.8 MHz).
2. Attempt TDRS-East if TDRS-West is degraded; select via COMM panel TDRS-E button.
3. Ku-Band backup: KU-XMTR → ON; select antenna track AOS window schedule.
4. If all TDRS lost, initiate Loss of Signal (LOS) protocol: continue nominal operations, log all events.
5. Re-establish contact at next ground station AOS window (see schedule, Comms tab).
6. Do not alter vehicle attitude without MCC confirmation unless life safety requires it.`,
  },
  {
    keywords: ['pressure', 'cabin pressure', 'depress', 'depressurization', 'leak'],
    ref: 'EAP-01 §1',
    procedure: `Cabin Depressurization Procedure:
1. Don O₂ masks IMMEDIATELY.
2. Identify leak source using pressure sensor panel. Seal suspect module hatches.
3. Activate emergency repressurization: O₂/N₂ supply panel, REPRESS switch → EMERGENCY.
4. All crew to safe haven module (Node 1). Close and lock hatches.
5. Begin leak isolation checklist from IFS binder, section DEP-1.
6. Report to MCC via UHF; request emergency support and medical monitoring.`,
  },
  {
    keywords: ['fire', 'smoke', 'burning', 'flame'],
    ref: 'EAP-05 §1',
    procedure: `Fire/Smoke Procedure:
1. Call "FIRE" — all crew respond immediately.
2. Don oxygen masks and goggles.
3. Identify source. Cut power to affected area: RPCM panel for relevant zone.
4. Use CO₂ fire extinguisher (location: Node 1 aft, Lab starboard hatch).
5. If not extinguished in 30s, initiate module isolation — close and seal hatches.
6. Contact MCC via UHF immediately. Do not open sealed module until cleared by MCC.`,
  },
  {
    keywords: ['humidity', 'condensation', 'moisture', 'water'],
    ref: 'ECLSS-12 §2',
    procedure: `High Humidity Procedure:
1. Increase dehumidifier fan speed: ECLSS panel, CCAA-FAN → HIGH.
2. Check for condensation on cold surfaces — wipe and bag water per IFS wastewater protocol.
3. If humidity >90%: reduce crew activity, increase CDRA cycle frequency.
4. Inspect water recovery system for overflow or leaks (WRS panel nominal indicators).
5. Log humidity readings every 15 min until below 75%.`,
  },
]

const PROCEDURE_SYSTEM = `You are an ISS emergency procedure assistant. 
Answer the crew member's question using ONLY information from the provided emergency procedures.
Be brief (3–5 sentences), direct, and prioritize crew safety. If the question is not covered, say so clearly.
Do not speculate beyond what the procedure states.`

function findLocalProcedure(question: string): string | null {
  const q = question.toLowerCase()
  let bestMatch: { proc: typeof PROCEDURES[0]; hits: number } | null = null

  for (const proc of PROCEDURES) {
    const hits = proc.keywords.filter(k => q.includes(k)).length
    if (hits > 0 && (!bestMatch || hits > bestMatch.hits)) {
      bestMatch = { proc, hits }
    }
  }
  return bestMatch ? bestMatch.proc.procedure : null
}

function buildProcedureContext(question: string): string {
  const relevant = PROCEDURES.filter(p => p.keywords.some(k => question.toLowerCase().includes(k)))
  if (relevant.length === 0) {
    // Include all as fallback
    return PROCEDURES.map(p => `[${p.ref}]\n${p.procedure}`).join('\n\n')
  }
  return relevant.map(p => `[${p.ref}]\n${p.procedure}`).join('\n\n')
}

export interface ProcedureAnswer {
  answer: string
  ref: string
  generatedBy: 'watsonx' | 'openai' | 'local'
}

export async function askProcedure(question: string): Promise<ProcedureAnswer> {
  const localProc = findLocalProcedure(question)
  const matchedProc = PROCEDURES.find(p => p.keywords.some(k => question.toLowerCase().includes(k)))

  try {
    if (hasWatsonx() || hasOpenAI()) {
      const context = buildProcedureContext(question)
      const userPrompt = `Emergency Procedures:\n${context}\n\nCrew Question: ${question}`

      let answer: string
      let generatedBy: 'watsonx' | 'openai'

      if (hasWatsonx()) {
        answer = await watsonxGenerate(`${PROCEDURE_SYSTEM}\n\n${userPrompt}`, 300)
        generatedBy = 'watsonx'
      } else {
        answer = await openaiGenerate(PROCEDURE_SYSTEM, userPrompt, 300)
        generatedBy = 'openai'
      }

      return { answer, ref: matchedProc?.ref ?? 'See IFS', generatedBy }
    }
  } catch (err) {
    console.warn('[MCE AI] procedure Q&A fell back to local:', err)
  }

  // Local fallback — return the raw procedure steps
  if (localProc) {
    return {
      answer: localProc,
      ref: matchedProc?.ref ?? 'See IFS',
      generatedBy: 'local',
    }
  }

  return {
    answer: 'No matching emergency procedure found in the offline manual. Refer to the full IFS binder or contact MCC via UHF (296.8 MHz).',
    ref: 'IFS General',
    generatedBy: 'local',
  }
}

// ── 5. Research Action Recommendation ─────────────────────────────────────

export interface ResearchRecommendation {
  action: string
  rationale: string
  urgency: 'immediate' | 'next-shift' | 'routine'
  experimentId: string | null
  generatedBy: 'watsonx' | 'openai' | 'local'
}

const RESEARCH_SYSTEM = `You are a mission science officer AI for a crewed ISS mission.
Given the current experiment status, crew fatigue, and any active system anomalies, recommend the single most important research action the crew should take next.
Be specific and actionable in one sentence. State which experiment and why. Do not use bullet points or say "I".`

function buildResearchPrompt(experiments: Experiment[], crewMaxFatigue: number, activeAlertSystems: string[]): string {
  const running = experiments.filter(e => e.progress < 100)
  const atRisk  = running.filter(e => e.status === 'critical')
  const p1      = running.filter(e => e.priority === 'P1')

  return `Experiment status:
${running.map(e => `- ${e.id} "${e.name}" [${e.domain}/${e.priority}/${e.status.toUpperCase()}] ${e.progress}% complete — ${e.objective.slice(0, 80)}`).join('\n')}

Crew max fatigue: ${crewMaxFatigue.toFixed(0)}%
Active system anomalies: ${activeAlertSystems.length > 0 ? activeAlertSystems.join(', ') : 'None'}

What is the single most important research action to take next?`
}

function localResearchRecommendation(experiments: Experiment[], crewMaxFatigue: number, activeAlertSystems: string[]): ResearchRecommendation {
  const hasLifeSupportAnomaly = activeAlertSystems.some(s => s === 'Power' || s === 'ECLSS')
  const atRisk   = experiments.filter(e => e.status === 'critical' && e.progress < 100)
  const p1       = experiments.filter(e => e.priority === 'P1' && e.status !== 'critical' && e.progress < 100)
  const warning  = experiments.filter(e => e.status === 'warning' && e.progress < 100)
  const crewTired = crewMaxFatigue > 60

  // If life support anomalies are active, defer non-critical science
  if (hasLifeSupportAnomaly && crewMaxFatigue > 70) {
    return {
      action: 'Suspend non-critical science operations and focus crew on resolving active system anomalies before resuming experiments.',
      rationale: 'Active power/ECLSS anomalies with high crew fatigue make experiment work unsafe; crew safety takes priority.',
      urgency: 'immediate',
      experimentId: null,
      generatedBy: 'local',
    }
  }

  // At-risk P1 experiment
  if (atRisk.length > 0) {
    const exp = atRisk.find(e => e.priority === 'P1') ?? atRisk[0]
    return {
      action: `Intervene immediately on ${exp.id} "${exp.name}" — conduct diagnostic check and attempt to recover before data loss.`,
      rationale: `${exp.name} is at critical risk at ${exp.progress}% completion; this is a ${exp.priority} mission objective that cannot be extended.`,
      urgency: 'immediate',
      experimentId: exp.id,
      generatedBy: 'local',
    }
  }

  // Warning P1 experiment
  if (warning.length > 0 && !crewTired) {
    const exp = warning.find(e => e.priority === 'P1') ?? warning[0]
    return {
      action: `Advance ${exp.id} "${exp.name}" during the next available crew window to prevent it from slipping to critical status.`,
      rationale: `${exp.name} is flagged at warning; early intervention at ${exp.progress}% will protect this ${exp.priority} priority experiment.`,
      urgency: 'next-shift',
      experimentId: exp.id,
      generatedBy: 'local',
    }
  }

  // P1 experiment still in progress
  if (p1.length > 0 && !crewTired) {
    const exp = p1[0]
    return {
      action: `Continue scheduled runs for ${exp.id} "${exp.name}" — this ${exp.priority} experiment is on track at ${exp.progress}%.`,
      rationale: `No critical anomalies; crew capacity sufficient to advance highest-priority science objective.`,
      urgency: 'routine',
      experimentId: exp.id,
      generatedBy: 'local',
    }
  }

  // Crew rest needed
  if (crewTired) {
    return {
      action: 'Prioritize crew rest this shift; schedule next experiment run for the following duty period when fatigue levels recover.',
      rationale: `Crew fatigue at ${crewMaxFatigue.toFixed(0)}% — performing complex experiment procedures at this level increases error risk.`,
      urgency: 'next-shift',
      experimentId: null,
      generatedBy: 'local',
    }
  }

  return {
    action: 'All experiments are on track — continue nominal science operations per the scheduled daily plan.',
    rationale: 'No anomalies, no at-risk experiments, crew fatigue acceptable.',
    urgency: 'routine',
    experimentId: null,
    generatedBy: 'local',
  }
}

export async function recommendResearchAction(
  experiments: Experiment[],
  crewMaxFatigue: number,
  activeAlertSystems: string[]
): Promise<ResearchRecommendation> {
  const local = () => localResearchRecommendation(experiments, crewMaxFatigue, activeAlertSystems)
  try {
    if (hasWatsonx()) {
      const prompt = `${RESEARCH_SYSTEM}\n\n${buildResearchPrompt(experiments, crewMaxFatigue, activeAlertSystems)}`
      const raw = await watsonxGenerate(prompt, 150)
      if (raw.length > 20) {
        const atRisk = experiments.filter(e => e.status === 'critical')
        return {
          action: raw.trim(),
          rationale: atRisk.length > 0 ? `${atRisk[0].name} is at critical risk.` : 'Based on current experiment and crew state.',
          urgency: atRisk.length > 0 ? 'immediate' : 'routine',
          experimentId: atRisk[0]?.id ?? null,
          generatedBy: 'watsonx',
        }
      }
    }
    if (hasOpenAI()) {
      const raw = await openaiGenerate(RESEARCH_SYSTEM, buildResearchPrompt(experiments, crewMaxFatigue, activeAlertSystems), 150)
      if (raw.length > 20) {
        const atRisk = experiments.filter(e => e.status === 'critical')
        return {
          action: raw.trim(),
          rationale: atRisk.length > 0 ? `${atRisk[0].name} is at critical risk.` : 'Based on current experiment and crew state.',
          urgency: atRisk.length > 0 ? 'immediate' : 'routine',
          experimentId: atRisk[0]?.id ?? null,
          generatedBy: 'openai',
        }
      }
    }
  } catch (err) {
    console.warn('[MCE AI] research recommendation fell back to local:', err)
  }
  return local()
}
