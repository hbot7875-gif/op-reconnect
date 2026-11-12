import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CLEANUP, DRY_RUN_ACTION, fetchDeletionPreview, nextUtcHour, cleanupRows, agentGroup, agentGroupCounts,
  questStatus, questNeedsAdmin, questDeadline, questDistricts, questStatusCounts, questProgress,
  leaveStatus, leaveDurationDays, leaveRows, leaveCounts, leavesUnavailable,
} from './admin-dashboard.js'

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8')

/* ── the dry run can never delete ───────────────────────────────────── */

test('the cleanup preview always asks for a dry run of the 14-day rule', async () => {
  const calls = []
  const call = async (action, params) => { calls.push([action, params]); return { success: true, dryRun: true, count: 0, candidates: [] } }
  const res = await fetchDeletionPreview(call)
  assert.deepEqual(calls, [[DRY_RUN_ACTION, { dryRun: true, inactiveDays: 14 }]])
  assert.ok(Object.isFrozen(calls[0][1]), 'params cannot be edited on the way out')
  assert.equal(res.ok, true)
})

test('an answer that is not a dry run is discarded', async () => {
  const res = await fetchDeletionPreview(async () => ({ success: true, dryRun: false, deletedCount: 3 }))
  assert.equal(res.ok, false)
  const failed = await fetchDeletionPreview(async () => ({ success: false, error: 'Unauthorized' }))
  assert.deepEqual(failed, { ok: false, error: 'Unauthorized' })
})

test('admin.html reaches the deletion endpoint only through the dry-run helper', () => {
  assert.equal((html.match(/adminDeleteInactiveAgents/g) || []).length, 0)
  assert.match(html, /fetchDeletionPreview\(call\)/)
  assert.doesNotMatch(html, /dryRun\s*:\s*false/)
})

test('next job times are the next 09:00 and 18:00 UTC', () => {
  const now = Date.parse('2026-11-12T12:00:00Z')
  assert.equal(nextUtcHour(18, now).toISOString(), '2026-11-12T18:00:00.000Z')
  assert.equal(nextUtcHour(9, now).toISOString(), '2026-11-13T09:00:00.000Z')
  assert.equal(CLEANUP.warningNoticeDays, 2)
  assert.equal(CLEANUP.warningValidDays, 45)
})

/* ── eligibility only when the real rule confirms it ────────────────── */

const roster = [
  { agentNo: 'AGENT214', email: null, daysInactive: 16.2, daysSinceFeed: 16.2 },
  { agentNo: 'AGENT187', email: 'pa***@gmail.com', daysInactive: 15.1, daysSinceFeed: 15.1 },
  { agentNo: 'AGENT122', email: 'no***@gmail.com', daysInactive: 18, daysSinceFeed: 18 },
  { agentNo: 'AGENT240', email: null, daysInactive: 11.2, daysSinceFeed: 19.4, lastVoteAt: '2026-11-01T00:00:00Z' },
  { agentNo: 'AGENT050', email: null, daysInactive: 2, daysSinceFeed: 2 },
  { agentNo: 'AGENT001', email: null, daysInactive: 40, daysSinceFeed: 40 },
  { agentNo: 'AGENT009', email: null, daysInactive: 40, daysSinceFeed: 40, retiredAt: '2026-10-01T00:00:00Z' },
]
const preview = { ok: true, candidates: [
  { agentNo: 'AGENT214', daysInactive: 16.2 },
  { agentNo: 'AGENT187', daysInactive: 14.6 },
] }

test('only no-email candidates are eligible; email holders wait on an unseen warning', () => {
  const rows = cleanupRows(roster, preview)
  const state = Object.fromEntries(rows.map((r) => [r.agent.agentNo, r.state]))
  assert.deepEqual(state, {
    AGENT214: 'delete_next_run', AGENT187: 'warning_unknown', AGENT122: 'leave_paused',
    AGENT240: 'at_risk', AGENT050: 'ok', AGENT001: 'protected', AGENT009: 'retired',
  })
  assert.deepEqual(agentGroupCounts(rows), { delete: 1, warning: 1, charge: 4, risk: 1 })
  assert.equal(rows.find((r) => r.agent.agentNo === 'AGENT187').leaveDays, 0.5)
})

