// Weekly collectible XP.
//
// A collectible placed in a district the player restored themselves earns a
// fixed amount of XP once per KST week (Monday 00:00 KST, kstWeekKey — the
// same week weekly side missions and Era cards use), up to WEEKLY_CAP. Only
// one copy of each collectible counts; different collectibles each earn.
// Nothing is earned in the Pack, in a district the player hasn't restored,
// or for tickets / Backup Passes / used items.
//
// The week only pays if the player was actually restoring that week:
//   - QUALIFY_PLAYS plays of their active district's goal songs, or
//   - a district restored this week, or
//   - QUALIFY_PLAYS plays of the songs of a ReConnect team they're helping
//     (players who have restored everything help through ReConnect).
//
// Awards are rc_xp_ledger rows, source 'collectible', one per player + week +
// collectible (dedup_key), so moving, removing or re-placing an item can
// never pay twice. They're written only through rc_award_collectible_xp
// (payAwards), which locks the player's week and re-checks the cap, so the
// poll and the weekly settle (collectible-settle.ts) can race safely.
// earned_week records the week earned, apart from created_at (credited).
// Rewards start at START_WEEK (the first weekly reset after release); nothing earlier is
// paid. Everything here except awardCollectibleXp is pure, for the tests.

import { kstWeekKey, addDaysStr } from './kst.ts'

import { collectibleWeeklyXp, COLLECTION_WEEKLY_CAP } from './collectible-values.js'

export { collectibleWeeklyXp }
export const WEEKLY_CAP = COLLECTION_WEEKLY_CAP
export const QUALIFY_PLAYS = 10
export const START_WEEK = '2026-11-30'

export const dedupKey = (agentNo: string, weekKey: string, itemId: string) => `collectible:${agentNo}:${weekKey}:${itemId}`

/** Monday of this KST week, and the moment the next one starts (ISO). */
export function weekInfo(todayKst: string) {
  const weekKey = kstWeekKey(todayKst)
  const next = addDaysStr(weekKey, 7)
  return { weekKey, weekStartIso: new Date(`${weekKey}T00:00:00+09:00`).toISOString(), resetsAt: new Date(`${next}T00:00:00+09:00`).toISOString() }
}

interface OwnedItem { id: string; itemId: string; name?: string; kind?: string; era?: string; districtId?: string | null; usedAt?: string | null }

/** Which collectibles earn this week, one entry per collectible (a second
 *  copy never adds), highest value first so the cap keeps the best ones. */
export function eligibleCollectibles(items: OwnedItem[], restored: Set<string>) {
  const best = new Map<string, { itemId: string; name: string; xp: number }>()
  for (const it of items || []) {
    if (!it?.districtId || it.usedAt || !restored.has(it.districtId)) continue
    const xp = collectibleWeeklyXp(it)
    if (xp <= 0 || best.has(it.itemId)) continue
    best.set(it.itemId, { itemId: it.itemId, name: it.name || it.itemId, xp })
  }
  return [...best.values()].sort((a, b) => b.xp - a.xp || a.itemId.localeCompare(b.itemId))
}

/** What to pay now: whatever earns, isn't paid yet this week, and fits under
 *  the cap (the last one is trimmed to land exactly on it). */
export function planAwards(eligible: { itemId: string; name: string; xp: number }[], paid: Map<string, number>, cap = WEEKLY_CAP) {
  let earned = [...paid.values()].reduce((s, n) => s + n, 0)
  const award: { itemId: string; name: string; xp: number }[] = []
  for (const e of eligible) {
    if (paid.has(e.itemId)) continue
    const room = cap - earned
    if (room <= 0) break
    const xp = Math.min(e.xp, room)
    award.push({ ...e, xp })
    earned += xp
  }
  return { award, earned }
}

/** Plays of these title keys this week (from the daily rollups), counting
 *  only days on or after `fromDate`. */
export function weekPlays(rollups: { kst_date: string; track_counts?: Record<string, { n?: number }> }[], keys: Iterable<string>, weekKey: string, fromDate = weekKey) {
  const want = new Set(keys)
  if (!want.size) return 0
  const from = fromDate > weekKey ? fromDate : weekKey
  let n = 0
  for (const row of rollups || []) {
    const date = String(row.kst_date)
    if (date < from || date >= addDaysStr(weekKey, 7)) continue
    for (const key of want) n += Number(row.track_counts?.[key]?.n) || 0
  }
  return n
}

/** The title keys of a quest config, whichever shape it has. */
export function questKeys(config: Record<string, any> = {}): string[] {
  const keys = new Set<string>()
  for (const k of config.sharedTrack?.keys || []) keys.add(k)
  for (const t of config.sharedTracks?.tracks || []) for (const k of t.keys || []) keys.add(k)
  for (const t of config.checklist?.tracks || []) for (const k of t.keys || []) keys.add(k)
  return [...keys]
}

/** Every title key of a district attempt's own track and album goals. */
export function goalKeys(goals: any): string[] {
  const keys: string[] = []
  for (const t of goals?.trackGoals || []) keys.push(...(t.keys || []))
  for (const a of goals?.albumGoals || []) for (const t of a.tracks || []) keys.push(...(t.keys || []))
  return keys
}

