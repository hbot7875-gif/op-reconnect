// Who gets warned that their agent file is about to be deleted, and what the
// warning says. Pure — no database, no mailer — so every edge can be tested.
//
// The shape of the problem: rc_delete_inactive_agents_scheduled deletes at 14
// days of inactivity, counted from the last ARMY Bomb feed and reduced by any
// approved leave. This picks the people approaching that line and works out how
// long they have left.
//
// The band is deliberately BOUNDED at both ends. Below minDays there is nothing
// to warn about yet. At or above maxDays the sweep is entitled to delete them
// on its next run, and emailing "you have 0 days left" to someone whose file
// may already be gone by the time they read it is worse than not writing.

/** Days of inactivity at which the deletion sweep acts. */
export const DELETE_AT_DAYS = 14

/** Default warning band: from 9 days inactive up to (not including) 14. */
export const DEFAULT_MIN_DAYS = 9
export const DEFAULT_MAX_DAYS = DELETE_AT_DAYS

const int = (v, fallback) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

/**
 * @param candidates rows from rc_inactive_agent_candidates: { agent_no, days_inactive }
 * @param agents     rows from rc_agents: { agent_no, handle, email }
 * @param warnings   rows from rc_inactivity_warnings: { agent_no, last_attempt_at }
 * @returns { toSend, skipped, outOfBand, suppressed }
 */
export function reminderPlan({ candidates = [], agents = [], warnings = [], minDays, maxDays, withinHours = 20, now = Date.now() } = {}) {
  const lo = Math.max(0, int(minDays, DEFAULT_MIN_DAYS))
  const hi = Math.max(lo + 1, int(maxDays, DEFAULT_MAX_DAYS))

  const byAgent = new Map()
  for (const a of agents || []) {
    if (a && a.agent_no) byAgent.set(String(a.agent_no), a)
  }

  // Last ATTEMPT, not last success: a failed send still counts against the
  // suppression window, so a broken mailbox cannot be retried every few
  // minutes by a job that runs twice.
  const attemptedAt = new Map()
  for (const w of warnings || []) {
    if (!w || !w.agent_no) continue
    const t = w.last_attempt_at ? new Date(w.last_attempt_at).getTime() : 0
    if (t > 0) attemptedAt.set(String(w.agent_no), t)
  }

  const toSend = []
  const skipped = []
  const outOfBand = []
  const suppressed = []

  for (const row of candidates || []) {
    const agentNo = String(row?.agent_no || '')
    if (!agentNo) continue
    const days = Number(row?.days_inactive)

    // Not a number, or outside the band. A candidate at or past the deletion
    // threshold is the sweep's business, not ours.
    if (!Number.isFinite(days) || days < lo || days >= hi) { outOfBand.push(agentNo); continue }

    // An agent the purge has already removed can still appear in a stale
    // candidate list; there is nobody left to email.
    const agent = byAgent.get(agentNo)
    const email = String(agent?.email || '').trim()
    if (!agent || !email) { skipped.push(agentNo); continue }

    // Already written to recently. This is what stops a double-run of the
    // scheduled job emailing the same person twice in a morning.
    const last = attemptedAt.get(agentNo)
    if (last && now - last < Math.max(0, withinHours) * 3_600_000) { suppressed.push(agentNo); continue }

    // Always at least 1: "0 days left" reads as already-too-late, and rounding
    // could otherwise produce it for someone with hours still to go.
    const daysLeft = Math.max(1, Math.round(hi - days))
    toSend.push({ agentNo, email, handle: String(agent.handle || agentNo), daysLeft })
  }

  return { toSend, skipped, outOfBand, suppressed }
}

/** How many days of silence the warning band can survive before someone can
 *  cross from un-warned to deleted without ever being written to.
 *
 *  This USED to be the whole risk. It is now a delay rather than a loss: the
 *  deletion gate refuses to remove an account with a usable address until a
 *  warning has actually been delivered, so an outage postpones deletions
 *  instead of letting them happen unannounced. */
export function outageToleranceDays(minDays = DEFAULT_MIN_DAYS, maxDays = DEFAULT_MAX_DAYS) {
  return Math.max(0, maxDays - minDays)
}

/** Days after a delivered warning before the sweep may act, and how long a
 *  delivered warning stays valid. Must match rc_warning_notice_days() and
 *  rc_warning_valid_days() in the migration. */
export const NOTICE_DAYS = 2
export const WARNING_VALID_DAYS = 45

/** Whether the deletion sweep may remove this account yet.
 *
 *  Mirrors the SQL gate exactly so the two cannot disagree about what
 *  "warned" means. An account with no usable address is deletable on time —
 *  there is no warning to send, and holding it would keep the data longer
 *  rather than less. */
export function mayDelete({ email, lastWarnedAt, now = Date.now() } = {}) {
  if (!String(email || '').trim()) return { ok: true, reason: 'no_address_to_warn' }
  const at = lastWarnedAt ? new Date(lastWarnedAt).getTime() : 0
  if (!(at > 0)) return { ok: false, reason: 'never_warned' }
  const ageDays = (now - at) / 86_400_000
  if (ageDays < NOTICE_DAYS) return { ok: false, reason: 'warning_too_recent' }
  if (ageDays > WARNING_VALID_DAYS) return { ok: false, reason: 'warning_lapsed' }
  return { ok: true, reason: 'warned' }
}
