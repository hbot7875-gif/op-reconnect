import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CLEANUP, CLEANUP_ACTION, fetchCleanupPreview, nextUtcHour, cleanupRows, agentGroup, agentGroupCounts, warningState,
  buildQuestItems, questStatus, questNeedsAdmin, questDeadline, questDistricts, questStatusCounts, questProgress,
  questReason, questCurrentStage,
  leaveStatus, leaveDurationDays, leaveRows, leaveCounts, leavesUnavailable,
} from './admin-dashboard.js'

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8')
const NOW = Date.parse('2026-11-12T12:00:00Z')
const iso = (h) => new Date(NOW + h * 3600e3).toISOString()

/* ── cleanup: the read-only preview only ────────────────────────────── */

test('the cleanup preview is one read-only action with no parameters', async () => {
  const calls = []
  const res = await fetchCleanupPreview(async (action, params) => { calls.push([action, params]); return { success: true, agents: [] } })
  assert.deepEqual(calls, [[CLEANUP_ACTION, {}]])
  assert.equal(CLEANUP_ACTION, 'adminCleanupPreview')
  assert.equal(res.ok, true)
  assert.deepEqual(await fetchCleanupPreview(async () => ({ success: false, error: 'Unauthorized' })), { ok: false, error: 'Unauthorized' })
})

test('admin.html never calls the deletion endpoint', () => {
  assert.doesNotMatch(html, /adminDeleteInactiveAgents|dryRun/)
  assert.match(html, /fetchCleanupPreview\(call\)/)
})

test('next job times are the next 09:00 and 18:00 UTC', () => {
  assert.equal(nextUtcHour(18, NOW).toISOString(), '2026-11-12T18:00:00.000Z')
  assert.equal(nextUtcHour(9, NOW).toISOString(), '2026-11-13T09:00:00.000Z')
  assert.equal(CLEANUP.warningNoticeDays, 2)
  assert.equal(CLEANUP.warningValidDays, 45)
})

const roster = [
  { agentNo: 'AGENT214', email: null, daysInactive: 16.2, daysSinceFeed: 16.2 },
  { agentNo: 'AGENT187', email: 'pa***@gmail.com', daysInactive: 15.1, daysSinceFeed: 15.1 },
  { agentNo: 'AGENT188', email: 'qq***@gmail.com', daysInactive: 17, daysSinceFeed: 17 },
  { agentNo: 'AGENT189', email: 'rr***@gmail.com', daysInactive: 20, daysSinceFeed: 20 },
  { agentNo: 'AGENT122', email: 'no***@gmail.com', daysInactive: 18, daysSinceFeed: 18 },
  { agentNo: 'AGENT240', email: null, daysInactive: 11.2, daysSinceFeed: 19.4, lastVoteAt: '2026-11-01T00:00:00Z' },
  { agentNo: 'AGENT050', email: null, daysInactive: 2, daysSinceFeed: 2 },
  { agentNo: 'AGENT001', email: null, daysInactive: 40, daysSinceFeed: 40 },
  { agentNo: 'AGENT009', email: null, daysInactive: 40, daysSinceFeed: 40, retiredAt: '2026-10-01T00:00:00Z' },
]
// What rc_inactive_agent_deletion_preview would return: leave-adjusted days,
// warning rows, and the job's own `eligible`.
const preview = { ok: true, agents: [
  { agentNo: 'AGENT214', daysInactive: 16.2, hasEmail: false, eligible: true },
  { agentNo: 'AGENT187', daysInactive: 14.6, hasEmail: true, lastWarnedAt: iso(-20), eligibleFrom: iso(28), warnCount: 1, lastDeliveryOk: true, eligible: false },
  { agentNo: 'AGENT188', daysInactive: 17, hasEmail: true, lastWarnedAt: iso(-24 * 3), eligibleFrom: iso(-24), warnCount: 1, lastDeliveryOk: true, eligible: true },
  { agentNo: 'AGENT189', daysInactive: 20, hasEmail: true, lastWarnedAt: null, lastAttemptAt: iso(-3), warnCount: 0, lastDeliveryOk: false, eligible: false },
  { agentNo: 'AGENT240', daysInactive: 11.2, hasEmail: false, eligible: false },
] }

test('eligibility is the preview\'s own answer; email holders show their real warning state', () => {
  const rows = cleanupRows(roster, preview, NOW)
  const state = Object.fromEntries(rows.map((r) => [r.agent.agentNo, r.state]))
  assert.deepEqual(state, {
    AGENT214: 'delete_next_run', AGENT187: 'notice_period', AGENT188: 'delete_next_run', AGENT189: 'needs_warning',
    AGENT122: 'leave_paused', AGENT240: 'at_risk', AGENT050: 'ok', AGENT001: 'protected', AGENT009: 'retired',
  })
  assert.deepEqual(agentGroupCounts(rows), { delete: 2, warning: 2, charge: 6, risk: 1 })
  const by = Object.fromEntries(rows.map((r) => [r.agent.agentNo, r]))
  assert.equal(by.AGENT187.leaveDays, 0.5)
  assert.equal(by.AGENT189.warning, 'delivery_failed')
  assert.equal(by.AGENT188.warning, 'warned')
})

