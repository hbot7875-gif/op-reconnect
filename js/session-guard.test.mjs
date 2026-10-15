// Session survival: a database blip on the server's session check is
// "try again", never "signed out"; one invalid_session while playing gets a
// second look; a real one (this account signed in elsewhere) signs out with
// a reason. Plus the sign-in form leaving the page and the phone blur fix.
// The full browser flow (resume, network drop, recheck, sign-in again) was
// also run against the real main.js with a scripted fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sessionCheck } from '../supabase/functions/op-reconnect/lib/session-check.js'
import { sessionDecision, SESSION_RECHECK_MS, SIGNED_OUT_ELSEWHERE } from './session-guard.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const ROW = { session_token: 'tok-1', session_expires_at: '2027-01-01T00:00:00Z', retired_at: null }
const NOW = Date.parse('2026-10-16T00:00:00Z')

test('server: a database error is "unavailable", never "invalid"', () => {
  assert.equal(sessionCheck({ row: null, error: { message: 'failed to connect' } }, 'tok-1', NOW), 'unavailable')
  assert.equal(sessionCheck({ row: ROW, error: { message: 'timeout' } }, 'tok-1', NOW), 'unavailable')
})

test('server: right token ok; wrong, missing, expired, retired or no agent are invalid', () => {
  assert.equal(sessionCheck({ row: ROW, error: null }, 'tok-1', NOW), 'ok')
  assert.equal(sessionCheck({ row: ROW, error: null }, 'tok-2', NOW), 'invalid', 'signed in elsewhere: the token rotated')
  assert.equal(sessionCheck({ row: ROW, error: null }, '', NOW), 'invalid')
  assert.equal(sessionCheck({ row: ROW, error: null }, undefined, NOW), 'invalid')
  assert.equal(sessionCheck({ row: null, error: { message: 'x' } }, null, NOW), 'invalid', 'no token is invalid whatever the database says')
  assert.equal(sessionCheck({ row: { ...ROW, session_expires_at: '2026-10-15T00:00:00Z' }, error: null }, 'tok-1', NOW), 'invalid')
  assert.equal(sessionCheck({ row: { ...ROW, session_expires_at: null }, error: null }, 'tok-1', NOW), 'ok', 'no expiry column value = no expiry')
  assert.equal(sessionCheck({ row: { ...ROW, retired_at: '2026-10-01T00:00:00Z' }, error: null }, 'tok-1', NOW), 'invalid')
  assert.equal(sessionCheck({ row: null, error: null }, 'tok-1', NOW), 'invalid')
  assert.equal(sessionCheck({ row: { ...ROW, session_token: null }, error: null }, 'tok-1', NOW), 'invalid')
})

