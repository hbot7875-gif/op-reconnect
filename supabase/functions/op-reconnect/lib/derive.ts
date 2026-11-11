// The rollup engine. rc_daily_activity stores FACTS ONLY (per-track-name
// buckets per KST day); all interpretation — caps, XP, transmission progress —
// happens at read time. Deleting a rollup row and re-calling getGameState
// reproduces it exactly; the XP ledger's unique dedup keys absorb recomputes.

import { normKeyFull, normalizeKey, countedArtistPlays } from './text.ts'
import { kstDateOf, todayKst, kstDayBounds, addDaysStr, kstDatesBetween } from './kst.ts'
import { fetchStreamRows } from './streams.ts'
import type { AgentSourceRow } from './streams.ts'
import type { DayBucket, FrozenTransmission } from './transmission.ts'
import type { GameContent, SupabaseDB } from './config.ts'
import { limits, streamsPerXpFor, PERSONAL_COUNT_CAP, trackArtistOverrides } from './config.ts'
import type { FrozenGoals } from './districts.ts'
import { logFeedEvent } from './feed.ts'
import { isReopenedDay, mergeClosedDay, eligibleAddedPlays, lateXpLedgerRow, activationDayBaselineBump } from './late-plays.ts'
import type { DistrictWindow } from './late-plays.ts'

export interface DailyRow {
  agent_no: string
  kst_date: string
  raw_streams: number
  track_counts: DayBucket
  transmission: FrozenTransmission | null
  transmission_done: boolean
  finalized: boolean
  mode?: string
}

/** Counted (BTS-allowlisted, variety-capped) streams for one day's bucket. */
export function countedStreams(
  bucket: DayBucket, allowlist: string[], cap: number,
  overrides?: Record<string, string[]>,
): number {
  let total = 0
  for (const key of Object.keys(bucket)) {
    const entry = bucket[key]
    const allowedN = countedArtistPlays(entry.a, allowlist, key, overrides)
    total += Math.min(allowedN, cap)
  }
  return total
}

export interface GoalXpScope {
  goals: FrozenGoals
  baseline: Record<string, number>
  activatedAt: string
}

/** Count only streams assigned to the district's frozen Track/Album goals.
 *  A key shared by two goals is counted once, so overlapping assignments
 *  cannot manufacture extra XP. Reconnect goals are completed through their
 *  own mission resolver rather than by accepting arbitrary BTS streams. */
export function countedGoalStreams(
  bucket: DayBucket,
  allowlist: string[],
  cap: number,
  goals: FrozenGoals | null | undefined,
  overrides?: Record<string, string[]>,
): number {
  if (!goals) return 0
  const keys = new Set<string>()
  for (const goal of goals.trackGoals || []) for (const key of goal.keys || []) keys.add(key)
  for (const album of goals.albumGoals || []) {
    for (const track of album.tracks || []) for (const key of track.keys || []) keys.add(key)
  }

  let total = 0
  for (const key of keys) {
    const entry = bucket[key]
    if (!entry) continue
    const allowedN = countedArtistPlays(entry.a, allowlist, key, overrides)
    total += Math.min(allowedN, cap)
  }
  return total
}

/** Apply the district activation window and activation-day baseline to the
 *  goal-only stream count used by both the ledger and the HUD. */
export function goalXpCountForDate(
  bucket: DayBucket,
  date: string,
  allowlist: string[],
  cap: number,
  scope: GoalXpScope | null,
  overrides?: Record<string, string[]>,
): number {
  if (!scope) return 0
  const activationDate = kstDateOf(Math.floor(new Date(scope.activatedAt).getTime() / 1000))
  if (date < activationDate) return 0
  let counted = countedGoalStreams(bucket, allowlist, cap, scope.goals, overrides)
  if (date === activationDate) {
    const stored = scope.baseline?.['xp:goal-streams']
    const legacy = Object.entries(scope.baseline || {})
      .filter(([key]) => key.startsWith('t:') || key.startsWith('a:'))
      .reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
    const activationBaseline = typeof stored === 'number' && Number.isFinite(stored) ? stored : legacy
    counted = Math.max(0, counted - activationBaseline)
  }
  return counted
}