test('warning states follow the 2-day notice and 45-day validity', () => {
  const day = 24
  assert.equal(warningState({ hasEmail: false }, NOW), null)
  assert.equal(warningState({ hasEmail: true }, NOW), 'not_warned')
  assert.equal(warningState({ hasEmail: true, lastDeliveryOk: false }, NOW), 'delivery_failed')
  assert.equal(warningState({ hasEmail: true, lastWarnedAt: iso(-1 * day) }, NOW), 'notice_period')
  assert.equal(warningState({ hasEmail: true, lastWarnedAt: iso(-3 * day) }, NOW), 'warned')
  assert.equal(warningState({ hasEmail: true, lastWarnedAt: iso(-50 * day) }, NOW), 'warning_lapsed')
})

test('a vote within 14 days keeps a never-charging agent off the deletion list', () => {
  const voter = cleanupRows(roster, preview, NOW).find((r) => r.agent.agentNo === 'AGENT240')
  assert.equal(voter.notCharged, true)
  assert.equal(voter.state, 'at_risk')
})

test('without the preview nobody is shown as eligible', () => {
  const rows = cleanupRows(roster, null, NOW)
  assert.equal(agentGroup(rows, 'delete').length, 0)
  assert.equal(agentGroup(rows, 'warning').length, 0)
  assert.equal(rows.find((r) => r.agent.agentNo === 'AGENT214').state, 'unconfirmed')
})

/* ── ReConnect: stored statuses and stages ──────────────────────────── */

const stage = (key, state, detail = null) => ({ key, label: { team: 'Team formed', streaming: 'Streaming', cipher: 'Cipher', complete: 'Completed' }[key], state, detail })
const member = (agentNo, status = 'joined', extra = {}) => ({ agentNo, codename: `C ${agentNo}`, status, inviteLapsed: false, joinedAt: iso(-24), ...extra })
const quests = [
  { missionId: 'm1', districtId: 'bell', districtName: 'Bell Tower', goalId: 'g', goalLabel: 'Connect', requiredAgents: 2, status: 'open', storedStatus: 'open',
    createdAt: iso(-144), completedAt: null, expiresAt: iso(30), members: [member('A1')],
    stages: [stage('team', 'current'), stage('streaming', 'todo'), stage('complete', 'todo')] },
  { missionId: 'm2', districtId: 'bell', districtName: 'Bell Tower', goalId: 'g', goalLabel: 'Connect', requiredAgents: 2, status: 'open', storedStatus: 'open',
    createdAt: iso(-24), completedAt: null, expiresAt: iso(100), members: [member('A3'), member('A4')],
    stages: [stage('team', 'done'), stage('streaming', 'done'), stage('cipher', 'current', '2 of 3 · 1 guesses left'), stage('complete', 'todo')] },
  { missionId: 'm3', districtId: 'old', districtName: 'Old Station', goalId: 'g', goalLabel: 'Connect', requiredAgents: 2, status: 'expired', storedStatus: 'open',
    createdAt: iso(-200), completedAt: null, expiresAt: iso(-6), members: [member('A5')],
    stages: [stage('team', 'stopped'), stage('streaming', 'todo'), stage('complete', 'todo')] },
  { missionId: 'm4', districtId: 'old', districtName: 'Old Station', goalId: 'g', goalLabel: 'Connect', requiredAgents: 2, status: 'completed', storedStatus: 'complete',
    createdAt: iso(-300), completedAt: iso(-48), expiresAt: iso(-10), members: [member('A7'), member('A8')],
    stages: [stage('team', 'done'), stage('streaming', 'done'), stage('complete', 'done', iso(-48))] },
  { missionId: 'm5', districtId: 'bell', districtName: 'Bell Tower', goalId: 'g', goalLabel: 'Connect', requiredAgents: 2, status: 'cancelled', storedStatus: 'cancelled',
    createdAt: iso(-60), completedAt: null, expiresAt: iso(50), members: [member('A9')],
    stages: [stage('team', 'stopped'), stage('streaming', 'todo'), stage('complete', 'todo')] },
]
const cases = [
  { kind: 'mission', missionId: 'm1', districtId: 'bell', districtName: 'Bell Tower', goalLabel: 'Connect', requiredAgents: 2, missingSeats: 1, pendingInvites: 0,
    flags: ['deadline_soon', 'needs_people'], suggestedAgentNos: ['A1', 'A2'], agents: [{ agentNo: 'A1', codename: 'Paper Moon' }],
    invites: [], districtExpiresAt: iso(18), missionExpiresAt: iso(30), waitingSince: iso(-144) },
  { kind: 'mission', missionId: 'm2', districtId: 'bell', districtName: 'Bell Tower', goalLabel: 'Connect', requiredAgents: 2, missingSeats: 0, pendingInvites: 0,
    flags: ['active'], agents: [{ agentNo: 'A3', codename: 'Star Ferry' }, { agentNo: 'A4', codename: 'Gold Ribbon' }],
    invites: [], districtExpiresAt: iso(120), missionExpiresAt: iso(100), waitingSince: iso(-24) },
  { kind: 'mission', missionId: 'm3', districtId: 'old', districtName: 'Old Station', goalLabel: 'Connect', requiredAgents: 2, missingSeats: 1, pendingInvites: 0,
    flags: ['expired', 'needs_people'], agents: [{ agentNo: 'A5', codename: 'Tin Planet' }], invites: [], districtExpiresAt: iso(-6), missionExpiresAt: iso(-6), waitingSince: iso(-200) },
  { kind: 'puzzle', missionId: null, districtId: 'harbor', districtName: 'Harbor Line', goalLabel: 'Cipher', requiredAgents: 1, missingSeats: 0, pendingInvites: 0,
    flags: ['puzzle_blocked'], agents: [{ agentNo: 'A6', codename: 'North Lantern' }], invites: [], districtExpiresAt: iso(48), waitingSince: iso(-48) },
]
const items = buildQuestItems(quests, cases)
const byId = (id) => items.find((i) => i.missionId === id)

