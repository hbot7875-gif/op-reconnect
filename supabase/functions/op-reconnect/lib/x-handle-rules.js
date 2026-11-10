// The optional X (Twitter) username on an agent file (rc_agents.x_handle).
// Shared by the sign-up form, Settings, the team roster and the server, so
// all of them agree on what a valid X username is.
//
// X's own rule: 1–15 characters, letters, digits and underscore. A leading @
// is accepted and stripped. Stored lowercase because X usernames are
// case-insensitive, the same shape rc_agent_x_handles uses for voting.

export const X_HANDLE_RE = /^[a-z0-9_]{1,15}$/

/** raw → { ok: true, value: 'name' | null } (null = left blank / cleared)
 *  or { ok: false, error: 'x_handle_invalid' }. */
export function normalizeXHandle(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  const h = String(raw).trim().replace(/^@/, '').toLowerCase()
  if (!h) return { ok: true, value: null }
  if (!X_HANDLE_RE.test(h)) return { ok: false, error: 'x_handle_invalid' }
  return { ok: true, value: h }
}

export function xProfileUrl(handle) {
  const r = normalizeXHandle(handle)
  return r.ok && r.value ? `https://x.com/${r.value}` : null
}

export const X_HANDLE_HINT = 'Up to 15 letters, numbers or underscores.'

// Same rule as auth.ts's HANDLE_RE (the account name, rc_agents.handle).
export const ACCOUNT_HANDLE_RE = /^[a-zA-Z0-9._]{3,30}$/

/** Sign-up: Instagram or X, at least one. The Instagram username stays the
 *  account name when given (as before); with only X, the X username is the
 *  account name and handleSource says so, so the team roster never shows it
 *  as an Instagram link.
 *  → { ok: true, handle, handleSource: 'instagram' | 'x', xHandle } or
 *    { ok: false, error, field: 'ig' | 'x' }. */
export function pickAccountHandle({ handle, xHandle } = {}) {
  const ig = String(handle ?? '').trim().replace(/^@/, '')
  const x = normalizeXHandle(xHandle)
  if (!x.ok) return { ok: false, error: x.error, field: 'x' }
  if (ig) {
    if (!ACCOUNT_HANDLE_RE.test(ig)) return { ok: false, error: 'handle_invalid', field: 'ig' }
    return { ok: true, handle: ig, handleSource: 'instagram', xHandle: x.value }
  }
  if (!x.value) return { ok: false, error: 'handle_required', field: 'ig' }
  if (x.value.length < 3) return { ok: false, error: 'x_handle_short', field: 'x' }
  return { ok: true, handle: x.value, handleSource: 'x', xHandle: x.value }
}
