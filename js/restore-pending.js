// A restored district's moment, kept until the player sees it on the
// district page.
//
// The server reports a restoration once (activeDistrict.restoredNow), on the
// refresh that finishes the district — from whatever screen the player is
// on. The XP, item and stream numbers only come in that one response, so a
// small copy is kept on this device until the district page has played it.
// Per device, like the team chat "seen" marks: a player who switches phones
// just sees the normal restored page there.

const KEY = 'rc_restore_pending'
const MAX_AGE_MS = 14 * 86400000
const MAX_ENTRIES = 8

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch { return {} }
}

function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* private mode: plays only if they're on the page */ }
}

const keyFor = (agentNo, districtId) => `${String(agentNo || '').toUpperCase()}:${districtId}`

/** Only what the restoration card shows, so the entry stays small. */
export function restoreSnapshot(d, bombCharge) {
  return {
    id: d.id,
    name: d.name,
    wardId: d.wardId,
    echoOf: d.echoOf || null,
    xpAwarded: Number.isFinite(d.xpAwarded) ? d.xpAwarded : null,
    rewardXp: Number.isFinite(d.rewardXp) ? d.rewardXp : null,
    itemDropped: d.itemDropped || null,
    backupPassDropped: !!d.backupPassDropped,
    trackGoals: (d.trackGoals || []).map((g) => ({ progress: g.progress || 0, target: g.target || 0 })),
    bombCharge: Number.isFinite(bombCharge) ? bombCharge : null,
    at: Date.now(),
  }
}

export function savePendingRestore(agentNo, d, bombCharge) {
  if (!agentNo || !d?.id) return
  const map = readAll()
  const now = Date.now()
  for (const [k, v] of Object.entries(map)) if (!v?.at || now - v.at > MAX_AGE_MS) delete map[k]
  const k = keyFor(agentNo, d.id)
  if (map[k]) return // already waiting; the first copy has the real numbers
  map[k] = restoreSnapshot(d, bombCharge)
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[stale]
  }
  writeAll(map)
}

export function peekPendingRestore(agentNo, districtId) {
  const v = readAll()[keyFor(agentNo, districtId)]
  return v && Date.now() - (v.at || 0) <= MAX_AGE_MS ? v : null
}

export function clearPendingRestore(agentNo, districtId) {
  const map = readAll()
  const k = keyFor(agentNo, districtId)
  if (!(k in map)) return
  delete map[k]
  writeAll(map)
}
