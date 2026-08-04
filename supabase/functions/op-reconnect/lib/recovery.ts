// Forgotten password / lost agent number — the way back in.
//
// One flow covers both, on purpose. The agent number is shown exactly once at
// signup and is what you sign in with, so "I lost my number" and "I lost my
// password" are the same person in the same trouble. Enter the email on file,
// get one message carrying the number AND a reset code.
//
// Two rules this flow doesn't bend:
//   · No account enumeration. requestReset returns the same success shape
//     whether or not that email exists — otherwise the endpoint becomes a
//     free "is this person registered" oracle.
//   · The code is never stored, only its SHA-256, and it's single-use.

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
 * Send a recovery code to the address on file. Always reports success when
 * the request itself was well-formed — see the enumeration rule above. The
 * one honest exception is a missing mail key: that's our fault, not the
 * caller's, and pretending to send would strand them waiting for an email
 * that was never going to arrive.
 */
export async function requestPasswordReset(supabase: SupabaseDB, params: Record<string, unknown>) {
  const email = normalizeEmail(params.email)
  if (!email) return { success: false, error: 'email_invalid' }
  if (!mailerConfigured()) return { success: false, error: 'mail_not_configured' }

  if (!await throttle(supabase, `reset:${email}`, 5, 3600)) {
    return { success: false, error: 'rate_limited' }
  }

  const { data: agent } = await supabase.from('rc_agents')
    .select('agent_no, handle, email').ilike('email', email).maybeSingle()

  if (agent) {
    const code = newCode()
    await supabase.from('rc_password_resets').insert({
      agent_no: agent.agent_no,
      code_hash: await sha256(code),
      expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
    })
    const mail = recoveryEmail(agent.agent_no, agent.handle, code, CODE_TTL_MINUTES)
    const sent = await sendMail(agent.email, mail.subject, mail.html, mail.text)
    // A send failure is logged but not surfaced — reporting "couldn't send"
    // for a real address and "sent" for a fake one would leak exactly what
    // the uniform response exists to hide.
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
