import { kstDateOf } from './kst.ts'

export type DiaryImportance = 'special' | 'nice' | 'ordinary'
export type DiaryReliability = 'A' | 'B'

export type DiaryCandidate = {
  type: string
  occurredAt: string
  kstDate: string
  importance: DiaryImportance
  reliability: DiaryReliability
  safeTitle: string
  source: { table: string; id: string; eventType?: string }
  artworkId?: number
  counterpartyCodename?: string
  retroactive?: boolean
  facts: Record<string, string | number | boolean>
}

const IMPORTANCE_RANK: Record<DiaryImportance, number> = { special: 3, nice: 2, ordinary: 1 }
const AGENT_NUMBER = /\bAGENT\d+\b/i

function safeString(value: unknown, max = 160): string {
  const text = String(value || '').trim().slice(0, max)
  return AGENT_NUMBER.test(text) ? '' : text
}

function safeFacts(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string | number | boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key)) continue
    if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
    else if (typeof raw === 'boolean') out[key] = raw
    else if (typeof raw === 'string') {
      const text = safeString(raw)
      if (text) out[key] = text
    }
  }
  return out
}

/** The only door into the diary candidate layer. C/D facts, invalid dates,
 * unsafe agent numbers and untraceable rows are rejected instead of being
 * repaired or guessed. */
export function normalizeDiaryCandidate(raw: Partial<DiaryCandidate>): DiaryCandidate | null {
  if (raw.reliability !== 'A' && raw.reliability !== 'B') return null
  if (!raw.importance || !IMPORTANCE_RANK[raw.importance]) return null
  const occurredAt = safeString(raw.occurredAt, 40)
  const time = Date.parse(occurredAt)
  const type = safeString(raw.type, 64)
  const title = safeString(raw.safeTitle, 180)
  const table = safeString(raw.source?.table, 80)
  const id = safeString(raw.source?.id, 160)
  if (!Number.isFinite(time) || !type || !title || !table || !id) return null
  const kstDate = kstDateOf(Math.floor(time / 1000))
  if (raw.kstDate && raw.kstDate !== kstDate) return null
  const codename = raw.counterpartyCodename ? safeString(raw.counterpartyCodename, 24) : ''
  if (raw.counterpartyCodename && !codename) return null
  return {
    type, occurredAt: new Date(time).toISOString(), kstDate,
    importance: raw.importance, reliability: raw.reliability, safeTitle: title,
    source: { table, id, ...(raw.source?.eventType ? { eventType: safeString(raw.source.eventType, 64) } : {}) },
    ...(Number.isInteger(raw.artworkId) ? { artworkId: Number(raw.artworkId) } : {}),
    ...(codename ? { counterpartyCodename: codename } : {}),
    ...(raw.retroactive != null ? { retroactive: !!raw.retroactive } : {}),
    facts: safeFacts(raw.facts),
  }
}

export function streamingXpKstDate(dedupKey: unknown, agentNo?: string): string | null {
  const key = String(dedupKey || '')
  const match = /^streams:([^:]+):(\d{4}-\d{2}-\d{2})$/.exec(key)
  if (!match || (agentNo && match[1].toUpperCase() !== agentNo.toUpperCase())) return null
  const date = match[2]
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

function sameUnderlyingEvent(a: DiaryCandidate, b: DiaryCandidate): boolean {
  if (a.type === 'district-restored' && b.type === 'xp' && b.facts.source === 'district') return true
  if (b.type === 'district-restored' && a.type === 'xp' && a.facts.source === 'district') return true
  if (a.type === 'mission-completed' && b.type === 'reconnect-completed') return true
  if (b.type === 'mission-completed' && a.type === 'reconnect-completed') return true
  if (a.type === 'level-reached' && b.type === 'level-reward') return true
  if (b.type === 'level-reached' && a.type === 'level-reward') return true
  if (a.type.startsWith('red-zone-') && b.type.startsWith('red-zone-')) return true
  return false
}

/** Keep the richer candidate for correlated rows while badges remain separate
 * visual collectibles and are never removed by narrative deduplication. */
export function dedupeDiaryCandidates(candidates: DiaryCandidate[]): DiaryCandidate[] {
  const exact = new Map<string, DiaryCandidate>()
  for (const item of candidates) exact.set(`${item.source.table}:${item.source.id}:${item.type}`, item)
  const out: DiaryCandidate[] = []
  for (const item of [...exact.values()].sort(compareDiaryCandidates)) {
    if (item.type === 'badge-awarded' || !out.some((prior) => sameUnderlyingEvent(prior, item))) out.push(item)
  }
  return out.sort(compareDiaryCandidates)
}

export function compareDiaryCandidates(a: DiaryCandidate, b: DiaryCandidate): number {
  return IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance]
    || Number(a.type === 'badge-awarded') - Number(b.type === 'badge-awarded')
    || Date.parse(a.occurredAt) - Date.parse(b.occurredAt)
    || a.type.localeCompare(b.type)
}