/** Exported for the late-play recount script, which must bucket exactly like this. */
export function bucketRows(rows: { track_name: string; artist_name: string; listened_at: number }[]): Map<string, { raw: number; bucket: DayBucket }> {
  const byDay = new Map<string, { raw: number; bucket: DayBucket }>()
  for (const r of rows) {
    const day = kstDateOf(r.listened_at)
    let entry = byDay.get(day)
    if (!entry) { entry = { raw: 0, bucket: {} }; byDay.set(day, entry) }
    entry.raw++
    const key = normKeyFull(r.track_name)
    if (!key) continue
    const b = entry.bucket[key] || (entry.bucket[key] = { n: 0, a: {} })
    b.n++
    const artist = normalizeKey(r.artist_name || '')
    b.a[artist] = (b.a[artist] || 0) + 1
  }
  return byDay
}

async function awardStreamsXp(
  supabase: SupabaseDB, agentNo: string, date: string, counted: number,
  perXp: number, finalizedAlready: boolean, personalBoostMult = 1,
) {
  if (finalizedAlready) return
  // Incremental, not a recompute-the-whole-day-and-replace: only the
  // streams counted SINCE the last time this day's XP was touched
  // (meta.counted, from the previous call) get today's current boost
  // multiplier, and their XP is ADDED to whatever's already stored — never
  // recomputed from the day's full total.
  //
  // The original design multiplied the WHOLE day's counted total by
  // whatever multiplier happened to be active at calculation time, replaced
  // outright on every poll — so a level-up boost expiring mid-day silently
  // clawed back XP already earned while it was live (the same streams,
  // recomputed at the now-lower rate). Flooring the replacement at the
  // higher of old/new (this file's previous fix) stopped the clawback, but
  // created a different problem: once a boost pushed a day's XP ahead of
  // what plain unboosted streaming would give, every REAL stream after the
  // boost expired had to out-earn that inflated number before the display
  // moved again — a player could keep streaming for a while and see
  // nothing happen. Segmenting by delta fixes both: streams made during a
  // boost keep their boosted rate forever (nothing to claw back, they were
  // never recomputed), and every stream after that adds its own XP
  // immediately, on top, at whatever rate applies right now.
  const { data: existing } = await supabase.from('rc_xp_ledger')
    .select('amount, meta').eq('dedup_key', `streams:${agentNo}:${date}`).maybeSingle()
  const lastCounted = existing?.meta?.counted || 0
  const priorAmount = existing?.amount || 0
  // Real counted-goal-streams only grows within a day (accumulate-and-dedup,
  // never re-derived smaller) — this floor is just a defensive guard against
  // a stale/out-of-order read, not something normal operation should hit.
  const deltaCounted = Math.max(0, counted - lastCounted)
  // deltaCounted alone is almost never an exact multiple of perXp (a poll
  // can land after just 1-2 new streams), and flooring EACH delta on its
  // own throws away that remainder for good — floor(a/n)+floor(b/n) is
  // routinely less than floor((a+b)/n), so a player who polls often (every
  // action re-triggers this) can lose the majority of a day's earned XP to
  // repeated fractional truncation, even though counted itself is correct.
  // Carrying the leftover, not-yet-converted streams forward in
  // meta.remainder (instead of resetting to 0 every call) means every
  // stream is only ever "spent" once it and its carried-over siblings
  // reach a full perXp chunk — nothing is silently dropped, just deferred
  // to the next poll that pushes the total over the next chunk boundary.
  const priorRemainder = existing?.meta?.remainder || 0
  const available = priorRemainder + deltaCounted
  const wholeChunks = Math.floor(available / perXp)
  const deltaXp = Math.floor(wholeChunks * personalBoostMult)
  const remainder = available - wholeChunks * perXp
  const finalAmount = priorAmount + deltaXp
  await supabase.from('rc_xp_ledger').upsert(
    { agent_no: agentNo, amount: finalAmount, source: 'streams', dedup_key: `streams:${agentNo}:${date}`, meta: { counted, remainder } },
    { onConflict: 'dedup_key' },
  )
}

