// The War of Cards quest pass (Bangtan Seven Bridge). Database reads only;
// the rules are reconnect-war-stage.js.
//
// A pass is ACCESS ONLY. Nothing here writes to the album: covers, gifting
// and the normal unlock (all 15 covers, or the tester list) are untouched.
// The pass exists while the agent is a joined teammate on a quest in its War
// of Cards stage, and lets them play until they have finished one counted
// game; after that, and for a short grace once the quest completes, it only
// lets them look at the table and leave it.

import type { SupabaseDB } from './config.ts'
import { WAR_COUNTED_RESULTS, warPassLevel, warPassAllows } from './reconnect-war-stage.js'

/** Which of these agents finished a counted War of Cards game (won, or
 *  played a played-out game to the end) at or after `sinceIso`. One query. */
export async function warPlayedAgents(supabase: SupabaseDB, agentNos: string[], sinceIso: string): Promise<string[]> {
  if (!agentNos.length || !sinceIso) return []
  const { data, error } = await supabase.from('rc_run_ami_match_players')
    .select('agent_no').in('agent_no', agentNos)
    .in('result', WAR_COUNTED_RESULTS as unknown as string[])
    .gte('finished_at', sinceIso)
  if (error) return []
  return [...new Set((data || []).map((r: any) => String(r.agent_no)))]
}

interface PassMission {
  id: string; district_id: string; status: string; phase: string
  expires_at: string; completed_at: string | null; cards_unlocked_at: string | null
}

/** The agent's quest missions that are, or just were, in a War of Cards
 *  stage. Fails closed: any read error means no pass. */
async function passMissions(supabase: SupabaseDB, agentNo: string): Promise<PassMission[]> {
  const { data: rows, error } = await supabase.from('rc_reconnect_participants')
    .select('mission_id').eq('agent_no', agentNo).eq('status', 'joined')
  if (error || !rows?.length) return []
  const { data: missions, error: mErr } = await supabase.from('rc_reconnect_missions')
    .select('id, district_id, status, phase, expires_at, completed_at, cards_unlocked_at')
    .in('id', rows.map((r: any) => r.mission_id))
    .in('status', ['open', 'complete'])
    .not('cards_unlocked_at', 'is', null)
  if (mErr) return []
  return (missions || []) as PassMission[]
}

/** Every pass this agent holds right now, read once: each quest mission in
 *  its War of Cards stage with whether the agent already played there. */
async function passes(supabase: SupabaseDB, agentNo: string) {
  const out: { mission: PassMission; played: boolean }[] = []
  for (const mission of await passMissions(supabase, agentNo)) {
    out.push({ mission, played: (await warPlayedAgents(supabase, [agentNo], mission.cards_unlocked_at!)).length > 0 })
  }
  return out
}

/** The strongest level any of those passes gives for `route`. */
function bestLevel(list: { mission: PassMission; played: boolean }[], route: string, nowMs: number) {
  let best: { level: 'play' | 'view'; mission: PassMission; played: boolean } | null = null
  for (const p of list) {
    const level = warPassLevel({ mission: p.mission, played: p.played, route, nowMs })
    if (level && (!best || (level === 'play' && best.level === 'view'))) best = { level, ...p }
  }
  return best
}

/** run-ami.ts's gate: does a quest pass let this agent call `route`? */
export async function warQuestPassAllows(supabase: SupabaseDB, agentNo: string, route: string): Promise<boolean> {
  const best = bestLevel(await passes(supabase, agentNo).catch(() => []), route, Date.now())
  return !!best && warPassAllows(best.level, route)
}

/** For buildState: what the app shows (Run ARMY entry, quest panel). One
 *  participants read for nearly everyone; more only while on such a quest. */
export async function warQuestPassForState(supabase: SupabaseDB, agentNo: string) {
  const list = await passes(supabase, agentNo).catch(() => [])
  if (!list.length) return null
  const now = Date.now()
  const play = bestLevel(list, 'createRoom', now)
  if (play?.level === 'play') return { active: true, played: false, districtId: play.mission.district_id }
  const seen = bestLevel(list, 'getState', now)
  return seen ? { active: false, played: seen.played, districtId: seen.mission.district_id } : null
}
