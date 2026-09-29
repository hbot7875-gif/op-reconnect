// Broadcasts — site-owner announcements, delivered through the same channel
// every agent already polls (getGameState, every 90s per main.js) rather
// than a separate mechanism. See migrations/031_rc_broadcasts.sql.
//
// getActiveBroadcasts is read by handlers.ts's buildState and folded into
// the normal game-state response as `broadcasts`. The admin* functions here
// are gated centrally in index.ts (auth: 'admin', SYNC_ADMIN_KEY) — same
// pattern as every other admin action in this backend.

import type { SupabaseDB } from './config.ts'

/** The one-time "we published Privacy/Terms/Credits" notice.
 *
 *  Not a broadcast row: a broadcast is global, and this is specifically for
 *  agents who existed BEFORE those pages went up — someone who registers
 *  afterwards has had them available the whole time and should not be told
 *  they were "added". It is also not a consent gate; it informs, and the
 *  pages themselves are reachable from Settings either way.
 *
 *  The cutoff is one fixed release constant, deliberately not Date.now():
 *  evaluated per request, "new" would keep sliding forward and agents who
 *  joined after the release would start seeing a historical notice.
 *
 *  The id doubles as the client's dismissal key, so publishing a later
 *  notice means a new id rather than resetting a shared boolean. */
export const LEGAL_INFO_NOTICE_ID = 'legal_info_2026_09'

/** The instant the legal pages become publicly reachable — the STATIC
 *  deploy, not the Edge deploy that ships this constant and not midnight on
 *  the release date.
 *
 *  Midnight UTC was wrong: someone registering at 09:00 on release day, with
 *  the pages still hours from going live, would be classified as a new agent
 *  who had always had them.
 *
 *  The release procedure makes this true by construction rather than by
 *  measurement — see docs, but in short: set this, deploy the Edge Function
 *  (invisible: the live frontend ignores `legalNotice`), then deploy the
 *  static site AT OR AFTER this instant. Never before it.
 *
 *  That ordering is deliberate about which way to be wrong. If the cutoff
 *  landed AFTER real publication, agents who joined in between would be told
 *  pages were "added" that existed the whole time they were here — a false
 *  claim about their own history. If it lands slightly BEFORE, those agents
 *  simply never see an informational notice about pages already sitting in
 *  their Settings. The second is recoverable; the first is a lie. So the
 *  cutoff is held at or before publication, and the gap is kept short. */
export const LEGAL_INFO_PUBLISHED_AT = '2026-09-29T17:50:00Z'

/** True only for an agent registered before the legal pages were published.
 *  Reads rc_players.joined_at, which already exists and is already set for
 *  every row — nothing new is stored, and the timestamp itself never leaves
 *  the server (buildState sends the notice id or null, never the date). */
export function legalInfoNoticeDue(joinedAt: string | null | undefined): boolean {
  if (!joinedAt) return false
  const joined = Date.parse(joinedAt)
  const published = Date.parse(LEGAL_INFO_PUBLISHED_AT)
  if (!Number.isFinite(joined)) return false
  return joined < published
}

export interface BroadcastRow {
  id: number
  title: string
  message: string
  tone: 'info' | 'gold'
  created_at: string
  expires_at: string | null
}

function shape(r: BroadcastRow) {
  return { id: r.id, title: r.title, message: r.message, tone: r.tone, createdAt: r.created_at, expiresAt: r.expires_at }
}

/** Everything currently live — not expired. Newest first, capped at 5 so a
 *  neglected admin panel can't bury the World screen in old announcements. */
export async function getActiveBroadcasts(supabase: SupabaseDB) {
  const nowIso = new Date().toISOString()
  const { data } = await supabase
    .from('rc_broadcasts')
    .select('*')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(5)
  return (data || []).map(shape)
}

/** Admin: create a new broadcast. expiresInHours is optional — omitted or 0
 *  means it never expires on its own (the admin deletes it when it's stale). */
export async function adminCreateBroadcast(supabase: SupabaseDB, params: any) {
  const title = String(params.title || '').trim()
  const message = String(params.message || '').trim()
  const tone = params.tone === 'gold' ? 'gold' : 'info'
  if (!title) return { success: false, error: 'title_required' }
  if (!message) return { success: false, error: 'message_required' }

  const hours = parseInt(params.expiresInHours)
  const expiresAt = hours > 0 ? new Date(Date.now() + hours * 3600_000).toISOString() : null

  const { data, error } = await supabase.from('rc_broadcasts')
    .insert({ title, message, tone, expires_at: expiresAt }).select().single()
  if (error) return { success: false, error: error.message }
  return { success: true, broadcast: shape(data) }
}

/** Admin: every broadcast, live or expired, newest first — so the panel can
 *  show and manage the full recent history, not just what's currently live. */
export async function adminListBroadcasts(supabase: SupabaseDB) {
  const { data, error } = await supabase.from('rc_broadcasts')
    .select('*').order('created_at', { ascending: false }).limit(50)
  if (error) return { success: false, error: error.message }
  const nowIso = new Date().toISOString()
  const rows = (data || []).map((r: BroadcastRow) => ({ ...shape(r), active: !r.expires_at || r.expires_at > nowIso }))
  return { success: true, broadcasts: rows }
}

/** Admin: remove a broadcast for good (not a soft-expire) — this is a
 *  lookup-and-manage tool, not an audit log, so a deleted broadcast is
 *  genuinely gone. */
export async function adminDeleteBroadcast(supabase: SupabaseDB, params: any) {
  const id = parseInt(params.id)
  if (!id) return { success: false, error: 'id_required' }
  const { error } = await supabase.from('rc_broadcasts').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true }
}
