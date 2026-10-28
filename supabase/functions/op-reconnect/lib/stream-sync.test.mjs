import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { nextStreamCoverage } from './sync-all.ts'

const result = (overrides = {}) => ({
  ok: true,
  complete: false,
  partialReason: 'recent_limit',
  providerRowCount: 50,
  providerOldestAt: 900,
  providerNewestAt: 1200,
  ...overrides,
})

test('Stats.fm retains its continuous start when the recent window overlaps the checkpoint', () => {
  const next = nextStreamCoverage({
    source: 'statsfm',
    previousSource: 'statsfm',
    previousCoverageFrom: new Date(500 * 1000).toISOString(),
    previousProviderAt: 1000,
    attemptedFrom: 700,
    result: result(),
  })
  assert.equal(next.coverageFrom, 500)
  assert.equal(next.newestProviderAt, 1200)
  assert.equal(next.gapDetected, false)
})

test('Stats.fm restarts coverage when more than the recent window arrived between runs', () => {
  const next = nextStreamCoverage({
    source: 'statsfm',
    previousSource: 'statsfm',
    previousCoverageFrom: new Date(500 * 1000).toISOString(),
    previousProviderAt: 800,
    attemptedFrom: 500,
    result: result({ providerOldestAt: 900 }),
  })
  assert.equal(next.coverageFrom, 900)
  assert.equal(next.gapDetected, true)
})

test('pageable providers extend coverage back to the requested checkpoint', () => {
  const next = nextStreamCoverage({
    source: 'musicat',
    previousSource: 'musicat',
    previousCoverageFrom: new Date(600 * 1000).toISOString(),
    previousProviderAt: 1000,
    attemptedFrom: 500,
    result: result({ complete: true, partialReason: null, providerRowCount: 4 }),
  })
  assert.equal(next.coverageFrom, 500)
  assert.equal(next.gapDetected, false)
})

test('failed requests never advance a checkpoint', () => {
  const next = nextStreamCoverage({
    source: 'listenbrainz', previousProviderAt: 1000, attemptedFrom: 700,
    result: result({ ok: false, complete: false, partialReason: 'provider_error', providerRowCount: 0 }),
  })
  assert.equal(next, null)
})

test('server schedules are source-aware and direct scrobbles are not polled', () => {
  const sql = readFileSync(new URL('../../../migrations/20260925130000_rc_stream_sync_scheduler.sql', import.meta.url), 'utf8')
  assert.match(sql, /'rc-capture-statsfm'[\s\S]*?'\*\/5 \* \* \* \*'/)
  assert.match(sql, /'rc-capture-musicat'[\s\S]*?'2,17,32,47 \* \* \* \*'/)
  assert.match(sql, /'rc-capture-listenbrainz'[\s\S]*?'7,22,37,52 \* \* \* \*'/)
  assert.doesNotMatch(sql, /rc-capture-direct/)
  assert.match(sql, /rc_stream_sync_token/)
})

test('Musicat capture always re-reads a trailing day for late Spotify plays', async () => {
  const { captureFromTs, MUSICAT_LATE_LOOKBACK_SEC } = await import('./sync-all.ts')
  const now = 10_000_000
  // Checkpoint a minute ago: Musicat still starts a day back, others at the checkpoint.
  assert.equal(captureFromTs('musicat', now - 60, now, 7 * 86400), now - MUSICAT_LATE_LOOKBACK_SEC)
  assert.equal(captureFromTs('statsfm', now - 60, now, 7 * 86400), now - 360)
  assert.equal(captureFromTs('listenbrainz', now - 60, now, 7 * 86400), now - 360)
  // A checkpoint older than a day is still honoured, so nothing older is skipped.
  assert.equal(captureFromTs('musicat', now - 3 * 86400, now, 7 * 86400), now - 3 * 86400 - 300)
  // First run looks back the initial window.
  assert.equal(captureFromTs('musicat', 0, now, 7 * 86400), now - 7 * 86400)
})

test('late plays reopen only the closed KST days they belong to', async () => {
  const { closedDaysFor } = await import('./streams.ts')
  const at = (iso) => Math.floor(Date.parse(iso) / 1000)
  // 2026-10-27T16:00Z is 2026-10-28 01:00 KST.
  assert.deepEqual(closedDaysFor([
    at('2026-10-27T08:07:00Z'), at('2026-10-27T07:30:00Z'), at('2026-10-26T21:31:00Z'), at('2026-10-27T16:00:00Z'),
  ], '2026-10-28'), ['2026-10-27'])
  assert.deepEqual(closedDaysFor([at('2026-10-28T01:00:00Z')], '2026-10-28'), [])
  assert.deepEqual(closedDaysFor([], '2026-10-28'), [])
})
