// Forgotten password / lost agent number — the way back in.
//
// One flow covers both, on purpose. The agent number is shown exactly once at
// signup and is what you sign in with, so "I lost my number" and "I lost my
// password" are the same person in the same trouble. Enter the email on file,
// get one message carrying the number AND a reset code.
//
// The rule this flow doesn't bend: the code is never stored, only its
// SHA-256, and it's single-use.

import type { SupabaseDB } from './config.ts'
import { getRcAgent, setPasswordAndRotate, normalizeEmail, throttle } from './auth.ts'
import { mailerConfigured, sendMail, recoveryEmail } from './mailer.ts'

const CODE_TTL_MINUTES = 30

// No 0/O/1/I — this gets read off a phone screen and typed by someone who is
// already annoyed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Send a recovery code to the address on file. Says email_not_found when no
 * agent file uses that address, and mail_not_configured when the mail key is
 * missing: either way, answering "sent" would strand the player waiting for
 * an email that was never going to arrive.
 *
 * Unknown addresses used to get the same "sent" as real ones, so nobody could
 * use this to check who's registered. Players kept typing an email they never
 * signed up with and waiting for nothing (AGENT087, 2026-11-01), and sign-up
 * already answers email_taken for a registered address, so the uniform answer
 * was hiding nothing.
 */
export async function requestPasswordReset(supabase: SupabaseDB, params: Record<string, unknown>) {
  const email = normalizeEmail(params.email)
  if (!email) return { success: false, error: 'email_invalid' }
  if (!mailerConfigured()) return { success: false, error: 'mail_not_configured' }

  if (!await throttle(supabase, `reset:${email}`, 5, 3600)) {
    return { success: false, error: 'rate_limited' }
  }

  const { data: agent, error: lookupErr } = await supabase.from('rc_agents')
    .select('agent_no, handle, email').ilike('email', email).maybeSingle()

  // A failed lookup is not proof the address is unknown, so it keeps the old
  // "sent" answer rather than telling a real player they have no file.
  if (lookupErr) console.error('recovery lookup failed:', lookupErr.message)
  else if (!agent) return { success: false, error: 'email_not_found' }

  if (agent) {
    const code = newCode()
    await supabase.from('rc_password_resets').insert({
      agent_no: agent.agent_no,
      code_hash: await sha256(code),
      expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    })
    const mail = recoveryEmail(agent.agent_no, agent.handle, code, CODE_TTL_MINUTES)
    const sent = await sendMail(agent.email, mail.subject, mail.html, mail.text)
    // A send failure is logged but not surfaced: a 2xx from Resend is no
    // proof of delivery either, so the code step still says to check the
    // inbox and ask again.
    if (!sent.ok) console.error('recovery mail failed for', agent.agent_no, sent.error)
  }

  return { success: true, sent: true, expiresInMinutes: CODE_TTL_MINUTES }
}

/**
 * Spend a code and set a new password. Returns a fresh session token so the
 * client can drop the player straight into the game instead of bouncing them
 * to a sign-in form they'd fill in with the password they just typed twice.
 */
export async function resetPassword(supabase: SupabaseDB, params: Record<string, unknown>) {
  const code = String(params.code || '').trim().toUpperCase().replace(/[\s-]/g, '')
  const password = String(params.newPassword || '')
  if (!code) return { success: false, error: 'code_invalid' }
  if (password.length < 6) return { success: false, error: 'password_short' }

  // Throttled on the code itself: a brute-forcer changes the code every try,
  // so this bucket mostly catches repeated attempts at one guess, while the
  // 8-character alphabet (32^8) does the real work.
  if (!await throttle(supabase, `resetuse:${code.slice(0, 4)}`, 20, 900)) {
    return { success: false, error: 'rate_limited' }
  }

  const codeHash = await sha256(code)
  const { data: row } = await supabase.from('rc_password_resets')
    .select('id, agent_no, expires_at, used_at')
    .eq('code_hash', codeHash).is('used_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!row) return { success: false, error: 'code_invalid' }
  if (new Date(row.expires_at).getTime() <= Date.now()) return { success: false, error: 'code_expired' }

  // Burn it first. If the password update somehow fails after this, the
  // player asks for another code — far better than a live code surviving a
  // partial failure.
  const { error: burnErr } = await supabase.from('rc_password_resets')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id).is('used_at', null)
  if (burnErr) return { success: false, error: 'code_invalid' }

  const res = await setPasswordAndRotate(supabase, row.agent_no, password)
  if (!res.ok) return { success: false, error: res.error }

  const agent = await getRcAgent(supabase, row.agent_no)
  return {
    success: true,
    agent: { agentNo: row.agent_no, handle: agent?.handle || null, email: agent?.email || null, sessionToken: res.sessionToken },
  }
}