test('quests merge with health by mission; statuses come from the stored rows', () => {
  assert.equal(items.length, 6, 'five quests plus the solo puzzle case')
  assert.deepEqual(['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => questStatus(byId(id))), ['waiting', 'active', 'expired', 'completed', 'cancelled'])
  assert.equal(questStatus(items.find((i) => i.kind === 'puzzle')), 'active')
  assert.deepEqual(['m1', 'm2', 'm3', 'm4', 'm5'].map((id) => questNeedsAdmin(byId(id))), [true, false, true, false, false])
  assert.equal(questNeedsAdmin(items.find((i) => i.kind === 'puzzle')), true)
  assert.equal(questDeadline(byId('m4')), null, 'closed quests have no deadline')
  assert.deepEqual(questStatusCounts(items), { all: 6, attention: 3, open: 3, waiting: 1, active: 2, completed: 1, cancelled: 1, expired: 1 })
})

test('stage and reason come from the stored quest, not guessed', () => {
  assert.equal(questCurrentStage(byId('m1')), 'Team formed')
  assert.equal(questCurrentStage(byId('m2')), 'Cipher 2 of 3')
  assert.equal(questCurrentStage(byId('m4')), 'Completed')
  assert.equal(questCurrentStage(items.find((i) => i.kind === 'puzzle')), 'Puzzle locked')
  assert.equal(questReason(byId('m4')), 'Completed')
  assert.equal(questReason(byId('m3')), 'Expired with 1/2 joined')
  assert.equal(questReason(byId('m1')), 'Needs 1 teammate before the deadline')
})

test('quests group by district with open ones first, filter, search and sort', () => {
  const all = questDistricts(items)
  assert.deepEqual(all.map((d) => d.districtName), ['Bell Tower', 'Harbor Line', 'Old Station'])
  assert.deepEqual(all[0].items.map((i) => i.missionId), ['m1', 'm2', 'm5'])
  assert.deepEqual(all[0].counts, { waiting: 1, active: 1, completed: 0, cancelled: 1, expired: 0, attention: 1 })
  assert.deepEqual(questDistricts(items, { sort: 'district' }).map((d) => d.districtName), ['Bell Tower', 'Harbor Line', 'Old Station'])
  assert.deepEqual(questDistricts(items, { query: 'C A8' }).flatMap((d) => d.items.map((i) => i.missionId)), ['m4'])
  assert.deepEqual(questDistricts(items, { filter: 'completed' }).flatMap((d) => d.items.map((i) => i.missionId)), ['m4'])
  assert.deepEqual(questDistricts(items, { filter: 'cancelled' }).flatMap((d) => d.items.map((i) => i.missionId)), ['m5'])
  assert.equal(questDistricts(items, { filter: 'open' }).flatMap((d) => d.items).length, 3)
})

test('seats are real participant rows', () => {
  assert.deepEqual(questProgress(byId('m2')), { joined: 2, required: 2, invited: 0 })
  assert.deepEqual(questProgress(byId('m1')), { joined: 1, required: 2, invited: 0 })
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

test('the page script is valid JavaScript', () => {
  const js = html.slice(html.indexOf('<script type="module">') + '<script type="module">'.length, html.lastIndexOf('</script>'))
  const body = js.replace(/^import[\s\S]*?from '[^']+'\s*$/gm, '')
  assert.doesNotThrow(() => new Function(body))
})
