// ARMY Bomb — the network's shared power source.
//
// Charge = every agent's counted streams over a rolling window, pooled.
// `multiplier` here USED to multiply personal XP directly — retired (see
// derive.ts's awardStreamsXp) once Personal Charge (agent-charge.ts) became
// the thing that actually matters for a player's own XP and district
// survival. What's left is display/atmosphere: a live "how busy is the
// network" reading, plus the brownout state below, plus Red Zone's shared
// target/contribution/reward — none of which touch personal XP.
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
import { xpRules, modeMultiplier, loadContent } from './config.ts'
import { todayKst, addDaysStr } from './kst.ts'
import { countedStreams } from './derive.ts'
import { getEraTimeline, completedEraCount } from './era-timeline.ts'

export interface BombCfg {
  chargeWindowHours: number
  chargeFullAt: number
  maxMultiplier: number
  brownoutHours: number
  brownoutMultiplier: number
  defuseRewardXp: number
}

export function bombCfg(content: GameContent): BombCfg {
  return {
    chargeWindowHours: 24, chargeFullAt: 1500, maxMultiplier: 1.5,
    brownoutHours: 24, brownoutMultiplier: 0.75, defuseRewardXp: 50,
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
    yourStreams: number
  } | null
}

/**
 * Every player's own variety cap, keyed by agent_no — each agent's mode
 * determines THEIR cap, never the cap of whoever happens to be viewing the
 * bomb. Falls back to the unmultiplied base cap for any agent not found
 * (shouldn't happen, since every rc_daily_activity row belongs to a joined
 * player, but a stream shouldn't just get dropped from the pool if it does).
 */
async function agentCapMap(supabase: SupabaseDB, content: GameContent): Promise<{ map: Map<string, number>; base: number }> {
  const base = xpRules(content).varietyCapBase
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
  const { data } = await supabase
    .from('rc_daily_activity')
    .select('agent_no, track_counts')
    .gte('kst_date', from)
  let total = 0
  for (const row of data || []) {
    const cap = caps.map.get(row.agent_no) ?? caps.base
    total += countedStreams(row.track_counts || {}, allow, cap)
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

  const { data: ev } = await supabase
    .from('rc_defuse_events').select('*')
    .eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()

  let defuse: BombView['defuse'] = null
  if (ev) {
    const resolved = await refreshDefuse(supabase, content, ev, caps, cfg)
    if (resolved.stillActive) {
      const { data: mine } = await supabase.from('rc_defuse_contrib')
        .select('streams').eq('event_id', ev.id).eq('agent_no', agentNo).maybeSingle()
      defuse = {
        id: ev.id, title: ev.title, message: ev.message,
        target: ev.target, progress: resolved.progress,
        endsAt: ev.active_until, activeUntil: ev.active_until, rewardXp: ev.reward_xp,
        yourStreams: mine?.streams || 0,
      }
    }
  }

  return {
    charge: Math.round(charge * 100) / 100,
    communityStreams: pooled,
    multiplier,
    brownout,
    brownoutUntil: brownout ? state.brownout_until : null,
    chargeWindowDays: days,
    defuse,
  }
}

/**
 * Recompute an event's community progress from streams logged inside its
 * window, then settle it if the target was met or the clock ran out.
 */
async function refreshDefuse(
  supabase: SupabaseDB, content: GameContent, ev: any, caps: { map: Map<string, number>; base: number }, cfg: BombCfg,
): Promise<{ stillActive: boolean; progress: number }> {
  const allow: string[] = content.config.bts_artists || []
  const fromDate = new Date(ev.active_from).toISOString().slice(0, 10)

  // Per-agent counted streams inside the event window, from the daily rollups.
  const { data: rows } = await supabase
    .from('rc_daily_activity').select('agent_no, track_counts, kst_date')
    .gte('kst_date', addDaysStr(fromDate, -1))
  const perAgent = new Map<string, number>()
  for (const r of rows || []) {
    const cap = caps.map.get(r.agent_no) ?? caps.base
    const n = countedStreams(r.track_counts || {}, allow, cap)
    if (n > 0) perAgent.set(r.agent_no, (perAgent.get(r.agent_no) || 0) + n)
  }

  let progress = 0
  const contribRows: any[] = []
  for (const [agent, n] of perAgent) {
    progress += n
    contribRows.push({ event_id: ev.id, agent_no: agent, streams: n, updated_at: new Date().toISOString() })
  }
  if (contribRows.length) {
    for (let i = 0; i < contribRows.length; i += 100) {
      await supabase.from('rc_defuse_contrib').upsert(contribRows.slice(i, i + 100), { onConflict: 'event_id, agent_no' })
    }
  }

  const expired = new Date(ev.active_until).getTime() <= Date.now()
  const met = progress >= ev.target

  if (met) {
    await supabase.from('rc_defuse_events')
      .update({ status: 'defused', progress, resolved_at: new Date().toISOString() })
      .eq('id', ev.id).eq('status', 'active')
    await awardDefuseXp(supabase, ev, cfg)
    return { stillActive: false, progress }
  }
  if (expired) {
    await supabase.from('rc_defuse_events')
      .update({ status: 'failed', progress, resolved_at: new Date().toISOString() })
      .eq('id', ev.id).eq('status', 'active')
    // Brown-out: visuals dim and the multiplier drops for a while. Nothing
    // already earned is removed.
    const until = new Date(Date.now() + cfg.brownoutHours * 3600_000).toISOString()
    await supabase.from('rc_bomb_state').update({ brownout_until: until, updated_at: new Date().toISOString() }).eq('id', 1)
    return { stillActive: false, progress }
  }

  await supabase.from('rc_defuse_events').update({ progress }).eq('id', ev.id).eq('status', 'active')
  return { stillActive: true, progress }
}

/** Everyone who contributed gets the reward, once, via the dedup ledger. */
async function awardDefuseXp(supabase: SupabaseDB, ev: any, cfg: BombCfg) {
  const { data: contribs } = await supabase.from('rc_defuse_contrib')
    .select('agent_no, streams').eq('event_id', ev.id).gt('streams', 0)
  const xp = ev.reward_xp || cfg.defuseRewardXp
  for (const c of contribs || []) {
    await supabase.from('rc_xp_ledger').upsert({
      agent_no: c.agent_no, amount: xp, source: 'defuse',
      dedup_key: `defuse:${c.agent_no}:${ev.id}`, meta: { eventId: ev.id, streams: c.streams },
    }, { onConflict: 'dedup_key', ignoreDuplicates: true })
    await supabase.from('rc_badges').upsert(
      { agent_no: c.agent_no, badge_id: 'defuse:first' },
      { onConflict: 'agent_no, badge_id', ignoreDuplicates: true })
  }
}

/** Admin: launch a red-zone attack. */
export async function launchDefuse(supabase: SupabaseDB, params: any) {
  const target = parseInt(params.target) || 2000
  const hours = Math.max(1, Math.min(72, parseInt(params.hours) || 24))
  const { data, error } = await supabase.from('rc_defuse_events').insert({
    title: params.title || 'INCOMING: RED ZONE',
    message: params.message || 'The ARMY Bomb is under attack. Stream together to defuse it before the timer runs out.',
    target,
    reward_xp: parseInt(params.rewardXp) || 50,
    active_until: new Date(Date.now() + hours * 3600_000).toISOString(),
  }).select().single()
  if (error) return { success: false, error: error.message }
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
    } : null,
    charge: bomb.charge,
    brownout: bomb.brownout,
    brownoutUntil: bomb.brownoutUntil,
  }
}
