// MAMA Battle recruit links: /battle?team=aliens → "Join ALIENS" →
// /game?screen=voting&team=aliens. The team is remembered on this device
// (through sign-in and onboarding) so the 7-second chooser can mark it as
// "Your invite". It only marks a button: the agent still taps their side,
// and nothing about who shared the link exists anywhere.
import { teamFromQuery } from './battle-share-rules.js'

const KEY = 'rc_battle_invite'
const KEEP_MS = 14 * 86_400_000

/** At boot: keep a ?team= from the URL, if there is one. */
export function rememberInvite(search, storage, now = Date.now()) {
  const team = teamFromQuery(search)
  if (!team) return null
  try { storage.setItem(KEY, JSON.stringify({ team, at: now })) } catch { /* private mode: no invite mark */ }
  return team
}

/** The remembered invite team, or null once it is old or unreadable. */
export function readInvite(storage, now = Date.now()) {
  try {
    const v = JSON.parse(storage.getItem(KEY) || 'null')
    return v && teamFromQuery(`team=${v.team}`) && now - Number(v.at) < KEEP_MS ? v.team : null
  } catch {
    return null
  }
}

/** Once a side is chosen, the invite has done its job. */
export function clearInvite(storage) {
  try { storage.removeItem(KEY) } catch { /* nothing kept */ }
}
