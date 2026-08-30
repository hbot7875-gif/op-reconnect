// ARMY Bomb — the network's shared power source.
//
// Charge = every agent's counted streams over a rolling window, pooled.
// `multiplier` here USED to multiply personal XP directly — retired (see
// derive.ts's awardStreamsXp) once Personal Charge (agent-charge.ts) became
// the thing that actually matters for a player's own XP and district
// survival. What's left is display/atmosphere: a live "how busy is the
// network" reading plus the brownout state below. Red Zone is the explicit
// exception: its editable XP pool is split across qualifying contributors.
//
// The window itself isn't fixed: chargeWindowDays() extends it by a day for
// every Era Timeline era (era-timeline.ts) the network has fully unlocked —
// finishing an era is a lasting reward for the whole network's charge, not
// just a one-time number.
//
// Red-zone attacks are admin-launched. Failing one browns the network out
// (dimmer visuals, expires on its own) but never removes XP, files or
// restored districts.

import type { SupabaseDB, GameContent } from './config.ts'
import { modeMultiplier, loadContent, PERSONAL_COUNT_CAP, trackArtistOverrides } from './config.ts'
import { todayKst, addDaysStr } from './kst.ts'
import { countedStreams } from './derive.ts'
import { getEraTimeline, completedEraCount } from './era-timeline.ts'
import { countedArtistPlays, normKeyFull, normalizeKey } from './text.ts'
import {
  countRedZoneRows, redZoneUnixBounds, isDefender, isQualifiedDefender, redZoneBand,
  blackoutChargeValue, blackoutShouldReset, validateDefuseLaunch,
  redZoneTargetKeySet, redZoneTrackCounts, validateRedZoneTarget,
} from './red-zone.js'
import { resolvedAgentStreamSource } from './streams.ts'
import { goalKeys } from './transmission.ts'

const RED_ZONE_DEFAULT_XP_POOL = 500
const RED_ZONE_MIN_STREAMS = 7
const RED_ZONE_REFRESH_MS = 3_000
const RED_ZONE_PAGE_SIZE = 1_000
const MAX_DEFENDER_MESSAGE_LEN = 240

export interface BombCfg {
  chargeWindowHours: number
  chargeFullAt: number
  maxMultiplier: number
  brownoutHours: number
  brownoutMultiplier: number
}

export function bombCfg(content: GameContent): BombCfg {
  return {
    chargeWindowHours: 24, chargeFullAt: 1500, maxMultiplier: 1.5,
    brownoutHours: 24, brownoutMultiplier: 0.75,
    ...(content.config.bomb || {}),
  }
}

export interface BombView {
  charge: number          // 0..1
  communityStreams: number
  multiplier: number      // display/atmosphere only now — no longer applied to XP, see header comment
  brownout: boolean
  brownoutUntil: string | null
  // How many KST days of activity are pooled into `charge` right now — base
  // window plus one extra day per Era Timeline era the network has fully
  // unlocked (see communityStreams()). Surfaced so "why is charge holding up
  // longer than it used to" has a visible answer, not a silent backend effect.
  chargeWindowDays: number
  defuse: {
    id: string
    title: string
    message: string | null
    target: number
    progress: number
    endsAt: string
    // Same timestamp as endsAt, under the name the client actually reads.
    // screen-world.js and bomb-sheet.js both look for `activeUntil ||
    // active_until` and neither has ever found one, so the Red Zone countdown
    // rendered as "BREACH" with no timer. Keeping both names: endsAt is what
    // this file has always emitted, activeUntil is what the UI was built for.
    activeUntil: string
    rewardXp: number
    minimumStreams: number
    qualifiedAgents: number
    // Real headcount of agents with 1+ counted stream this event (Defenders,
    // not just qualified ones) — ARMY Comms' header needs this exact
    // number, not qualifiedAgents, or it undercounts everyone who unlocked
    // the room but hasn't hit the XP minimum yet. Live-queried rather than
    // stored on the row: rc_defuse_contrib is already the one place a
    // sub-minimum agent's real count lives (see refreshDefuse's own comment
    // on why some rows there carry streams:0), so this stays correct even
    // between progress refreshes.
    defenderAgents: number
    yourStreams: number
    // Both derived from yourStreams/minimumStreams — surfaced directly so
    // the client never has to re-implement the same threshold red-zone.js
    // already owns (isDefender/isQualifiedDefender).
    isDefender: boolean
    isQualified: boolean
    // What this event asks players to stream, frozen at launch. targetNames
    // is the full picked list ([{name, kind}], possibly mixing a track with
    // an album); targetTrack/targetAlbum stay for the single-target case an
    // older client may still be reading. All null means every eligible BTS
    // play counts, which is what the copy then says (redZoneTarget() in
    // js/red-zone-ui.js). The client never needs the raw keys.
    targetTrack: string | null
    targetAlbum: string | null
    targetKind: 'track' | 'album' | null
    targetNames: { name: string; kind: 'track' | 'album' }[] | null
  } | null
  // The most recently CONCLUDED event, once only — resolved.status is
  // 'active' while getBombView's own `defuse` field above is the one still
  // live. Exists because rc_defuse_events flips out of the active query the
  // instant it settles, so the very next poll after success/failure would
  // otherwise show nothing at all. The client is expected to remember the
  // last event id it already showed a result for (e.g. localStorage) and
  // stop asking for this once it has — this field itself never expires or
  // hides on its own, so a slow client still gets its one chance to show it.
  resolvedDefuse: {
    id: string
    status: 'defused' | 'failed'
    title: string
    target: number
    progress: number
    rewardXp: number
    minimumStreams: number
    // Real defender headcount as the event ended — same number Defender
    // Comms' read-only header keeps showing after the room archives, so
    // "how many people were in this" doesn't disappear along with the
    // ability to post.
    defenderAgents: number
    yourStreams: number
    isQualified: boolean
    // The exact ledger award for THIS agent, not an estimate — 0 for anyone
    // who didn't qualify, including on a failed event (no rewards are ever
    // paid out for a failed Red Zone).
    yourXpAwarded: number
  } | null
}

