// RUN AMI — LAST CARD: Edge Function routes.
//
// auth: 'agent' for every player route (index.ts proves the session belongs
// to params.agentNo before any of these run); 'cron' for the sweep. This
// file is only the database adapter: run-ami-service.js sequences each
// request, run-ami-rules.js decides outcomes, run-ami-view.js decides what a
// browser may see. See migration 20261018120000_rc_run_ami.sql for the RPCs.
//
// Agent numbers stay on this side. They are how rows are found; no response
// built from here carries one (players are seats + codename + avatar).

import type { SupabaseDB } from './config.ts'
import { throttle } from './auth.ts'
import { resolveEquippedBadges } from './badge-profile.ts'
import { RULES_VERSION } from './run-ami-rules.js'
import { createRunAmiService, ROOM_CODE_ALPHABET } from './run-ami-service.js'
import { createTesterService } from './run-ami-testers.js'
import { albumService } from './album.ts'

function cryptoRng(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  // 33 symbols; the modulo bias over 256 is irrelevant for a lobby code.
  return [...bytes].map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('')
}

function randomTopic(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
}

const agentOf = (params: any) => String(params.agentNo || '').trim().toUpperCase()

function rpcResult(data: any, error: any) {
  if (error) return { ok: false, error: 'server_error', detail: error.message }
  return data || { ok: false, error: 'server_error' }
}