test('server: the router answers 503 "try again" for unavailable, 401 only for invalid', () => {
  const idx = read('../supabase/functions/op-reconnect/index.ts')
  assert.match(idx, /if \(session === 'unavailable'\) return jsonResponse\(\{ success: false, error: 'session_check_unavailable', retryable: true \}, 503\)/)
  assert.match(idx, /if \(session !== 'ok'\) return jsonResponse\(\{ success: false, error: 'invalid_session' \}, 401\)/)
  const auth = read('../supabase/functions/op-reconnect/lib/auth.ts')
  assert.match(auth, /const \{ data, error \} = await supabase\.from\('rc_agents'\)/, 'the error is read, not dropped')
  assert.match(auth, /\} catch \{\s*return 'unavailable'/)
  assert.match(auth, /\.update\(\{ session_token: sessionToken,/, 'single session per account is unchanged: sign-in still rotates the token')
})

test('game: what each getGameState answer means', () => {
  assert.equal(sessionDecision({ success: true }, { gameOpen: true }), 'ok')
  for (const error of ['Network error — check your connection', 'session_check_unavailable', 'http_502', undefined])
    assert.equal(sessionDecision({ success: false, error }, { gameOpen: true }), 'retry', String(error))
  assert.equal(sessionDecision(null, { gameOpen: true }), 'retry')
  assert.equal(sessionDecision({ success: false, error: 'invalid_session' }, { gameOpen: true }), 'recheck', 'one bad answer while playing: look again')
  assert.equal(sessionDecision({ success: false, error: 'invalid_session' }, { gameOpen: true, rechecked: true }), 'signout', 'still invalid: really signed out')
  assert.equal(sessionDecision({ success: false, error: 'invalid_session' }, { gameOpen: false }), 'signout', 'at start-up there is no game to protect')
  assert.equal(sessionDecision({ success: false, error: 'agent_not_found' }, { gameOpen: true }), 'signout')
  assert.ok(SESSION_RECHECK_MS >= 2000 && SESSION_RECHECK_MS <= 10000)
  assert.equal(SIGNED_OUT_ELSEWHERE, 'Your session ended. This can happen if this account was signed in on another device or browser.')
})

test('game: a second-browser sign-in plays out as recheck → sign out with the reason', () => {
  // The other browser rotated the token, so every answer is invalid now.
  let rechecked = false
  const first = sessionDecision({ success: false, error: 'invalid_session' }, { gameOpen: true, rechecked })
  assert.equal(first, 'recheck')
  rechecked = true
  assert.equal(sessionDecision({ success: false, error: 'invalid_session' }, { gameOpen: true, rechecked }), 'signout')
  // A one-off (transient) invalid answer followed by a good one keeps playing.
  assert.equal(sessionDecision({ success: true }, { gameOpen: true, rechecked: true }), 'ok')
})

test('main.js wiring: retry keeps the game, recheck waits, sign-out explains; the sign-in screen is not redrawn under the player', () => {
  const src = read('./main.js')
  assert.match(src, /const decision = sessionDecision\(res, \{ gameOpen: !!getState\(\)\?\.joined, rechecked: sessionRechecked \}\)/)
  assert.match(src, /sessionRecheck = setTimeout\(\(\) => \{ sessionRecheck = null; refresh\(\) \}, SESSION_RECHECK_MS\)/)
  assert.match(src, /showAuth\(res\?\.error === 'invalid_session' \? \{ notice: SIGNED_OUT_ELSEWHERE \} : \{\}\)/)
  assert.match(src, /if \(!agentNo\) \{ if \(\$\('auth'\)\.hidden\) showAuth\(\); return \}/)
  const body = src.slice(src.indexOf('async function refresh'), src.indexOf('\nrefresh()'))
  assert.equal((body.match(/clearSession\(\)/g) || []).length, 1, 'one place clears the session in refresh()')
  const signout = body.slice(body.indexOf("if (decision === 'signout')"))
  assert.match(signout.slice(0, signout.indexOf('return')), /clearSession\(\)/, '…and it is inside the sign-out branch')
})

test('sign-in form leaves the page once past it; notice opens on sign-in', () => {
  const src = read('./main.js')
  assert.match(src, /if \(id !== 'auth'\) \$\('auth'\)\.replaceChildren\(\)/)
  const auth = read('./ui-auth.js')
  assert.match(auth, /export function renderAuth\(container, onAuthed, opts = \{\}\)/)
  assert.match(auth, /const notice = el\('p', 'auth-notice', opts\.notice\)\s*notice\.setAttribute\('role', 'status'\)/)
  assert.match(auth, /selectTab\(wantsSignIn \|\| opts\.notice \? 'old' : 'new'\)/)
})

test('phones: no backdrop blur on the panels over the animated City scene', () => {
  const css = read('../css/reconnect.css')
  const block = css.slice(css.lastIndexOf('@media (max-width: 640px) {'))
  for (const sel of ['.core-health', '.mission-beacon', '.stage-agents']) {
    assert.match(block, new RegExp(`${sel.replace('.', '\\.')}[^{]*\\{[^}]*backdrop-filter: none; -webkit-backdrop-filter: none;`), sel)
  }
  assert.match(css, /\.auth-notice \{/)
})
