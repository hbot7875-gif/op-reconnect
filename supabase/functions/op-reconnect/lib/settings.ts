// Account settings — everything the in-game Settings screen reads and writes.
//
// All of these are session-verified at the router (index.ts), so none of them
// re-check the agent number against anything: by the time a handler runs, the
// caller has already proved they hold that agent's token. The two exceptions
// take a password anyway — changing a password and changing the recovery
// email are exactly the actions a stolen phone would be used for, so they ask
// for the one thing a thief with an unlocked phone still doesn't have.

import bcrypt from 'bcryptjs'
import type { SupabaseDB } from './config.ts'
import { getRcAgent, setPasswordAndRotate, normalizeEmail, EMAIL_RE, throttle } from './auth.ts'

const SOURCES = ['lb', 'direct', 'statsfm', 'musicat']

/** Everything the Settings screen needs, in one call. The scrobble PIN is
 *  reported as present/absent rather than returned — revealing it is its own
 *  deliberate tap (getWebhookPin), the same way a game shows "••••" until you
 *  ask. */
export async function getAccount(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agent = await getRcAgent(supabase, String(params.agentNo || ''))
  if (!agent) return { success: false, error: 'agent_not_found' }
  return {
    success: true,
    account: {
      agentNo: agent.agent_no,
      handle: agent.handle,
      email: agent.email,
      createdAt: agent.created_at,
      lastLoginAt: agent.last_login_at,
      streamSource: agent.stream_source_preference || 'lb',
      lbUsername: agent.lb_username,
      statsfmUsername: agent.statsfm_username ?? null,
      musicatPublicId: agent.musicat_public_id ?? null,
      hasPin: !!agent.scrobble_pin,
    },
  }
}

/** Add or change the recovery address. Password-gated: whoever controls the
 *  email controls the account, so quietly repointing it is a full takeover. */
export async function updateEmail(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const email = normalizeEmail(params.email)
  const password = String(params.password || '')
  if (!EMAIL_RE.test(email)) return { success: false, error: 'email_invalid' }

  if (!await throttle(supabase, `email:${agentNo}`, 10, 3600)) {
    return { success: false, error: 'rate_limited' }
  }

  const agent = await getRcAgent(supabase, agentNo)
  if (!agent) return { success: false, error: 'agent_not_found' }
  if (!await bcrypt.compare(password, agent.password_hash)) {
    return { success: false, error: 'bad_credentials' }
  }

  const { data: taken } = await supabase.from('rc_agents').select('agent_no')
    .ilike('email', email).neq('agent_no', agentNo).maybeSingle()
  if (taken) return { success: false, error: 'email_taken' }

  const { error } = await supabase.from('rc_agents').update({ email }).eq('agent_no', agentNo)
  if (error) return { success: false, error: String(error.code) === '23505' ? 'email_taken' : error.message }
  return { success: true, email }
}

/** Change password from inside the game. Rotates the session, so the caller
 *  gets a fresh token back and every other device is signed out — which is
 *  the entire point of changing a password you think someone else has. */
export async function changePassword(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const current = String(params.currentPassword || '')
  const next = String(params.newPassword || '')
  if (next.length < 6) return { success: false, error: 'password_short' }

  if (!await throttle(supabase, `pwchange:${agentNo}`, 10, 900)) {
    return { success: false, error: 'rate_limited' }
  }

  const agent = await getRcAgent(supabase, agentNo)
  if (!agent) return { success: false, error: 'agent_not_found' }
  if (!await bcrypt.compare(current, agent.password_hash)) {
    return { success: false, error: 'bad_credentials' }
  }

  const res = await setPasswordAndRotate(supabase, agentNo, next)
  if (!res.ok) return { success: false, error: res.error }
  return { success: true, sessionToken: res.sessionToken }
}

/** Retirement Protocol — a soft delete, password-gated same as changing a
 *  password: this is the one action a stolen phone would use to grief an
 *  account, so it asks for the one thing a thief with an unlocked phone
 *  still doesn't have. Clears the session (kicks every device out, like
 *  logoutAgent) but deliberately touches nothing outside rc_agents —
 *  rc_players/rc_player_districts/badges/xp all survive untouched, since
 *  districts are named after real agents with no team to fold their spot
 *  into. auth.ts's verifySession/loginAgent both reject a retired_at agent
 *  from here on. */
