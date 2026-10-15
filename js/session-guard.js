// What a getGameState answer means for the stored session — pure, so Node can
// test it (session-guard.test.mjs); main.js acts on it.
//
//   'ok'      carry on
//   'retry'   a network error, a deploy, or the server couldn't check the
//             session (session_check_unavailable): keep the game on screen
//             and quietly try again — never sign out for these
//   'recheck' invalid_session while the game is already open: ask once more
//             after a short pause before believing it (one bad answer must
//             not throw a playing agent out)
//   'signout' the session really is gone (still invalid on the recheck, or
//             invalid at start-up), or the agent no longer exists

export const SESSION_RECHECK_MS = 4000

export const SIGNED_OUT_ELSEWHERE = 'You were signed out because this account signed in on another device or browser.'

export function sessionDecision(res, { gameOpen = false, rechecked = false } = {}) {
  if (res?.success) return 'ok'
  if (res?.error === 'agent_not_found') return 'signout'
  if (res?.error === 'invalid_session') return gameOpen && !rechecked ? 'recheck' : 'signout'
  return 'retry'
}
