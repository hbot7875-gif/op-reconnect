// Weekly Collection XP settle: pays the week that just ended for every
// eligible player, whether or not they opened HT before the reset.
//
// The app's poll (collectible-rewards.ts awardCollectibleXp) still pays during
// the week, so active players see their XP straight away. This catches
// everyone else, with the same values, cap and activity rules, read as they
// stood at the reset (Monday 00:00 KST = Sunday 8:30 PM IST):
//
//   - placements: current rc_player_items rolled back through
//     rc_item_placement_log, so a move, a Move to Pack or a ticket used after
//     the reset doesn't change the week that ended;
//   - restored districts and the active attempt: rc_player_districts rolled
//     back through rc_player_district_log, so an attempt that expired (its
//     row deleted) after the reset still counts for the week it ran in;
//   - plays: rc_daily_activity for the seven KST days of that week, which the
//     hourly fleet sync keeps current for everyone (and re-reads when plays
//     arrive late);
//   - ReConnect help: teams the player was in at some point that week.
//
// pg_cron runs it 65 minutes after the reset (after the fleet sync has read
// all of Sunday) and again 24 h and 48 h later for late-arriving plays. Each
// run settles only the week that just ended and only inside CATCH_UP_HOURS.
// Payment goes through payAwards (rc_award_collectible_xp), which locks the
// player's week and re-checks the cap, so a run, a re-run and an app poll can
// overlap without paying anything twice or passing 50 XP.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { addDaysStr, kstWeekKey, todayKst } from './kst.ts'
import {
  eligibleCollectibles, planAwards, weekQualifies, questKeys, payAwards,
  START_WEEK, WEEKLY_CAP,
} from './collectible-rewards.ts'

/** How long after a week ends it can still be settled (late plays). */
export const CATCH_UP_HOURS = 72

const BATCH = 8

export function weekBounds(weekKey: string) {
  return {
    weekKey,
    startIso: new Date(`${weekKey}T00:00:00+09:00`).toISOString(),
    endIso: new Date(`${addDaysStr(weekKey, 7)}T00:00:00+09:00`).toISOString(),
    lastDay: addDaysStr(weekKey, 6),
  }
}

/** The week a cron run settles: the one that ended most recently. */
export function weekToSettle(nowMs = Date.now()) {
  const today = todayKstAt(nowMs)
  return kstWeekKey(addDaysStr(kstWeekKey(today), -7))
}

function todayKstAt(ms: number) {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10)
}

interface ItemRow { id: string; agent_no: string; item_id: string; district_id: string | null; used_at: string | null; obtained_at: string }
interface LogRow { player_item_id: string; agent_no: string; item_id: string; obtained_at: string; old_district_id: string | null; old_used_at: string | null; changed_at: string }

/** Each player item as it stood at `atIso`. A row's first change at or after
 *  that moment carries the values it had before — the values at `atIso`.
 *  Rows deleted since come back from the log; rows obtained after are left
 *  out. */
export function itemsAt(current: ItemRow[], log: LogRow[], atIso: string) {
  const at = Date.parse(atIso)
  const firstAfter = new Map<string, LogRow>()
  for (const l of log || []) {
    if (Date.parse(l.changed_at) < at) continue
    const prev = firstAfter.get(l.player_item_id)
    if (!prev || Date.parse(l.changed_at) < Date.parse(prev.changed_at)) firstAfter.set(l.player_item_id, l)
  }
  const out = new Map<string, { id: string; itemId: string; districtId: string | null; usedAt: string | null }>()
  const add = (id: string, itemId: string, obtainedAt: string, districtId: string | null, usedAt: string | null) => {
    if (Date.parse(obtainedAt) >= at) return
    out.set(id, { id, itemId, districtId, usedAt: usedAt && Date.parse(usedAt) < at ? usedAt : null })
  }
  for (const r of current || []) {
    const l = firstAfter.get(r.id)
    if (l) add(r.id, r.item_id, r.obtained_at, l.old_district_id, l.old_used_at)
    else add(r.id, r.item_id, r.obtained_at, r.district_id, r.used_at)
  }
  for (const [id, l] of firstAfter) {
    if (!out.has(id) && !(current || []).some((r) => r.id === id)) add(id, l.item_id, l.obtained_at, l.old_district_id, l.old_used_at)
  }
  return [...out.values()]
}

/** rc_player_districts rows as they stood at `atIso`: a row changed or
 *  deleted since (an attempt that expired, a district lost to Bora decay,
 *  one restored after the reset) comes back from rc_player_district_log as
 *  it was. Rows created after are left for districtsAt to drop. */
export function districtRowsAt(current: any[], log: any[], atIso: string) {
  const at = Date.parse(atIso)
  const key = (r: any) => `${r.district_id}|${r.activated_at ? Date.parse(r.activated_at) : ''}`
  const firstAfter = new Map<string, any>()
  for (const l of [...(log || [])].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at))) {
    if (Date.parse(l.changed_at) < at || !l.old_row) continue
    const k = key(l.old_row)
    if (!firstAfter.has(k)) firstAfter.set(k, l.old_row)
  }
  const out: any[] = []
  const seen = new Set<string>()
  for (const r of current || []) {
    const k = key(r)
    out.push(firstAfter.get(k) || r); seen.add(k)
  }
  for (const [k, row] of firstAfter) if (!seen.has(k)) out.push(row)
  return out
}

