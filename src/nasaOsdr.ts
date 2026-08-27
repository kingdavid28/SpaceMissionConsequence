/**
 * NASA Open Science Data Repository (OSDR) integration
 *
 * Fetches real ISS spaceflight experiment metadata from the NASA OSDR
 * public REST API (no API key required).
 *
 * API docs: https://osdr.nasa.gov/bio/repo/data/studies/
 * CORS: the OSDR API allows cross-origin requests from browsers.
 *
 * Falls back to a curated offline set of real ISS experiments when the
 * network is unavailable or the API is unreachable.
 */

export type ExperimentDomain =
  | 'Biology'
  | 'Physics'
  | 'Earth Observation'
  | 'Human Research'
  | 'Plant Science'
  | 'Materials Science'
  | 'Technology Demo'

export type ExperimentPriority = 'P1' | 'P2' | 'P3'

export interface Experiment {
  id: string
  name: string
  domain: ExperimentDomain
  objective: string
  /** 0–100 simulated completion progress */
  progress: number
  /** derived from progress + anomaly flags */
  status: 'stable' | 'warning' | 'critical'
  /** P1 = mission-critical, P2 = high value, P3 = secondary */
  priority: ExperimentPriority
  /** Human-readable ETA or "Complete" / "At Risk" */
  eta: string
  /** Source URL or dataset reference */
  sourceRef: string
  /** True when fetched live from NASA OSDR */
  isLive: boolean
}

// ── Offline curated baseline — all real ISS experiments ────────────────────
// Data sourced from NASA OSDR and ISS National Lab published study records.
const OFFLINE_EXPERIMENTS: Experiment[] = [
  {
    id: 'OSD-100',
    name: 'Rodent Research-1 (RR-1)',
    domain: 'Biology',
    objective: 'Characterize physiological and genomic effects of microgravity on mice; bone and muscle loss markers over 37-day flight.',
    progress: 68,
    status: 'stable',
    priority: 'P1',
    eta: '2026-08-22',
    sourceRef: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-100',
    isLive: false,
  },
  {
    id: 'OSD-37',
    name: 'GeneLab Plant Experiment-1 (GLDS-37)',
    domain: 'Plant Science',
    objective: 'Evaluate Arabidopsis thaliana growth and gene expression in microgravity using VEGGIE growth chamber; assess crop viability for long-duration missions.',
    progress: 22,
    status: 'critical',
    priority: 'P1',
    eta: 'At Risk',
    sourceRef: 'https://osdr.nasa.gov/bio/repo/data/studies/OSD-37',
    isLive: false,
  },
  {
    id: 'CFE-3',
    name: 'Capillary Flow Experiment-3',
    domain: 'Physics',
    objective: 'Study capillary flows in spacecraft propellant management; validate computational fluid dynamics models for microgravity fuel systems.',
    progress: 34,
    status: 'warning',
    priority: 'P2',
    eta: '2026-08-31',
    sourceRef: 'https://www.nasa.gov/mission/station/research-explorer/investigation/?#id=688',
    isLive: false,
  },
  {
    id: 'MSG-4',
    name: 'Microgravity Science Glovebox — Run 12',
    domain: 'Materials Science',
    objective: 'Study combustion behavior of solid-fuel samples in microgravity; support development of fire-safety standards for exploration vehicles.',
    progress: 68,
    status: 'stable',
    priority: 'P2',
    eta: '2026-08-22',
    sourceRef: 'https://www.nasa.gov/mission/station/research-explorer/investigation/?#id=7502',
    isLive: false,
  },
  {
    id: 'HDEV-6',
    name: 'High Definition Earth Viewing (HDEV)',
    domain: 'Earth Observation',
    objective: 'Continuous HD video observation of Earth surface for atmospheric, geological, and oceanic phenomena; supports citizen science downlink.',
    progress: 100,
    status: 'stable',
    priority: 'P3',
    eta: 'Complete',
    sourceRef: 'https://eol.jsc.nasa.gov/HDEV/',
    isLive: false,
  },
]

// ── OSDR API types (partial) ───────────────────────────────────────────────
interface OsdrStudy {
  study_id: string
  title: string
  study_description?: string
  factors?: string[]
  organisms?: string[]
  assay_types?: string[]
}

