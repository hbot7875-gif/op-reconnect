// Daily transmission — one small auto-generated mission per KST day.
// Deterministic from (agentNo, date) so no scheduler is needed, but the
// generated mission is FROZEN into rc_daily_activity at first computation:
// mid-day signal/goal edits can never mutate a mission someone is playing.

import { normKeyFull, artistAllowed } from './text.ts'
import type { GameContent, GoalRow } from './config.ts'

export interface FrozenTransmission {
  templateId: number
  kind: string
  text: string
  required: number
  keys: string[] | null            // track buckets that count (null = variety kind)
  albumTracks?: { label: string; keys: string[] }[]
}

export interface DayBucket {
  [key: string]: { n: number; a: Record<string, number> }
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function goalKeys(goal: { label: string; aliases: string[] }): string[] {
  const keys = new Set<string>([normKeyFull(goal.label)])
  for (const a of goal.aliases || []) {
    const k = normKeyFull(a)
    if (k) keys.add(k)
  }
  return [...keys]
}

export function generateTransmission(agentNo: string, kstDate: string, content: GameContent): FrozenTransmission | null {
  const templates: any[] = (content.config.transmission_templates || []).filter((t: any) => t.enabled)
  const trackGoals = content.goals.filter((g) => g.kind === 'track')
  const albumGoal = content.goals.find((g) => g.kind === 'album') || null
  if (templates.length === 0 || trackGoals.length === 0) return null

  const seed = fnv1a(`${agentNo}|${kstDate}`)
  const tpl = templates[seed % templates.length]
  const n = tpl.nMin + ((seed >>> 8) % (tpl.nMax - tpl.nMin + 1))
  const pick: GoalRow = trackGoals[(seed >>> 16) % trackGoals.length]

  const text = String(tpl.text).replace('{track}', pick.label).replace('{n}', String(n))
  const base = { templateId: tpl.id, kind: tpl.kind, text, required: n }

  switch (tpl.kind) {
    case 'critical_track':
      return { ...base, keys: goalKeys(pick) }
    case 'any_goal_track':
      return { ...base, keys: trackGoals.flatMap((g) => goalKeys(g)) }
    case 'variety':
      return { ...base, keys: null }
    case 'album_day': {
      if (!albumGoal || !albumGoal.tracks) return { ...base, kind: 'any_goal_track', keys: trackGoals.flatMap((g) => goalKeys(g)) }
      return {
        ...base,
        required: 1,
        keys: null,
        albumTracks: albumGoal.tracks.map((t) => ({ label: t.label, keys: goalKeys({ label: t.label, aliases: t.aliases || [] }) })),
      }
    }
    default:
      return { ...base, keys: trackGoals.flatMap((g) => goalKeys(g)) }
  }
}

/** Evaluate a frozen transmission against one day's activity bucket. */
export function evaluateTransmission(
  frozen: FrozenTransmission,
  bucket: DayBucket,
  allowlist: string[],
): { progress: number; done: boolean } {
  let progress = 0
  if (frozen.kind === 'variety') {
    for (const key of Object.keys(bucket)) {
      const entry = bucket[key]
      const allowedN = Object.entries(entry.a).reduce((s, [artist, cnt]) => s + (artistAllowed(artist, allowlist) ? cnt : 0), 0)
      if (allowedN > 0) progress++
    }
  } else if (frozen.kind === 'album_day' && frozen.albumTracks) {
    // one full pass today = every album track played at least once
    let passes = Infinity
    for (const t of frozen.albumTracks) {
      const plays = t.keys.reduce((s, k) => s + (bucket[k]?.n || 0), 0)
      passes = Math.min(passes, plays)
    }
    progress = Number.isFinite(passes) ? passes : 0
  } else if (frozen.keys) {
    for (const k of frozen.keys) progress += bucket[k]?.n || 0
  }
  return { progress: Math.min(progress, frozen.required), done: progress >= frozen.required }
}
