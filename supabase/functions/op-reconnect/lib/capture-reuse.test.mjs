// When a fleet sync may trust the pg_cron capture instead of re-asking the
// provider, and — more importantly — every case where it may not.
//
// The asymmetry these tests exist to protect: an unnecessary provider fetch
// costs a slow sync, a wrong reuse costs missing streams. So every branch
// that is not provably covered must fall through to a real fetch.

import test from 'node:test'
import assert from 'node:assert/strict'
import { captureReuse } from './streams.ts'

const NOW = Date.parse('2026-09-27T06:00:00Z')
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString()
const secs = (iso) => Math.floor(Date.parse(iso) / 1000)

// A window starting an hour ago — what a routine same-day sync asks for.
const FROM = secs(minsAgo(60))

const healthy = (over = {}) => ({
  source: 'statsfm',
  coverage_from: minsAgo(600),
  last_success_at: minsAgo(3),
  consecutive_failures: 0,
  ...over,
})

const decide = (over = {}, source = 'statsfm', fromTs = FROM) =>
  captureReuse({ source, state: healthy(over), fromTs, nowMs: NOW })

test('fresh coverage is reused', () => {
  const d = decide()
  assert.equal(d.reuse, true)
  assert.equal(d.reason, 'reuse')
})

test('stale coverage still syncs from the provider', () => {
  // stats.fm captures every 5 min; 40 minutes of silence is not trustworthy.
  const d = decide({ last_success_at: minsAgo(40) })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'stale')
})

test('each source gets its own freshness window', () => {
  // 20 minutes: stale for stats.fm (12 min), still fresh for the 15-minute
  // musicat and ListenBrainz jobs (35 min).
  const at20 = { last_success_at: minsAgo(20) }
  assert.equal(captureReuse({ source: 'statsfm', state: healthy({ ...at20 }), fromTs: FROM, nowMs: NOW }).reuse, false)
  assert.equal(captureReuse({ source: 'musicat', state: healthy({ ...at20, source: 'musicat' }), fromTs: FROM, nowMs: NOW }).reuse, true)
  assert.equal(captureReuse({ source: 'listenbrainz', state: healthy({ ...at20, source: 'listenbrainz' }), fromTs: FROM, nowMs: NOW }).reuse, true)
})

test('a failing capture is never reused, however recent', () => {
  const d = decide({ consecutive_failures: 1, last_success_at: minsAgo(1) })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'capture_failing')
})

test('a new agent with no checkpoint is fully synced', () => {
  const d = captureReuse({ source: 'statsfm', state: null, fromTs: FROM, nowMs: NOW })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'no_state')
})

test('switching provider invalidates the old checkpoint', () => {
  // The row describes musicat; the agent now reads from stats.fm.
  const d = captureReuse({ source: 'statsfm', state: healthy({ source: 'musicat' }), fromTs: FROM, nowMs: NOW })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'source_changed')
})

test('coverage that starts after the requested window is a gap, not a hit', () => {
  // Capture only reaches back 10 minutes; the sync wants the last hour.
  const d = decide({ coverage_from: minsAgo(10) })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'coverage_gap')
})

test('a backfill is never served from a same-day checkpoint', () => {
  // 35-day historical recovery against coverage that starts 10 hours ago.
  const backfillFrom = secs(minsAgo(35 * 24 * 60))
  const d = captureReuse({ source: 'statsfm', state: healthy(), fromTs: backfillFrom, nowMs: NOW })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'coverage_gap')
})

test('coverage exactly at the window edge is accepted', () => {
  const d = decide({ coverage_from: minsAgo(60) })
  assert.equal(d.reuse, true)
})

test('recovery after an outage: reuse resumes only once capture succeeds again', () => {
  // During the outage the checkpoint is stale and failing — full sync.
  const during = decide({ last_success_at: minsAgo(90), consecutive_failures: 6 })
  assert.equal(during.reuse, false)

  // The first successful capture clears the failure count but its coverage
  // still starts where the old checkpoint did, so the gap is what decides.
  const justAfter = decide({ last_success_at: minsAgo(1), consecutive_failures: 0, coverage_from: minsAgo(10) })
  assert.equal(justAfter.reuse, false, 'a gap opened by the outage must still be fetched')

  // Once capture has re-established coverage across the window, reuse is on.
  const recovered = decide({ last_success_at: minsAgo(1), consecutive_failures: 0, coverage_from: minsAgo(600) })
  assert.equal(recovered.reuse, true)
})

test('direct webhook agents are never treated as capture-covered', () => {
  const d = captureReuse({ source: 'direct', state: healthy({ source: 'direct' }), fromTs: FROM, nowMs: NOW })
  assert.equal(d.reuse, false)
  assert.equal(d.reason, 'not_polled')
})

test('missing or malformed checkpoint fields fall through rather than reuse', () => {
  for (const over of [
    { last_success_at: null },
    { coverage_from: null },
    { last_success_at: 'not-a-date' },
    { coverage_from: 'not-a-date' },
    { consecutive_failures: null, last_success_at: null },
  ]) {
    assert.equal(decide(over).reuse, false, JSON.stringify(over))
  }
})

test('all three polled sources can reuse when healthy', () => {
  for (const s of ['statsfm', 'musicat', 'listenbrainz']) {
    assert.equal(captureReuse({ source: s, state: healthy({ source: s }), fromTs: FROM, nowMs: NOW }).reuse, true, s)
  }
})
