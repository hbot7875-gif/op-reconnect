// Rap Line to 1B: the figures players see as Spotify totals.
//
// The failures worth guarding are the ones that would put a wrong number on
// screen: a multi-day jump shown as one day's gain, a repeated total shown as
// zero streams, a Spotify correction shown as negative streaming, an old total
// presented as current, or the free request quota being spent too fast.
// The series below copy the shapes seen in the provider's real history
// (2026-10-27): a repeated reading after a two-day jump, a one-day gap, and
// small downward corrections.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RAPLINE_TRACKS, RAPLINE_MILESTONES, RAPLINE_BUDGET,
  parseHistory, trimHistory, summariseSeries, summariseTracker, raplineFetchDecision,
} from './rapline-rules.js'

const series = (obj) => Object.entries(obj).map(([day, streams]) => ({ day, streams }))

test('tracks only the three Rap Line songs; Jin and SWIM are milestones only', () => {
  assert.deepEqual(RAPLINE_TRACKS.map((t) => t.spotifyId), [
    '1AZjCZSGEjlxUufFQwSszF', '4bjN59DRXFRxBE1g5ne6B1', '2GzwtXPlI0gZEOS6xFOZ2j',
  ])
  assert.deepEqual(RAPLINE_MILESTONES.map((m) => m.spotifyId), ['27xkOIER6uDLKALIelHylZ', '4g5eopb54XIaV2ciooY3St'])
  const tracked = new Set(RAPLINE_TRACKS.map((t) => t.spotifyId))
  for (const m of RAPLINE_MILESTONES) assert.equal(tracked.has(m.spotifyId), false)
})

test('parseHistory accepts the provider shape and rejects anything else', () => {
  assert.deepEqual(parseHistory([{ date: '2026-10-27', streams: 3 }, { date: '2026-10-26', streams: 2 }]),
    [{ day: '2026-10-26', streams: 2 }, { day: '2026-10-27', streams: 3 }])
  assert.throws(() => parseHistory({ message: 'You are not subscribed to this API.' }), /not_array/)
  assert.throws(() => parseHistory([{ date: '27/10/2026', streams: 1 }]), /bad_date/)
  assert.throws(() => parseHistory([{ date: '2026-10-27', streams: '1' }]), /bad_streams/)
  assert.throws(() => parseHistory([{ date: '2026-10-27', streams: -1 }]), /bad_streams/)
})

test('trimHistory keeps the newest window only', () => {
  const pts = series({ '2026-01-01': 1, '2026-10-26': 2, '2026-10-27': 3 })
  assert.deepEqual(trimHistory(pts, 30).map((p) => p.day), ['2026-10-26', '2026-10-27'])
})

test('a clean consecutive pair gives the daily gain, dated to its day', () => {
  const s = summariseSeries(series({ '2026-10-25': 457_835_007, '2026-10-26': 458_160_611, '2026-10-27': 458_468_618 }), '2026-10-27')
  assert.equal(s.total, 458_468_618)
  assert.equal(s.asOf, '2026-10-27')
  assert.deepEqual(s.latestGain, { day: '2026-10-27', streams: 308_007 })
  assert.equal(s.remaining, 541_531_382)
  assert.equal(s.percent, 45.84)
  assert.equal(s.stale, false)
})

test("a repeated total is never a day of zero streams, and the jump around it isn't a day's gain", () => {
  // Killin' It Girl, Oct 2026: +600k into the 24th, the 24th repeated on the 25th.
  const s = summariseSeries(series({
    '2026-10-22': 363_722_900, '2026-10-23': 363_977_743, '2026-10-24': 364_578_011,
    '2026-10-25': 364_578_011, '2026-10-26': 364_908_762, '2026-10-27': 365_215_555,
  }), '2026-10-27')
  const kind = Object.fromEntries(s.days.map((d) => [d.day, d.kind]))
  assert.equal(kind['2026-10-24'], 'spans_repeat')
  assert.equal(kind['2026-10-25'], 'repeat')
  assert.equal(kind['2026-10-26'], 'spans_repeat')
  assert.equal(kind['2026-10-27'], 'gain')
  assert.deepEqual(s.latestGain, { day: '2026-10-27', streams: 306_793 })
  for (const d of s.days) if (d.kind !== 'gain' && d.kind !== 'correction') assert.equal(d.gain, null)
})

test('a missing day breaks the chain: no gain across a gap', () => {
  const s = summariseSeries(series({ '2026-09-04': 100, '2026-09-06': 300, '2026-09-07': 450 }), '2026-09-07')
  const kind = Object.fromEntries(s.days.map((d) => [d.day, d.kind]))
  assert.equal(kind['2026-09-05'], 'missing')
  assert.equal(kind['2026-09-06'], 'gap')
  assert.deepEqual(s.latestGain, { day: '2026-09-07', streams: 150 })
})

