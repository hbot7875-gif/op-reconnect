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

// Where the Postgres instance lives (supabase/.temp/pooler-url: aws-1-ap-northeast-2).
const DB_REGION = 'ap-northeast-2'

export async function call(action, params = {}) {
  const body = { action, ...params }
  if (!PUBLIC_ACTIONS.has(action)) {
    const token = getToken()
    if (token) body.sessionToken = token
  }
  try {
    const res = await fetch(API, {
      method: 'POST',
      // Pin the Edge Function to the database's region. Without this the
      // function runs nearest the caller (ap-south-1 for most agents) and
      // every one of getGameState's ~120 sequential queries pays a
      // Mumbai↔Seoul round trip: measured 12.5s per poll vs 4.2s pinned.
      headers: { 'Content-Type': 'application/json', 'x-region': DB_REGION },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) {
    return { success: false, error: 'Network error — check your connection' }
  }
}
