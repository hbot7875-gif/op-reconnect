/** Pure badge-progress rules shared with Node regression tests. */

function ratio(value, target) {
  const safeTarget = Number(target) || 0
  if (safeTarget <= 0) return 0
  return Math.max(0, Math.min(1, (Number(value) || 0) / safeTarget))
}

/** Each frozen district goal has equal weight. A 100-play track and a
 * one-pass album therefore each contribute one completed goal, matching the
 * board's player-facing goal list instead of letting large numeric targets
 * drown out smaller ones. */
export function districtBadgeProgress(progress, reconnect = null) {
  const parts = [
    ...(progress?.trackGoals || []).map((g) => ratio(g.progress, g.target)),
    ...(progress?.albums || []).map((a) => ratio(a.passesDone, a.target)),
  ]
  if (reconnect) parts.push(reconnect.done ? 1 : 0)

  const percent = parts.length
    ? Math.round((parts.reduce((sum, value) => sum + value, 0) / parts.length) * 100)
    : 0
  const templateIds = []
  if (percent >= 25) templateIds.push('district_frag_1')
  if (percent >= 50) templateIds.push('district_frag_2')
  if (percent >= 75) templateIds.push('district_frag_3')
  return { percent, templateIds }
}
