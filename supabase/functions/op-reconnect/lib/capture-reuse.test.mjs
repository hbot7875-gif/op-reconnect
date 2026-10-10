// When a fleet sync may trust the pg_cron capture instead of re-asking the
// provider, and — more importantly — every case where it may not.
//
// The asymmetry these tests exist to protect: an unnecessary provider fetch
// costs a slow sync, a wrong reuse costs missing streams. So every branch
// that is not provably covered must fall through to a real fetch.

import test from 'node:test'
import assert from 'node:assert/strict'
import { captureReuse, streamFreshness } from './streams.ts'

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

// ── what Moon Station may say about freshness ─────────────────────────────
//
// Same checkpoint, a different question. captureReuse asks "may I build
// rollups from this?"; streamFreshness asks "what do I tell the player?".
//
// These tests exist because the surface used to answer the second question
// with the first one's evidence, and told agents their account had a sync
// problem when they had simply not listened that week. The invariant worth
// protecting is narrow and absolute: nothing about how much somebody played
// may reach the `connection` verdict, and nothing about the connection may
// imply plays exist.

const fresh = (over = {}, source = 'statsfm') =>
  streamFreshness({ source, state: healthy({ source, ...over }), nowMs: NOW })

test('a working collector reports ok, with the gate it was judged against', () => {
  const f = fresh()
  assert.equal(f.connection, 'ok')
  assert.equal(f.sinceLastSuccessMs, 3 * 60_000)
  assert.equal(f.pollGateMs, 12 * 60_000)
  assert.equal(f.consecutiveFailures, 0)
})

test('an empty week cannot make a healthy connection look broken', () => {
  // The bug this whole type exists for. streamFreshness is not even given
  // the rows, so a quiet week has no route to the verdict -- that is the
  // point, and this test pins the signature as much as the behaviour.
  assert.equal(fresh().connection, 'ok')
  assert.deepEqual(Object.keys(streamFreshness({ source: 'statsfm', state: healthy(), nowMs: NOW })).sort(),
    ['connection', 'consecutiveFailures', 'pollGateMs', 'sinceLastSuccessMs'])
})

test('a collector past its own gate is stale, not merely quiet', () => {
  const f = fresh({ last_success_at: minsAgo(40) })
  assert.equal(f.connection, 'stale')
  assert.equal(f.sinceLastSuccessMs, 40 * 60_000)
})

test('each source is judged against its own schedule, not a shared number', () => {
  // statsfm captures every 5 min (12-min gate); musicat and listenbrainz
  // every 15 (35-min gate). 20 minutes of silence means different things.
  assert.equal(fresh({ last_success_at: minsAgo(20) }, 'statsfm').connection, 'stale')
  assert.equal(fresh({ last_success_at: minsAgo(20) }, 'musicat').connection, 'ok')
  assert.equal(fresh({ last_success_at: minsAgo(20) }, 'listenbrainz').connection, 'ok')
  assert.equal(fresh({ last_success_at: minsAgo(40) }, 'musicat').connection, 'stale')
})

test('the freshness gates are the same ones captureReuse uses', () => {
  // One definition of "recent". Two would drift, and the player would be
  // told the sync was fine by one of them and stale by the other.
  for (const [source, mins] of [['statsfm', 12], ['musicat', 35], ['listenbrainz', 35]]) {
    assert.equal(fresh({}, source).pollGateMs, mins * 60_000, source)
    const justInside = { last_success_at: minsAgo(mins - 1) }
    const justOutside = { last_success_at: minsAgo(mins + 1) }
    assert.equal(fresh(justInside, source).connection, 'ok', source)
    assert.equal(fresh(justOutside, source).connection, 'stale', source)
    assert.equal(captureReuse({ source, state: healthy({ source, ...justInside }), fromTs: FROM, nowMs: NOW }).reason, 'reuse', source)
    assert.equal(captureReuse({ source, state: healthy({ source, ...justOutside }), fromTs: FROM, nowMs: NOW }).reason, 'stale', source)
  }
})

