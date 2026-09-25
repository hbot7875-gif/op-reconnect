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
