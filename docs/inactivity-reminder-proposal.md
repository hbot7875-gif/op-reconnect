# Inactivity reminder — proposed revision

**PROPOSAL ONLY. Not wired in, not deployed, nothing sent.** `mailer.ts` is
unchanged and the next scheduled send at 09:00 UTC would still use the current
wording unless this is approved first.

## What the current email gets wrong

Three recipients received it at 09:00 UTC today. Reading it as they would:

- **"HopeTrackers" appears nowhere.** Not the subject, body, HTML or footer.
  The only identification is "Op: Reconnect · HQ", which means nothing to
  someone who signed up weeks ago and has not opened the game since — which is,
  by definition, everyone who gets this email.
- **No link.** Nothing says where to go. The email asks them to sign in and
  then does not say where.
- **The threat dominates.** A red-bordered box, the largest text in the email,
  saying "N days left" over "then your agent file is permanently deleted".
  Combined with an unfamiliar sender and no brand name, it reads like phishing.

The revision keeps every fact and changes the emphasis: the action first, the
deadline as context, the consequence stated once and plainly.

---

## Proposed subject

```
HopeTrackers · OP: ReConnect — 2 days left, AGENT071
```

Both names before the em dash, so it is recognisable in a notification preview
without opening. The agent number is last because it is the least useful thing
for deciding whether to open it.

*(the number varies: "1 day left" / "4 days left" — singular handled)*

---

## Proposed plain-text body

```
Hey AGENT071 (thats._riaa),

Your ARMY Bomb hasn't been fed in a while, so your agent file in
OP: ReConnect is about to go quiet — 2 days left.

Coming back is all it takes. Sign in and feed your Bomb, or just stream
BTS like you normally would: Auto Feed picks it up from there and your
agent stays active.

  Come back → https://hopetrackers.org

If you're done with the game, no action is needed. We just didn't want it
to be a surprise — after that, the agent file and everything in it is
removed.

— HopeTrackers · OP: ReConnect
https://hopetrackers.org
```

---

## Proposed HTML, as it reads on screen

```
  HOPETRACKERS · OP: RECONNECT                    (eyebrow, monospace, purple)

  Your signal is fading                           (heading)

  Hey Agent AGENT071 (thats._riaa) — your ARMY Bomb hasn't been fed in a
  while, so your agent file is about to go quiet.

  ┌──────────────────────────────────────────┐
  │              2 days left                 │   (purple card, not red)
  │   to feed your Bomb and stay active      │
  └──────────────────────────────────────────┘

           ┌────────────────────────┐
           │   Come back to the city │            (purple button →
           └────────────────────────┘             https://hopetrackers.org)

  Coming back is all it takes. Sign in and feed your Bomb, or just stream
  BTS like you normally would — Auto Feed handles it from there.

  If you're done with the game, no action is needed. We just didn't want it
  to be a surprise — after that, the agent file and everything in it is
  removed.

  ──────────────────────────────────────────
  HopeTrackers · OP: ReConnect
  hopetrackers.org
```

### What changed, and why

| Change | Reason |
|---|---|
| "HopeTrackers" in subject, eyebrow and sign-off | The requirement, and the fix for the phishing read |
| Button to `https://hopetrackers.org` | The old email asked them to sign in without saying where |
| Alert box red → purple, smaller | It was the loudest thing on screen; now the button is |
| "permanently deleted" → "removed", stated once, in the footer paragraph | Kept as a fact, demoted from the headline |
| Box subtitle is the action, not the threat | "to feed your Bomb and stay active" instead of "then your agent file is permanently deleted" |
| "Hey" opener | The old one opened "Agent AGENT071," like a summons |
| Agent number **and** handle kept | So they know which account, per the requirement |
| "no action is needed" kept, verbatim in meaning | Requirement |

---

## The code, for review

Replaces `bombReminderEmail` in `supabase/functions/op-reconnect/lib/mailer.ts`.
**Not applied.**

```ts
export function bombReminderEmail(agentNo: string, handle: string, daysLeft: number) {
  const days = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`
  const site = 'https://hopetrackers.org'

  // Both names up front: someone who has not opened the game in two weeks
  // needs to recognise this in a notification preview, not after opening it.
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
    `  Come back → ${site}`,
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
        <a href="${site}" style="display:inline-block;background:#a78bfa;color:#0b0810;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:9px;font-size:15px">Come back to the city</a>
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
```

---

## Before this ships

The wording is only half the recognisability problem. The other half is the
`From:` header, which this file cannot change — see the accompanying report.
An email that says HopeTrackers in the body but arrives from an unrecognised
address is still going to read as suspicious.