test('an erroring collector is reported as failing even inside its gate', () => {
  // A success three minutes ago plus a failure since is a connection in
  // trouble right now, and that is the actionable fact.
  const f = fresh({ consecutive_failures: 2 })
  assert.equal(f.connection, 'failing')
  assert.equal(f.consecutiveFailures, 2)
})

test('a pushed source has no connection to report, and does not pretend to', () => {
  // A scrobbler pushes; a push that never happens leaves no record of
  // having been attempted. Inventing 'ok' or 'stale' here would be a guess.
  for (const state of [null, healthy({ source: 'direct' })]) {
    const f = streamFreshness({ source: 'direct', state, nowMs: NOW })
    assert.equal(f.connection, 'unobservable')
    assert.equal(f.pollGateMs, null)
    assert.equal(f.sinceLastSuccessMs, null)
  }
})

test('a polled source with no checkpoint has never synced', () => {
  const f = streamFreshness({ source: 'statsfm', state: null, nowMs: NOW })
  assert.equal(f.connection, 'never_synced')
  assert.equal(f.sinceLastSuccessMs, null)
  // The gate is still reported: it is a property of the source, not of the
  // checkpoint, and the UI needs it to say what it is waiting for.
  assert.equal(f.pollGateMs, 12 * 60_000)
})

test("a checkpoint describing the previous provider is not this one's health", () => {
  // Someone who switched from Musicat to stats.fm has a checkpoint about
  // Musicat. Reading it would report the health of a connection they no
  // longer use.
  const f = streamFreshness({ source: 'statsfm', state: healthy({ source: 'musicat' }), nowMs: NOW })
  assert.equal(f.connection, 'source_changed')
  assert.equal(f.sinceLastSuccessMs, null, "the old provider's timing says nothing about this one")
  // Named, so the UI can say which connection the old history came from
  // instead of claiming there is no history.
  assert.equal(f.previousSource, 'musicat')
})

test('a provider switch and a first-ever sync are not the same state', () => {
  // They look identical in the checkpoint and mean opposite things to the
  // player: one has a whole history from the old provider in front of them,
  // the other has nothing at all. Measured on production, 7 of 84 agents
  // were in one of these two states and ALL SEVEN had streams in the
  // window, so collapsing them produced "nothing has come through yet"
  // above twenty-five listed plays.
  const switched = streamFreshness({ source: 'statsfm', state: healthy({ source: 'musicat' }), nowMs: NOW })
  const firstEver = streamFreshness({ source: 'statsfm', state: null, nowMs: NOW })
  assert.notEqual(switched.connection, firstEver.connection)
  assert.equal(firstEver.connection, 'never_synced')
  assert.equal(firstEver.previousSource, undefined, 'there is no previous provider to name')
  // A checkpoint row that exists but names nothing is a first sync, not a
  // switch — there is no previous provider to point at.
  assert.equal(streamFreshness({ source: 'statsfm', state: healthy({ source: null }), nowMs: NOW }).connection,
    'never_synced')
})

test('an unusable timestamp is never read as healthy', () => {
  for (const over of [{ last_success_at: null }, { last_success_at: 'not-a-date' }, { last_success_at: '' }]) {
    assert.notEqual(fresh(over).connection, 'ok', JSON.stringify(over))
  }
})

test('every verdict is one of the six documented states', () => {
  const allowed = new Set(['ok', 'failing', 'stale', 'never_synced', 'source_changed', 'unobservable'])
  for (const source of ['statsfm', 'musicat', 'listenbrainz', 'direct', '', 'webhook']) {
    for (const state of [null, healthy({ source }), healthy({ source, consecutive_failures: 9 }),
      healthy({ source, last_success_at: minsAgo(999) }), healthy({ source: 'other' })]) {
      const f = streamFreshness({ source, state, nowMs: NOW })
      assert.ok(allowed.has(f.connection), `${source} -> ${f.connection}`)
    }
  }
})