/**
 * Every player's own variety cap, keyed by agent_no. Uncapped now, same as
 * personal goal/XP counting (config.ts's PERSONAL_COUNT_CAP) — the site
 * owner wants the shared Bomb to count real streams exactly like the
 * arirang mission does too, not hold back one player's contribution because
 * they favor a single track. The map/per-mode shape stays only because
 * communityStreams/refreshDefuse below already key off it; every agent
 * effectively gets the same uncapped ceiling now regardless of mode.
 */
async function agentCapMap(supabase: SupabaseDB, content: GameContent): Promise<{ map: Map<string, number>; base: number }> {
  const base = PERSONAL_COUNT_CAP
  const { data } = await supabase.from('rc_players').select('agent_no, mode')
  const map = new Map<string, number>()
  for (const p of data || []) map.set(p.agent_no, base * modeMultiplier(content, p.mode))
  return { map, base }
}

/**
 * KST days of activity to pool into charge — base window (chargeWindowHours,
 * rounded up to whole days since rc_daily_activity only has day-granularity
 * buckets) plus one extra day per Era Timeline era the network has fully
 * unlocked (era-timeline.ts). A network that's finished a whole era's worth
 * of discography keeps its charge momentum longer, not just a bigger single
 * pooled number. This is the one place chargeWindowHours actually gets
 * read — it used to sit in BombCfg unused, the window hardcoded to 1 day
 * back regardless of it.
 */
async function chargeWindowDays(supabase: SupabaseDB, content: GameContent, cfg: BombCfg): Promise<number> {
  const timeline = await getEraTimeline(supabase, content)
  const bonusDays = completedEraCount(timeline)
  return Math.max(1, Math.ceil(cfg.chargeWindowHours / 24)) + bonusDays
}

/** Community counted-streams over the last `days` KST days. */
async function communityStreams(
  supabase: SupabaseDB, content: GameContent, caps: { map: Map<string, number>; base: number }, days: number,
): Promise<number> {
  const today = todayKst()
  const from = addDaysStr(today, -days)
  const allow: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)
  const { data } = await supabase
    .from('rc_daily_activity')
    .select('agent_no, track_counts')
    .gte('kst_date', from)
  let total = 0
  for (const row of data || []) {
    const cap = caps.map.get(row.agent_no) ?? caps.base
    total += countedStreams(row.track_counts || {}, allow, cap, overrides)
  }
  return total
}

/**
 * Read bomb state, refresh the active defuse event's progress from real
 * community activity, and resolve it if it hit target or ran out of time.
 */
