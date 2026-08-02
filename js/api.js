// Op: Reconnect API client — one keyless POST per action to the game's own
// edge function.
//
// Every call carries the stored session token (see session.js) so the server
// can prove the caller owns the agent number they're claiming. An agent
// number alone is a name, not a credential: it shows up in leaderboards and
// gets shared, so it can never be the thing that authorizes an action.
// Auth calls (register/login) run before a session exists and skip it.

import { getToken } from './session.js'

// Own Supabase project (2026-08-02) — a clean break from the S2 site's
// shared "arirang" project, same reasoning as rc_agents itself: no shared
// identity, no shared migration history to keep straight.
const API = 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect'

// Settings shows this to the player: it's the endpoint they paste into Web
// Scrobbler / Pano Scrobbler, so it can't stay private to this module.
export const API_URL = API

// Recovery runs when the player has lost the very thing a session is made
// of, so it can't require one — the code sent to their email is the proof.
const PUBLIC_ACTIONS = new Set([
  'registerAgent', 'loginAgent', 'checkHandle', 'requestPasswordReset', 'resetPassword',
])

export async function call(action, params = {}) {
  const body = { action, ...params }
  if (!PUBLIC_ACTIONS.has(action)) {
    const token = getToken()
    if (token) body.sessionToken = token
  }
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) {
    return { success: false, error: 'Network error — check your connection' }
  }
}