// Maps OSDR study fields to our ExperimentDomain
function inferDomain(study: OsdrStudy): ExperimentDomain {
  const title = (study.title ?? '').toLowerCase()
  const desc  = (study.study_description ?? '').toLowerCase()
  const orgs  = (study.organisms ?? []).join(' ').toLowerCase()
  if (orgs.includes('arabidopsis') || orgs.includes('plant') || title.includes('plant') || title.includes('veggie')) return 'Plant Science'
  if (title.includes('rodent') || title.includes('mouse') || title.includes('rat') || orgs.includes('mus musculus')) return 'Biology'
  if (title.includes('human') || title.includes('crew') || title.includes('astronaut')) return 'Human Research'
  if (title.includes('combustion') || title.includes('fluid') || title.includes('capillary') || title.includes('material')) return 'Materials Science'
  if (title.includes('earth') || title.includes('imaging') || title.includes('remote sens')) return 'Earth Observation'
  if (title.includes('tech') || title.includes('demo') || title.includes('hardware')) return 'Technology Demo'
  const assays = (study.assay_types ?? []).join(' ').toLowerCase()
  if (assays.includes('rna') || assays.includes('protein') || assays.includes('transcriptom')) return 'Biology'
  return 'Human Research'
}

// ── In-memory cache ────────────────────────────────────────────────────────
let _cachedExperiments: Experiment[] | null = null
let _cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000   // 5 minutes

/**
 * Load ISS experiment records.
 *
 * Strategy:
 *  1. Return in-memory cache if fresh.
 *  2. Try fetching 5 recent spaceflight studies from NASA OSDR.
 *  3. Merge live OSDR metadata with our curated progress/status/priority fields.
 *  4. On any network error, return the curated offline baseline.
 */
export async function loadExperiments(): Promise<Experiment[]> {
  if (_cachedExperiments && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedExperiments
  }

  try {
    // OSDR search: filter to ISS / Space Station platform, return 5 most recent
    const url = 'https://osdr.nasa.gov/osdr/data/osd/studies/?term=ISS&from=0&size=5&sort=release_date&order=desc'
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`OSDR API ${res.status}`)
    const json = await res.json()

    const studies: OsdrStudy[] = json?.hits?.hits?.map((h: { _source: OsdrStudy }) => h._source) ?? []
    if (studies.length === 0) throw new Error('OSDR returned empty results')

    // Map live studies, blending with curated progress/priority from our offline set
    const live: Experiment[] = studies.slice(0, 5).map((s, i) => {
      const offline = OFFLINE_EXPERIMENTS[i % OFFLINE_EXPERIMENTS.length]
      const domain = inferDomain(s)
      return {
        id: s.study_id ?? offline.id,
        name: s.title ?? offline.name,
        domain,
        objective: s.study_description
          ? s.study_description.slice(0, 160).replace(/\n/g, ' ') + (s.study_description.length > 160 ? '…' : '')
          : offline.objective,
        progress: offline.progress,
        status: offline.status,
        priority: offline.priority,
        eta: offline.eta,
        sourceRef: `https://osdr.nasa.gov/bio/repo/data/studies/${s.study_id}`,
        isLive: true,
      }
    })

    _cachedExperiments = live
    _cacheTimestamp = Date.now()
    return live
  } catch (err) {
    console.info('[MCE] OSDR API unavailable, using offline experiment data:', (err as Error).message)
    _cachedExperiments = OFFLINE_EXPERIMENTS
    _cacheTimestamp = Date.now()
    return OFFLINE_EXPERIMENTS
  }
}

/** Return experiments sorted by priority then status severity. */
export function sortedExperiments(experiments: Experiment[]): Experiment[] {
  const statusRank = { critical: 0, warning: 1, stable: 2 }
  const priorityRank = { P1: 0, P2: 1, P3: 2 }
  return [...experiments].sort((a, b) => {
    const pr = priorityRank[a.priority] - priorityRank[b.priority]
    if (pr !== 0) return pr
    return statusRank[a.status] - statusRank[b.status]
  })
}

/** Domain colour tokens (CSS-compatible) */
export const DOMAIN_COLOR: Record<ExperimentDomain, string> = {
  'Biology':           'rgba(0,212,255,0.8)',
  'Physics':           'rgba(180,100,255,0.8)',
  'Earth Observation': 'rgba(0,255,157,0.8)',
  'Human Research':    'rgba(245,166,35,0.8)',
  'Plant Science':     'rgba(80,220,80,0.8)',
  'Materials Science': 'rgba(255,180,0,0.8)',
  'Technology Demo':   'rgba(150,180,255,0.8)',
}

export const DOMAIN_BG: Record<ExperimentDomain, string> = {
  'Biology':           'rgba(0,212,255,0.06)',
  'Physics':           'rgba(180,100,255,0.06)',
  'Earth Observation': 'rgba(0,255,157,0.06)',
  'Human Research':    'rgba(245,166,35,0.06)',
  'Plant Science':     'rgba(80,220,80,0.06)',
  'Materials Science': 'rgba(255,180,0,0.06)',
  'Technology Demo':   'rgba(150,180,255,0.06)',
}
