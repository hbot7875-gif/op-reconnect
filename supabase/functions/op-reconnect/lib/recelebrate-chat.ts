// ARIRANG RE:CELEBRATE shared Party Chat. Both routes are session-gated in
// index.ts. Agent numbers stay server-side: clients receive only codename,
// side, message text, time, and whether a row belongs to the caller.

import type { SupabaseDB } from './config.ts'
import { RECELEBRATE_EVENT_ID } from './recelebrate-tracks.js'

const OPENS_AT = new Date('2026-09-20T03:30:00.000Z').getTime()
const ENDS_AT = new Date('2026-09-21T04:00:00.000Z').getTime()
const MESSAGE_LIMIT = 100
const MESSAGE_MAX = 200
const RATE_WINDOW_MS = 10_000
const RATE_MAX = 4

const agentOf = (params: any) => String(params.agentNo || '').trim().toUpperCase()
const roomState = (now = Date.now()) => ({ locked: now < OPENS_AT, readOnly: now >= ENDS_AT })

function cleanMessage(value: unknown) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
}

export async function getRecelebrateMessages(supabase: SupabaseDB, params: any) {
  const agentNo = agentOf(params)
  const state = roomState()
  if (state.locked) return { success: true, ...state, messages: [] }

  const { data, error } = await supabase.from('rc_recelebrate_messages')
    .select('id, agent_no, body, created_at')
    .eq('event_id', RECELEBRATE_EVENT_ID)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(MESSAGE_LIMIT)
  if (error) return { success: false, error: error.message }

  const rows = (data || []).reverse()
  const agentNos = [...new Set(rows.map((r: any) => String(r.agent_no)))]
  const [{ data: players }, { data: passes }] = agentNos.length ? await Promise.all([
    supabase.from('rc_players').select('agent_no, codename').in('agent_no', agentNos),
    supabase.from('rc_recelebrate_passes').select('agent_no, team')
      .eq('event_id', RECELEBRATE_EVENT_ID).in('agent_no', agentNos),
  ]) : [{ data: [] }, { data: [] }]
  const names = new Map((players || []).map((p: any) => [String(p.agent_no), String(p.codename || 'AGENT')]))
  const sides = new Map((passes || []).map((p: any) => [String(p.agent_no), String(p.team || '')]))

  return {
    success: true,
    ...state,
    messages: rows.map((r: any) => ({
      id: String(r.id),
      name: names.get(String(r.agent_no)) || 'AGENT',
      side: sides.get(String(r.agent_no)) || null,
      text: r.body,
      at: r.created_at,
      me: String(r.agent_no) === agentNo,
    })),
  }
}

export async function sendRecelebrateMessage(supabase: SupabaseDB, params: any) {
  const agentNo = agentOf(params)
  const state = roomState()
  if (state.locked) return { success: false, error: 'party_not_open' }
  if (state.readOnly) return { success: false, error: 'party_over' }

  const body = cleanMessage(params.message)
  if (!body) return { success: false, error: 'message_required' }

  // The server-side pass is the source of truth for side identity; the client
  // cannot claim Hooligan/Alien status in a message payload.
  const { data: pass, error: passError } = await supabase.from('rc_recelebrate_passes')
    .select('team').eq('event_id', RECELEBRATE_EVENT_ID).eq('agent_no', agentNo).maybeSingle()
  if (passError) return { success: false, error: passError.message }
  if (!pass?.team) return { success: false, error: 'team_required' }

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  const { count, error: rateError } = await supabase.from('rc_recelebrate_messages')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', RECELEBRATE_EVENT_ID).eq('agent_no', agentNo).gte('created_at', since)
  if (rateError) return { success: false, error: rateError.message }
  if ((count || 0) >= RATE_MAX) return { success: false, error: 'slow_down' }

  const { error } = await supabase.from('rc_recelebrate_messages')
    .insert({ event_id: RECELEBRATE_EVENT_ID, agent_no: agentNo, body })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

export const __chatTest = { cleanMessage, roomState }