function makeStore(supabase: SupabaseDB) {
  return {
    async config() {
      const { data } = await supabase.from('rc_config').select('value').eq('key', 'run_ami').maybeSingle()
      return data?.value || {}
    },

    async profiles(agentNos: string[]) {
      const out = new Map<string, { name: string; avatar: string | null }>()
      if (!agentNos.length) return out
      const { data } = await supabase.from('rc_players')
        .select('agent_no, codename, equipped_badge_id').in('agent_no', agentNos)
      const rows = data || []
      const art = await resolveEquippedBadges(supabase,
        rows.map((r: any) => ({ agentNo: r.agent_no, badgeId: r.equipped_badge_id || null })))
      for (const r of rows) {
        out.set(r.agent_no, { name: String(r.codename || 'AGENT'), avatar: art.get(r.agent_no)?.artworkUrl || null })
      }
      return out
    },

    async bombActive(agentNo: string) {
      const { data } = await supabase.rpc('rc_run_ami_bomb_active', { p_agent_no: agentNo })
      return data === true
    },

    async touchSeat(agentNo: string, staleSeconds: number) {
      const { data } = await supabase.rpc('rc_run_ami_touch', { p_agent_no: agentNo, p_stale_seconds: staleSeconds })
      return data?.room_id ? { roomId: data.room_id, wasStale: !!data.was_stale } : null
    },

    async findSeat(agentNo: string) {
      const { data } = await supabase.from('rc_run_ami_seats')
        .select('room_id, seat').eq('agent_no', agentNo).is('left_at', null).maybeSingle()
      return data ? { roomId: data.room_id, seat: data.seat } : null
    },

    async getRoom(roomId: string) {
      const { data } = await supabase.from('rc_run_ami_rooms')
        .select('id, code, host_agent_no, status, topic, version, current_match_id, last_match_id')
        .eq('id', roomId).maybeSingle()
      if (!data) return null
      return {
        id: data.id, code: data.code, hostAgentNo: data.host_agent_no, status: data.status,
        topic: data.topic, version: data.version,
        currentMatchId: data.current_match_id, lastMatchId: data.last_match_id,
      }
    },

    async listSeats(roomId: string) {
      const { data } = await supabase.from('rc_run_ami_seats')
        .select('agent_no, seat, last_seen_at').eq('room_id', roomId).is('left_at', null)
      return (data || []).map((s: any) => ({ agentNo: s.agent_no, seat: s.seat, lastSeenAt: s.last_seen_at }))
    },

    async createRoom({ agentNo, code, topic }: { agentNo: string; code: string; topic: string }) {
      const { data, error } = await supabase.rpc('rc_run_ami_create_room', { p_agent_no: agentNo, p_code: code, p_topic: topic })
      return rpcResult(data, error)
    },

    async joinRoom({ agentNo, code }: { agentNo: string; code: string }) {
      const { data, error } = await supabase.rpc('rc_run_ami_join_room', { p_agent_no: agentNo, p_code: code })
      return rpcResult(data, error)
    },

    async watchRoom({ agentNo, code, maxWatchers }: { agentNo: string; code: string; maxWatchers: number }) {
      const { data, error } = await supabase.rpc('rc_run_ami_watch_room', { p_agent_no: agentNo, p_code: code, p_max_watchers: maxWatchers })
      return rpcResult(data, error)
    },

    async unwatch({ agentNo }: { agentNo: string }) {
      const { data, error } = await supabase.rpc('rc_run_ami_unwatch', { p_agent_no: agentNo })
      return rpcResult(data, error)
    },

    // Heartbeat for a watcher: their room id, or null once the watch has ended.
    async watchTouch(agentNo: string, idleMinutes: number) {
      const { data } = await supabase.rpc('rc_run_ami_watch_touch', { p_agent_no: agentNo, p_idle_minutes: idleMinutes })
      return typeof data === 'string' ? data : null
    },

    async findWatch(agentNo: string) {
      const { data } = await supabase.from('rc_run_ami_watchers')
        .select('room_id').eq('agent_no', agentNo).is('left_at', null).maybeSingle()
      return data?.room_id || null
    },

    async listWatchers(roomId: string) {
      const { data } = await supabase.from('rc_run_ami_watchers')
        .select('agent_no, last_seen_at').eq('room_id', roomId).is('left_at', null).order('joined_at')
      return (data || []).map((w: any) => ({ agentNo: w.agent_no, lastSeenAt: w.last_seen_at }))
    },

    async leaveRoom({ agentNo }: { agentNo: string }) {
      const { data, error } = await supabase.rpc('rc_run_ami_leave_room', { p_agent_no: agentNo })
      return rpcResult(data, error)
    },

    async startMatch(p: any) {
      const { data, error } = await supabase.rpc('rc_run_ami_start_match', {
        p_room_id: p.roomId, p_agent_no: p.agentNo, p_room_version: p.roomVersion, p_agents: p.agents,
        p_public: p.pub, p_state: p.state, p_deadline: p.deadline, p_rules_version: RULES_VERSION,
        p_events: p.events,
      })
      return rpcResult(data, error)
    },

    async loadMatch(matchId: string) {
      const { data } = await supabase.from('rc_run_ami_matches')
        .select('id, room_id, status, version, ended_at, rc_run_ami_match_secrets(state), rc_run_ami_match_players(seat, agent_no)')
        .eq('id', matchId).maybeSingle()
      if (!data) return null
      const secrets: any = Array.isArray(data.rc_run_ami_match_secrets)
        ? data.rc_run_ami_match_secrets[0] : data.rc_run_ami_match_secrets
      const seats = [...(data.rc_run_ami_match_players || [])].sort((a: any, b: any) => a.seat - b.seat)
      if (!secrets?.state) return null
      return {
        id: data.id, roomId: data.room_id, status: data.status, version: data.version,
        endedAt: data.ended_at, state: secrets.state, agents: seats.map((s: any) => s.agent_no),
      }
    },

    async hasAction(matchId: string, agentNo: string, actionId: string) {
      const { data } = await supabase.from('rc_run_ami_events').select('id')
        .eq('match_id', matchId).eq('agent_no', agentNo).eq('action_id', actionId).limit(1)
      return !!(data && data.length)
    },

    async commit(p: any) {
      const { data, error } = await supabase.rpc('rc_run_ami_commit', {
        p_match_id: p.matchId, p_expected_version: p.expectedVersion, p_public: p.pub, p_state: p.state,
        p_status: p.status, p_deadline: p.deadline, p_winner_seat: p.winner, p_end_reason: p.endReason,
        p_events: p.events, p_agent_no: p.agentNo, p_action_id: p.actionId, p_final: p.final,
      })
      if (error) return { ok: false, reason: 'error', detail: error.message }
      return data || { ok: false, reason: 'error' }
    },

    // Most recent finished match this agent was dropped from for
    // disconnecting (finished_at is written when the match ends).
    async droppedMatch(agentNo: string) {
      const { data } = await supabase.from('rc_run_ami_match_players')
        .select('match_id').eq('agent_no', agentNo).eq('forfeit_reason', 'disconnect')
        .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1)
      return data && data.length ? data[0].match_id : null
    },

    // Public columns only. `private` (drawn card ids) is never selected here.
    async recentEvents(matchId: string, limit: number) {
      const { data } = await supabase.from('rc_run_ami_events')
        .select('id, type, seat, public').eq('match_id', matchId)
        .not('type', 'in', '(PLAYER_JOINED,PLAYER_LEFT)')
        .order('id', { ascending: false }).limit(limit)
      return (data || []).reverse().map((e: any) => ({ seq: e.id, type: e.type, seat: e.seat, pub: e.public }))
    },

    throttle(bucket: string, max: number, windowSeconds: number) {
      return throttle(supabase, bucket, max, windowSeconds)
    },

    async expireRooms(idleMinutes: number) {
      const { data } = await supabase.rpc('rc_run_ami_expire_rooms', { p_idle_minutes: idleMinutes })
      return Number(data) || 0
    },

    async chatSend({ agentNo, kind, body, name }: { agentNo: string; kind: string; body: string; name: string }) {
      const { data, error } = await supabase.rpc('rc_run_ami_chat_send', { p_agent_no: agentNo, p_kind: kind, p_body: body, p_name: name })
      return rpcResult(data, error)
    },

    // Newest `limit` messages, returned oldest first.
    async chatRecent(roomId: string, limit: number) {
      const { data } = await supabase.from('rc_run_ami_chat')
        .select('id, agent_no, name, kind, body, watching, created_at').eq('room_id', roomId)
        .order('id', { ascending: false }).limit(limit)
      return (data || []).reverse().map((m: any) => ({
        id: m.id, agentNo: m.agent_no, name: m.name, kind: m.kind, body: m.body, watching: !!m.watching, createdAt: m.created_at,
      }))
    },

    async dueMatches(graceSeconds: number) {
      const { data } = await supabase.rpc('rc_run_ami_due_matches', { p_grace_seconds: graceSeconds })
      return (data || []).map((row: any) => (typeof row === 'string' ? row : row.rc_run_ami_due_matches))
    },
  }
}

