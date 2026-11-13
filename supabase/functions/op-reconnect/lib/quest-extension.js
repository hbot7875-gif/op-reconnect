// A district Extension Charge (extendDistrictDeadline) buys the whole attempt
// more time, and the attempt's ReConnect quest is part of that attempt. The
// quest row carries its own 7-day clock from creation (rc_reconnect_missions.
// expires_at), which the extension never touched, so an extended agent's quest
// still lapsed days before the district it gates (AGENT247, 2026-11-13: quest
// 14 Nov 11:57 vs district 16 Nov 20:05).
//
// Rule: the quest gets the same extra time the attempt got, but never runs
// past the attempt's new deadline, and is never shortened. Pure, so the rule
// is testable without a database.

/** The quest's new expiry, or null when it should stay as it is. */
export function extendedQuestExpiry(expiresAt, extraMs, attemptDeadline) {
  const current = new Date(expiresAt).getTime()
  const cap = new Date(attemptDeadline).getTime()
  if (!Number.isFinite(current) || !Number.isFinite(cap) || !(extraMs > 0)) return null
  const next = Math.min(current + extraMs, cap)
  return next > current ? new Date(next).toISOString() : null
}
