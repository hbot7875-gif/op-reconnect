// The warning before deletion.
//
// The asymmetry: a warning sent to the wrong person is noise, but a warning
// NOT sent means somebody loses an account and their listening history without
// being told it was coming. Terms §6 and the Privacy Policy both promise this
// email, so the promise is only as good as this band.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  reminderPlan,
  outageToleranceDays,
  mayDelete,
  NOTICE_DAYS,
  WARNING_VALID_DAYS,
  DELETE_AT_DAYS,
  DEFAULT_MIN_DAYS,
  DEFAULT_MAX_DAYS,
} from './inactive-reminder-rules.js'

// The retention migration moves from pending/ to migrations/ when applied, and
// was renamed to sort after the Stage 1 trigger. Resolve it either way rather
// than pinning a path that a deployment invalidates.
const RETENTION_SQL = '20260928060000_rc_privacy_retention.sql'
const readRetentionMigration = () => {
  for (const dir of ['migrations', 'pending']) {
    try { return readFileSync(new URL(`../../../${dir}/${RETENTION_SQL}`, import.meta.url), 'utf8') } catch { /* try the next */ }
  }
  throw new Error(`${RETENTION_SQL} is in neither supabase/migrations/ nor supabase/pending/`)
}

const cand = (agent_no, days_inactive) => ({ agent_no, days_inactive })
const agent = (agent_no, email = `${agent_no.toLowerCase()}@example.com`, handle = agent_no) => ({ agent_no, email, handle })

test('the band sits below the deletion threshold and never reaches it', () => {
  assert.equal(DEFAULT_MAX_DAYS, DELETE_AT_DAYS)
  assert.ok(DEFAULT_MIN_DAYS < DEFAULT_MAX_DAYS)
})

test('someone approaching the cutoff is warned, with the days they have left', () => {
  const { toSend } = reminderPlan({
    candidates: [cand('AGENT100', 9), cand('AGENT101', 11.4), cand('AGENT102', 13.6)],
    agents: [agent('AGENT100'), agent('AGENT101'), agent('AGENT102')],
  })
  assert.deepEqual(toSend.map((t) => [t.agentNo, t.daysLeft]), [
    ['AGENT100', 5],
    ['AGENT101', 3],
    ['AGENT102', 1],
  ])
})

test('nobody is ever told they have 0 days left', () => {
  // Rounding at the top of the band would otherwise produce it.
  const { toSend } = reminderPlan({ candidates: [cand('A', 13.99)], agents: [agent('A')] })
  assert.equal(toSend[0].daysLeft, 1)
})

test('someone too fresh to worry about is not written to', () => {
  const { toSend, outOfBand } = reminderPlan({ candidates: [cand('A', 3)], agents: [agent('A')] })
  assert.deepEqual(toSend, [])
  assert.deepEqual(outOfBand, ['A'])
})

test('someone already past the cutoff is left to the sweep, not emailed', () => {
  // Warning at or past 14 days races the deletion: the file may be gone before
  // the mail is read, and the email would be a lie about what they can do.
  const { toSend, outOfBand } = reminderPlan({
    candidates: [cand('A', 14), cand('B', 40)],
    agents: [agent('A'), agent('B')],
  })
  assert.deepEqual(toSend, [])
  assert.deepEqual(outOfBand, ['A', 'B'])
})

test('approved leave is respected, because it is already subtracted upstream', () => {
  // rc_inactive_agent_candidates subtracts leave before reporting
  // days_inactive, so someone 20 calendar days quiet with 12 days of approved
  // leave arrives here as 8 and is correctly left alone.
  const { toSend, outOfBand } = reminderPlan({ candidates: [cand('ONLEAVE', 8)], agents: [agent('ONLEAVE')] })
  assert.deepEqual(toSend, [])
  assert.deepEqual(outOfBand, ['ONLEAVE'])
})

test('an agent with no email address is skipped, not silently dropped', () => {
  const { toSend, skipped } = reminderPlan({
    candidates: [cand('A', 10), cand('B', 10), cand('C', 10)],
    agents: [agent('A'), { agent_no: 'B', email: null, handle: 'b' }, { agent_no: 'C', email: '   ', handle: 'c' }],
  })
  assert.deepEqual(toSend.map((t) => t.agentNo), ['A'])
  assert.deepEqual(skipped, ['B', 'C'], 'reported so an operator can see the gap')
})

