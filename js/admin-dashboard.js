// Pure rules behind the admin dashboard (admin.html). Kept outside the page
// so each promise the dashboard makes is testable in Node:
//
//   - deletion eligibility is shown only when the real rule confirms it
//     (rc_inactive_agent_candidates via the dry run + the email/warning gate
//     of rc_delete_inactive_agents_scheduled),
//   - the dry run can never be a real delete,
//   - ReConnect quests are grouped by district with statuses taken from the
//     backend's own flags, never estimated,
//   - leave rows get a status from their real dates only.
//
// Nothing here calls the network except fetchDeletionPreview, which takes the
// page's `call` so the request it makes can be asserted.

import { reconnectAdminBucket, reconnectPlainReason } from './reconnect-admin-ui.js'

const DAY_MS = 86_400_000

/* ── Cleanup rule ────────────────────────────────────────────────────── */

// Mirrors the database: the 14-day default of rc_inactive_agent_candidates
// and rc_delete_inactive_agents_scheduled, the 09:00 / 18:00 UTC jobs, and
// rc_warning_notice_days() / rc_warning_valid_days(). Display only.
export const CLEANUP = Object.freeze({
  inactiveDays: 14,
  atRiskFromDays: 9,
  reminderHourUtc: 9,
  deleteHourUtc: 18,
  warningNoticeDays: 2,
  warningValidDays: 45,
})

export const DRY_RUN_ACTION = 'adminDeleteInactiveAgents'

/** The ONLY way the dashboard asks the deletion endpoint anything. The
 *  request always carries dryRun: true, and an answer that does not say it
 *  was a dry run is thrown away rather than shown. */
export async function fetchDeletionPreview(call) {
  const res = await call(DRY_RUN_ACTION, Object.freeze({ dryRun: true, inactiveDays: CLEANUP.inactiveDays }))
  if (!res || !res.success) return { ok: false, error: res?.error || 'Could not load the cleanup preview' }
  if (res.dryRun !== true || !Array.isArray(res.candidates)) return { ok: false, error: 'Cleanup preview was not a dry run' }
  return { ok: true, candidates: res.candidates }
}

/** Next time the given UTC hour comes round, as a Date. */
export function nextUtcHour(hour, now = Date.now()) {
  const d = new Date(now)
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour)
  return new Date(at > now ? at : at + DAY_MS)
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

/** One row per roster agent with its cleanup position.
 *
 *  state:
 *    'delete_next_run'   candidate (14+ days after leave, votes counted) AND
 *                        no email address — the scheduled job deletes these
 *    'warning_unknown'   candidate WITH an email — deleted only 2–45 days after
 *                        a delivered warning, which the admin API does not
 *                        expose, so this is never called eligible
 *    'leave_paused'      14+ days by the raw clock but not a candidate: the
 *                        only difference between the two clocks is leave
 *    'at_risk'           raw clock 9–13 days
 *    'ok' | 'protected' | 'retired'
 *
 *  `preview` is null when the dry run failed — then nothing is eligible and
 *  the 14+ rows read 'unconfirmed'. */
export function cleanupRows(roster = [], preview = null) {
  const byAgent = new Map((preview?.candidates || []).map((c) => [c.agentNo, c]))
  return roster.map((a) => {
    const raw = num(a.daysInactive ?? a.daysSinceFeed) ?? 0
    const sinceCharge = num(a.daysSinceFeed) ?? 0
    const cand = byAgent.get(a.agentNo) || null
    const hasEmail = !!a.email
    let state
    if (a.retiredAt) state = 'retired'
    else if (a.agentNo === 'AGENT001') state = 'protected'
    else if (cand) state = hasEmail ? 'warning_unknown' : 'delete_next_run'
    else if (raw >= CLEANUP.inactiveDays) state = preview ? 'leave_paused' : 'unconfirmed'
    else if (raw >= CLEANUP.atRiskFromDays) state = 'at_risk'
    else state = 'ok'
    const adjusted = cand ? num(cand.daysInactive) : null
    return {
      agent: a, state, hasEmail, rawDays: raw, sinceCharge,
      adjustedDays: adjusted,
      leaveDays: adjusted != null ? Math.max(0, Math.round((raw - adjusted) * 10) / 10) : null,
      notCharged: !a.retiredAt && a.agentNo !== 'AGENT001' && sinceCharge >= CLEANUP.inactiveDays,
    }
  })
}