/** Reopened days recounted per ensureDailyRollups call. Each is one day's
 *  fetch; the hourly sync and every app open drain the rest. */
export const REOPENED_DAYS_PER_CALL = 7

/** Split the days a rollup needs into the run ending today, fetched in one
 *  window as always, and earlier days cut off from it by finalized days, each
 *  fetched on its own. `needed` is sorted and always ends with today. Pure,
 *  exported for regression tests. */
export function splitNeededDays(needed: string[], today: string): { trailing: string[]; isolated: string[] } {
  let i = needed.length - 1
  if (i < 0 || needed[i] !== today) return { trailing: [...needed], isolated: [] }
  while (i > 0 && addDaysStr(needed[i - 1], 1) === needed[i]) i--
  return { trailing: needed.slice(i), isolated: needed.slice(0, i) }
}

/**
 * Ensure rc_daily_activity rows exist and are current for this player from
 * max(join date, today - backfillMaxDays) through today. Returns all rows in
 * that window (refreshed today included).
 */
export async function ensureDailyRollups(
  supabase: SupabaseDB,
  agent: AgentSourceRow,
  player: { agent_no: string; mode: string; joined_at: string },
  content: GameContent,
  personalBoostMult = 1,
  goalXpScope: GoalXpScope | null = null,
  // Reuse today's row if it was refreshed within this many ms instead of
  // hitting the external stream service again. The 90s background poll
  // passes ~3 min (so streams still land within a couple of polls); the
  // HUD's explicit Sync passes 0 and every other caller keeps the default.
  maxStaleMs = 0,
): Promise<DailyRow[]> {
  const lim = limits(content)
  const allowlist: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)
  // Personal XP counting is uncapped — see config.ts's PERSONAL_COUNT_CAP.
  const cap = PERSONAL_COUNT_CAP
  const today = todayKst()
  const joinedDate = kstDateOf(Math.floor(new Date(player.joined_at).getTime() / 1000))
  const windowStart = joinedDate > addDaysStr(today, -lim.backfillMaxDays) ? joinedDate : addDaysStr(today, -lim.backfillMaxDays)

  const { data: existingRows } = await supabase
    .from('rc_daily_activity').select('*')
    .eq('agent_no', player.agent_no)
    .gte('kst_date', windowStart)
    .order('kst_date')
  const byDate = new Map<string, DailyRow>((existingRows || []).map((r: DailyRow) => [String(r.kst_date), r]))
  const sorted = () => [...byDate.values()].sort((a, b) => String(a.kst_date).localeCompare(String(b.kst_date)))

  // Days needing a (re)fetch: missing, unfinalized past days, and always today.
  const needed = kstDatesBetween(windowStart, today).filter((d) => {
    const row = byDate.get(d)
    return !row || !row.finalized || d === today
  })
  // A day reopened for late plays (streams.ts reopenDaysForLatePlays) can sit
  // weeks behind today with finalized days in between. Fetching from it to
  // today in one window used to re-read every day in between and could hit
  // the provider's page cap; a day older than backfillMaxDays was never
  // re-read at all and stayed open for good. Recount each such day on its
  // own window instead, oldest first, a bounded number per call, under the
  // closed-day rules in late-plays.ts (only adds; XP for the district live
  // when each play was heard).
  const reopenedInWindow = needed.filter((d) => isReopenedDay(byDate.get(d) as any, d, today))
  const { trailing, isolated } = splitNeededDays(needed.filter((d) => !reopenedInWindow.includes(d)), today)
  const { data: olderOpen } = await supabase
    .from('rc_daily_activity').select('*')
    .eq('agent_no', player.agent_no)
    .eq('finalized', false)
    .gte('kst_date', joinedDate)
    .lt('kst_date', windowStart)
    .order('kst_date')
    .limit(REOPENED_DAYS_PER_CALL)
  // Kept apart from byDate: callers get exactly the window back, as before.
  const olderByDate = new Map<string, DailyRow>((olderOpen || []).map((r: DailyRow) => [String(r.kst_date), r]))
  const closedDays = [...olderByDate.keys(), ...reopenedInWindow].slice(0, REOPENED_DAYS_PER_CALL)
  // Days missing from the middle of the window (rare) are new, not closed:
  // they take the ordinary path below, one day each.
  const isolatedNew = isolated.slice(0, REOPENED_DAYS_PER_CALL)

  const writeDays = async (dates: string[], byDay: Map<string, { raw: number; bucket: DayBucket }>) => {
    for (const date of dates) {
      const dayData = byDay.get(date) || { raw: 0, bucket: {} }
      const existing = byDate.get(date) || olderByDate.get(date)
      // Daily Transmission was replaced by the fixed four-track Side Mission.
      // Keep the legacy columns null/false so old rows stop surfacing it.
      const transmission = null
      // Whichever mode was live the first time THIS date's row was ever
      // written is what that date's XP converts at, for good — a mode
      // switch later in the day (or on any later poll) never rewrites a
      // date that's already been touched once, today included. Prevents
      // streaming on Hard then switching to Easy (or the reverse) before
      // midnight from silently rewriting the day's XP.
      const dayMode = existing?.mode || player.mode
      const row: DailyRow = {
        agent_no: player.agent_no,
        kst_date: date,
        raw_streams: dayData.raw,
        track_counts: dayData.bucket,
        transmission,
        transmission_done: false,
        finalized: date < today,
        mode: dayMode,
      }
      // updated_at is what the maxStaleMs check above reads — stamp it here,
      // the table has no trigger for it.
      await supabase.from('rc_daily_activity').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'agent_no, kst_date' })
      if (date >= windowStart) byDate.set(date, row)

      // Starting a district must never retroactively turn streams from
      // earlier that day into XP. New activations persist the exact union
      // baseline; goalXpCountForDate has a conservative legacy fallback.
      const counted = goalXpCountForDate(dayData.bucket, date, allowlist, cap, goalXpScope, overrides)
      await awardStreamsXp(supabase, player.agent_no, date, counted, streamsPerXpFor(content, dayMode), !!existing?.finalized, date === today ? personalBoostMult : 1)
    }
  }

  let districts: DistrictWindow[] | null = null
  for (const date of closedDays) {
    const existing = (byDate.get(date) || olderByDate.get(date)) as DailyRow & { updated_at?: string }
    const { fromTs, toTs } = kstDayBounds(date)
    const { rows, ok } = await fetchStreamRows(supabase, agent, fromTs, toTs, lim.lbMaxPages)
    // Same rule as below: a failed fetch leaves the day open for next time.
    if (!ok) continue
    const dayRows = rows.filter((r) => kstDateOf(r.listened_at) === date)
    const fresh = bucketRows(dayRows).get(date) || { raw: 0, bucket: {} }
    const merged = mergeClosedDay({ raw: existing.raw_streams || 0, bucket: existing.track_counts || {} }, fresh)
    // Optimistic: only the recount that still sees the row as it read it
    // writes it, and only that one pays XP. A play landing meanwhile moves
    // updated_at (reopenDaysForLatePlays), so this skips and the next call
    // recounts with it included.
    const { data: won } = await supabase.from('rc_daily_activity')
      .update({ raw_streams: merged.raw, track_counts: merged.bucket, finalized: true, updated_at: new Date().toISOString() })
      .eq('agent_no', player.agent_no).eq('kst_date', date).eq('finalized', false)
      .eq('updated_at', existing.updated_at as string)
      .select('kst_date')
    if (!won || won.length === 0) continue
    const row: DailyRow = { ...existing, raw_streams: merged.raw, track_counts: merged.bucket, finalized: true }
    if (date >= windowStart) byDate.set(date, row)
    if (!merged.added.size) continue
    if (!districts) {
      const { data } = await supabase.from('rc_player_districts')
        .select('district_id, status, goals, baseline, activated_at, completed_at').eq('agent_no', player.agent_no)
      districts = (data || []) as DistrictWindow[]
    }
    // Rule 4 (late-plays.ts): an active district activated this very day
    // must not count the late plays heard before it started.
    for (const pd of districts as any[]) {
      if (pd.status !== 'active' || kstDateOf(Math.floor(new Date(pd.activated_at).getTime() / 1000)) !== date) continue
      const bump = activationDayBaselineBump(merged.added, dayRows, pd.goals, pd.activated_at)
      if (!Object.keys(bump).length) continue
      const baseline = { ...(pd.baseline || {}) }
      for (const [k, n] of Object.entries(bump)) baseline[k] = (Number(baseline[k]) || 0) + n
      await supabase.from('rc_player_districts').update({ baseline })
        .eq('agent_no', player.agent_no).eq('district_id', pd.district_id).eq('status', 'active').eq('activated_at', pd.activated_at)
      pd.baseline = baseline
    }
    const plays = eligibleAddedPlays(merged.added, dayRows, districts, allowlist, overrides)
    if (plays <= 0) continue
    const dedupKey = `streams:${player.agent_no}:${date}`
    const { data: ledgerRow } = await supabase.from('rc_xp_ledger').select('amount, meta').eq('dedup_key', dedupKey).maybeSingle()
    const next = lateXpLedgerRow(ledgerRow, plays, streamsPerXpFor(content, existing.mode || player.mode))
    await supabase.from('rc_xp_ledger').upsert(
      { agent_no: player.agent_no, amount: next.amount, source: 'streams', dedup_key: dedupKey, meta: next.meta },
      { onConflict: 'dedup_key' },
    )
  }
  for (const date of isolatedNew) {
    const { fromTs, toTs } = kstDayBounds(date)
    const { rows, ok } = await fetchStreamRows(supabase, agent, fromTs, toTs, lim.lbMaxPages)
    if (ok) await writeDays([date], bucketRows(rows))
  }

  const todayRow = byDate.get(today) as (DailyRow & { updated_at?: string }) | undefined
  const freshEnough = maxStaleMs > 0 && trailing.length === 1 && trailing[0] === today
    && !!todayRow?.updated_at && Date.now() - new Date(todayRow.updated_at).getTime() < maxStaleMs
  if (trailing.length > 0 && !freshEnough) {
    const fromTs = kstDayBounds(trailing[0]).fromTs
    const toTs = Math.min(kstDayBounds(trailing[trailing.length - 1]).toTs, Math.floor(Date.now() / 1000))
    const { rows, ok } = await fetchStreamRows(supabase, agent, fromTs, toTs, lim.lbMaxPages)
    // A failed fetch (network error, non-ok status, unparseable body — see
    // fetchListenBrainz) returns the same shape as "genuinely zero streams
    // this window." Trusting that here used to silently overwrite whatever
    // a day already had recorded from an earlier, successful poll — a real
    // agent's whole day of real streams disappearing because THIS ONE poll
    // happened to hit a ListenBrainz hiccup. Skip the write entirely on
    // failure instead; the next successful poll picks needed dates back up
    // exactly the same way (nothing here marks them finalized in between).
    if (!ok) return sorted()
    await writeDays(trailing, bucketRows(rows))
  }
  return sorted()
}

