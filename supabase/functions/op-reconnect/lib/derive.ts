// The rollup engine. rc_daily_activity stores FACTS ONLY (per-track-name
// buckets per KST day); all interpretation — caps, XP, transmission progress —
// happens at read time. Deleting a rollup row and re-calling getGameState
// reproduces it exactly; the XP ledger's unique dedup keys absorb recomputes.

import { normKeyFull, normalizeKey, artistAllowed } from './text.ts'
import { kstDateOf, todayKst, kstDayBounds, addDaysStr, kstDatesBetween } from './kst.ts'
import { fetchStreamRows } from './streams.ts'
import type { AgentSourceRow } from './streams.ts'
import type { DayBucket, FrozenTransmission } from './transmission.ts'
import type { GameContent, SupabaseDB } from './config.ts'
import { xpRules, limits, streamsPerXpFor } from './config.ts'
import type { FrozenGoals } from './districts.ts'

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
export function countedStreams(bucket: DayBucket, allowlist: string[], cap: number): number {
  let total = 0
  for (const key of Object.keys(bucket)) {
    const entry = bucket[key]
    const allowedN = Object.entries(entry.a).reduce(
      (s, [artist, cnt]) => s + (artistAllowed(artist, allowlist) ? cnt : 0), 0)
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
    const allowedN = Object.entries(entry.a).reduce(
      (sum, [artist, count]) => sum + (artistAllowed(artist, allowlist) ? count : 0), 0)
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
): number {
  if (!scope) return 0
  const activationDate = kstDateOf(Math.floor(new Date(scope.activatedAt).getTime() / 1000))
  if (date < activationDate) return 0
  let counted = countedGoalStreams(bucket, allowlist, cap, scope.goals)
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

function bucketRows(rows: { track_name: string; artist_name: string; listened_at: number }[]): Map<string, { raw: number; bucket: DayBucket }> {
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
  // The shared ARMY Bomb's community charge USED to multiply XP here too —
  // retired. XP is now purely personal: streams-per-Xp (mode-dependent, see
  // streamsPerXpFor) and a level-up's own timed personal boost (today only —
  // a finalized past day never gets its XP rewritten). The network Bomb
  // still matters for Red Zone and for a player's own survival via Personal
  // Charge (agent-charge.ts), just never for how much XP a stream is worth.
  const amount = Math.floor((counted / perXp) * personalBoostMult)
  if (finalizedAlready) return
  await supabase.from('rc_xp_ledger').upsert(
    { agent_no: agentNo, amount, source: 'streams', dedup_key: `streams:${agentNo}:${date}`, meta: { counted } },
    { onConflict: 'dedup_key' },
  )
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
): Promise<DailyRow[]> {
  const lim = limits(content)
  const rules = xpRules(content)
  const allowlist: string[] = content.config.bts_artists || []
  // modeMultiplier no longer scales the variety cap — see decision 5 note in handlers.ts.
  const cap = rules.varietyCapBase
  const today = todayKst()
  const joinedDate = kstDateOf(Math.floor(new Date(player.joined_at).getTime() / 1000))
  const windowStart = joinedDate > addDaysStr(today, -lim.backfillMaxDays) ? joinedDate : addDaysStr(today, -lim.backfillMaxDays)

  const { data: existingRows } = await supabase
    .from('rc_daily_activity').select('*')
    .eq('agent_no', player.agent_no)
    .gte('kst_date', windowStart)
    .order('kst_date')
  const byDate = new Map<string, DailyRow>((existingRows || []).map((r: DailyRow) => [String(r.kst_date), r]))

  // Days needing a (re)fetch: missing, unfinalized past days, and always today.
  const needed = kstDatesBetween(windowStart, today).filter((d) => {
    const row = byDate.get(d)
    return !row || !row.finalized || d === today
  })
  if (needed.length > 0) {
    const fromTs = kstDayBounds(needed[0]).fromTs
    const toTs = Math.min(kstDayBounds(needed[needed.length - 1]).toTs, Math.floor(Date.now() / 1000))
    const rows = await fetchStreamRows(supabase, agent, fromTs, toTs, lim.lbMaxPages)
    const byDay = bucketRows(rows)

    for (const date of needed) {
      const dayData = byDay.get(date) || { raw: 0, bucket: {} }
      const existing = byDate.get(date)
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
      await supabase.from('rc_daily_activity').upsert(row, { onConflict: 'agent_no, kst_date' })
      byDate.set(date, row)

      // Starting a district must never retroactively turn streams from
      // earlier that day into XP. New activations persist the exact union
      // baseline; goalXpCountForDate has a conservative legacy fallback.
      const counted = goalXpCountForDate(dayData.bucket, date, allowlist, cap, goalXpScope)
      await awardStreamsXp(supabase, player.agent_no, date, counted, streamsPerXpFor(content, dayMode), !!existing?.finalized, date === today ? personalBoostMult : 1)
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.kst_date).localeCompare(String(b.kst_date)))
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
  const today = todayKst()
  const { data } = await supabase
    .from('rc_daily_activity').select('kst_date, track_counts')
    .eq('agent_no', agentNo)
    .gte('kst_date', addDaysStr(today, -lim.streakLookbackDays))
    .order('kst_date', { ascending: false })
  const activeDays = new Set<string>()
  for (const r of data || []) {
    if (countedStreams(r.track_counts || {}, allowlist, capForPlayer) > 0) activeDays.add(String(r.kst_date))
  }

  const { data: freezeRows } = await supabase.from('rc_streak_freeze_log').select('freeze_date').eq('agent_no', agentNo)
  const frozenDays = new Set<string>((freezeRows || []).map((r: any) => String(r.freeze_date)))

  const todayCounted = activeDays.has(today)
  let streak = 0
  let cursor = todayCounted ? today : addDaysStr(today, -1)
  let chargesLeft = freezeCharges
  const newlyFrozen: string[] = []

  while (true) {
    if (cursor < joinedDate) break
    if (activeDays.has(cursor) || frozenDays.has(cursor)) {
      streak++
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
      await supabase.from('rc_badges').upsert(
        { agent_no: agentNo, badge_id: `streak:${t}` },
        { onConflict: 'agent_no, badge_id', ignoreDuplicates: true },
      )
    }
  }
}

export async function totalXp(supabase: SupabaseDB, agentNo: string): Promise<number> {
  const { data } = await supabase.from('rc_xp_ledger').select('amount').eq('agent_no', agentNo)
  return (data || []).reduce((s: number, r: any) => s + (r.amount || 0), 0)
}
