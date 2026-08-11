# The test account, and how session tokens get used to verify a fix

A companion to [`bug-resolution-log.md`](./bug-resolution-log.md): that file
records *what* was wrong and *why*. This one records the *how* — the
mechanism nearly every fix in this log was actually verified against, since
"I read the code and it looks right" isn't proof, but a real authenticated
call against the real deployed backend is.

---

## The test account

**AGENT001 — handle `test`, codename `test`, email `test@gmail.com`, easy
mode.** A real row in `rc_agents`/`rc_players`, same tables and same code
path every real player uses — it's not a mock or a separate environment.
That's the point: bugs in this app live in real data shapes (join timestamps,
frozen goal snapshots, artist-breakdown JSON), and a fake in-memory stand-in
would test a different, simpler world than the one the bug actually lives in.

It exists so a bug can be reproduced and a fix verified end-to-end — real
HTTP call, real auth check, real database round trip — **without ever
touching a real player's account, session, or data.**

**Hard rule: never mint a session token for a real player's `AGENTnnn` row.**
`rc_agents.session_token` is a single slot per account (see below) — writing
a fresh one to force your way in would silently invalidate whatever token
that player's own phone currently holds, logging them out with no warning.
AGENT001 is the ONLY account this is ever done to.

---

## How sessions actually work here (`lib/auth.ts`)

- Each `rc_agents` row carries exactly one live `session_token` (opaque,
  `crypto.randomUUID()` ×2 concatenated) and one `session_expires_at` (90
  days out). Logging in **replaces** the old token — one active session per
  account, every other device silently signed out. This is also *why*
  minting one for a real account is destructive, not just risky.
- `verifySession(supabase, agentNo, sessionToken)` is the gate: every action
  in `index.ts`'s route table marked `auth: 'agent'` checks that the token
  sent with the request matches the row's current `session_token` exactly,
  hasn't expired, and the account isn't retired. Fails closed on any
  mismatch.
- The frontend just stores whatever `{agentNo, sessionToken}` login returned
  in `localStorage` under the key `rc_agent` (`js/session.js`) and echoes it
  back on every call (`js/api.js`). No cookies, no header scheme — the token
  travels as a normal field in the JSON body, same as any other param.

---

## The actual verification loop

Every "reproduce this, then verify the fix" step in the bug log followed the
same four moves:

**1. Mint a session directly in the database**, bypassing the login form
entirely (no password needed, and it doesn't touch `rc_auth_attempts`
throttling):

```sql
update rc_agents
set session_token = 'test-' || gen_random_uuid()::text,
    session_expires_at = now() + interval '1 hour'
where agent_no = 'AGENT001';
```

A short expiry (an hour, not the real 90 days) is deliberate — it self-heals
if a cleanup step ever gets forgotten.

**2. Call the real, deployed backend** with that token — `curl` against the
production endpoint is the usual path when the check doesn't need a UI at
all (a specific handler's return value, a specific error code):

```bash
curl -s -X POST https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect \
  -H 'Content-Type: application/json' \
  -d '{"action":"getReconnectMission","agentNo":"AGENT001","sessionToken":"test-...","districtId":"..."}'
```

— or, when the bug is specifically about what renders (a combo-check
rejecting a valid pick, a checkbox's escaped `value` attribute), the same
token gets injected straight into the *browser's* `localStorage` instead, so
the real client code runs against the real backend:

```js
localStorage.setItem('rc_agent', JSON.stringify({
  agentNo: 'AGENT001', sessionToken: 'test-...',
}))
location.reload()
```

Either way, this is what "verified against a live reproduction" in the bug
log actually means — not reading the code and reasoning it should work, but
watching the real request take the real code path and produce the real
(broken, or later fixed) result.

**3. Re-run the identical call after deploying the fix** and diff the two
responses. If the fix is a resolution-order/logic change (most of them:
`findMyMission`/`findMyCompletedMission` priority, the Candy Star combo
check, `countTrack`'s artist filter), this step is the actual proof it
works — not a guess that the new code "should" behave differently.

**4. Clean up immediately after, every time:**

```sql
update rc_agents set session_token = null, session_expires_at = null
where agent_no = 'AGENT001';
```

Plus deleting anything the reproduction created that wouldn't naturally
belong on a real "test" account afterward — a mission opened just to test
`openReconnectMission`'s guard, a message posted to prove `sendReconnectMessage`
works, an item row. AGENT001 stays empty between sessions on purpose: the
next person (or the next debugging session) who uses it shouldn't have to
guess which of its rows are real test fixtures and which are load-bearing.

---

## Where this showed up in the bug log

A few concrete examples, cross-referenced to
[`bug-resolution-log.md`](./bug-resolution-log.md):

- **Candy Star's apostrophe bug** — reproduced by first sending the exact
  client request with a hand-cleaned `trackKeys` array (succeeded, proving
  the server-side matching logic was fine) and then the real, DOM-read value
  straight from a live page with AGENT001 logged in (failed) — the diff
  between those two calls is what proved the bug was in what the *client*
  sent, before a single line of `candy-star.js` was even opened.
- **Reconnect mission accept/invite guards** (`already_paired_elsewhere`,
  `already_completed`) — each new guard was called directly with AGENT001
  placed into the exact edge-case shape it exists to catch (two open
  memberships, an already-complete mission for the same goal) to confirm it
  actually returns the new error code instead of silently no-op'ing.
- **XP curve rounding** — less a session-token case and more a plain read:
  levels were recomputed against AGENT001's own live `xp` value at a few
  different levels to confirm the `+1e-9` fix changed the *displayed*
  number, not just the isolated formula.

Real player agent numbers appear throughout the bug log itself (AGENT015,
AGENT030, AGENT044, ...) — those were always **read-only** direct SQL
(`select ... from rc_reconnect_missions ...`), never a minted session. A
real player's own account is only ever read from or repaired via data
patches, never signed into.
