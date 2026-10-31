// Pure rules for bomb-nudge-popup.js (testable in Node).
//
// Charging the ARMY Bomb is the only thing that resets the 14-day clock the
// nightly cleanup deletes agent files by (feedHealth, agent-charge.ts) —
// voting and streaming don't. So an agent who hasn't charged gets a popup on
// day 6 (once per dark spell) and on day 13 (once per KST day, the last day).

const SEEN_KEY = 'rc_seen_bomb_nudge:'

const kstDay = (now) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** 6, 13 or null: which warning `feedHealth` is at. */
export function bombNudgeStage(feedHealth) {
  const d = Number(feedHealth?.daysSinceFeed)
  const left = Number(feedHealth?.daysLeft)
  if (!Number.isFinite(d) || !Number.isFinite(left) || left <= 0) return null
  if (d >= 13) return 13
  if (d >= 6) return 6
  return null
}

const seenKey = (agentNo, feedHealth, stage, now) =>
  `${SEEN_KEY}${agentNo}:${feedHealth.lastFedAt || ''}:${stage}${stage === 13 ? `:${kstDay(now)}` : ''}`

/** The stage due now and not yet shown on this device. Storage failing reads
 *  as "seen", so a broken store never repeats the popup on every poll. */
export function bombNudgeDue(feedHealth, { agentNo, storage, now = new Date() } = {}) {
  const stage = bombNudgeStage(feedHealth)
  if (!agentNo || !stage) return null
  try { return storage.getItem(seenKey(agentNo, feedHealth, stage, now)) !== '1' ? stage : null } catch (_) { return null }
}

export function markBombNudgeSeen(storage, agentNo, feedHealth, stage, now = new Date()) {
  try { storage.setItem(seenKey(agentNo, feedHealth, stage, now), '1') } catch (_) {}
}

export function bombNudgeCopy(stage, feedHealth) {
  const days = Math.max(0, Math.floor(Number(feedHealth?.daysSinceFeed) || 0))
  const left = Math.max(1, Math.ceil(Number(feedHealth?.daysLeft) || 1))
  if (stage === 13) {
    return {
      tone: 'err',
      eyebrow: 'ARMY Bomb · last day',
      title: 'Charge your ARMY Bomb today',
      body: `${days} days without charging. If it isn't charged by tomorrow, your agent file and everything on it is deleted. Use the Charge Cells you got as rewards to charge it.`,
      action: 'Charge my Bomb now',
    }
  }
  return {
    tone: 'warn',
    eyebrow: 'ARMY Bomb',
    title: 'Your ARMY Bomb needs charging',
    body: `It's been ${days} days since you last charged it. Charge it within ${left} day${left === 1 ? '' : 's'}: after 14 days without charging, your agent file is deleted. Use the Charge Cells you got as rewards to charge it.`,
    action: 'Charge my Bomb',
  }
}
