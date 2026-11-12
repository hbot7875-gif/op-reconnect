// Pure rules behind the admin dashboard (admin.html). Kept outside the page
// so each promise the dashboard makes is testable in Node:
//
//   - deletion eligibility comes only from adminCleanupPreview, which runs the
//     scheduled job's own rule (rc_inactive_agent_deletion_preview: charge or
//     verified vote, minus leave, plus the email/warning gate) and deletes
//     nothing — the dashboard never touches the deletion endpoint,
//   - ReConnect quests are grouped by district with statuses and stages taken
//     from the stored quest rows, never estimated,
//   - leave rows get a status from their real dates only.
//
// Nothing here calls the network except fetchCleanupPreview, which takes the
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

export const CLEANUP_ACTION = 'adminCleanupPreview'

/** The read-only cleanup preview (no parameters to get wrong). */
export async function fetchCleanupPreview(call) {
  const res = await call(CLEANUP_ACTION, {})
  if (!res || !res.success || !Array.isArray(res.agents)) return { ok: false, error: res?.error || 'Could not load the cleanup preview' }
  return { ok: true, agents: res.agents }
}

/** Next time the given UTC hour comes round, as a Date. */
export function nextUtcHour(hour, now = Date.now()) {
  const d = new Date(now)
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour)
  return new Date(at > now ? at : at + DAY_MS)
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

/** Where a 14+ day agent with an email stands on the warning gate. */
export function warningState(p, now = Date.now()) {
  if (!p?.hasEmail) return null
  if (!p.lastWarnedAt) return p.lastDeliveryOk === false ? 'delivery_failed' : 'not_warned'
  const warned = new Date(p.lastWarnedAt).getTime()
  if (warned < now - CLEANUP.warningValidDays * DAY_MS) return 'warning_lapsed'
  if (warned > now - CLEANUP.warningNoticeDays * DAY_MS) return 'notice_period'
  return 'warned'
}

/** One row per roster agent with its cleanup position.
 *
 *  state:
 *    'delete_next_run'   the preview's `eligible` — the job's own rule
 *    'notice_period'     14+ days, warned under 2 days ago (eligibleFrom says when)
 *    'needs_warning'     14+ days with an email but no valid delivered warning
 *                        (never sent, failed, or older than 45 days) — the
 *                        09:00 reminder job handles these; not deletable
 *    'at_risk'           9–13 days on the leave-adjusted clock
 *    'leave_paused'      9+ days by the raw clock but under 9 after leave
 *    'ok' | 'protected' | 'retired'
 *    'unconfirmed'       9+ raw days while the preview could not be read
 *
 *  `preview` is null when the preview failed — then nothing is eligible. */
export function cleanupRows(roster = [], preview = null, now = Date.now()) {
  const byAgent = new Map((preview?.agents || []).map((c) => [c.agentNo, c]))
  return roster.map((a) => {
    const raw = num(a.daysInactive ?? a.daysSinceFeed) ?? 0
    const sinceCharge = num(a.daysSinceFeed) ?? 0
    const p = byAgent.get(a.agentNo) || null
    const adjusted = p ? num(p.daysInactive) : null
    let state
    if (a.retiredAt) state = 'retired'
    else if (a.agentNo === 'AGENT001') state = 'protected'
    else if (!preview) state = raw >= CLEANUP.atRiskFromDays ? 'unconfirmed' : 'ok'
    else if (p?.eligible) state = 'delete_next_run'
    else if (p && adjusted >= CLEANUP.inactiveDays) state = warningState(p, now) === 'notice_period' ? 'notice_period' : 'needs_warning'
    else if (p) state = 'at_risk'
    else if (raw >= CLEANUP.atRiskFromDays) state = 'leave_paused'
    else state = 'ok'
    return {
      agent: a, state, preview: p, warning: p ? warningState(p, now) : null,
      hasEmail: p ? !!p.hasEmail : !!a.email, rawDays: raw, sinceCharge, adjustedDays: adjusted,
      leaveDays: adjusted != null ? Math.max(0, Math.round((raw - adjusted) * 10) / 10) : null,
      notCharged: !a.retiredAt && a.agentNo !== 'AGENT001' && sinceCharge >= CLEANUP.inactiveDays,
    }
  })
}

export const AGENT_GROUPS = ['delete', 'warning', 'charge', 'risk']

export function agentGroup(rows, key) {
  if (key === 'delete') return rows.filter((r) => r.state === 'delete_next_run')
  if (key === 'warning') return rows.filter((r) => r.state === 'notice_period' || r.state === 'needs_warning')
  if (key === 'charge') return rows.filter((r) => r.notCharged)
  if (key === 'risk') return rows.filter((r) => r.state === 'at_risk')
  return rows
}