test('a Spotify correction is labelled, never counted as a gain', () => {
  // Haegeum, 2026-10-03: down ~298k.
  const s = summariseSeries(series({ '2026-10-01': 865_500_000, '2026-10-02': 865_979_138, '2026-10-03': 865_681_048 }), '2026-10-03')
  assert.equal(s.days.at(-1).kind, 'correction')
  assert.equal(s.days.at(-1).gain, -298_090)
  assert.deepEqual(s.latestCorrection, { day: '2026-10-03', streams: -298_090 })
  assert.deepEqual(s.latestGain, { day: '2026-10-02', streams: 479_138 })
})

test('a total repeated at the end keeps the date it was first reported', () => {
  const s = summariseSeries(series({ '2026-10-24': 10, '2026-10-25': 20, '2026-10-26': 20, '2026-10-27': 20 }), '2026-10-27')
  assert.equal(s.asOf, '2026-10-25')
  assert.equal(s.latestDay, '2026-10-27')
  assert.equal(s.ageDays, 2)
  assert.equal(s.latestGain, null)  // 24→25 touches the repeated run
})

test('old reports are marked stale with their real age', () => {
  const s = summariseSeries(series({ '2026-10-19': 1, '2026-10-20': 2 }), '2026-10-27')
  assert.equal(s.asOf, '2026-10-20')
  assert.equal(s.ageDays, 7)
  assert.equal(s.stale, true)
  const fresh = summariseSeries(series({ '2026-10-22': 1, '2026-10-23': 2 }), '2026-10-27')
  assert.equal(fresh.stale, false)  // 4 days: still inside one refresh cycle
})

test('reaching the goal caps progress and remaining', () => {
  const s = summariseSeries(series({ '2026-10-27': 1_000_000_001 }), '2026-10-27')
  assert.equal(s.reached, true)
  assert.equal(s.remaining, 0)
  assert.equal(s.percent, 100)
})

test('summariseTracker reports per track and handles a track with no data yet', () => {
  const t = summariseTracker({ '4bjN59DRXFRxBE1g5ne6B1': series({ '2026-10-26': 873_785_880, '2026-10-27': 874_058_865 }) }, '2026-10-28')
  assert.equal(t.tracks.length, 3)
  assert.equal(t.tracks.find((x) => x.id === 'haegeum').summary.total, 874_058_865)
  assert.equal(t.tracks.find((x) => x.id === 'wild-flower').summary, null)
  assert.equal(t.asOf, '2026-10-27')
  assert.equal(t.ageDays, 1)
  assert.equal(t.milestones.length, 2)
  const empty = summariseTracker({}, '2026-10-28')
  assert.equal(empty.asOf, null)
  assert.equal(empty.stale, false)
})

test('the request budget allows one refresh per ~3 days and stays under the free 50', () => {
  const now = Date.parse('2026-10-30T12:20:00Z')
  const ago = (h) => new Date(now - h * 3_600_000).toISOString()
  const base = { requestsInWindow: 3, lastRemaining: 47, lastSuccessAt: ago(72), lastAttemptAt: ago(72) }
  assert.deepEqual(raplineFetchDecision(base, now), { ok: true, reason: 'due' })
  assert.equal(raplineFetchDecision({ ...base, lastSuccessAt: ago(48), lastAttemptAt: ago(48) }, now).reason, 'fresh')
  assert.equal(raplineFetchDecision({ ...base, lastSuccessAt: ago(100), lastAttemptAt: ago(5) }, now).reason, 'cooldown')
  assert.equal(raplineFetchDecision({ ...base, requestsInWindow: 40 }, now).reason, 'budget')
  assert.equal(raplineFetchDecision({ ...base, lastRemaining: 7 }, now).reason, 'quota_floor')
  assert.equal(raplineFetchDecision({ requestsInWindow: 0, lastRemaining: null, lastSuccessAt: null, lastAttemptAt: null }, now).ok, true)

  // Simulate 62 days of the daily cron with every fetch succeeding: no
  // rolling 31-day window may exceed the cap, and the cadence is 3 days.
  const log = []
  const start = Date.parse('2026-11-01T12:20:00Z')
  for (let d = 0; d < 62; d++) {
    const t = start + d * 86_400_000
    const inWindow = log.filter((x) => x > t - RAPLINE_BUDGET.windowDays * 86_400_000)
    const last = log.length ? new Date(log.at(-1)).toISOString() : null
    const decision = raplineFetchDecision({ requestsInWindow: inWindow.length, lastRemaining: null, lastSuccessAt: last, lastAttemptAt: last }, t)
    if (decision.ok) for (let i = 0; i < RAPLINE_TRACKS.length; i++) log.push(t)
  }
  for (const t of log) {
    const windowCount = log.filter((x) => x > t - RAPLINE_BUDGET.windowDays * 86_400_000 && x <= t).length
    assert.ok(windowCount <= RAPLINE_BUDGET.cap && windowCount <= 50, `window count ${windowCount}`)
  }
  const runs = [...new Set(log)]
  for (let i = 1; i < runs.length; i++) assert.equal((runs[i] - runs[i - 1]) / 86_400_000, 3)
})