/** The live tester list (rc_run_ami_testers, migration 20261025190000). */
function testerStore(supabase: SupabaseDB) {
  return {
    async hasTester(agentNo: string) {
      const { data } = await supabase.from('rc_run_ami_testers').select('agent_no').eq('agent_no', agentNo).maybeSingle()
      return !!data
    },
    async listTesters() {
      const { data } = await supabase.from('rc_run_ami_testers').select('agent_no, added_at').order('added_at', { ascending: true })
      return (data || []).map((r: any) => ({ agentNo: r.agent_no, addedAt: r.added_at }))
    },
    async addTester(agentNo: string, addedBy: string) {
      const { data: agent } = await supabase.from('rc_agents').select('agent_no').eq('agent_no', agentNo).is('retired_at', null).maybeSingle()
      if (!agent) return { ok: false, error: 'tester_no_agent' }
      const { error } = await supabase.from('rc_run_ami_testers').upsert({ agent_no: agentNo, added_by: addedBy }, { onConflict: 'agent_no', ignoreDuplicates: true })
      return error ? { ok: false, error: 'server_error' } : { ok: true }
    },
    async removeTester(agentNo: string) {
      await supabase.from('rc_run_ami_testers').delete().eq('agent_no', agentNo)
    },
    async names(agentNos: string[]) {
      const out = new Map<string, string>()
      const { data } = await supabase.from('rc_players').select('agent_no, codename').in('agent_no', agentNos)
      for (const r of data || []) out.set(r.agent_no, String(r.codename || 'AGENT'))
      return out
    },
  }
}

const testers = (supabase: SupabaseDB) => createTesterService({ store: testerStore(supabase) })

function service(supabase: SupabaseDB) {
  // In: a tester (AGENT000 or the rc_run_ami_testers list), or anyone
  // holding all 15 album covers.
  const allowAgent = async (agentNo: string) =>
    (await testers(supabase).isTester(agentNo).catch(() => false)) || albumService(supabase).isComplete(agentNo).catch(() => false)
  return createRunAmiService({ store: makeStore(supabase), rng: cryptoRng, randomCode, randomTopic, allowAgent })
}

// Owner-only (run-ami-testers.js checks the caller is AGENT000).
export const runAmiTesters = (sb: SupabaseDB, p: any) => testers(sb).list(agentOf(p))
export const runAmiTesterAdd = (sb: SupabaseDB, p: any) => testers(sb).add(agentOf(p), p.target)
export const runAmiTesterRemove = (sb: SupabaseDB, p: any) => testers(sb).remove(agentOf(p), p.target)

/** For buildState: whether the app should show this agent the way in. */
export const runAmiTesterForState = (sb: SupabaseDB, agentNo: string) => testers(sb).isTester(agentNo).catch(() => false)

export const runAmiState = (sb: SupabaseDB, p: any) => service(sb).getState(agentOf(p))
export const runAmiCreateRoom = (sb: SupabaseDB, p: any) => service(sb).createRoom(agentOf(p))
export const runAmiJoinRoom = (sb: SupabaseDB, p: any) => service(sb).joinRoom(agentOf(p), p.code)
export const runAmiWatchRoom = (sb: SupabaseDB, p: any) => service(sb).watchRoom(agentOf(p), p.code)
export const runAmiLeaveRoom = (sb: SupabaseDB, p: any) => service(sb).leaveRoom(agentOf(p))
export const runAmiStart = (sb: SupabaseDB, p: any) => service(sb).startMatch(agentOf(p))
export const runAmiAct = (sb: SupabaseDB, p: any) => service(sb).act(agentOf(p), p)
export const runAmiChat = (sb: SupabaseDB, p: any) => service(sb).sendChat(agentOf(p), { kind: p.kind, body: p.body })
export const cronRunAmiSweep = (sb: SupabaseDB) => service(sb).sweep()
