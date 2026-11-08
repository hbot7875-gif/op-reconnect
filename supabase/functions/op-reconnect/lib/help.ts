// Help portal (migration 20261108150000): agents send a problem from
// Settings → Get help; AGENT000 reads and replies from Settings → Help inbox;
// the reply reaches the agent's bell. Rules live in help-rules.js.
//
// The details attached to a request are looked up here, on the server, from
// the agent's own rows — never taken from the browser — and keep only
// yes/no for each stream connection (no usernames, IDs, PINs or tokens).

import {
  HELP_OWNER, HELP_OPEN_LIMIT, HELP_DAILY_LIMIT, HELP_REPLY_MAX, validateHelpRequest, helpDiagnostics,
} from './help-rules.js'
import { resolvedAgentStreamSource } from './streams.ts'

// deno-lint-ignore no-explicit-any
type Sb = any

const agentOf = (p: any) => String(p?.agentNo || '').trim().toUpperCase()
const iso = (v: any) => (v ? new Date(v).toISOString() : null)

async function diagnosticsFor(sb: Sb, agentNo: string) {
  const [agentRes, syncRes, playRes, districtRes] = await Promise.all([
    sb.from('rc_agents').select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id, created_at')
      .eq('agent_no', agentNo).maybeSingle(),
    sb.from('rc_stream_sync_state').select('source, last_success_at, last_provider_at, last_error, consecutive_failures')
      .eq('agent_no', agentNo).maybeSingle(),
    sb.from('rc_scrobbles').select('listened_at').eq('agent_no', agentNo).order('listened_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('rc_player_districts').select('district_id').eq('agent_no', agentNo).eq('status', 'active').limit(1).maybeSingle(),
  ])
  const a = agentRes.data
  const s = syncRes.data
  const lastPlay = Number(playRes.data?.listened_at)
  return helpDiagnostics({
    source: a ? resolvedAgentStreamSource(a) : null,
    connections: { listenbrainz: !!a?.lb_username, statsfm: !!a?.statsfm_username, musicat: !!a?.musicat_public_id },
    sync: s ? { source: s.source, lastSuccessAt: iso(s.last_success_at), newestAtProvider: iso(s.last_provider_at), lastError: s.last_error, failures: s.consecutive_failures } : null,
    lastPlayAt: Number.isFinite(lastPlay) && lastPlay > 0 ? new Date(lastPlay * 1000).toISOString() : null,
    joinedAt: iso(a?.created_at),
    district: districtRes.data?.district_id || null,
  })
}

export async function submitHelpRequest(sb: Sb, params: any) {
  const agentNo = agentOf(params)
  const v = validateHelpRequest({ topic: params.topic, message: params.message })
  if (!v.ok) return { success: false, error: v.error }
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString()
  const [{ count: open }, { count: today }] = await Promise.all([
    sb.from('rc_help_requests').select('id', { count: 'exact', head: true }).eq('agent_no', agentNo).eq('status', 'open'),
    sb.from('rc_help_requests').select('id', { count: 'exact', head: true }).eq('agent_no', agentNo).gte('created_at', dayAgo),
  ])
  if ((open || 0) >= HELP_OPEN_LIMIT) return { success: false, error: 'too_many_open' }
  if ((today || 0) >= HELP_DAILY_LIMIT) return { success: false, error: 'daily_limit' }
  const diagnostics = await diagnosticsFor(sb, agentNo).catch(() => ({}))
  const { error } = await sb.from('rc_help_requests').insert({ agent_no: agentNo, topic: v.topic, message: v.message, diagnostics })
  if (error) return { success: false, error: 'server_error' }
  return { success: true }
}

/** The agent's own requests, newest first. Opening the list marks the
 *  team's replies as read, which clears them from the bell. */
export async function getMyHelpRequests(sb: Sb, params: any) {
  const agentNo = agentOf(params)
  const { data, error } = await sb.from('rc_help_requests')
    .select('id, topic, message, status, reply, replied_at, reply_seen_at, created_at')
    .eq('agent_no', agentNo).order('created_at', { ascending: false }).limit(10)
  if (error) return { success: false, error: 'server_error' }
  const unseen = (data || []).filter((r: any) => r.reply && !r.reply_seen_at).map((r: any) => r.id)
  if (unseen.length) await sb.from('rc_help_requests').update({ reply_seen_at: new Date().toISOString() }).in('id', unseen)
  return {
    success: true,
    requests: (data || []).map((r: any) => ({
      id: r.id, topic: r.topic, message: r.message, status: r.status, reply: r.reply || null,
      repliedAt: r.replied_at, createdAt: r.created_at, isNewReply: unseen.includes(r.id),
    })),
  }
}

/** AGENT000's inbox: open requests (or the latest 50 of any status). */
export async function helpInbox(sb: Sb, params: any) {
  if (agentOf(params) !== HELP_OWNER) return { success: false, error: 'not_owner' }
  let q = sb.from('rc_help_requests')
    .select('id, agent_no, topic, message, diagnostics, status, reply, replied_at, created_at')
    .order('created_at', { ascending: false }).limit(50)
  if (params.status !== 'all') q = q.eq('status', 'open')
  const { data, error } = await q
  if (error) return { success: false, error: 'server_error' }
  const agentNos = [...new Set((data || []).map((r: any) => r.agent_no))]
  const [{ data: players }, { data: agents }] = agentNos.length
    ? await Promise.all([
      sb.from('rc_players').select('agent_no, codename').in('agent_no', agentNos),
      sb.from('rc_agents').select('agent_no, handle').in('agent_no', agentNos),
    ])
    : [{ data: [] }, { data: [] }]
  const name = new Map((players || []).map((p: any) => [p.agent_no, p.codename]))
  const handle = new Map((agents || []).map((a: any) => [a.agent_no, a.handle]))
  return {
    success: true,
    requests: (data || []).map((r: any) => ({
      id: r.id, agentNo: r.agent_no, codename: name.get(r.agent_no) || r.agent_no, handle: handle.get(r.agent_no) || null,
      topic: r.topic, message: r.message, diagnostics: r.diagnostics || {}, status: r.status,
      reply: r.reply || null, repliedAt: r.replied_at, createdAt: r.created_at,
    })),
  }
}

/** AGENT000 replies and/or resolves (or reopens) a request. */
export async function helpReply(sb: Sb, params: any) {
  const owner = agentOf(params)
  if (owner !== HELP_OWNER) return { success: false, error: 'not_owner' }
  const id = String(params.id || '')
  const reply = typeof params.reply === 'string' ? params.reply.trim().slice(0, HELP_REPLY_MAX) : ''
  const status = params.status === 'resolved' || params.status === 'open' ? params.status : null
  if (!reply && !status) return { success: false, error: 'empty_reply' }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (reply) Object.assign(patch, { reply, replied_at: new Date().toISOString(), replied_by: owner, reply_seen_at: null })
  if (status) patch.status = status
  const { data, error } = await sb.from('rc_help_requests').update(patch).eq('id', id).select('id').maybeSingle()
  if (error) return { success: false, error: 'server_error' }
  if (!data) return { success: false, error: 'not_found' }
  return { success: true }
}

/** For the game state (bell): unread replies, and AGENT000's open count. */
export async function helpStateFor(sb: Sb, agentNo: string) {
  const [{ count: replyUnread }, open] = await Promise.all([
    sb.from('rc_help_requests').select('id', { count: 'exact', head: true })
      .eq('agent_no', agentNo).not('reply', 'is', null).is('reply_seen_at', null),
    agentNo === HELP_OWNER
      ? sb.from('rc_help_requests').select('id', { count: 'exact', head: true }).eq('status', 'open')
      : Promise.resolve({ count: 0 }),
  ])
  return { replyUnread: replyUnread || 0, inboxOpen: open?.count || 0 }
}