export async function getBombView(
  supabase: SupabaseDB,
  content: GameContent,
  agentNo: string,
  manualSync = false,
): Promise<BombView> {
  const cfg = bombCfg(content)
  const caps = await agentCapMap(supabase, content)
  const days = await chargeWindowDays(supabase, content, cfg)
  const pooled = await communityStreams(supabase, content, caps, days)
  const charge = Math.max(0, Math.min(1, pooled / Math.max(1, cfg.chargeFullAt)))

  const { data: state } = await supabase.from('rc_bomb_state').select('*').eq('id', 1).maybeSingle()
  const nowIso = new Date().toISOString()
  const brownout = !!(state?.brownout_until && state.brownout_until > nowIso)

  // multiplier: 1.0 at empty, up to maxMultiplier at full charge
  let multiplier = 1 + charge * (cfg.maxMultiplier - 1)
  if (brownout) multiplier *= cfg.brownoutMultiplier
  multiplier = Math.round(multiplier * 100) / 100

  // The single most recent event regardless of status — active is handled
  // below same as always; anything else (defused/failed) is what feeds
  // resolvedDefuse so a poll landing just after settlement still gets to
  // show the result once, instead of the event disappearing outright.
  const { data: ev } = await supabase
    .from('rc_defuse_events').select('*')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  let defuse: BombView['defuse'] = null
  let resolvedDefuse: BombView['resolvedDefuse'] = null
  if (ev && ev.status === 'active') {
    const resolved = await refreshDefuse(supabase, content, ev, caps, cfg, manualSync)
    if (resolved.stillActive) {
      const [{ data: mine }, { count: defenderAgents }] = await Promise.all([
        supabase.from('rc_defuse_contrib').select('streams').eq('event_id', ev.id).eq('agent_no', agentNo).maybeSingle(),
        supabase.from('rc_defuse_contrib').select('agent_no', { count: 'exact', head: true })
          .eq('event_id', ev.id).gte('streams', 1),
      ])
      const yourStreams = mine?.streams || 0
      const minimumStreams = ev.minimum_streams || RED_ZONE_MIN_STREAMS
      defuse = {
        id: ev.id, title: ev.title, message: ev.message,
        target: ev.target, progress: resolved.progress,
        endsAt: ev.active_until, activeUntil: ev.active_until,
        rewardXp: ev.reward_xp || RED_ZONE_DEFAULT_XP_POOL,
        minimumStreams,
        qualifiedAgents: resolved.qualifiedAgents,
        defenderAgents: defenderAgents || 0,
        yourStreams,
        isDefender: isDefender(yourStreams),
        isQualified: isQualifiedDefender(yourStreams, minimumStreams),
        targetTrack: ev.target_kind === 'track' ? ev.target_label : null,
        targetAlbum: ev.target_kind === 'album' ? ev.target_label : null,
        targetKind: ev.target_kind || null,
        targetNames: Array.isArray(ev.target_names) && ev.target_names.length ? ev.target_names : null,
      }
    } else {
      resolvedDefuse = await buildResolvedDefuseView(supabase, ev, agentNo)
    }
  } else if (ev && (ev.status === 'defused' || ev.status === 'failed')) {
    resolvedDefuse = await buildResolvedDefuseView(supabase, ev, agentNo)
  }

  return {
    charge: Math.round(charge * 100) / 100,
    communityStreams: pooled,
    multiplier,
    brownout,
    brownoutUntil: brownout ? state.brownout_until : null,
    chargeWindowDays: days,
    defuse,
    resolvedDefuse,
  }
}

/** The exact ledger award, not an estimate — see resolvedDefuse's own doc
 *  comment. Looked up by the same dedup_key awardDefuseRewards writes, so
 *  this can never disagree with what was actually paid out. */
async function buildResolvedDefuseView(supabase: SupabaseDB, ev: any, agentNo: string): Promise<BombView['resolvedDefuse']> {
  const minimumStreams = ev.minimum_streams || RED_ZONE_MIN_STREAMS
  const [{ data: mine }, { data: award }, { count: defenderAgents }] = await Promise.all([
    supabase.from('rc_defuse_contrib').select('streams').eq('event_id', ev.id).eq('agent_no', agentNo).maybeSingle(),
    supabase.from('rc_xp_ledger').select('amount').eq('dedup_key', `defuse:${agentNo}:${ev.id}`).maybeSingle(),
    supabase.from('rc_defuse_contrib').select('agent_no', { count: 'exact', head: true })
      .eq('event_id', ev.id).gte('streams', 1),
  ])
  const yourStreams = mine?.streams || 0
  return {
    id: ev.id, status: ev.status, title: ev.title,
    target: ev.target, progress: Number(ev.progress) || 0,
    rewardXp: ev.reward_xp || RED_ZONE_DEFAULT_XP_POOL,
    minimumStreams, defenderAgents: defenderAgents || 0, yourStreams,
    isQualified: isQualifiedDefender(yourStreams, minimumStreams),
    yourXpAwarded: Number(award?.amount) || 0,
  }
}

/**
 * Read timestamped scrobbles inside the exact event window. Daily rollups
 * are deliberately not used here: they cannot distinguish a play made
 * before launch or after the deadline on the same KST day.
 */
