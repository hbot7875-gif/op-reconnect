// Op: Reconnect's own accounts (migration 016) — a clean break from the old
// site's `agents` table. Passwords are hashed HERE with bcrypt, never in SQL
// and never in the browser. Session tokens are opaque, rotated on every
// login, and checked on every non-public action (see index.ts).
//
// This file is the session core: create an account, sign in, sign out, prove
// a token. Account *settings* (email, password change, stream source) live in
// settings.ts and recovery in recovery.ts — same reason handlers.ts spun off
// items.ts, this file was heading past the project's ~300-line rule.

import bcrypt from 'bcryptjs'
import type { SupabaseDB } from './config.ts'

export interface RcAgentRow {
  agent_no: string
  handle: string
  password_hash: string
  email: string | null
  lb_username: string | null
  session_token: string | null
  session_expires_at: string | null
  // Stream-source columns (migrations 019/020) — read here so settings.ts can
  // report and validate them without a second round trip.
  scrobble_pin: string | null
  stream_source_preference: string | null
  statsfm_username: string | null
  musicat_public_id: string | null
  created_at: string
  last_login_at: string | null
  // Retirement Protocol (migration 038) — a soft delete. Set once an agent
  // retires; rc_players/rc_player_districts/badges are left untouched, this
  // is purely a login gate. See settings.ts's retireAccount().
  retired_at: string | null
}

// Matches ui-auth.js's own validation message exactly: "Handles are 3-30
// characters — letters, numbers, dots and underscores."
export const HANDLE_RE = /^[a-zA-Z0-9._]{3,30}$/
// Deliberately permissive. Email validation's only honest job here is
// catching typos like a missing @ — anything stricter starts rejecting real
// addresses, and the recovery code is the actual proof the mailbox exists.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SESSION_DAYS = 90

function newSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
}

function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
}

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

/**
 * Rolling-window attempt limiter for the endpoints a stranger can reach
 * without a session. Buckets are opaque strings, so adding a limited action
 * needs no schema change. Fails OPEN on a DB error: a throttle table that's
 * having a bad day must never be the reason nobody can sign in.
 */
