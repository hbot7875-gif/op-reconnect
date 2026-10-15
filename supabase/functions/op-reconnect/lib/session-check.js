// The session check's decision, apart from any I/O so Node can test it
// (js/session-guard.test.mjs). auth.ts reads the agent row and asks this.
//
//   'ok'          the token matches, hasn't expired, the agent isn't retired
//   'invalid'     no token, wrong token, expired, retired or no such agent
//   'unavailable' the row couldn't be read (a database or network blip):
//                 says nothing about the token, so the caller must answer
//                 "try again", never "signed out"
export function sessionCheck({ row, error }, sessionToken, now = Date.now()) {
  if (!sessionToken || typeof sessionToken !== 'string') return 'invalid'
  if (error) return 'unavailable'
  if (!row || !row.session_token || row.session_token !== sessionToken) return 'invalid'
  if (row.session_expires_at && new Date(row.session_expires_at).getTime() <= now) return 'invalid'
  // A retired agent's session_token is cleared the moment they retire (see
  // retireAccount); this is a second gate for a token already in flight.
  if (row.retired_at) return 'invalid'
  return 'ok'
}