async function redZoneScrobbles(supabase: SupabaseDB, ev: any) {
  const bounds = redZoneUnixBounds(ev.active_from, ev.active_until)
  if (bounds.untilExclusive <= bounds.fromInclusive) return { rows: [], expired: bounds.expired }

  const rows: any[] = []
  for (let offset = 0; ; offset += RED_ZONE_PAGE_SIZE) {
    const { data, error } = await supabase.from('rc_scrobbles')
      .select('agent_no, track_name, artist_name, listened_at, source')
      .gte('listened_at', bounds.fromInclusive)
      .lt('listened_at', bounds.untilExclusive)
      .order('listened_at', { ascending: true })
      .order('agent_no', { ascending: true })
      .order('track_name', { ascending: true })
      .range(offset, offset + RED_ZONE_PAGE_SIZE - 1)
    if (error) throw new Error(`Red Zone stream read failed: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < RED_ZONE_PAGE_SIZE) break
  }
  return { rows, expired: bounds.expired }
}

async function redZoneSourceMap(supabase: SupabaseDB): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('rc_agents')
    .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
  if (error) throw new Error(`Red Zone source read failed: ${error.message}`)
  return new Map((data || []).map((agent: any) => [String(agent.agent_no), String(resolvedAgentStreamSource(agent))]))
}

function redZoneSourceAllowed(selected: string | undefined, stored: string | null | undefined) {
  if (!selected) return false
  if (selected === 'direct') return stored === 'webhook' || stored === 'lb-like'
  return stored === selected
}

function cachedDefuseResult(ev: any) {
  return {
    stillActive: ev.status === 'active',
    progress: Number(ev.progress) || 0,
    qualifiedAgents: Number(ev.qualified_agents) || 0,
  }
}

const DEFENDER_MILESTONES = [5, 10, 25, 50, 100]

async function postSystemMessage(supabase: SupabaseDB, eventId: string, body: string, dedupKey: string) {
  const { error } = await supabase.from('rc_defuse_messages').upsert(
    { event_id: eventId, agent_no: 'SYSTEM', body, kind: 'system', dedup_key: dedupKey },
    { onConflict: 'event_id,dedup_key', ignoreDuplicates: true },
  )
  if (error) console.error('Red Zone system message failed:', error.message)
}

/** Deterministic, state-driven announcements — never a timer/interval, only
 *  ever written from the same exact-scan pass that already recomputed real
 *  progress. Each dedup_key can only ever insert once per event (the
 *  migration's partial unique index + upsert-ignore), so this is safe to
 *  call on every refresh without checking "have I already posted this"
 *  first — concurrent refreshes racing here all resolve to the same
 *  no-op-after-the-first outcome. */
async function postProgressSystemMessages(supabase: SupabaseDB, ev: any, progress: number, defenderCount: number) {
  const band = redZoneBand(progress, ev.target)
  const pct = Math.round((progress / Math.max(1, ev.target)) * 100)
  // Same one verb the City screen and both sheets use — "defused", not
  // "stabilized" (see redZoneHeadline/defusedLine in js/red-zone-ui.js).
  // dedup_key means lines already posted on a live event keep their old
  // wording; only new ones pick this up.
  if (band === 'restoring') await postSystemMessage(supabase, ev.id, `🟣 ${pct}% defused — keep streaming`, 'band:restoring')
  if (band === 'final-push') await postSystemMessage(supabase, ev.id, `🟣 FINAL PUSH — ${pct}% defused`, 'band:final-push')

  const untilMs = new Date(ev.active_until).getTime()
  const msLeft = untilMs - Date.now()
  if (Number.isFinite(untilMs) && msLeft > 0 && msLeft <= 30 * 60_000) {
    await postSystemMessage(supabase, ev.id, '⚠️ 30 minutes remaining', 'time:30m')
  }

  for (const milestone of DEFENDER_MILESTONES) {
    if (defenderCount >= milestone) await postSystemMessage(supabase, ev.id, `🛡️ ${milestone} ARMY defenders joined the signal`, `defenders:${milestone}`)
  }
}

/** The only Blackout penalty: every currently-charged agent's ARMY Bomb
 *  drops to 0. Citywide by design (see bomb.ts's header/the approved plan)
 *  — Defenders were protecting everyone's Bomb, not just their own, so
 *  failure isn't scoped to rc_defuse_contrib. Deliberately a single SQL
 *  statement, not a per-agent loop:
 *   - charged_until > now()  → really had charge to lose → reset to exactly
 *     now(). Never anything else — see red-zone.js's blackoutChargeValue —
 *     a backdated value would make agent-charge.ts's blackout_started_at
 *     (anchored to whatever charged_until it first finds in the past) look
 *     partially through its 7/14-day clock the instant this lands.
 *   - charged_until <= now() (already dark) or null (never fed) → excluded
 *     by the WHERE clause itself (Postgres NULL > x is NULL, never true) —
 *     their existing blackout timeline is untouched, exactly as required.
 *  Naturally idempotent: a repeat run only ever matches rows still in the
 *  future relative to ITS OWN now(), which after the first run is nothing
 *  (everything was just set to a now() already in the past). Only reaches
 *  retired agents' rows if they still had a stale future charge, which
 *  can't happen since retirement clears out active state. */
async function applyBlackout(supabase: SupabaseDB) {
  const nowIso = blackoutChargeValue()
  const { error } = await supabase.from('rc_agent_charge')
    .update({ charged_until: nowIso })
    .gt('charged_until', nowIso)
  if (error) console.error('Red Zone blackout failed:', error.message)
}

async function refreshDefuse(
  supabase: SupabaseDB, content: GameContent, ev: any, caps: { map: Map<string, number>; base: number }, cfg: BombCfg,
  manualSync = false,
): Promise<{ stillActive: boolean; progress: number; qualifiedAgents: number }> {
  const allow: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)
  const minimumStreams = ev.minimum_streams || RED_ZONE_MIN_STREAMS
  const now = Date.now()
  const refreshedAt = new Date(ev.progress_refreshed_at || 0).getTime()

  // One network-wide exact scan per short interval, not one full scan per
  // player's 90-second poll. The compare-and-set also prevents concurrent
  // requests from all doing the same work. The first refresh after expiry
  // performs the final scan; its upper bound is the immutable active_until.
  // A manual Sync explicitly bypasses this: the whole point of tapping
  // "sync now" is to see the real current number immediately, not a result
  // that's already a few seconds stale by the time it renders.
  if (!manualSync && Number.isFinite(refreshedAt) && now - refreshedAt < RED_ZONE_REFRESH_MS) {
    return cachedDefuseResult(ev)
  }
  const claimedAt = new Date(now).toISOString()
  let claim = supabase.from('rc_defuse_events')
    .update({ progress_refreshed_at: claimedAt })
    .eq('id', ev.id).eq('status', 'active')
  claim = ev.progress_refreshed_at
    ? claim.eq('progress_refreshed_at', ev.progress_refreshed_at)
    : claim.is('progress_refreshed_at', null)
  const { data: claimed, error: claimError } = await claim.select('id').maybeSingle()
  if (claimError) {
    console.error('Red Zone refresh claim failed:', claimError.message)
    return cachedDefuseResult(ev)
  }
  if (!claimed) {
    const { data: current } = await supabase.from('rc_defuse_events')
      .select('status, progress, qualified_agents').eq('id', ev.id).maybeSingle()
    return current ? cachedDefuseResult(current) : { stillActive: false, progress: Number(ev.progress) || 0, qualifiedAgents: Number(ev.qualified_agents) || 0 }
  }

  let exact: { rows: any[]; expired: boolean }
  let sources: Map<string, string>
  try {
    ;[exact, sources] = await Promise.all([redZoneScrobbles(supabase, ev), redZoneSourceMap(supabase)])
  } catch (error) {
    console.error((error as Error).message)
    await supabase.from('rc_defuse_events')
      .update({ progress_refreshed_at: ev.progress_refreshed_at || null })
      .eq('id', ev.id).eq('status', 'active')
    return cachedDefuseResult(ev)
  }

  const perTrack = new Map<string, number>()
  // The event's own frozen target, if it named one — read from the row, never
  // re-read from rc_goals, so an admin editing the goal mid-event cannot
  // change which plays count. Null set = every eligible BTS play counts.
  const targetKeys = redZoneTargetKeySet(ev.target_keys)
  const counted = countRedZoneRows(exact.rows, ev.target, minimumStreams, (row: any) => {
    if (!redZoneSourceAllowed(sources.get(row.agent_no), row.source)) return false
    const trackKey = normKeyFull(row.track_name || '')
    if (!trackKey) return false
    if (!redZoneTrackCounts(targetKeys, trackKey)) return false
    const artist = normalizeKey(row.artist_name || '')
    if (countedArtistPlays({ [artist]: 1 }, allow, trackKey, overrides) <= 0) return false
    const cap = caps.map.get(row.agent_no) ?? caps.base
    const capKey = `${row.agent_no}\u0000${trackKey}`
    const used = perTrack.get(capKey) || 0
    if (used >= cap) return false
    perTrack.set(capKey, used + 1)
    return true
  })
  const progress = counted.progress
  const qualifiedAgents = counted.qualifiedAgents
  const updatedAt = new Date().toISOString()
  const contribRows: any[] = [...counted.perAgent.entries()].map(([agent, streams]) => ({
    event_id: ev.id, agent_no: agent, streams, updated_at: updatedAt,
  }))
  // An event launched before this exact-window fix may contain approximate
  // daily-rollup contributions from an agent who has no valid timestamped
  // row in the real window. Preserve the row for auditability but zero its
  // display value instead of deleting history.
  const { data: priorContribs } = await supabase.from('rc_defuse_contrib')
    .select('agent_no').eq('event_id', ev.id)
  for (const prior of priorContribs || []) {
    if (!counted.perAgent.has(prior.agent_no)) {
      contribRows.push({ event_id: ev.id, agent_no: prior.agent_no, streams: 0, updated_at: updatedAt })
    }
  }
  if (contribRows.length) {
    for (let i = 0; i < contribRows.length; i += 100) {
      const { error } = await supabase.from('rc_defuse_contrib')
        .upsert(contribRows.slice(i, i + 100), { onConflict: 'event_id, agent_no' })
      if (error) console.error('Red Zone contribution write failed:', error.message)
    }
  }

  const met = progress >= ev.target

  if (met) {
    const { data: settled, error: settleError } = await supabase.from('rc_defuse_events')
      .update({ status: 'defused', progress, qualified_agents: qualifiedAgents, resolved_at: updatedAt, progress_refreshed_at: updatedAt })
      .eq('id', ev.id).eq('status', 'active').eq('progress_refreshed_at', claimedAt)
      .select('id').maybeSingle()
    if (settleError) console.error('Red Zone settlement failed:', settleError.message)
    if (!settled) {
      const { data: current } = await supabase.from('rc_defuse_events')
        .select('status, progress, qualified_agents').eq('id', ev.id).maybeSingle()
      return current ? cachedDefuseResult(current) : { stillActive: false, progress, qualifiedAgents }
    }
    await awardDefuseRewards(supabase, ev, minimumStreams, counted.perAgent)
    await postSystemMessage(supabase, ev.id, '✦ SIGNAL RESTORED', 'resolved:success')
    return { stillActive: false, progress, qualifiedAgents }
  }
  if (exact.expired) {
    const { data: settled, error: settleError } = await supabase.from('rc_defuse_events')
      .update({ status: 'failed', progress, qualified_agents: qualifiedAgents, resolved_at: updatedAt, progress_refreshed_at: updatedAt })
      .eq('id', ev.id).eq('status', 'active').eq('progress_refreshed_at', claimedAt)
      .select('id').maybeSingle()
    if (settleError) console.error('Red Zone settlement failed:', settleError.message)
    if (!settled) {
      const { data: current } = await supabase.from('rc_defuse_events')
        .select('status, progress, qualified_agents').eq('id', ev.id).maybeSingle()
      return current ? cachedDefuseResult(current) : { stillActive: false, progress, qualifiedAgents }
    }
    // Brown-out: the shared network visual/multiplier dims for a while —
    // unconditional, unrelated to Blackout below. Nothing already earned is
    // removed by either mechanic.
    const until = new Date(Date.now() + cfg.brownoutHours * 3600_000).toISOString()
    await supabase.from('rc_bomb_state').update({ brownout_until: until, updated_at: new Date().toISOString() }).eq('id', 1)
    // Blackout: the real, personal consequence — every currently-charged
    // agent's own ARMY Bomb drops to 0. See applyBlackout's own doc comment
    // for exactly why this is a single statement, not a loop, and why it
    // can never touch an already-dark or never-fed agent.
    await applyBlackout(supabase)
    await postSystemMessage(supabase, ev.id, '⚫ RED ZONE FAILED — BLACKOUT', 'resolved:failure')
    return { stillActive: false, progress, qualifiedAgents }
  }

  await postProgressSystemMessages(supabase, ev, progress, counted.perAgent.size)

  const { data: saved, error: saveError } = await supabase.from('rc_defuse_events')
    .update({ progress, qualified_agents: qualifiedAgents, progress_refreshed_at: updatedAt })
    .eq('id', ev.id).eq('status', 'active').eq('progress_refreshed_at', claimedAt)
    .select('id').maybeSingle()
  if (saveError) console.error('Red Zone progress write failed:', saveError.message)
  if (!saved) {
    const { data: current } = await supabase.from('rc_defuse_events')
      .select('status, progress, qualified_agents').eq('id', ev.id).maybeSingle()
    return current ? cachedDefuseResult(current) : { stillActive: false, progress, qualifiedAgents }
  }
  return { stillActive: true, progress, qualifiedAgents }
}

/** Split the configured pool exactly across qualified agents. Sorting makes
 *  remainder assignment deterministic, so concurrent settlement calls
 *  produce the same per-agent awards and ledger deduplication stays safe. */
async function awardDefuseRewards(
  supabase: SupabaseDB, ev: any, minimumStreams: number, perAgent: Map<string, number>,
) {
  const qualified = [...perAgent.entries()]
    .filter(([, streams]) => streams >= minimumStreams)
    .map(([agent_no, streams]) => ({ agent_no, streams }))
    .sort((a, b) => String(a.agent_no).localeCompare(String(b.agent_no)))
  if (qualified.length === 0) return
  const pool = Math.max(0, Number(ev.reward_xp) || RED_ZONE_DEFAULT_XP_POOL)
  const baseShare = Math.floor(pool / qualified.length)
  const remainder = pool % qualified.length
  for (let i = 0; i < qualified.length; i++) {
    const c = qualified[i]
    const amount = baseShare + (i < remainder ? 1 : 0)
    if (amount > 0) {
      await supabase.from('rc_xp_ledger').upsert({
        agent_no: c.agent_no, amount, source: 'defuse',
        dedup_key: `defuse:${c.agent_no}:${ev.id}`,
        meta: { eventId: ev.id, streams: c.streams, pool, qualifiedAgents: qualified.length, minimumStreams },
      }, { onConflict: 'dedup_key', ignoreDuplicates: true })
    }
    await supabase.from('rc_badges').upsert(
      { agent_no: c.agent_no, badge_id: 'defuse:first' },
      { onConflict: 'agent_no, badge_id', ignoreDuplicates: true })
  }
}

const DEFENDER_MESSAGE_LIMIT = 50

/** The one gate every ARMY Comms action shares: at least 1 valid stream
 *  on THIS event (rc_defuse_contrib is the same table refreshDefuse already
 *  writes real counted progress into, so this can never disagree with what
 *  "Defender" means anywhere else). Resolves the target event itself too —
 *  callers always want "the current Red Zone" by id, and this is the one
 *  place that existence + eligibility are checked together. */
async function requireDefender(supabase: SupabaseDB, eventId: string, agentNo: string) {
  const [{ data: ev }, { data: contrib }] = await Promise.all([
    supabase.from('rc_defuse_events').select('id, status').eq('id', eventId).maybeSingle(),
    supabase.from('rc_defuse_contrib').select('streams').eq('event_id', eventId).eq('agent_no', agentNo).maybeSingle(),
  ])
  if (!ev) return { ok: false as const, error: 'event_not_found' }
  if (!isDefender(contrib?.streams)) return { ok: false as const, error: 'not_a_defender' }
  return { ok: true as const, event: ev }
}

/** ARMY Comms — a shared thread scoped to one Red Zone event. Read-only
 *  the moment the event stops being 'active' (resolved or superseded): the
 *  room doesn't get deleted, it just stops accepting new lines, same as the
 *  brief's "archive, don't leave another permanent GC" requirement. */
export async function getDefuseMessages(supabase: SupabaseDB, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const eventId = String(params.eventId || '')
  if (!eventId) return { success: false, error: 'event_required' }
  const gate = await requireDefender(supabase, eventId, agentNo)
  if (!gate.ok) return { success: false, error: gate.error }

  const { data, error } = await supabase.from('rc_defuse_messages')
    .select('agent_no, body, kind, created_at').eq('event_id', eventId)
    .order('created_at', { ascending: true }).limit(DEFENDER_MESSAGE_LIMIT)
  if (error) return { success: false, error: error.message }
  const rows = data || []
  const humanAgentNos = [...new Set(rows.filter((r: any) => r.kind !== 'system').map((r: any) => String(r.agent_no)))]
  const { data: players } = humanAgentNos.length
    ? await supabase.from('rc_players').select('agent_no, codename').in('agent_no', humanAgentNos)
    : { data: [] as any[] }
  const codenames = new Map((players || []).map((p: any) => [p.agent_no, p.codename]))

  return {
    success: true,
    readOnly: gate.event.status !== 'active',
    messages: rows.map((r: any) => ({
      isSystem: r.kind === 'system',
      isMe: r.agent_no === agentNo,
      codename: r.kind === 'system' ? null : (codenames.get(r.agent_no) || r.agent_no),
      body: r.body,
      at: r.created_at,
    })),
  }
}

/** Post a line to the caller's ARMY Comms — same eligibility gate as
 *  reading, plus the room must still be live. */
export async function sendDefuseMessage(supabase: SupabaseDB, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const eventId = String(params.eventId || '')
  const body = String(params.message || '').trim().slice(0, MAX_DEFENDER_MESSAGE_LEN)
  if (!eventId) return { success: false, error: 'event_required' }
  if (!body) return { success: false, error: 'message_required' }
  const gate = await requireDefender(supabase, eventId, agentNo)
  if (!gate.ok) return { success: false, error: gate.error }
  if (gate.event.status !== 'active') return { success: false, error: 'red_zone_resolved' }

  const { error } = await supabase.from('rc_defuse_messages').insert({ event_id: eventId, agent_no: agentNo, body, kind: 'user' })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** Resolve an admin's picked goals into the one frozen target the event
 *  stores. Several can be picked and they can mix kinds — "the ARIRANG
 *  album and Keep Swimming" is one event with one shared goal — so every
 *  pick's keys are pooled into a single list. Album goals contribute every
 *  track's keys ("stream the album" means any track on it counts), the same
 *  rule Backup Pass already uses for album goals (backup-pass.ts). A pick
 *  that resolves to no usable keys is refused rather than launched: it
 *  would produce an event that counts nothing.
 *
 *  target_goal_id stays the single-goal provenance link and is null once
 *  several are picked — target_keys is, as always, the only thing matching
 *  actually reads. */
async function freezeRedZoneTarget(supabase: SupabaseDB, goalIds: unknown) {
  const ids = (Array.isArray(goalIds) ? goalIds : [goalIds])
    .map((g) => String(g || '').trim())
    .filter(Boolean)
  // De-duplicated, but the admin's own order is what the copy reads back.
  const unique = [...new Set(ids)]
  if (!unique.length) {
    return { valid: true as const, goalId: null, value: { kind: null, label: null, keys: null, names: null } }
  }

  const { data: goals, error } = await supabase.from('rc_goals')
    .select('id, kind, label, aliases, tracks').in('id', unique)
  if (error) return { valid: false as const, error: error.message }

  const byId = new Map((goals || []).map((g: any) => [String(g.id), g]))
  const keys: string[] = []
  const names: { name: string; kind: 'track' | 'album' }[] = []
  for (const id of unique) {
    const goal = byId.get(id)
    if (!goal) return { valid: false as const, error: `target goal not found: ${id}` }
    if (goal.kind !== 'track' && goal.kind !== 'album') {
      return { valid: false as const, error: `a Red Zone target must be a track or album goal: ${goal.label}` }
    }
    const goalOwnKeys = goal.kind === 'album'
      ? (goal.tracks || []).flatMap((t: any) => goalKeys({ label: t.label, aliases: t.aliases || [] }))
      : goalKeys({ label: goal.label, aliases: goal.aliases || [] })
    // Refused per pick, not just in aggregate: an album with an empty track
    // list would otherwise ride along invisibly on a second, valid pick and
    // count nothing, which is exactly the surprise this check exists for.
    if (!goalOwnKeys.length) {
      return { valid: false as const, error: `no matchable track names on: ${goal.label}` }
    }
    keys.push(...goalOwnKeys)
    names.push({ name: goal.label, kind: goal.kind })
  }

  // The stored label is for the admin panel and older clients; the player
  // copy composes its own phrase from `names` (js/red-zone-ui.js).
  const label = names.map((n) => n.name).join(' + ')
  const checked = validateRedZoneTarget({ label, keys, names })
  if (!checked.valid) return { valid: false as const, error: checked.error }
  return { valid: true as const, goalId: unique.length === 1 ? unique[0] : null, value: checked.value }
}

/** Admin: launch a red-zone attack. Rejects bad input outright — a typo'd
 *  target of 0 or a negative reward used to silently clamp into something
 *  launchable; now it just fails, with the reason, before anything is
 *  written. */
export async function launchDefuse(supabase: SupabaseDB, params: any) {
  const validation = validateDefuseLaunch(params)
  if (!validation.valid) return { success: false, error: 'invalid_launch_params', details: validation.errors }
  const target = Math.trunc(Number(params.target))
  const hours = Number(params.hours)
  const rewardXp = Math.trunc(Number(params.rewardXp))
  const { data: active, error: activeError } = await supabase.from('rc_defuse_events')
    .select('*').eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (activeError) return { success: false, error: activeError.message }
  if (active) {
    const content = await loadContent(supabase)
    const caps = await agentCapMap(supabase, content)
    const refreshed = await refreshDefuse(supabase, content, active, caps, bombCfg(content))
    if (refreshed.stillActive) {
      return {
        success: false,
        error: 'red_zone_already_active',
        activeEvent: { id: active.id, title: active.title, activeUntil: active.active_until },
      }
    }
  }

  // An optional streaming target: one existing goal, frozen into the event.
  // No goal picked keeps the original behavior — every eligible BTS play
  // counts — and the player copy says exactly that.
  const frozen = await freezeRedZoneTarget(supabase, params.targetGoalIds ?? params.targetGoalId)
  if (!frozen.valid) return { success: false, error: 'invalid_launch_params', details: [frozen.error] }

  const activeFrom = new Date()
  const activeUntil = new Date(activeFrom.getTime() + hours * 3600_000)
  const { data, error } = await supabase.rpc('rc_red_zone_launch', {
    p_title: params.title || 'INCOMING: RED ZONE',
    p_message: params.message || 'The ARMY Bomb is under attack. Stream together to defuse it before the timer runs out.',
    p_target: target,
    p_reward_xp: rewardXp,
    p_minimum_streams: RED_ZONE_MIN_STREAMS,
    p_active_from: activeFrom.toISOString(),
    p_active_until: activeUntil.toISOString(),
    p_target_goal_id: frozen.goalId,
    p_target_kind: frozen.value.kind,
    p_target_label: frozen.value.label,
    p_target_keys: frozen.value.keys,
    p_target_names: frozen.value.names,
  })
  if (error) {
    const message = String(error.message || '')
    return { success: false, error: message.includes('red_zone_already_active') ? 'red_zone_already_active' : message }
  }
  return { success: true, event: data }
}

/**
 * Admin, read-only: the currently active Red Zone event (if any), so the
 * panel can show its live status/progress before overwriting it with a new
 * one. Reuses getBombView's own refresh/resolve logic rather than
 * duplicating it — 'ADMIN' is not a real agent_no, so `yourStreams` in the
 * result is meaningless and intentionally not surfaced to the caller below.
 */
export async function adminGetActiveDefuse(supabase: SupabaseDB) {
  const content = await loadContent(supabase)
  const bomb = await getBombView(supabase, content, '__admin__')
  return {
    success: true,
    active: !!bomb.defuse,
    defuse: bomb.defuse ? {
      id: bomb.defuse.id, title: bomb.defuse.title, message: bomb.defuse.message,
      target: bomb.defuse.target, progress: bomb.defuse.progress,
      activeUntil: bomb.defuse.activeUntil, rewardXp: bomb.defuse.rewardXp,
      minimumStreams: bomb.defuse.minimumStreams, qualifiedAgents: bomb.defuse.qualifiedAgents,
      // So the panel can show what the live event is actually counting,
      // not just how far along it is.
      targetTrack: bomb.defuse.targetTrack, targetAlbum: bomb.defuse.targetAlbum,
      targetKind: bomb.defuse.targetKind, targetNames: bomb.defuse.targetNames,
    } : null,
    charge: bomb.charge,
    brownout: bomb.brownout,
    brownoutUntil: bomb.brownoutUntil,
  }
}