export async function throttle(
  supabase: SupabaseDB, bucket: string, max: number, windowSeconds: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { count, error } = await supabase
    .from('rc_auth_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('bucket', bucket)
    .gte('created_at', since)
  if (error) return true
  if ((count ?? 0) >= max) return false
  await supabase.from('rc_auth_attempts').insert({ bucket })
  // Opportunistic cleanup — no cron needed at this scale, and it keeps the
  // table from growing without bound.
  if (Math.random() < 0.02) {
    await supabase.from('rc_auth_attempts').delete()
      .lt('created_at', new Date(Date.now() - 86400_000).toISOString())
  }
  return true
}

export async function getRcAgent(supabase: SupabaseDB, agentNo: string): Promise<RcAgentRow | null> {
  const { data } = await supabase.from('rc_agents').select('*')
    .eq('agent_no', String(agentNo).trim().toUpperCase()).maybeSingle()
  return data
}

/** Every non-public action must pass this before touching game state.
 *  A null session_expires_at is treated as "no expiry" — accounts created
 *  before migration 023 keep working instead of being logged out by a
 *  column that didn't exist when they signed in. */
export async function verifySession(supabase: SupabaseDB, agentNo: string, sessionToken: unknown): Promise<boolean> {
  if (!sessionToken || typeof sessionToken !== 'string') return false
  const agent = await getRcAgent(supabase, agentNo)
  if (!agent || !agent.session_token || agent.session_token !== sessionToken) return false
  if (agent.session_expires_at && new Date(agent.session_expires_at).getTime() <= Date.now()) return false
  // A retired agent's session_token is cleared the moment they retire (see
  // retireAccount), so this almost never fires in practice — it's here as a
  // second gate in case a token was already in flight the instant they did.
  if (agent.retired_at) return false
  return true
}

/** Live handle availability, so the sign-up form can say "taken" before
 *  someone fills in a password and hits submit. api.js has always listed
 *  this as a public action; it just never existed server-side. */
export async function checkHandle(supabase: SupabaseDB, params: Record<string, unknown>) {
  const handle = String(params.handle || '').trim()
  if (!HANDLE_RE.test(handle)) return { success: true, available: false, reason: 'handle_invalid' }
  const { data } = await supabase.from('rc_agents').select('agent_no').ilike('handle', handle).maybeSingle()
  return { success: true, available: !data, reason: data ? 'handle_taken' : null }
}

export async function registerAgent(supabase: SupabaseDB, params: Record<string, unknown>) {
  const handle = String(params.handle || '').trim()
  const password = String(params.password || '')
  const email = normalizeEmail(params.email)
  const lbUsername = params.lbUsername ? String(params.lbUsername).trim() : null

  if (!HANDLE_RE.test(handle)) return { success: false, error: 'handle_invalid' }
  // Required as of migration 023: it's the only way back into an account
  // whose number or password gets lost, and the number is shown exactly once.
  if (!EMAIL_RE.test(email)) return { success: false, error: 'email_invalid' }
  if (password.length < 6) return { success: false, error: 'password_short' }

  if (!await throttle(supabase, `register:${email}`, 5, 3600)) {
    return { success: false, error: 'rate_limited' }
  }

  const { data: existing } = await supabase.from('rc_agents').select('agent_no')
    .ilike('handle', handle).maybeSingle()
  if (existing) return { success: false, error: 'handle_taken' }

  const { data: emailTaken } = await supabase.from('rc_agents').select('agent_no')
    .ilike('email', email).maybeSingle()
  if (emailTaken) return { success: false, error: 'email_taken' }

  const { data: agentNo, error: numErr } = await supabase.rpc('rc_next_agent_no')
  if (numErr || !agentNo) return { success: false, error: 'Could not issue an agent number' }

  const passwordHash = await bcrypt.hash(password, 10)
  const sessionToken = newSessionToken()

  const { error: insErr } = await supabase.from('rc_agents').insert({
    agent_no: agentNo,
    handle,
    email,
    password_hash: passwordHash,
    lb_username: lbUsername,
    session_token: sessionToken,
    session_expires_at: sessionExpiry(),
    last_login_at: new Date().toISOString(),
  })
  if (insErr) {
    if (String(insErr.code) === '23505') {
      return { success: false, error: /email/i.test(insErr.message || '') ? 'email_taken' : 'handle_taken' }
    }
    return { success: false, error: insErr.message }
  }

  return { success: true, agent: { agentNo, handle, email, sessionToken } }
}

export async function loginAgent(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const password = String(params.password || '')
  if (!agentNo || !password) return { success: false, error: 'agent_not_found' }

  // Per agent number, so one account under attack can't lock everyone out.
  if (!await throttle(supabase, `login:${agentNo}`, 10, 900)) {
    return { success: false, error: 'rate_limited' }
  }

  const agent = await getRcAgent(supabase, agentNo)
  if (!agent) return { success: false, error: 'agent_not_found' }
  if (agent.retired_at) return { success: false, error: 'agent_retired' }

  const ok = await bcrypt.compare(password, agent.password_hash)
  if (!ok) return { success: false, error: 'bad_credentials' }

  const sessionToken = newSessionToken()
  await supabase.from('rc_agents')
    .update({ session_token: sessionToken, session_expires_at: sessionExpiry(), last_login_at: new Date().toISOString() })
    .eq('agent_no', agentNo)

  return {
    success: true,
    agent: { agentNo, handle: agent.handle, email: agent.email, sessionToken },
    needsEmail: !agent.email,
  }
}

/** Sign out for real. Clearing localStorage alone left the token valid in
 *  rc_agents forever — fine on your own phone, not fine on a shared one. */
export async function logoutAgent(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  await supabase.from('rc_agents')
    .update({ session_token: null, session_expires_at: null })
    .eq('agent_no', agentNo)
  return { success: true }
}

/** Shared by settings.ts (change password) and recovery.ts (reset it) —
 *  both rotate the session so other devices are kicked off. */
export async function setPasswordAndRotate(supabase: SupabaseDB, agentNo: string, newPassword: string) {
  const passwordHash = await bcrypt.hash(newPassword, 10)
  const sessionToken = newSessionToken()
  const { error } = await supabase.from('rc_agents')
    .update({ password_hash: passwordHash, session_token: sessionToken, session_expires_at: sessionExpiry() })
    .eq('agent_no', agentNo)
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const, sessionToken }
}
