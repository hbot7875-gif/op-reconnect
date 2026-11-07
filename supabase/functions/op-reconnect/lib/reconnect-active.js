// Who is worth inviting to a ReConnect team — pure rules, shared by
// reconnect-missions.ts and the district screen (and Node tests).
//
// The voting battle brought in agents who came only to vote: they sit on a
// district, never stream, and an invite to them just waits out its 24 hours.
// So the invite list shows an agent only when they have BOTH opened the app
// and streamed recently. One alone isn't enough: last_seen_at only moves on a
// real app request, while raw_streams is written by the hourly sync whether
// or not the agent ever opens anything (see feed.ts's markOnline).

export const INVITE_ACTIVE_DAYS = 3

const DAY_MS = 86_400_000

/** Whole KST days between two 'YYYY-MM-DD' dates. */
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)

/** Is this agent active enough to list? `lastSeenAt` is rc_players.last_seen_at;
 *  `lastStreamDay` the newest KST day with raw_streams > 0, or null. */
export function isActiveForInvite({ lastSeenAt, lastStreamDay }, nowMs, todayKst) {
  const seen = lastSeenAt ? Date.parse(lastSeenAt) : NaN
  if (!Number.isFinite(seen) || nowMs - seen > INVITE_ACTIVE_DAYS * DAY_MS) return false
  if (!lastStreamDay) return false
  return daysBetween(lastStreamDay, todayKst) <= INVITE_ACTIVE_DAYS
}

/** Online first, then whoever streamed most recently, then longest waiting. */
export function rankInviteCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    if (a.streamedDaysAgo !== b.streamedDaysAgo) return a.streamedDaysAgo - b.streamedDaysAgo
    if (a.waitingSince && b.waitingSince) return a.waitingSince.localeCompare(b.waitingSince)
    if (a.waitingSince) return -1
    if (b.waitingSince) return 1
    return a.codename.localeCompare(b.codename)
  })
}

export const streamedDaysAgo = (lastStreamDay, todayKst) => Math.max(0, daysBetween(lastStreamDay, todayKst))

/** 0 → 'Streamed today'. */
export function streamedLabel(days) {
  if (days === 0) return 'Streamed today'
  if (days === 1) return 'Streamed yesterday'
  return `Streamed ${days} days ago`
}