test('an agent the purge already removed is skipped, not emailed', () => {
  // A stale candidate list can name somebody who no longer exists.
  const { toSend, skipped } = reminderPlan({ candidates: [cand('GONE', 10)], agents: [] })
  assert.deepEqual(toSend, [])
  assert.deepEqual(skipped, ['GONE'])
})

test('a malformed candidate cannot become a send', () => {
  const { toSend } = reminderPlan({
    candidates: [cand('', 10), cand('A', null), cand('B', 'soon'), cand('C', NaN), {}],
    agents: [agent('A'), agent('B'), agent('C')],
  })
  assert.deepEqual(toSend, [])
})

test('the handle falls back to the agent number rather than going blank', () => {
  const { toSend } = reminderPlan({
    candidates: [cand('AGENT200', 10)],
    agents: [{ agent_no: 'AGENT200', email: 'x@example.com', handle: null }],
  })
  assert.equal(toSend[0].handle, 'AGENT200')
})

test('a custom band is honoured, and cannot be inverted', () => {
  const wide = reminderPlan({ candidates: [cand('A', 4)], agents: [agent('A')], minDays: 3, maxDays: 14 })
  assert.equal(wide.toSend.length, 1)
  assert.equal(wide.toSend[0].daysLeft, 10)
  // max below min would otherwise select everything or nothing at random.
  const silly = reminderPlan({ candidates: [cand('A', 10)], agents: [agent('A')], minDays: 12, maxDays: 2 })
  assert.deepEqual(silly.toSend, [], 'a nonsensical band sends nothing')
})

// ── duplicate suppression ─────────────────────────────────────────────

const NOW = Date.parse('2026-09-27T09:00:00Z')
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString()

test('a second run the same morning does not email anyone twice', () => {
  const args = {
    candidates: [cand('A', 10)],
    agents: [agent('A')],
    warnings: [{ agent_no: 'A', last_attempt_at: hoursAgo(1) }],
    now: NOW,
  }
  const out = reminderPlan(args)
  assert.deepEqual(out.toSend, [])
  assert.deepEqual(out.suppressed, ['A'])
})

test('the next day, the same agent is written to again', () => {
  const out = reminderPlan({
    candidates: [cand('A', 11)],
    agents: [agent('A')],
    warnings: [{ agent_no: 'A', last_attempt_at: hoursAgo(24) }],
    now: NOW,
  })
  assert.deepEqual(out.toSend.map((t) => t.agentNo), ['A'])
})

test('a FAILED send still suppresses, so a broken mailbox is not hammered', () => {
  // The record is of the attempt, not the success.
  const out = reminderPlan({
    candidates: [cand('A', 10)],
    agents: [agent('A')],
    warnings: [{ agent_no: 'A', last_attempt_at: hoursAgo(2) }],
    now: NOW,
  })
  assert.deepEqual(out.suppressed, ['A'])
})

test('a malformed warning row cannot suppress a real warning', () => {
  const out = reminderPlan({
    candidates: [cand('A', 10)],
    agents: [agent('A')],
    warnings: [{ agent_no: 'A', last_attempt_at: 'not-a-date' }, {}, null],
    now: NOW,
  })
  assert.deepEqual(out.toSend.map((t) => t.agentNo), ['A'])
})

// ── the deletion gate ─────────────────────────────────────────────────

test('an account that was never warned is not deleted', () => {
  const d = mayDelete({ email: 'a@example.com', lastWarnedAt: null, now: NOW })
  assert.equal(d.ok, false)
  assert.equal(d.reason, 'never_warned')
})

test('a warning needs time to be read before the sweep may act', () => {
  const tooNew = mayDelete({ email: 'a@example.com', lastWarnedAt: new Date(NOW - 3600e3).toISOString(), now: NOW })
  assert.equal(tooNew.ok, false)
  assert.equal(tooNew.reason, 'warning_too_recent')

  const ripe = mayDelete({ email: 'a@example.com', lastWarnedAt: new Date(NOW - (NOTICE_DAYS + 0.5) * 86400e3).toISOString(), now: NOW })
  assert.equal(ripe.ok, true)
  assert.equal(ripe.reason, 'warned')
})

test('a warning from months ago has lapsed and does not authorise deletion', () => {
  const old = mayDelete({ email: 'a@example.com', lastWarnedAt: new Date(NOW - (WARNING_VALID_DAYS + 5) * 86400e3).toISOString(), now: NOW })
  assert.equal(old.ok, false)
  assert.equal(old.reason, 'warning_lapsed')
})