export async function retireAccount(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const password = String(params.password || '')

  if (!await throttle(supabase, `retire:${agentNo}`, 5, 900)) {
    return { success: false, error: 'rate_limited' }
  }

  const agent = await getRcAgent(supabase, agentNo)
  if (!agent) return { success: false, error: 'agent_not_found' }
  if (!await bcrypt.compare(password, agent.password_hash)) {
    return { success: false, error: 'bad_credentials' }
  }

  const { error } = await supabase.from('rc_agents')
    .update({ retired_at: new Date().toISOString(), session_token: null, session_expires_at: null })
    .eq('agent_no', agentNo)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

// ── Stream sources ────────────────────────────────────────────────
// Direct-scrobble PIN — authenticates Web Scrobbler's webhook and the
// ListenBrainz-like protocol (Pano Scrobbler). Same 8-char format as the old
// site's scrobble_pin for familiarity, but no password re-check on
// generation: unlike the old `agents` table, every op-reconnect action
// already runs through verifySession() at the router, so the session token
// itself is the gate — a second password prompt would just be redundant.

function newScrobblePin(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(36).toUpperCase())
    .join('')
    .replace(/[^A-Z0-9]/g, '0')
    .slice(0, 8)
}

export async function generateScrobblePin(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const pin = newScrobblePin()
  const { error } = await supabase.from('rc_agents').update({ scrobble_pin: pin }).eq('agent_no', agentNo)
  if (error) return { success: false, error: error.message }
  return { success: true, pin }
}

export async function getWebhookPin(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const agent = await getRcAgent(supabase, agentNo)
  if (!agent?.scrobble_pin) return { success: false, error: 'no_pin' }
  return { success: true, pin: agent.scrobble_pin }
}

// Musicat's own listening-history endpoint takes only the stable publicId
// (a UUID) — it 422s on anything else, including the handle shown on a
// profile URL (e.g. "soty_swim"). This lookup is how arirang-btsbackend's
// linkMusicat resolves either one to that UUID before it's ever stored, so
// a player pasting their handle (the natural thing to copy) doesn't end up
// with an ID that silently fetches nothing forever. Ported verbatim —
// same endpoint, same header shape.
async function resolveMusicatId(input: string): Promise<{ publicId: string } | { error: string }> {
  const res = await fetch(`https://api.musicat.fm/v1/users?user=${encodeURIComponent(input)}`, {
    headers: { Authorization: 'Bearer empty', 'User-Agent': 'HopeTracker/1.0', Accept: 'application/json' },
  }).catch(() => null)
  if (!res || !res.ok) {
    if (res?.status === 404) return { error: 'musicat_user_not_found' }
    return { error: 'musicat_unreachable' }
  }
  const user = await res.json().catch(() => null)
  if (!user?.publicId) return { error: 'musicat_user_not_found' }
  return { publicId: user.publicId }
}

/**
 * Pick where counted streams come from. Validates that the source actually
 * has something to read before switching: silently accepting `statsfm` with
 * no username set is how an agent ends up staring at a game that counts
 * nothing and can't tell them why.
 */
export async function setStreamSource(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const pref = String(params.preference || '')
  if (!SOURCES.includes(pref)) return { success: false, error: 'invalid_preference' }

  const agent = await getRcAgent(supabase, agentNo)
  if (!agent) return { success: false, error: 'agent_not_found' }

  const patch: Record<string, unknown> = { stream_source_preference: pref }
  const lb = params.lbUsername !== undefined ? String(params.lbUsername || '').trim() : null
  const sfm = params.statsfmUsername !== undefined ? String(params.statsfmUsername || '').trim() : null
  let mus = params.musicatPublicId !== undefined ? String(params.musicatPublicId || '').trim() : null
  if (lb !== null) patch.lb_username = lb || null
  if (sfm !== null) patch.statsfm_username = sfm || null
  if (mus) {
    const resolvedMus = await resolveMusicatId(mus)
    if ('error' in resolvedMus) return { success: false, error: resolvedMus.error }
    mus = resolvedMus.publicId
  }
  if (mus !== null) patch.musicat_public_id = mus || null

  const resolved = {
    lb: lb ?? agent.lb_username,
    statsfm: sfm ?? agent.statsfm_username,
    musicat: mus ?? agent.musicat_public_id,
  }
  if (pref === 'lb' && !resolved.lb) return { success: false, error: 'lb_username_required' }
  if (pref === 'statsfm' && !resolved.statsfm) return { success: false, error: 'statsfm_username_required' }
  if (pref === 'musicat' && !resolved.musicat) return { success: false, error: 'musicat_id_required' }
  if (pref === 'direct' && !agent.scrobble_pin) return { success: false, error: 'pin_required' }

  const { error } = await supabase.from('rc_agents').update(patch).eq('agent_no', agentNo)
  if (error) return { success: false, error: error.message }
  return { success: true, streamSource: pref }
}
