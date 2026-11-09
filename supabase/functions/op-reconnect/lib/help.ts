// Help portal (migration 20261108150000): agents send a problem from
// Settings → Get help; AGENT000 reads and replies from Settings → Help inbox;
// the reply reaches the agent's bell. Rules live in help-rules.js.
//
// The details attached to a request are looked up here, on the server, from
// the agent's own rows — never taken from the browser — and keep only
// yes/no for each stream connection (no usernames, IDs, PINs or tokens).

import {
  HELP_OWNER, HELP_OPEN_LIMIT, HELP_DAILY_LIMIT, HELP_REPLY_MAX, validateHelpRequest, helpDiagnostics,
  HELP_SCREENSHOT_MAX, HELP_SCREENSHOT_BYTES, HELP_SCREENSHOT_KEEP_DAYS, HELP_SCREENSHOT_TYPES,
} from './help-rules.js'
import { resolvedAgentStreamSource } from './streams.ts'

// deno-lint-ignore no-explicit-any
type Sb = any

const agentOf = (p: any) => String(p?.agentNo || '').trim().toUpperCase()
const SHOT_BUCKET = 'help-shots'
const SIGNED_TTL_SEC = 15 * 60

/** Short-lived links to screenshots in the private bucket (the bucket itself
 *  is never public). Empty when there are none or signing fails. */
async function signShots(sb: Sb, paths: string[] | null | undefined): Promise<string[]> {
  if (!paths?.length) return []
  const { data, error } = await sb.storage.from(SHOT_BUCKET).createSignedUrls(paths, SIGNED_TTL_SEC)
  if (error || !data) return []
  return data.map((d: any) => d.signedUrl).filter(Boolean)
}

/** Checks and decodes up to HELP_SCREENSHOT_MAX images sent as base64. */
function decodeShots(images: any): { ok: true; shots: { bytes: Uint8Array; mime: string }[] } | { ok: false; error: string } {
  if (images == null) return { ok: true, shots: [] }
  if (!Array.isArray(images)) return { ok: false, error: 'bad_image' }
  if (images.length > HELP_SCREENSHOT_MAX) return { ok: false, error: 'too_many_images' }
  const shots: { bytes: Uint8Array; mime: string }[] = []
  for (const img of images) {
    const mime = String(img?.mime || '').toLowerCase()
    if (!HELP_SCREENSHOT_TYPES.includes(mime)) return { ok: false, error: 'bad_image' }
    let bytes: Uint8Array
    try { bytes = Uint8Array.from(atob(String(img?.base64 || '')), (c) => c.charCodeAt(0)) } catch { return { ok: false, error: 'bad_image' } }
    if (!bytes.length) return { ok: false, error: 'bad_image' }
    if (bytes.length > HELP_SCREENSHOT_BYTES) return { ok: false, error: 'image_too_large' }
    shots.push({ bytes, mime })
  }
  return { ok: true, shots }
}
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
  const decoded = decodeShots(params.images)
  if (!decoded.ok) return { success: false, error: decoded.error }
  // Only streaming problems carry the stream details — what the form tells them.
  const diagnostics = v.topic === 'streams' ? await diagnosticsFor(sb, agentNo).catch(() => ({})) : {}
  // Files first, then the row that points at them; if the row fails, the
  // files are removed again so nothing is left orphaned.
  const id = crypto.randomUUID()
  const paths: string[] = []
  for (const [i, shot] of decoded.shots.entries()) {
    const ext = shot.mime === 'image/png' ? 'png' : shot.mime === 'image/webp' ? 'webp' : 'jpg'
    const path = `${agentNo}/${id}-${i + 1}.${ext}`
    const { error: upErr } = await sb.storage.from(SHOT_BUCKET).upload(path, shot.bytes, { contentType: shot.mime, upsert: false })
    if (upErr) {
      if (paths.length) await sb.storage.from(SHOT_BUCKET).remove(paths)
      return { success: false, error: 'upload_failed' }
    }
    paths.push(path)
  }
  const { error } = await sb.from('rc_help_requests')
    .insert({ id, agent_no: agentNo, topic: v.topic, message: v.message, diagnostics, screenshot_paths: paths })
  if (error) {
    if (paths.length) await sb.storage.from(SHOT_BUCKET).remove(paths)
    return { success: false, error: 'server_error' }
  }
  return { success: true }
}

/** The agent's own requests, newest first. Opening the list marks the
 *  team's replies as read, which clears them from the bell. */
export async function getMyHelpRequests(sb: Sb, params: any) {
  const agentNo = agentOf(params)
  const { data, error } = await sb.from('rc_help_requests')
    .select('id, topic, message, status, reply, replied_at, reply_seen_at, created_at, screenshot_paths')
    .eq('agent_no', agentNo).order('created_at', { ascending: false }).limit(10)
  if (error) return { success: false, error: 'server_error' }
  const unseen = (data || []).filter((r: any) => r.reply && !r.reply_seen_at).map((r: any) => r.id)
  if (unseen.length) await sb.from('rc_help_requests').update({ reply_seen_at: new Date().toISOString() }).in('id', unseen)
  return {
    success: true,
    requests: await Promise.all((data || []).map(async (r: any) => ({
      id: r.id, topic: r.topic, message: r.message, status: r.status, reply: r.reply || null,
      repliedAt: r.replied_at, createdAt: r.created_at, isNewReply: unseen.includes(r.id),
      screenshots: await signShots(sb, r.screenshot_paths),
    }))),
  }
}

/** AGENT000's inbox: open requests (or the latest 50 of any status). */
export async function helpInbox(sb: Sb, params: any) {
  if (agentOf(params) !== HELP_OWNER) return { success: false, error: 'not_owner' }
  let q = sb.from('rc_help_requests')
    .select('id, agent_no, topic, message, diagnostics, status, reply, replied_at, created_at, screenshot_paths')
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
    requests: await Promise.all((data || []).map(async (r: any) => ({
      id: r.id, agentNo: r.agent_no, codename: name.get(r.agent_no) || r.agent_no, handle: handle.get(r.agent_no) || null,
      topic: r.topic, message: r.message, diagnostics: r.diagnostics || {}, status: r.status,
      reply: r.reply || null, repliedAt: r.replied_at, createdAt: r.created_at,
      screenshots: await signShots(sb, r.screenshot_paths),
    }))),
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

/** Removes screenshots 30 days after their request was resolved. Files
 *  first, then the references; a crash in between leaves references to
 *  files that are already gone (their links simply stop working) and the
 *  next run clears them. Rides the hourly sync, so it never throws. */
export async function sweepHelpScreenshots(sb: Sb): Promise<{ cleared: number; error?: string }> {
  try {
    const before = new Date(Date.now() - HELP_SCREENSHOT_KEEP_DAYS * 86400_000).toISOString()
    const { data, error } = await sb.from('rc_help_requests').select('id, screenshot_paths')
      .eq('status', 'resolved').lt('updated_at', before).neq('screenshot_paths', '{}').limit(100)
    if (error || !data?.length) return { cleared: 0, ...(error ? { error: error.message } : {}) }
    const paths = data.flatMap((r: any) => r.screenshot_paths || [])
    if (paths.length) {
      const { error: rmErr } = await sb.storage.from(SHOT_BUCKET).remove(paths)
      if (rmErr) return { cleared: 0, error: rmErr.message }
    }
    const { error: upErr } = await sb.from('rc_help_requests').update({ screenshot_paths: [] }).in('id', data.map((r: any) => r.id))
    return { cleared: upErr ? 0 : data.length, ...(upErr ? { error: upErr.message } : {}) }
  } catch (e) {
    return { cleared: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