/** Was this a restoring week? Returns why (or the closest progress). */
export function weekQualifies(input: {
  weekKey: string
  rollups: any[]
  activePd: any | null
  pdRows: any[]
  helpingQuests: { keys: string[] }[]
  weekStartIso: string
}) {
  const restoredThisWeek = (input.pdRows || []).some((r: any) => r.status === 'restored' && r.completed_at && r.completed_at >= input.weekStartIso)
  if (restoredThisWeek) return { qualified: true, reason: 'restored', plays: QUALIFY_PLAYS }
  let plays = 0
  if (input.activePd) {
    const activated = String(input.activePd.activated_at || '').slice(0, 10)
    plays = weekPlays(input.rollups, goalKeys(input.activePd.goals), input.weekKey, activated)
    if (plays >= QUALIFY_PLAYS) return { qualified: true, reason: 'goal_plays', plays }
  }
  for (const q of input.helpingQuests || []) {
    const n = weekPlays(input.rollups, q.keys, input.weekKey)
    if (n >= QUALIFY_PLAYS) return { qualified: true, reason: 'reconnect', plays: n }
    plays = Math.max(plays, n)
  }
  return { qualified: false, reason: null, plays: Math.min(plays, QUALIFY_PLAYS) }
}

// deno-lint-ignore no-explicit-any
type Sb = any

/** Writes awards through rc_award_collectible_xp — the only writer, shared by
 *  the app's poll and the weekly settle. It locks the player's week, re-checks
 *  the cap against what that week already paid, and skips any key already
 *  there, so racing callers can't pay twice or pass the cap. Returns what was
 *  actually written (itemId -> xp); an error writes nothing. */
export async function payAwards(supabase: Sb, agentNo: string, weekKey: string, award: { itemId: string; xp: number }[], via: 'app' | 'settle') {
  const got = new Map<string, number>()
  if (!award.length) return got
  const { data, error } = await supabase.rpc('rc_award_collectible_xp', {
    p_agent_no: agentNo, p_week: weekKey, p_cap: WEEKLY_CAP,
    p_awards: award.map((a) => ({ itemId: a.itemId, xp: a.xp })), p_via: via,
  })
  if (error) { console.error('collectible award failed:', error.message); return got }
  for (const r of data || []) got.set(String(r.item_id), Number(r.amount) || 0)
  return got
}

/** Pays this week's collectible XP if due, and returns what the Pack shows.
 *  Cheap on a normal poll: one ledger read, and only when something placed
 *  could earn. */
export async function awardCollectibleXp(supabase: Sb, input: {
  agentNo: string
  today: string
  items: OwnedItem[]
  restored: Set<string>
  rollups: any[]
  activePd: any | null
  pdRows: any[]
  helpingQuests: { keys: string[] }[]
}) {
  const { weekKey, weekStartIso, resetsAt } = weekInfo(input.today)
  const eligible = eligibleCollectibles(input.items, input.restored)
  const base = { weekKey, startsWeek: START_WEEK, started: weekKey >= START_WEEK, cap: WEEKLY_CAP, qualifyPlays: QUALIFY_PLAYS, resetsAt }
  if (!base.started) return { ...base, earned: 0, earnedItemIds: [] as string[], qualified: false, plays: 0, reason: null, newlyAwarded: [] as any[], awardedXp: 0 }

  const paid = new Map<string, number>()
  if (eligible.length) {
    const { data } = await supabase.from('rc_xp_ledger').select('dedup_key, amount')
      .eq('agent_no', input.agentNo).eq('source', 'collectible').gte('created_at', weekStartIso)
    const prefix = `collectible:${input.agentNo}:${weekKey}:`
    for (const row of data || []) {
      if (String(row.dedup_key || '').startsWith(prefix)) paid.set(String(row.dedup_key).slice(prefix.length), Number(row.amount) || 0)
    }
  }
  const q = weekQualifies({ weekKey, rollups: input.rollups, activePd: input.activePd, pdRows: input.pdRows, helpingQuests: input.helpingQuests, weekStartIso })
  const plan = q.qualified ? planAwards(eligible, paid) : { award: [], earned: [...paid.values()].reduce((s, n) => s + n, 0) }

  let awardedXp = 0
  const newlyAwarded: { itemId: string; name: string; xp: number }[] = []
  if (plan.award.length) {
    const got = await payAwards(supabase, input.agentNo, weekKey, plan.award, 'app')
    for (const a of plan.award) {
      const xp = got.get(a.itemId)
      if (xp == null) continue
      newlyAwarded.push({ ...a, xp }); awardedXp += xp; paid.set(a.itemId, xp)
    }
  }
  return {
    ...base,
    earned: [...paid.values()].reduce((s, n) => s + n, 0),
    earnedItemIds: [...paid.keys()],
    qualified: q.qualified, reason: q.reason, plays: q.plays,
    newlyAwarded, awardedXp,
  }
}