export function agentGroupCounts(rows) {
  return Object.fromEntries(AGENT_GROUPS.map((k) => [k, agentGroup(rows, k).length]))
}

export const CLEANUP_LABELS = {
  delete_next_run: 'Deletes next run',
  notice_period: 'Notice period',
  needs_warning: 'Needs warning',
  leave_paused: 'Paused by leave',
  unconfirmed: 'Not confirmed',
  at_risk: 'At risk',
  ok: 'Healthy',
  protected: 'Protected',
  retired: 'Retired',
}

export const WARNING_LABELS = {
  not_warned: 'No warning sent yet',
  delivery_failed: 'Last warning failed to deliver',
  warning_lapsed: 'Last warning is over 45 days old',
  notice_period: 'Warned; 2-day notice running',
  warned: 'Warned 2–45 days ago',
}

/* ── ReConnect quests ────────────────────────────────────────────────── */

// adminListReconnectQuests gives every quest (open, completed, cancelled,
// expired) with its stored stage; adminListStuckReconnects gives the health
// flags and team-fill suggestions for the open ones. buildQuestItems merges
// the two by mission id; solo puzzle cases come from health alone.
export const QUEST_STATUSES = {
  waiting: 'Waiting for teammates',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
}
export const QUEST_LIST_ACTION = 'adminListReconnectQuests'
export const QUEST_DETAIL_ACTION = 'adminGetReconnectQuest'

const hasFlag = (item, f) => (item?.flags || []).includes(f)

export function buildQuestItems(quests = [], cases = []) {
  const health = new Map(cases.filter((c) => c.missionId).map((c) => [c.missionId, c]))
  const items = quests.map((q) => {
    const h = health.get(q.missionId) || null
    const joined = q.members.filter((m) => m.status === 'joined')
    const invited = q.members.filter((m) => m.status === 'invited' && !m.inviteLapsed)
    return {
      ...(h || {}),
      kind: 'mission', missionId: q.missionId, districtId: q.districtId, districtName: q.districtName,
      goalId: q.goalId, goalLabel: q.goalLabel, requiredAgents: q.requiredAgents,
      quest: q, health: h,
      flags: h ? h.flags : [],
      agents: h ? h.agents : joined.map((m) => ({ agentNo: m.agentNo, codename: m.codename })),
      invites: h ? h.invites : invited.map((m) => ({ agentNo: m.agentNo, codename: m.codename, waitingSince: m.joinedAt })),
      missingSeats: Math.max(0, q.requiredAgents - joined.length),
      pendingInvites: invited.length,
      missionExpiresAt: q.expiresAt,
      districtExpiresAt: h?.districtExpiresAt || null,
      waitingSince: h?.waitingSince || q.createdAt,
      closedAt: q.completedAt || (q.status === 'expired' ? q.expiresAt : null),
    }
  })
  const listed = new Set(quests.map((q) => q.missionId))
  for (const c of cases) if (!c.missionId || !listed.has(c.missionId)) items.push({ ...c, health: c, quest: null })
  return items
}

export function questStatus(item) {
  const q = item?.quest
  if (q) {
    if (q.status === 'completed' || q.status === 'cancelled' || q.status === 'expired') return q.status
    return Number(item.missingSeats) > 0 || Number(item.pendingInvites) > 0 ? 'waiting' : 'active'
  }
  if (hasFlag(item, 'expired')) return 'expired'
  if (item?.kind === 'mission' && (Number(item.missingSeats) > 0 || Number(item.pendingInvites) > 0)) return 'waiting'
  return 'active'
}

/** Only open quests with a health case can need the admin. */
export function questNeedsAdmin(item) {
  if (!item?.health) return false
  // Still open in the table (an expired-but-unsettled quest included) — the
  // health check's own flags decide; closed quests never need the admin.
  if (item.quest && item.quest.storedStatus !== 'open') return false
  return reconnectAdminBucket(item.health) === 'action'
}

export function questReason(item) {
  const q = item?.quest
  if (q?.status === 'completed') return 'Completed'
  if (q?.status === 'cancelled') return 'Cancelled'
  if (q?.status === 'expired') return `Expired with ${q.members.filter((m) => m.status === 'joined').length}/${q.requiredAgents} joined`
  if (item?.health) return reconnectPlainReason(item.health)
  return 'No teammate is still restoring this district'
}

/** The stored stage the quest is on (or stopped at), for the table. */
export function questCurrentStage(item) {
  const stages = item?.quest?.stages
  if (!stages) return item?.health && hasFlag(item.health, 'puzzle_blocked') ? 'Puzzle locked' : 'Puzzle'
  const s = stages.find((x) => x.state === 'current' || x.state === 'stopped')
  if (!s) return 'Completed'
  return s.key === 'cipher' ? `Cipher ${String(s.detail || '').split(' ·')[0]}` : s.label
}

