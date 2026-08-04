// Outbound email — recovery codes only, nothing else sends mail.
//
// Resend over plain fetch: no SDK, no dependency, and this project had no
// mail infrastructure at all before now (the old backend never sent a single
// email — it used web-push instead). Two secrets, both optional at deploy
// time so the function still boots without them:
//   RESEND_API_KEY   required to actually send
//   RECOVERY_FROM    e.g. "Op: Reconnect HQ <hq@yourdomain.com>", must be a
//                    domain verified with Resend
//
// If the key is missing, send() says so plainly rather than pretending to
// have sent. The caller turns that into an honest error — a recovery flow
// that silently drops mail is worse than one that admits it isn't wired up.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function mailerConfigured(): boolean {
  return !!Deno.env.get('RESEND_API_KEY')
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'mail_not_configured' }
  const from = Deno.env.get('RECOVERY_FROM') || 'Op: Reconnect <onboarding@resend.dev>'

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  }).catch(() => null)

  if (!res) return { ok: false, error: 'mail_network_error' }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('resend send failed:', res.status, body.slice(0, 300))
    return { ok: false, error: 'mail_send_failed' }
  }
  return { ok: true }
}

/** The one template. In-world voice, but the code and the number are plain
 *  and unmissable — someone locked out is already frustrated. */
export function recoveryEmail(agentNo: string, handle: string, code: string, minutes: number) {
  const subject = `Op: Reconnect — recovery code ${code}`
  const text = [
    `Agent ${agentNo} (${handle}),`,
    '',
    `Your recovery code is: ${code}`,
    '',
    `It works once and expires in ${minutes} minutes.`,
    `Your agent number is ${agentNo} — that's what you sign in with.`,
    '',
    "If this wasn't you, ignore this. Nothing changed and your password still works.",
  ].join('\n')

  const html = `
  <div style="background:#0a0910;color:#ece9f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 20px">
    <div style="max-width:440px;margin:0 auto;background:#13111e;border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:28px">
      <div style="font-size:11px;letter-spacing:2px;color:#a78bfa;text-transform:uppercase;font-family:monospace">Op: Reconnect &middot; HQ</div>
      <h1 style="font-size:20px;margin:12px 0 8px">Signal restored</h1>
      <p style="color:#9c96b0;font-size:15px;line-height:1.6;margin:0 0 20px">
        Someone asked to reset the password for <strong style="color:#ece9f2">${agentNo}</strong> (${handle}). Here's the code.
      </p>
      <div style="background:rgba(139,92,246,0.13);border:1px solid #8b5cf6;border-radius:12px;padding:18px;text-align:center;margin-bottom:20px">
        <div style="font-family:monospace;font-size:30px;letter-spacing:6px;color:#ece9f2">${code}</div>
        <div style="font-size:12px;color:#9c96b0;margin-top:8px">One use &middot; expires in ${minutes} minutes</div>
      </div>
      <p style="color:#9c96b0;font-size:14px;line-height:1.6;margin:0 0 16px">
        While you're here — your agent number is <strong style="color:#d9ad5f;font-family:monospace">${agentNo}</strong>. That's what you sign in with. Write it down this time.
      </p>
      <p style="color:#635d78;font-size:12.5px;line-height:1.6;margin:0">
        If this wasn't you, ignore it. Nothing has changed and your current password still works.
      </p>
    </div>
  </div>`

  return { subject, text, html }
}
