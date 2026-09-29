// Outbound email — recovery codes, and (as of 2026-08-26) the 14-day
// inactive-agent deletion reminder below. Still just the two.
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

/** Sends one message.
 *
 *  `ok` means the provider returned 2xx. `id` means it returned an acceptance
 *  id for the message, which is the closest thing to a receipt available here.
 *  Neither means the mail reached an inbox — Resend can accept a message and
 *  still have it bounce, greylist or land in spam, and nothing in this system
 *  ever learns that. Callers that need proof of acceptance must check `id`,
 *  not `ok`; callers that only want best-effort delivery can use `ok`. */
export async function sendMail(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
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
  // A 2xx with no acceptance id is not an acceptance we can record. It has
  // not been seen from Resend, but treating an unparseable success as proof
  // would be exactly the kind of assumption this whole change exists to stop.
  const body = await res.json().catch(() => null)
  const id = typeof body?.id === 'string' && body.id ? body.id : undefined
  return id ? { ok: true, id } : { ok: true, error: 'mail_accepted_without_id' }
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

/** Sent to an agent approaching the 14-day inactive-auto-delete cutoff
 *  (rc_delete_inactive_agents_scheduled) — the only channel that can reach
 *  someone who hasn't opened the app in that long; an in-app banner would
 *  never be seen. daysLeft is rounded down from the same days_inactive
 *  rc_inactive_agent_candidates already computes, so it always agrees with
 *  what the cron will actually act on. */
export function bombReminderEmail(agentNo: string, handle: string, daysLeft: number) {
  const days = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`

  // /game?mode=signin, not the landing page and not /game.
  //
  // Everyone who receives this already has an agent file, so the marketing
  // landing page is the wrong destination and bare /game opens the auth screen
  // on the "Create file" tab. The param preselects "I have one" instead, and is
  // ignored entirely when a session already exists (main.js only shows the auth
  // screen when there is no stored agent), so a signed-in reader lands straight
  // in the game.
  //
  // Extensionless on purpose: /game.html 307-redirects to /game, and a redirect
  // in an email link is one more thing between a lapsed player and coming back.
  const site = 'https://hopetrackers.org'
  const returnUrl = `${site}/game?mode=signin`

  // Both names before the em dash: someone who has not opened the game in two
  // weeks needs to recognise this in a notification preview, not after opening
  // it. The old subject said only "Op: Reconnect", which meant nothing to them.
  const subject = `HopeTrackers · OP: ReConnect — ${days} left, ${agentNo}`

  const text = [
    `Hey ${agentNo} (${handle}),`,
    '',
    `Your ARMY Bomb hasn't been fed in a while, so your agent file in`,
    `OP: ReConnect is about to go quiet — ${days} left.`,
    '',
    'Coming back is all it takes. Sign in and feed your Bomb, or just stream',
    'BTS like you normally would: Auto Feed picks it up from there and your',
    'agent stays active.',
    '',
    `  Come back → ${returnUrl}`,
    '',
    "If you're done with the game, no action is needed. We just didn't want it",
    'to be a surprise — after that, the agent file and everything in it is',
    'removed.',
    '',
    '— HopeTrackers · OP: ReConnect',
    site,
  ].join('\n')

  const html = `
  <div style="background:#0a0910;color:#ece9f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px 20px">
    <div style="max-width:440px;margin:0 auto;background:#13111e;border:1px solid rgba(255,255,255,0.10);border-radius:16px;padding:28px">
      <div style="font-size:11px;letter-spacing:2px;color:#a78bfa;text-transform:uppercase;font-family:monospace">HopeTrackers &middot; OP: ReConnect</div>
      <h1 style="font-size:20px;margin:12px 0 8px">Your signal is fading</h1>
      <p style="color:#9c96b0;font-size:15px;line-height:1.6;margin:0 0 20px">
        Hey Agent <strong style="color:#ece9f2">${agentNo}</strong> (${handle}) — your ARMY Bomb hasn't been fed in a while, so your agent file is about to go quiet.
      </p>
      <div style="background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.45);border-radius:12px;padding:16px;text-align:center;margin-bottom:22px">
        <div style="font-family:monospace;font-size:22px;color:#ece9f2">${days} left</div>
        <div style="font-size:12px;color:#9c96b0;margin-top:6px">to feed your Bomb and stay active</div>
      </div>
      <div style="text-align:center;margin-bottom:22px">
        <a href="${returnUrl}" style="display:inline-block;background:#a78bfa;color:#0b0810;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px">Come back to the city</a>
      </div>
      <p style="color:#9c96b0;font-size:14px;line-height:1.6;margin:0 0 16px">
        Coming back is all it takes. Sign in and feed your Bomb, or just stream BTS like you normally would — Auto Feed handles it from there.
      </p>
      <p style="color:#635d78;font-size:12.5px;line-height:1.6;margin:0 0 20px">
        If you're done with the game, no action is needed. We just didn't want it to be a surprise — after that, the agent file and everything in it is removed.
      </p>
      <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;color:#635d78;font-size:12px;line-height:1.7">
        HopeTrackers &middot; OP: ReConnect<br>
        <a href="${site}" style="color:#8b7f9c;text-decoration:none">hopetrackers.org</a>
      </div>
    </div>
  </div>`

  return { subject, text, html }
}