test('a vote within 14 days keeps a never-charging agent off the deletion list', () => {
  const rows = cleanupRows(roster, preview)
  const voter = rows.find((r) => r.agent.agentNo === 'AGENT240')
  assert.equal(voter.notCharged, true)
  assert.notEqual(voter.state, 'delete_next_run')
})

test('without a dry-run answer nobody is shown as eligible', () => {
  const rows = cleanupRows(roster, null)
  assert.equal(agentGroup(rows, 'delete').length, 0)
  assert.equal(agentGroup(rows, 'warning').length, 0)
  assert.equal(rows.find((r) => r.agent.agentNo === 'AGENT214').state, 'unconfirmed')
})

/* ── ReConnect: statuses from flags only ────────────────────────────── */

const NOW = Date.parse('2026-11-12T12:00:00Z')
const iso = (h) => new Date(NOW + h * 3600e3).toISOString()
const cases = [
  { kind: 'mission', districtId: 'bell', districtName: 'Bell Tower', goalLabel: 'Connect', requiredAgents: 2, missingSeats: 1, pendingInvites: 0,
    flags: ['deadline_soon', 'needs_people'], suggestedAgentNos: ['A1', 'A2'], agents: [{ agentNo: 'A1', codename: 'Paper Moon', streamed: false }],
    invites: [], districtExpiresAt: iso(18), missionExpiresAt: iso(30), waitingSince: iso(-144) },
  { kind: 'mission', districtId: 'bell', districtName: 'Bell Tower', goalLabel: 'Connect', requiredAgents: 2, missingSeats: 0, pendingInvites: 0,
    flags: ['active'], agents: [{ agentNo: 'A3', codename: 'Star Ferry', streamed: true }, { agentNo: 'A4', codename: 'Gold Ribbon', streamed: false }],
    invites: [], districtExpiresAt: iso(120), missionExpiresAt: iso(100), waitingSince: iso(-24) },
  { kind: 'mission', districtId: 'old', districtName: 'Old Station', goalLabel: 'Connect', requiredAgents: 2, missingSeats: 1, pendingInvites: 0,
    flags: ['expired', 'needs_people'], agents: [{ agentNo: 'A5', codename: 'Tin Planet', streamed: false }], invites: [],
    districtExpiresAt: iso(-6), missionExpiresAt: iso(-6), waitingSince: iso(-200) },
  { kind: 'puzzle', districtId: 'harbor', districtName: 'Harbor Line', goalLabel: 'Cipher', requiredAgents: 1, missingSeats: 0, pendingInvites: 0,
    flags: ['puzzle_blocked'], agents: [{ agentNo: 'A6', codename: 'North Lantern' }], invites: [], districtExpiresAt: iso(48), waitingSince: iso(-48) },
]

test('quest status comes from the backend flags', () => {
  assert.deepEqual(cases.map(questStatus), ['waiting', 'active', 'expired', 'active'])
  assert.deepEqual(cases.map(questNeedsAdmin), [true, false, true, true])
  assert.equal(questDeadline(cases[1]), iso(100))
  assert.deepEqual(questStatusCounts(cases), { all: 4, attention: 3, waiting: 1, active: 2, expired: 1 })
})

test('quests group by district, filter, search and sort', () => {
  const all = questDistricts(cases)
  assert.deepEqual(all.map((d) => d.districtName), ['Old Station', 'Bell Tower', 'Harbor Line'])
  assert.deepEqual(all[1].counts, { waiting: 1, active: 1, expired: 0, attention: 1 })
  assert.deepEqual(questDistricts(cases, { sort: 'district' }).map((d) => d.districtName), ['Bell Tower', 'Harbor Line', 'Old Station'])
  assert.deepEqual(questDistricts(cases, { query: 'gold ribbon' }).map((d) => d.items.length), [1])
  assert.equal(questDistricts(cases, { filter: 'completed' }).length, 0)
  assert.deepEqual(questDistricts(cases, { filter: 'attention' }).flatMap((d) => d.items).length, 3)
})

test('progress is only what the backend reports — no inferred stage', () => {
  assert.deepEqual(questProgress(cases[1]), { joined: 2, required: 2, invited: 0, streamed: 1, streamKnown: true })
  assert.equal(questProgress(cases[3]).streamKnown, false)
})

/* ── Leaves ──────────────────────────────────────────────────────────── */

