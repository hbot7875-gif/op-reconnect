// Per-mission, per-device unread state for ReConnect Team Chat. The backend
// supplies a count of messages from OTHER teammates; opening the chat marks
// that total seen. This mirrors ARMY Comms without mixing the two channels.
const SEEN_KEY = 'rc_reconnect_chat_seen'

function seenMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch { return {} }
}

export function getReconnectChatSeen(missionId) {
  return Number(seenMap()[String(missionId)]) || 0
}

export function markReconnectChatSeen(missionId, count) {
  const id = String(missionId || '')
  if (!id) return
  const total = Math.max(0, Number(count) || 0)
  try {
    const map = seenMap()
    if ((Number(map[id]) || 0) >= total) return
    map[id] = total
    const ids = Object.keys(map)
    if (ids.length > 16) for (const stale of ids.slice(0, ids.length - 16)) delete map[stale]
    localStorage.setItem(SEEN_KEY, JSON.stringify(map))
  } catch { /* Private mode: leaving the hint visible is harmless. */ }
}

export function reconnectChatUnreadCount(total, seen) {
  return Math.max(0, (Number(total) || 0) - (Number(seen) || 0))
}

export function reconnectChatBadgeText(count) {
  const n = Math.max(0, Number(count) || 0)
  if (!n) return ''
  return n > 9 ? '9+' : String(n)
}