export const AGENT_GROUPS = ['delete', 'warning', 'charge', 'risk']

export function agentGroup(rows, key) {
  if (key === 'delete') return rows.filter((r) => r.state === 'delete_next_run')
  if (key === 'warning') return rows.filter((r) => r.state === 'warning_unknown')
  if (key === 'charge') return rows.filter((r) => r.notCharged)
  if (key === 'risk') return rows.filter((r) => r.state === 'at_risk')
  return rows
}

export function agentGroupCounts(rows) {
  return Object.fromEntries(AGENT_GROUPS.map((k) => [k, agentGroup(rows, k).length]))
}

export const CLEANUP_LABELS = {
  delete_next_run: 'Deletes next run',
  warning_unknown: 'Warning unknown',
  leave_paused: 'Paused by leave',
  unconfirmed: 'Not confirmed',
  at_risk: 'At risk',
  ok: 'Healthy',
  protected: 'Protected',
  retired: 'Retired',
}

/* ── ReConnect quests ────────────────────────────────────────────────── */

// Completed and cancelled exist as statuses, but adminListStuckReconnects
// returns open missions only, so no quest is ever given either of them here.
export const QUEST_STATUSES = {
  waiting: 'Waiting for teammates',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}
export const QUEST_UNAVAILABLE_STATUSES = ['completed', 'cancelled']

const hasFlag = (item, f) => (item?.flags || []).includes(f)

export function questStatus(item) {
  if (hasFlag(item, 'expired')) return 'expired'
  if (item?.kind === 'mission' && (Number(item.missingSeats) > 0 || Number(item.pendingInvites) > 0)) return 'waiting'
  return 'active'
}

export function questNeedsAdmin(item) {
  return reconnectAdminBucket(item) === 'action'
}

/** The earliest real deadline on the case: the district attempt or the
 *  mission's own expiry, whichever comes first. */
export function questDeadline(item) {
  const times = [item?.districtExpiresAt, item?.missionExpiresAt].filter(Boolean).map((t) => new Date(t).getTime())
  return times.length ? new Date(Math.min(...times)).toISOString() : null
}

export function questMatches(item, query = '') {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return [item.districtName, item.districtId, item.goalLabel,
    ...(item.agents || []).flatMap((a) => [a.agentNo, a.codename]),
    ...(item.invites || []).flatMap((a) => [a.agentNo, a.codename])]
    .some((v) => String(v || '').toLowerCase().includes(q))
}

export function questFilter(item, filter = 'all') {
  if (filter === 'all') return true
  if (filter === 'attention') return questNeedsAdmin(item)
  return questStatus(item) === filter
}

const ts = (iso, missing) => (iso ? new Date(iso).getTime() : missing)
const QUEST_SORTS = {
  deadline: (a, b) => ts(questDeadline(a), Infinity) - ts(questDeadline(b), Infinity),
  waiting: (a, b) => ts(a.waitingSince, Infinity) - ts(b.waitingSince, Infinity),
  attention: (a, b) => Number(questNeedsAdmin(b)) - Number(questNeedsAdmin(a)) || QUEST_SORTS.deadline(a, b),
  district: (a, b) => QUEST_SORTS.deadline(a, b),
}

/** District accordions: filtered, searched and sorted. */
export function questDistricts(cases = [], { query = '', filter = 'all', sort = 'deadline' } = {}) {
  const cmp = QUEST_SORTS[sort] || QUEST_SORTS.deadline
  const map = new Map()
  for (const item of cases) {
    if (!questFilter(item, filter) || !questMatches(item, query)) continue
    const key = item.districtId || item.districtName
    if (!map.has(key)) map.set(key, { districtId: item.districtId, districtName: item.districtName || item.districtId, items: [] })
    map.get(key).items.push(item)
  }
  const districts = [...map.values()].map((d) => {
    d.items.sort(cmp)
    const counts = { waiting: 0, active: 0, expired: 0, attention: 0 }
    for (const item of d.items) {
      counts[questStatus(item)] += 1
      if (questNeedsAdmin(item)) counts.attention += 1
    }
    const deadlines = d.items.map((i) => ts(questDeadline(i), Infinity))
    const waits = d.items.map((i) => ts(i.waitingSince, Infinity))
    return { ...d, counts, earliestDeadline: Math.min(...deadlines), oldestWait: Math.min(...waits) }
  })
  const dcmp = {
    deadline: (a, b) => a.earliestDeadline - b.earliestDeadline,
    waiting: (a, b) => a.oldestWait - b.oldestWait,
    attention: (a, b) => b.counts.attention - a.counts.attention || a.earliestDeadline - b.earliestDeadline,
    district: (a, b) => String(a.districtName).localeCompare(String(b.districtName)),
  }[sort] || ((a, b) => a.earliestDeadline - b.earliestDeadline)
  return districts.sort(dcmp)
}