const leaves = [
  { agentNo: 'AGENT122', codename: 'North Lantern', startsAt: iso(-24 * 11), endsAt: iso(24 * 3), endedAt: null },
  { agentNo: 'AGENT098', codename: 'Soft Thunder', startsAt: iso(-24 * 30), endsAt: iso(-24 * 16), endedAt: null },
  { agentNo: 'AGENT077', codename: 'Kite', startsAt: iso(-24 * 20), endsAt: iso(-24 * 6), endedAt: iso(-24 * 15) },
  { agentNo: 'AGENT060', codename: 'Later', startsAt: iso(24), endsAt: iso(24 * 5), endedAt: null },
]

test('leave status follows the row dates, ended_at first', () => {
  assert.deepEqual(leaves.map((l) => leaveStatus(l, NOW)), ['active', 'completed', 'ended_early', 'upcoming'])
  assert.equal(leaveDurationDays(leaves[2]), 5)
  assert.deepEqual(leaveCounts(leaves, NOW), { all: 4, active: 1, upcoming: 1, past: 2 })
  assert.deepEqual(leaveRows(leaves, { filter: 'past', now: NOW, sort: 'agent' }).map((l) => l.agentNo), ['AGENT077', 'AGENT098'])
  assert.deepEqual(leaveRows(leaves, { query: 'lantern', now: NOW }).map((l) => l.agentNo), ['AGENT122'])
})

test('a missing leaves action reads as unavailable, not as no leaves', () => {
  assert.equal(leavesUnavailable({ success: false, error: 'Action "adminListLeaves" not found' }), true)
  assert.equal(leavesUnavailable({ success: true, leaves: [] }), false)
})

/* ── the page itself ─────────────────────────────────────────────────── */

const script = html.slice(html.indexOf('<script type="module">'))
const handler = (anchor) => script.slice(script.indexOf(anchor), script.indexOf(anchor) + 1600)

test('consequential actions confirm before they call the backend', () => {
  for (const [anchor, action] of [
    ["$('btnLaunchRZ').onclick", "call('launchDefuse'"],
    ["$('btnSendBroadcast').onclick", "call('adminCreateBroadcast'"],
    ["list.querySelectorAll('.adm-list-del')", "call('adminDeleteBroadcast'"],
    [".querySelector('.vma-approve-btn').onclick", "call('adminReviewVmaVote'"],
    [".querySelector('.vma-reject-btn').onclick", "call('adminReviewVmaVote'"],
  ]) {
    const body = handler(anchor)
    const ask = body.indexOf('confirmAction(')
    assert.ok(ask > 0 && ask < body.indexOf(action), `${anchor} confirms first`)
  }
  assert.match(script, /mountVotingReview\(\$\('panel-voting'\), call, \{ confirm: confirmAction \}\)/)
})

test('the existing confirmations are all still there', () => {
  for (const text of ['Randomly assign missions for "${goal.label}"?', 'Delete "${goal.label}" for good?',
    'is already a goal${dupe.active', 'is already an album goal${dupeAlbum.active', 'Permanently delete ${agent.handle} (${agent.agentNo})?']) {
    assert.ok(script.includes(text), text)
  }
  assert.match(script, /<h3>Confirm this team\?<\/h3>/)
  assert.doesNotMatch(script, /[^.\w]confirm\(/, 'no native confirm() left; every prompt uses the styled dialog')
})

test('the confirm dialog only says yes from its confirm button', () => {
  assert.match(script, /\$\('admConfirmOk'\)\.onclick = \(\) => settleConfirm\?\.\(true\)/)
  for (const no of [/\$\('admConfirmCancel'\)\.onclick = \(\) => settleConfirm\?\.\(false\)/,
    /addEventListener\('cancel', \(e\) => \{ e\.preventDefault\(\); settleConfirm\?\.\(false\) \}\)/,
    /addEventListener\('close', \(\) => settleConfirm\?\.\(false\)\)/]) assert.match(script, no)
})

test('Leaves is in the sidebar and the mobile More sheet, and leave is read-only', () => {
  assert.match(html, /id="admNav"[\s\S]*?data-view="leaves"/)
  assert.match(html, /id="admMore"[\s\S]*?data-view="leaves"/)
  assert.doesNotMatch(script, /startLeave|endLeave/)
  // the bottom bar holds five fixed slots, no scrolling tab strip
  const bottom = html.slice(html.indexOf('id="admBottomNav"'), html.indexOf('</nav>', html.indexOf('id="admBottomNav"')))
  assert.equal((bottom.match(/data-view="/g) || []).length, 5)
})