/** Districts as they stood at `atIso`: restored before it, and the attempt
 *  that was active then (one restored afterwards was still active). */
export function districtsAt(pdRows: any[], atIso: string) {
  const at = Date.parse(atIso)
  const before = (t: any) => !!t && Date.parse(t) < at
  const restoredRows = (pdRows || []).filter((r) => r.status === 'restored' && before(r.completed_at))
  const activePd = (pdRows || []).find((r) => before(r.activated_at) && (r.status === 'active' || (r.status === 'restored' && !before(r.completed_at)))) || null
  return { restored: new Set<string>(restoredRows.map((r) => r.district_id)), activePd, pdRows: restoredRows }
}

/** ReConnect teams the player was helping at some point in the week: joined
 *  before it ended, not left before it started, and the team still going
 *  when the week started (open, or finished/expired during it). */
export function helpingDuring(parts: any[], missions: any[], goals: any[], startIso: string, endIso: string) {
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  const byId = new Map((missions || []).map((m) => [m.id, m]))
  const out: { keys: string[] }[] = []
  for (const p of parts || []) {
    if (!['joined', 'left'].includes(p.status)) continue
    if (!p.joined_at || Date.parse(p.joined_at) >= e) continue
    if (p.status === 'left' && (!p.left_at || Date.parse(p.left_at) < s)) continue
    const m = byId.get(p.mission_id)
    if (!m || !m.goal_id) continue
    if (m.completed_at && Date.parse(m.completed_at) < s) continue
    if (m.status === 'expired' && m.expires_at && Date.parse(m.expires_at) < s) continue
    if (m.created_at && Date.parse(m.created_at) >= e) continue
    const keys = questKeys(goals.find((g: any) => g.id === m.goal_id)?.config || {})
    if (keys.length) out.push({ keys })
  }
  return out
}

/** One player's plan for the week (pure): what earns, whether the week
 *  qualifies, and what's still owed after what's already paid. */
export function planWeek(input: {
  weekKey: string
  items: { id: string; itemId: string; districtId: string | null; usedAt: string | null; kind?: string; era?: string; name?: string }[]
  pdRows: any[]
  rollups: any[]
  helping: { keys: string[] }[]
  paid: Map<string, number>
}) {
  const b = weekBounds(input.weekKey)
  const d = districtsAt(input.pdRows, b.endIso)
  const eligible = eligibleCollectibles(input.items, d.restored)
  const q = weekQualifies({ weekKey: input.weekKey, rollups: input.rollups, activePd: d.activePd, pdRows: d.pdRows, helpingQuests: input.helping, weekStartIso: b.startIso })
  const plan = q.qualified ? planAwards(eligible, input.paid) : { award: [], earned: [...input.paid.values()].reduce((s, n) => s + n, 0) }
  return { eligible, qualified: q.qualified, reason: q.reason, plays: q.plays, award: plan.award }
}

/** cron / admin: settle one ended week. `weekKey` defaults to the week that
 *  just ended; `dryRun` plans without paying. */
export async function settleCollectionXp(supabase: SupabaseDB, params: Record<string, unknown> = {}, nowMs = Date.now()) {
  const weekKey = params.weekKey ? kstWeekKey(String(params.weekKey)) : weekToSettle(nowMs)
  const dryRun = params.dryRun === true
  const b = weekBounds(weekKey)
  if (weekKey < START_WEEK) return { success: true, weekKey, skipped: 'before_start_week' }
  if (Date.parse(b.endIso) > nowMs) return { success: false, weekKey, error: 'week_not_ended' }
  if (nowMs - Date.parse(b.endIso) > CATCH_UP_HOURS * 3600_000) return { success: false, weekKey, error: 'outside_catch_up_window' }

  // Who could be owed: anyone with something placed now, or placed at the
  // reset and moved since.
  const [{ data: placedNow, error: e1 }, { data: logSince, error: e2 }] = await Promise.all([
    supabase.from('rc_player_items').select('agent_no').not('district_id', 'is', null).limit(20000),
    supabase.from('rc_item_placement_log').select('agent_no').gte('changed_at', b.endIso).not('old_district_id', 'is', null).limit(20000),
  ])
  if (e1 || e2) return { success: false, weekKey, error: (e1 || e2).message }
  const candidates = [...new Set([...(placedNow || []), ...(logSince || [])].map((r: any) => String(r.agent_no)))]
  const { data: retiredRows } = await supabase.from('rc_agents').select('agent_no').not('retired_at', 'is', null)
  const retired = new Set((retiredRows || []).map((r: any) => String(r.agent_no)))
  const { data: players } = candidates.length
    ? await supabase.from('rc_players').select('agent_no').in('agent_no', candidates)
    : { data: [] }
  const agents = (players || []).map((p: any) => String(p.agent_no)).filter((a: string) => !retired.has(a)).sort()

  const content = await loadContent(supabase)
  const goals = (content as any).goals || []

  const results: any[] = []
  let paidXp = 0, paidPlayers = 0, qualified = 0, failed = 0
  for (let i = 0; i < agents.length; i += BATCH) {
    await Promise.all(agents.slice(i, i + BATCH).map(async (agentNo: string) => {
      try {
        const r = await settleOne(supabase, agentNo, weekKey, goals, dryRun)
        if (r.qualified) qualified++
        if (r.paidXp > 0) { paidPlayers++; paidXp += r.paidXp }
        if (dryRun || r.paidXp > 0) results.push(r)
      } catch (e) {
        failed++
        results.push({ agentNo, error: e instanceof Error ? e.message : String(e) })
      }
    }))
  }

  // The logs only have to reach back past the catch-up window.
  if (!dryRun) {
    const cutoff = new Date(nowMs - 21 * 86400_000).toISOString()
    await supabase.from('rc_item_placement_log').delete().lt('changed_at', cutoff)
    await supabase.from('rc_player_district_log').delete().lt('changed_at', cutoff)
  }
  return { success: true, weekKey, dryRun, considered: agents.length, qualified, paidPlayers, paidXp, failed, results }
}