export type DiarySelection = {
  state: 'real' | 'light' | 'none'
  anchor: DiaryCandidate | null
  badges: DiaryCandidate[]
  memories: DiaryCandidate[]
  listening: DiaryCandidate | null
  ordinary: DiaryCandidate[]
  selected: DiaryCandidate[]
}

export function selectDailyMemories(input: DiaryCandidate[], hasNote = false): DiarySelection {
  const all = dedupeDiaryCandidates(input)
  const badges = all.filter((c) => c.type === 'badge-awarded')
  const narrative = all.filter((c) => c.type !== 'badge-awarded')
  const listeningTypes = new Set(['top-track', 'listening-variety', 'high-stream-day'])
  const meaningful = narrative.filter((c) => c.importance !== 'ordinary' && !listeningTypes.has(c.type))
  const anchor = meaningful[0] || null
  const additional = meaningful.filter((c) => c !== anchor).slice(0, 2)
  const listening = narrative.find((c) => listeningTypes.has(c.type)) || null
  const chosenListening = listening && listening !== anchor && !additional.includes(listening) ? listening : null
  const ordinary = narrative.filter((c) => c.importance === 'ordinary' && c !== chosenListening).slice(0, meaningful.length ? 1 : 2)
  const selected = [anchor, ...badges, ...additional, chosenListening, ...ordinary].filter(Boolean) as DiaryCandidate[]
  return {
    state: meaningful.length || badges.length || listening?.importance === 'nice' ? 'real' : ordinary.length || chosenListening || hasNote ? 'light' : 'none',
    anchor, badges, memories: additional, listening: chosenListening, ordinary, selected,
  }
}

export function candidateDigest(candidates: DiaryCandidate[]): string {
  const stable = candidates.map((c) => [c.type, c.occurredAt, c.source.table, c.source.id, c.artworkId || null, c.facts])
  let hash = 2166136261
  for (const ch of JSON.stringify(stable)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

export function backupPassCandidates(rows: any[], codenames: Map<string, string>, agentNo: string): DiaryCandidate[] {
  const out: DiaryCandidate[] = []
  for (const row of rows || []) {
    const complete = row.status === 'complete' && row.helper_agent_no && row.completed_at
    const banked = row.status === 'banked' && row.helper_agent_no && Number(row.banked_credit) > 0 && row.closed_at
    if (!complete && !banked) continue
    const occurredAt = complete ? row.completed_at : row.closed_at
    const isOwner = row.owner_agent_no === agentNo
    const otherNo = isOwner ? row.helper_agent_no : row.owner_agent_no
    const codename = codenames.get(otherNo)
    if (!codename) continue
    const amount = Number(row.banked_credit) || 0
    const candidate = normalizeDiaryCandidate({
      type: isOwner ? 'backup-helped-me' : 'backup-helped-agent',
      occurredAt, importance: 'special', reliability: 'A',
      safeTitle: isOwner ? `Agent ${codename} helped finish a Backup Pass.` : `Helped Agent ${codename} finish a Backup Pass.`,
      source: { table: 'rc_backup_requests', id: String(row.id), eventType: row.status },
      counterpartyCodename: codename,
      facts: { outcome: row.status, ...(amount > 0 ? { contribution: amount } : {}) },
    })
    if (candidate) out.push(candidate)
  }
  return out
}
