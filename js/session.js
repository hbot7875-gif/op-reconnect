// Agent session for Op: Reconnect.
//
// This season has its own accounts (migration 016), and the old Mission
// Control dashboard is still live on its own login. So the two MUST NOT share
// a storage key — signing into one would otherwise overwrite the other and
// leave both broken. The old site owns `arirang_agent`; this one owns
// `rc_agent` and never touches the other.

const KEY = 'rc_agent'

export function getSession() {
  try {
    const saved = localStorage.getItem(KEY)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

export function getAgentNo() {
  return getSession()?.agentNo || null
}

export function getToken() {
  return getSession()?.sessionToken || null
}

export function setSession(agent) {
  localStorage.setItem(KEY, JSON.stringify({
    agentNo: agent.agentNo || agent.agent_no,
    handle: agent.handle || null,
    email: agent.email || null,
    sessionToken: agent.sessionToken || agent.session_token || null,
  }))
}

/** Changing or resetting a password rotates the token server-side, which
 *  signs out every other device — including this one, unless the new token
 *  replaces the stored one right away. */
export function setToken(sessionToken) {
  const current = getSession()
  if (!current) return
  localStorage.setItem(KEY, JSON.stringify({ ...current, sessionToken }))
}

export function clearSession() {
  localStorage.removeItem(KEY)
}