async function settleOne(supabase: SupabaseDB, agentNo: string, weekKey: string, goals: any[], dryRun: boolean) {
  const b = weekBounds(weekKey)
  const [items, log, pd, pdLog, daily, parts, ledger] = await Promise.all([
    supabase.from('rc_player_items').select('id, agent_no, item_id, district_id, used_at, obtained_at').eq('agent_no', agentNo),
    supabase.from('rc_item_placement_log').select('player_item_id, agent_no, item_id, obtained_at, old_district_id, old_used_at, changed_at')
      .eq('agent_no', agentNo).gte('changed_at', b.endIso),
    supabase.from('rc_player_districts').select('district_id, status, goals, activated_at, completed_at').eq('agent_no', agentNo),
    supabase.from('rc_player_district_log').select('old_row, changed_at').eq('agent_no', agentNo).gte('changed_at', b.endIso),
    supabase.from('rc_daily_activity').select('kst_date, track_counts').eq('agent_no', agentNo).gte('kst_date', weekKey).lte('kst_date', b.lastDay),
    supabase.from('rc_reconnect_participants').select('mission_id, status, joined_at, left_at').eq('agent_no', agentNo),
    supabase.from('rc_xp_ledger').select('dedup_key, amount').eq('agent_no', agentNo).eq('source', 'collectible').eq('earned_week', weekKey),
  ])
  for (const r of [items, log, pd, pdLog, daily, parts, ledger]) if (r.error) throw new Error(r.error.message)

  const asOf = itemsAt(items.data || [], log.data || [], b.endIso)
  const placedIds = [...new Set(asOf.filter((x) => x.districtId).map((x) => x.itemId))]
  const { data: cat, error: catErr } = placedIds.length
    ? await supabase.from('rc_items').select('id, name, kind, era').in('id', placedIds)
    : { data: [], error: null }
  if (catErr) throw new Error(catErr.message)
  const byId = new Map((cat || []).map((c: any) => [c.id, c]))
  const owned = asOf.map((x) => ({ ...x, name: byId.get(x.itemId)?.name, kind: byId.get(x.itemId)?.kind, era: byId.get(x.itemId)?.era }))

  const missionIds = [...new Set((parts.data || []).map((p: any) => p.mission_id))]
  const { data: missions } = missionIds.length
    ? await supabase.from('rc_reconnect_missions').select('id, goal_id, status, created_at, completed_at, expires_at').in('id', missionIds)
    : { data: [] }

  const prefix = `collectible:${agentNo}:${weekKey}:`
  const paid = new Map<string, number>()
  for (const r of ledger.data || []) if (String(r.dedup_key).startsWith(prefix)) paid.set(String(r.dedup_key).slice(prefix.length), Number(r.amount) || 0)

  const plan = planWeek({
    weekKey, items: owned, pdRows: districtRowsAt(pd.data || [], pdLog.data || [], b.endIso), rollups: daily.data || [],
    helping: helpingDuring(parts.data || [], missions || [], goals, b.startIso, b.endIso), paid,
  })
  const already = [...paid.values()].reduce((s, n) => s + n, 0)
  let paidXp = 0
  const awarded: { itemId: string; xp: number }[] = []
  if (!dryRun && plan.award.length) {
    const got = await payAwards(supabase, agentNo, weekKey, plan.award, 'settle')
    for (const [itemId, xp] of got) { awarded.push({ itemId, xp }); paidXp += xp }
  }
  return {
    agentNo, qualified: plan.qualified, reason: plan.reason, plays: plan.plays,
    eligible: plan.eligible.length, alreadyPaid: already,
    owed: plan.award.reduce((s, a) => s + a.xp, 0), owedItems: plan.award.map((a) => `${a.itemId}:${a.xp}`),
    paidXp, awarded, cap: WEEKLY_CAP,
  }
}
