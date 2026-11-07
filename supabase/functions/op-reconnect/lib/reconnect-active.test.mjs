// The ReConnect invite list shows agents who have BOTH opened the app and
// streamed lately, so a vote-only sign-up can't soak up an invite.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isActiveForInvite, rankInviteCandidates, streamedDaysAgo, streamedLabel, INVITE_ACTIVE_DAYS } from './reconnect-active.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const NOW = Date.parse('2026-11-07T06:00:00Z')
const TODAY = '2026-11-07'
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString()

test('needs both: a recent app visit and a recent stream', () => {
  const on = (lastSeenAt, lastStreamDay) => isActiveForInvite({ lastSeenAt, lastStreamDay }, NOW, TODAY)
  assert.equal(INVITE_ACTIVE_DAYS, 3)
  assert.equal(on(ago(1), '2026-11-06'), true)
  assert.equal(on(ago(1), null), false, 'opened the app to vote, never streamed')
  assert.equal(on(ago(5), '2026-11-07'), false, 'streams sync in the background, app never opened')
  assert.equal(on(null, '2026-11-07'), false)
  assert.equal(on(ago(1), '2026-11-03'), false, 'last stream too old')
  assert.equal(on(ago(2.9), '2026-11-04'), true, 'inside both windows')
})

test('order: online, then most recent stream, then longest waiting', () => {
  const c = (codename, online, streamedDaysAgo, waitingSince = null) => ({ codename, online, streamedDaysAgo, waitingSince })
  const ranked = rankInviteCandidates([
    c('Late', false, 3), c('Solo', true, 2), c('Fresh', false, 0, '2026-11-06T00:00:00Z'),
    c('Waiting', false, 0, '2026-11-01T00:00:00Z'), c('Live', true, 0),
  ])
  assert.deepEqual(ranked.map((r) => r.codename), ['Live', 'Solo', 'Waiting', 'Fresh', 'Late'])
})

test('labels name the stream, never a last-seen time', () => {
  assert.equal(streamedDaysAgo('2026-11-05', TODAY), 2)
  assert.equal(streamedLabel(0), 'Streamed today')
  assert.equal(streamedLabel(1), 'Streamed yesterday')
  assert.equal(streamedLabel(3), 'Streamed 3 days ago')
})

test('wiring: filtered on the server, fails open, and the panel explains a short list', () => {
  const src = read('./reconnect-missions.ts')
  const fn = src.slice(src.indexOf('export async function getInviteCandidates'), src.indexOf('/** Opt-in only: remember that this agent'))
  assert.match(fn, /if \(activity\) free = free\.filter\(\(f\) => activity\.get\(f\.agentNo\)\?\.active\)/, 'a failed read hides nobody')
  assert.match(fn, /emptyReason: 'nobody_active'/)
  assert.match(fn, /rankInviteCandidates\(free/)
  assert.doesNotMatch(fn.slice(fn.indexOf('const candidates = ')), /last_seen_at|lastSeenAt/, 'no last-seen time reaches the browser')
  const ui = read('../../../../js/screen-district.js')
  assert.match(ui, /nobody_active: /)
  assert.match(ui, /res2\.hiddenInactive/)
})
