// ARIRANG RE:CELEBRATE pre-party state — Love Song, Party Pass, and the
// surprise team choice.
//
// Every route here is auth: 'agent', so index.ts has already verified the
// session token belongs to params.agentNo before these run; the agent number
// is never taken on the client's word alone.
//
// The Love Song is only chosen client-side until the pass is issued. Issuing
// is a single insert that does nothing if a pass already exists, so the song
// is locked from that moment and a second device (or a double tap) always
// gets back the original pass rather than overwriting it.
//
// The team choice's timer and balancing live entirely in SQL (see migration
// 20260919170000_rc_recelebrate_team_choice.sql): the database's own clock
// stamps the start once, judges the 30s window, and assigns timeouts to the
// smaller side under a lock. This file only relays those results. Nothing
// here checks the event's opening time, so late arrivals can still get a
// pass and a side while the party is live.

import type { SupabaseDB } from './config.ts'
import { ARIRANG_TRACKS, RECELEBRATE_EVENT_ID } from './recelebrate-tracks.js'

const TEAM_WINDOW_MS = 30_000

function shapePass(row: any) {
  if (!row) return null
  const started = row.team_choice_started_at
  return {
    loveSong: row.love_song,
    issuedAt: row.pass_issued_at,
    teamChoiceStartedAt: started,
    teamDeadline: started ? new Date(new Date(started).getTime() + TEAM_WINDOW_MS).toISOString() : null,
    team: row.team,
    teamChosenAt: row.team_chosen_at,
    teamAssignedBy: row.team_assigned_by,
  }
}

async function rpcState(supabase: SupabaseDB, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, { p_event: RECELEBRATE_EVENT_ID, ...args })
  if (error) return { success: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  return { success: true, pass: shapePass(row), serverNow: row?.server_now || new Date().toISOString() }
}

const agentOf = (params: any) => String(params.agentNo || '').trim().toUpperCase()

/** Also the timeout path: reading state after an expired window lets HT
 *  assign the side, so an agent who closed the tab still ends up on a team. */
export async function getRecelebrateState(supabase: SupabaseDB, params: any) {
  return rpcState(supabase, 'rc_recelebrate_resolve_team', { p_agent: agentOf(params) })
}

export async function issuePartyPass(supabase: SupabaseDB, params: any) {
  const agentNo = agentOf(params)
  const loveSong = String(params.loveSong || '')
  if (!ARIRANG_TRACKS.includes(loveSong)) return { success: false, error: 'love_song_invalid' }

  const { error } = await supabase.from('rc_recelebrate_passes')
    .insert({ event_id: RECELEBRATE_EVENT_ID, agent_no: agentNo, love_song: loveSong })
  // 23505 = a pass already exists: the Love Song is locked, return that one.
  const alreadyIssued = error?.code === '23505'
  if (error && !alreadyIssued) return { success: false, error: error.message }

  const res = await rpcState(supabase, 'rc_recelebrate_state', { p_agent: agentNo })
  if (!res.success || !res.pass) return { success: false, error: res.error || 'pass_not_saved' }
  return { ...res, alreadyIssued }
}

export async function startTeamChoice(supabase: SupabaseDB, params: any) {
  const res = await rpcState(supabase, 'rc_recelebrate_start_team_choice', { p_agent: agentOf(params) })
  if (res.success && !res.pass) return { success: false, error: 'no_party_pass' }
  return res
}

export async function chooseTeam(supabase: SupabaseDB, params: any) {
  const team = String(params.team || '')
  if (team !== 'hooligans' && team !== 'aliens') return { success: false, error: 'team_invalid' }
  const res = await rpcState(supabase, 'rc_recelebrate_choose_team', { p_agent: agentOf(params), p_team: team })
  if (res.success && !res.pass) return { success: false, error: 'no_party_pass' }
  return res
}
