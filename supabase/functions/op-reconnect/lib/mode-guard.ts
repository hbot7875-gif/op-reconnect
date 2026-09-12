// Mode integrity — closing the loophole confirmed live 2026-09-12: an agent
// can declare Easy ("1 device") while feeding it Medium/Hard-tier volume,
// getting Easy's small targets and fast XP rate at several devices' worth
// of real throughput. Nothing before this capped daily volume by mode at
// all (config.ts's PERSONAL_COUNT_CAP is deliberately ~unlimited).
//
// The check is physical, not a guess: an average BTS track runs ~180
// seconds, so ONE continuously-playing device can produce at most
// 86,400 / 180 ≈ 480 real plays in a KST day with ZERO breaks — no sleep,
// no meals, nothing. A mode's declared device count multiplies that ceiling.
// Confirmed against real data before writing this: several agents were
// clearing that ceiling on 9–36 separate days each while sitting in Easy.

import type { SupabaseDB, GameContent } from './config.ts'
import { goalTargetForMode } from './districts.ts'
import { todayKst, addDaysStr } from './kst.ts'
import { logFeedEvent } from './feed.ts'

export const AVG_TRACK_SECONDS = 180
export const SECONDS_PER_DAY = 86_400

// The device count each mode already advertises in its own player-facing
// label (see rc_config's `modes` — "Easy — 1 device", "Medium — 2-4
// accounts", "Hard — 5-6 accounts") — using the top of each range, so a
// genuine single enthusiastic Medium user sitting near their own ceiling
// never gets flagged for being close to it.
const MODE_DEVICE_COUNT: Record<string, number> = { easy: 1, medium: 4, hard: 6, exam: 1 }
const MODE_UPGRADE_PATH: Record<string, string | null> = { easy: 'medium', medium: 'hard', hard: null, exam: null }

/** Whole-day play ceiling for `mode` — the largest raw_streams total one
 *  agent could produce in a KST day while honestly declaring that mode. */
export function dailyStreamCeiling(mode: string): number {
  const devices = MODE_DEVICE_COUNT[mode] ?? 1
  return Math.floor((SECONDS_PER_DAY / AVG_TRACK_SECONDS) * devices)
}

// Pattern, not a fluke: a single marathon binge day happens to real fans
// and must never trigger this on its own (confirmed live: MOONCHILD's one
// 1,022-stream day from looping one album, see agent-charge session notes
// — a real one-off, not a setup). Three-or-more days over the ceiling
// inside one trailing week is what separates "she had a big night" from
// "this is just how many streams this account produces now."
const VIOLATION_WINDOW_DAYS = 7
const VIOLATION_DAYS_TO_TRIGGER = 3

export interface ModeUpgradeResult {
  from: string
  to: string
  violationDays: number
  ceiling: number
}

/** Rescale every track/album goal on the agent's currently active district
 *  to the new mode's targets, recomputed from each goal's own rc_goals
 *  template — freezeGoals()'s own math (goalTargetForMode), just re-run
 *  after the fact instead of once at activation. Deliberately does NOT
 *  touch the reconnect goal: a pooled/team target is shared with teammates
 *  who did nothing wrong, so it stays exactly what the team agreed to.
 *  Without this, an auto-upgrade would only affect districts started
 *  AFTER today — the one currently being run at the abused rate would
 *  keep its Easy-sized targets forever. */
async function rescaleActiveDistrict(
  supabase: SupabaseDB, content: GameContent, agentNo: string, newMode: string,
): Promise<void> {
  const { data: pd } = await supabase.from('rc_player_districts')
    .select('district_id, goals').eq('agent_no', agentNo).eq('status', 'active').maybeSingle()
  if (!pd?.goals) return
  const goals = pd.goals
  const ids = [
    ...(goals.trackGoals || []).map((g: any) => g.id),
    ...(goals.albumGoals || []).map((g: any) => g.id),
  ]
  if (!ids.length) return
  const { data: rows } = await supabase.from('rc_goals').select('*').in('id', ids)
  const byId = new Map((rows || []).map((r: any) => [r.id, r]))

  const trackGoals = (goals.trackGoals || []).map((g: any) => {
    const row = byId.get(g.id)
    return row ? { ...g, target: goalTargetForMode(content, newMode, row) } : g
  })
  const albumGoals = (goals.albumGoals || []).map((g: any) => {
    const row = byId.get(g.id)
    return row ? { ...g, target: goalTargetForMode(content, newMode, row) } : g
  })
  const meta = { ...goals.meta, mode: newMode, multiplier: content.config.modes?.[newMode]?.multiplier || goals.meta?.multiplier }

  await supabase.from('rc_player_districts')
    .update({ goals: { ...goals, trackGoals, albumGoals, meta } })
    .eq('agent_no', agentNo).eq('district_id', pd.district_id).eq('status', 'active')
}

/** Called once per poll from handlers.ts's buildState, right after the
 *  day's rollup is settled. Cheap early-exit for the common case (hard
 *  mode has nowhere higher to go; most days nobody is anywhere near their
 *  own ceiling). Returns the upgrade just applied, or null — buildState
 *  surfaces that as `modeUpgrade` on this one response only, same one-shot
 *  shape leveling.ts's applyLevelUpIfNeeded already uses (the trigger
 *  condition naturally can't re-fire off the same evidence next poll: once
 *  moved to the new mode, that mode's ceiling is higher, so the exact same
 *  historical days that just triggered this no longer count as violations
 *  against it). */
export async function checkModeAbuse(
  supabase: SupabaseDB, content: GameContent, agentNo: string, mode: string,
): Promise<ModeUpgradeResult | null> {
  const nextMode = MODE_UPGRADE_PATH[mode]
  if (!nextMode) return null

  const ceiling = dailyStreamCeiling(mode)
  const since = addDaysStr(todayKst(), -(VIOLATION_WINDOW_DAYS - 1))
  const { data: days } = await supabase.from('rc_daily_activity')
    .select('raw_streams').eq('agent_no', agentNo).gte('kst_date', since)
  const violationDays = (days || []).filter((d: any) => (d.raw_streams || 0) > ceiling).length
  if (violationDays < VIOLATION_DAYS_TO_TRIGGER) return null

  const { error } = await supabase.from('rc_players')
    .update({ mode: nextMode, mode_upgraded_at: new Date().toISOString(), mode_upgraded_from: mode })
    .eq('agent_no', agentNo).eq('mode', mode) // guards a concurrent poll from double-applying
  if (error) return null

  await rescaleActiveDistrict(supabase, content, agentNo, nextMode)
  await logFeedEvent(supabase, agentNo, 'mode_auto_upgraded', { from: mode, to: nextMode },
    `mode-upgrade:${agentNo}:${new Date().toISOString().slice(0, 10)}`)

  return { from: mode, to: nextMode, violationDays, ceiling }
}