/** Current uplink streak (consecutive KST days with counted BTS streams).
 *  A gap day spends a freeze charge instead of breaking the chain, if one's
 *  available — rc_streak_freeze_log makes that spend idempotent, since this
 *  whole streak is re-derived from scratch on every call. Never walks
 *  earlier than joinedDate: a brand-new agent has no history before that,
 *  and without this bound the walk-back would spend freeze charges padding
 *  out days before the agent existed. */
export async function computeStreak(
  supabase: SupabaseDB,
  agentNo: string,
  content: GameContent,
  capForPlayer: number,
  freezeCharges = 0,
  joinedDate = '0000-00-00',
): Promise<{ current: number; todayCounted: boolean; freezesUsed: number; freezeChargesRemaining: number }> {
  const lim = limits(content)
  const allowlist: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)
  const today = todayKst()
  const { data } = await supabase
    .from('rc_daily_activity').select('kst_date, track_counts')
    .eq('agent_no', agentNo)
    .gte('kst_date', addDaysStr(today, -lim.streakLookbackDays))
    .order('kst_date', { ascending: false })
  const activeDays = new Set<string>()
  for (const r of data || []) {
    if (countedStreams(r.track_counts || {}, allowlist, capForPlayer, overrides) > 0) activeDays.add(String(r.kst_date))
  }

  const { data: freezeRows } = await supabase.from('rc_streak_freeze_log').select('freeze_date, kind').eq('agent_no', agentNo)
  // Charge-spent freezes count as streak days (always have). Leave days
  // (lib/leave.ts) only bridge: the chain survives them but doesn't grow —
  // otherwise a free 14-day leave was +14 streak with zero streams.
  const frozenDays = new Set<string>((freezeRows || []).filter((r: any) => r.kind !== 'leave').map((r: any) => String(r.freeze_date)))
  const leaveDays = new Set<string>((freezeRows || []).filter((r: any) => r.kind === 'leave').map((r: any) => String(r.freeze_date)))

  const todayCounted = activeDays.has(today)
  let streak = 0
  let cursor = todayCounted ? today : addDaysStr(today, -1)
  let chargesLeft = freezeCharges
  const newlyFrozen: string[] = []

  while (true) {
    if (cursor < joinedDate) break
    if (activeDays.has(cursor) || frozenDays.has(cursor)) {
      streak++
    } else if (leaveDays.has(cursor)) {
      // bridged, not counted — and never a reason to spend a charge
    } else if (chargesLeft > 0) {
      chargesLeft--
      newlyFrozen.push(cursor)
      streak++
    } else {
      break
    }
    cursor = addDaysStr(cursor, -1)
  }

  if (newlyFrozen.length > 0) {
    await supabase.from('rc_streak_freeze_log')
      .upsert(newlyFrozen.map((d) => ({ agent_no: agentNo, freeze_date: d })), { onConflict: 'agent_no,freeze_date', ignoreDuplicates: true })
    await supabase.from('rc_players').update({ streak_freeze_charges: chargesLeft }).eq('agent_no', agentNo)
  }

  return { current: streak, todayCounted, freezesUsed: newlyFrozen.length, freezeChargesRemaining: chargesLeft }
}