test('an account with no address is still deleted on time', () => {
  // There is no warning we could send, and holding it for ever would keep the
  // data longer rather than less — the opposite of the point.
  for (const email of [null, '', '   ', undefined]) {
    const d = mayDelete({ email, lastWarnedAt: null, now: NOW })
    assert.equal(d.ok, true, String(email))
    assert.equal(d.reason, 'no_address_to_warn')
  }
})

test('the full sequence: warned, waited, then deletable', () => {
  // Day 10: in the band, never warned → send, and not deletable.
  const day10 = reminderPlan({ candidates: [cand('A', 10)], agents: [agent('A')], warnings: [], now: NOW })
  assert.equal(day10.toSend.length, 1)
  assert.equal(mayDelete({ email: 'a@example.com', lastWarnedAt: null, now: NOW }).ok, false)

  // Same day, second run → suppressed.
  const again = reminderPlan({
    candidates: [cand('A', 10)], agents: [agent('A')],
    warnings: [{ agent_no: 'A', last_attempt_at: new Date(NOW).toISOString() }], now: NOW,
  })
  assert.deepEqual(again.toSend, [])

  // Day 12: warning is 2 days old → out of the send band soon, and now deletable.
  const later = NOW + 2.1 * 86400e3
  assert.equal(mayDelete({ email: 'a@example.com', lastWarnedAt: new Date(NOW).toISOString(), now: later }).ok, true)
})

test('an outage delays deletion rather than causing an unwarned one', () => {
  // The job is down for a fortnight. The agent sails past 14 days inactive,
  // but with no delivered warning the gate refuses to delete them.
  const d = mayDelete({ email: 'a@example.com', lastWarnedAt: null, now: NOW + 14 * 86400e3 })
  assert.equal(d.ok, false, 'held, not silently deleted')
  assert.equal(d.reason, 'never_warned')
})

test('the band only tolerates a short outage before someone is deleted unwarned', () => {
  // 9→14 gives five daily chances. A job down longer than that lets an agent
  // cross from un-warned to deleted without ever being written to.
  assert.equal(outageToleranceDays(), 5)
  assert.equal(outageToleranceDays(3, 14), 11, 'a wider band survives a longer outage')
})

test('nothing to do is a clean result, not an error', () => {
  const out = reminderPlan({})
  assert.deepEqual(out.toSend, [])
  assert.deepEqual(out.skipped, [])
  assert.deepEqual(out.outOfBand, [])
})


// ── delivery is recorded only on provider acceptance ──────────────────
// The handler itself cannot be imported here (its module graph reaches Deno
// APIs), so these pin the contract it depends on and the line that enforces it.

test('sendMail distinguishes a 2xx from an acceptance', () => {
  const mailer = readFileSync(new URL('./mailer.ts', import.meta.url), 'utf8')
  // A 200 with no id is reported as such rather than as a success.
  assert.match(mailer, /mail_accepted_without_id/)
  assert.match(mailer, /id \? \{ ok: true, id \}/)
  // And the doc comment must keep saying what ok does NOT mean.
  assert.match(mailer, /Neither means the mail reached an inbox/)
})

test('a warning is recorded only when the provider accepted it', () => {
  const handler = readFileSync(new URL('./admin-agent.ts', import.meta.url), 'utf8')
  assert.match(handler, /const accepted = !!result\.ok && !!result\.id/)
  assert.match(handler, /p_ok: accepted/)
  // And a send that was not accepted must not be counted as sent.
  assert.match(handler, /if \(accepted && !recErr\) sent\.push/)
})

test('the stored failure reason cannot carry an email address', () => {
  const sql = readRetentionMigration()
  assert.match(sql, /rc_scrub_mail_error/)
  assert.match(sql, /\[address\]/)
  // Verified against the database: the pattern rewrites an address in a
  // provider error and leaves a plain code untouched.
})

test('a warning record cannot outlive the account it belongs to', () => {
  const sql = readRetentionMigration()
  assert.match(sql, /agent_no\s+text primary key references rc_agents\(agent_no\) on delete cascade/)
  // The table holds no address and no codename — only the agent number, which
  // goes with the account.
  const block = sql.slice(sql.indexOf('create table if not exists rc_inactivity_warnings'))
  const cols = block.slice(0, block.indexOf(');'))
  for (const forbidden of ['email', 'codename', 'handle']) {
    assert.ok(!cols.includes(forbidden), `warning rows must not store ${forbidden}`)
  }
})