/** The earliest real deadline on an open case: the district attempt or the
 *  mission's own expiry, whichever comes first. Closed quests have none. */
export function questDeadline(item) {
  if (item?.quest && item.quest.status !== 'open') return null
  const times = [item?.districtExpiresAt, item?.missionExpiresAt].filter(Boolean).map((t) => new Date(t).getTime())
  return times.length ? new Date(Math.min(...times)).toISOString() : null
}

export function questMatches(item, query = '') {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const people = item.quest ? item.quest.members : [...(item.agents || []), ...(item.invites || [])]
  return [item.districtName, item.districtId, item.goalLabel, ...people.flatMap((a) => [a.agentNo, a.codename])]
    .some((v) => String(v || '').toLowerCase().includes(q))
}

export function questFilter(item, filter = 'all') {
  if (filter === 'all') return true
  if (filter === 'attention') return questNeedsAdmin(item)
  if (filter === 'open') return ['waiting', 'active'].includes(questStatus(item))
  return questStatus(item) === filter
}

const ts = (iso, missing) => (iso ? new Date(iso).getTime() : missing)
const isOpen = (i) => ['waiting', 'active'].includes(questStatus(i))
const OPEN_FIRST = (a, b) => Number(isOpen(b)) - Number(isOpen(a))
const QUEST_SORTS = {
  deadline: (a, b) => OPEN_FIRST(a, b) || ts(questDeadline(a), Infinity) - ts(questDeadline(b), Infinity) || ts(b.closedAt, 0) - ts(a.closedAt, 0),
  waiting: (a, b) => OPEN_FIRST(a, b) || ts(a.waitingSince, Infinity) - ts(b.waitingSince, Infinity),
  attention: (a, b) => Number(questNeedsAdmin(b)) - Number(questNeedsAdmin(a)) || QUEST_SORTS.deadline(a, b),
  district: (a, b) => QUEST_SORTS.deadline(a, b),
}

/** District accordions: filtered, searched and sorted. */
export function questDistricts(items = [], { query = '', filter = 'all', sort = 'deadline' } = {}) {
  const cmp = QUEST_SORTS[sort] || QUEST_SORTS.deadline
  const map = new Map()
  for (const item of items) {
    if (!questFilter(item, filter) || !questMatches(item, query)) continue
    const key = item.districtId || item.districtName
    if (!map.has(key)) map.set(key, { districtId: item.districtId, districtName: item.districtName || item.districtId, items: [] })
    map.get(key).items.push(item)
  }
  const byName = (a, b) => String(a.districtName).localeCompare(String(b.districtName))
  const districts = [...map.values()].map((d) => {
    d.items.sort(cmp)
    const counts = { waiting: 0, active: 0, completed: 0, cancelled: 0, expired: 0, attention: 0 }
    for (const item of d.items) {
      counts[questStatus(item)] += 1
      if (questNeedsAdmin(item)) counts.attention += 1
    }
    const deadlines = d.items.map((i) => ts(questDeadline(i), Infinity))
    const waits = d.items.filter(isOpen).map((i) => ts(i.waitingSince, Infinity))
    return { ...d, counts, earliestDeadline: Math.min(...deadlines), oldestWait: waits.length ? Math.min(...waits) : Infinity }
  })
  const dcmp = {
    deadline: (a, b) => a.earliestDeadline - b.earliestDeadline || byName(a, b),
    waiting: (a, b) => a.oldestWait - b.oldestWait || byName(a, b),
    attention: (a, b) => b.counts.attention - a.counts.attention || a.earliestDeadline - b.earliestDeadline || byName(a, b),
    district: byName,
  }[sort] || ((a, b) => a.earliestDeadline - b.earliestDeadline || byName(a, b))
  return districts.sort(dcmp)
}

export function questStatusCounts(items = []) {
  const counts = { all: items.length, attention: 0, open: 0, waiting: 0, active: 0, completed: 0, cancelled: 0, expired: 0 }
  for (const item of items) {
    const s = questStatus(item)
    counts[s] += 1
    if (s === 'waiting' || s === 'active') counts.open += 1
    if (questNeedsAdmin(item)) counts.attention += 1
  }
  return counts
}

/** Seats joined / required — real participant rows. */
export function questProgress(item) {
  const joined = item?.quest ? item.quest.members.filter((m) => m.status === 'joined').length : (item?.agents || []).length
  const required = Math.max(1, Number(item?.requiredAgents) || 1)
  return { joined, required, invited: Number(item?.pendingInvites) || (item?.invites || []).length }
}

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