export async function awardStreakBadges(supabase: SupabaseDB, agentNo: string, streak: number) {
  for (const t of [7, 30, 100]) {
    if (streak >= t) {
      // .select() on an ignoreDuplicates upsert returns the row only when
      // this call was the one that actually inserted it (a real ON CONFLICT
      // DO NOTHING skip returns nothing) — that's the "did this just happen"
      // signal the feed needs, with no extra latch column.
      const { data } = await supabase.from('rc_badges').upsert(
        { agent_no: agentNo, badge_id: `streak:${t}` },
        { onConflict: 'agent_no, badge_id', ignoreDuplicates: true },
      ).select('badge_id')
      if (data && data.length > 0) {
        await logFeedEvent(supabase, agentNo, 'streak_badge', { days: t }, `streak-badge:${agentNo}:${t}`)
      }
    }
  }
}

/** XP that drives level, rank and progression. Counts 'earn' rows only, so a
 *  Skip Quest charge (kind='spend', see the rc_quest_skip migration) can never
 *  de-level anyone. Every row written before that migration is 'earn', so this
 *  returns exactly what it always did. */
export async function totalXp(supabase: SupabaseDB, agentNo: string): Promise<number> {
  const { data } = await supabase.from('rc_xp_ledger').select('amount').eq('agent_no', agentNo).eq('kind', 'earn')
  return (data || []).reduce((s: number, r: any) => s + (r.amount || 0), 0)
}

/** The spendable XP wallet: everything earned minus everything spent. Only
 *  Skip Quest spends from it today. */
export async function spendableXp(supabase: SupabaseDB, agentNo: string): Promise<number> {
  const { data } = await supabase.from('rc_xp_ledger').select('amount').eq('agent_no', agentNo)
  return (data || []).reduce((s: number, r: any) => s + (r.amount || 0), 0)
}