export function questStatusCounts(cases = []) {
  const counts = { all: cases.length, attention: 0, waiting: 0, active: 0, expired: 0 }
  for (const item of cases) {
    counts[questStatus(item)] += 1
    if (questNeedsAdmin(item)) counts.attention += 1
  }
  return counts
}

/** Seats joined / required and members streamed / joined — the two numbers
 *  the backend actually reports. No stage is inferred from them. */
export function questProgress(item) {
  const joined = (item?.agents || []).length
  const required = Math.max(1, Number(item?.requiredAgents) || 1)
  const streamed = (item?.agents || []).filter((a) => a.streamed === true).length
  const streamKnown = item?.kind === 'mission'
  return { joined, required, invited: (item?.invites || []).length, streamed, streamKnown }
}

export { reconnectPlainReason as questReason }

/* ── Leaves ─────────────────────────────────────────────────────────── */

/** Status from the row's own dates (ended_at wins over ends_at, the same
 *  rule as rc_active_leave). */
export function leaveStatus(row, now = Date.now()) {
  const start = new Date(row.startsAt).getTime()
  const plannedEnd = new Date(row.endsAt).getTime()
  const end = row.endedAt ? new Date(row.endedAt).getTime() : plannedEnd
  if (start > now) return 'upcoming'
  if (end > now) return 'active'
  if (row.endedAt && end < plannedEnd) return 'ended_early'
  return 'completed'
}

export const LEAVE_STATUS_LABELS = { active: 'On leave', upcoming: 'Upcoming', ended_early: 'Ended early', completed: 'Completed' }

export function leaveDurationDays(row) {
  const end = new Date(row.endedAt || row.endsAt).getTime()
  return Math.max(0, Math.round(((end - new Date(row.startsAt).getTime()) / DAY_MS) * 10) / 10)
}

export function leaveRows(rows = [], { query = '', filter = 'all', sort = 'start_desc', now = Date.now() } = {}) {
  const q = String(query || '').trim().toLowerCase()
  const list = rows.map((r) => ({ ...r, status: leaveStatus(r, now), days: leaveDurationDays(r) }))
    .filter((r) => filter === 'all'
      || (filter === 'past' ? (r.status === 'completed' || r.status === 'ended_early') : r.status === filter))
    .filter((r) => !q || [r.agentNo, r.codename].some((v) => String(v || '').toLowerCase().includes(q)))
  const by = {
    start_desc: (a, b) => new Date(b.startsAt) - new Date(a.startsAt),
    start_asc: (a, b) => new Date(a.startsAt) - new Date(b.startsAt),
    end_asc: (a, b) => new Date(a.endedAt || a.endsAt) - new Date(b.endedAt || b.endsAt),
    duration: (a, b) => b.days - a.days,
    agent: (a, b) => String(a.agentNo).localeCompare(String(b.agentNo), undefined, { numeric: true }),
  }[sort] || ((a, b) => new Date(b.startsAt) - new Date(a.startsAt))
  return list.sort(by)
}

export function leaveCounts(rows = [], now = Date.now()) {
  const c = { all: rows.length, active: 0, upcoming: 0, past: 0 }
  for (const r of rows) {
    const s = leaveStatus(r, now)
    if (s === 'active') c.active += 1
    else if (s === 'upcoming') c.upcoming += 1
    else c.past += 1
  }
  return c
}

/** The read-only action the Leaves view asks for. It does not exist on the
 *  backend yet; a "not found" answer means "unavailable", never "no leaves". */
export const LEAVES_ACTION = 'adminListLeaves'
export function leavesUnavailable(res) {
  return !res?.success && /not found/i.test(String(res?.error || ''))
}
