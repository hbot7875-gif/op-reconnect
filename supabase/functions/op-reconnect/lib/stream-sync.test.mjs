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
  // ListenBrainz re-reads two days for listens other apps sent late, and a
  // week on the once-a-day deep run.
  const { LISTENBRAINZ_LATE_LOOKBACK_SEC, LISTENBRAINZ_DEEP_LOOKBACK_SEC } = await import('./sync-all.ts')
  assert.equal(LISTENBRAINZ_LATE_LOOKBACK_SEC, 48 * 3600)
  assert.equal(captureFromTs('listenbrainz', now - 60, now, 7 * 86400), now - LISTENBRAINZ_LATE_LOOKBACK_SEC)
  assert.equal(captureFromTs('listenbrainz', now - 60, now, 7 * 86400, true), now - LISTENBRAINZ_DEEP_LOOKBACK_SEC)
  assert.equal(captureFromTs('listenbrainz', now - 9 * 86400, now, 7 * 86400), now - 9 * 86400 - 300)
  // deep is ListenBrainz-only.
  assert.equal(captureFromTs('statsfm', now - 60, now, 7 * 86400, true), now - 360)
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

test('reopened days cut off from today are recounted one day at a time', async () => {
  const { splitNeededDays } = await import('./derive.ts')
  // Yesterday still open plus today: one window, as always.
  assert.deepEqual(splitNeededDays(['2026-11-08', '2026-11-09'], '2026-11-09'),
    { trailing: ['2026-11-08', '2026-11-09'], isolated: [] })
  // A day reopened two weeks back must not drag every finalized day since into one fetch.
  assert.deepEqual(splitNeededDays(['2026-10-20', '2026-10-21', '2026-11-07', '2026-11-09'], '2026-11-09'),
    { trailing: ['2026-11-09'], isolated: ['2026-10-20', '2026-10-21', '2026-11-07'] })
  // A new agent's backfill is contiguous and stays one window.
  assert.deepEqual(splitNeededDays(['2026-11-07', '2026-11-08', '2026-11-09'], '2026-11-09'),
    { trailing: ['2026-11-07', '2026-11-08', '2026-11-09'], isolated: [] })
})

test('reopened days older than the backfill window are still recounted', () => {
  const src = readFileSync(new URL('./derive.ts', import.meta.url), 'utf8')
  assert.match(src, /\.eq\('finalized', false\)[\s\S]{0,120}\.lt\('kst_date', windowStart\)/)
})

/** Stub database for the direct-scrobble handlers: every stored play is new,
 *  and the reopen UPDATE is recorded. */
function inboundDb() {
  const reopened = []
  const db = {
    reopened,
    from(table) {
      const state = { table, op: 'select', filters: {} }
      const chain = {
        select() { return chain },
        upsert(row) { state.op = 'upsert'; state.row = row; return chain },
        update(patch) { state.op = 'update'; state.patch = patch; return chain },
        eq(col, val) { state.filters[col] = val; return chain },
        in(col, val) { state.filters[col] = val; return chain },
        is() { return chain },
        maybeSingle: async () => ({ data: { agent_no: 'AGENT900' } }),
        then(resolve) {
          if (state.op === 'upsert') return resolve({ data: [{ listened_at: state.row.listened_at }] })
          if (state.op === 'update' && table === 'rc_daily_activity') reopened.push(state.filters.kst_date)
          return resolve({ data: null })
        },
      }
      return chain
    },
  }
  return db
}

test('a Pano Scrobbler batch posted after its KST day closed reopens that day', async () => {
  const { handleListenBrainzLike } = await import('./scrobble-inbound.ts')
  const db = inboundDb()
  const old = Math.floor(Date.parse('2026-11-01T03:00:00Z') / 1000)
  const body = JSON.stringify({ listen_type: 'import', payload: [
    { listened_at: old, track_metadata: { track_name: 'Butter', artist_name: 'BTS' } },
    { listened_at: old + 200, track_metadata: { track_name: 'Dynamite', artist_name: 'BTS' } },
  ] })
  const req = new Request('https://x/1/submit-listens', { method: 'POST', headers: { Authorization: 'Token pin' }, body })
  const res = await handleListenBrainzLike(db, req, '/1/submit-listens')
  assert.equal(res.status, 200)
  assert.deepEqual(db.reopened, [['2026-11-01']])
})

test('a Web Scrobbler play posted after its KST day closed reopens that day', async () => {
  const { handleWebScrobblerWebhook } = await import('./scrobble-inbound.ts')
  const db = inboundDb()
  const ts = Math.floor(Date.parse('2026-11-02T10:00:00Z') / 1000)
  await handleWebScrobblerWebhook(db, { eventName: 'scrobble', data: { timestamp: ts, song: { processed: { track: 'Butter', artist: 'BTS' } } } }, 'pin')
  assert.deepEqual(db.reopened, [['2026-11-02']])
})

test('a ListenBrainz listen sent behind a newer stored one is still stored', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const now = Math.floor(Date.now() / 1000)
  const newer = now - 600
  const behind = now - 1800 // a second device's listen, submitted after `newer`
  const upserts = []
  const db = {
    from(table) {
      const state = { op: 'select' }
      const chain = {
        select() { return chain }, eq() { return chain }, gte() { return chain }, lte() { return chain },
        in() { return chain }, order() { return chain }, limit() { return chain }, range() { return chain },
        upsert(rows) { state.op = 'upsert'; upserts.push(...rows); return chain },
        update() { state.op = 'update'; return chain },
        maybeSingle: async () => ({ data: table === 'rc_agents' ? { retired_at: null } : null, error: null }),
        then(resolve) {
          if (state.op === 'upsert') return resolve({ data: upserts.map((r) => ({ listened_at: r.listened_at })) })
          if (table === 'rc_scrobbles') return resolve({ data: [{ listened_at: newer, track_name: 'Butter' }], error: null })
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ payload: { listens: [
    { listened_at: newer, track_metadata: { track_name: 'Butter', artist_name: 'BTS' } },
    { listened_at: behind, track_metadata: { track_name: 'Dynamite', artist_name: 'BTS' } },
  ] } }))
  try {
    await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null },
      now - 3600, now, 1, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  assert.deepEqual(upserts.map((r) => r.track_name), ['Dynamite'])
})

test('the fleet sync runs in slices that cover every agent once', async () => {
  const { fleetSlice, sliceOf } = await import('./sync-all.ts')
  // Every agent in exactly one slice, and it stays there whoever else joins.
  const agents = Array.from({ length: 300 }, (_, i) => `AGENT${String(i).padStart(3, '0')}`)
  const seen = new Map()
  for (let s = 0; s < 6; s++) for (const a of agents) if (sliceOf(a, 6) === s) seen.set(a, (seen.get(a) || 0) + 1)
  assert.equal(seen.size, 300)
  assert.ok([...seen.values()].every((n) => n === 1))
  const sizes = [0, 1, 2, 3, 4, 5].map((s) => agents.filter((a) => sliceOf(a, 6) === s).length)
  assert.ok(Math.max(...sizes) < 80, `slices too uneven: ${sizes}`)
  assert.equal(sliceOf('AGENT110', 6), sliceOf('AGENT110', 6))
  assert.deepEqual(fleetSlice({ slice: 2, slices: 6 }), { slice: 2, slices: 6 })
  assert.equal(fleetSlice({}), null)
  assert.equal(fleetSlice({ slice: 6, slices: 6 }), null)
  assert.equal(fleetSlice({ slice: '1', slices: 0 }), null)
  const sql = readFileSync(new URL('../../../migrations/20261110150500_rc_fleet_sync_schedule.sql', import.meta.url), 'utf8')
  for (let i = 0; i < 6; i++) assert.ok(sql.includes(`'rc-fleet-sync-${i}'`) && sql.includes(`rc_invoke_fleet_sync(${i}, 6)`), `slice ${i}`)
  assert.match(sql, /'rc-capture-listenbrainz-deep'/)
  const workflow = readFileSync(new URL('../../../../.github/workflows/hourly-stream-sync.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(workflow, /schedule:/)
})

test('LB rows keep the submitting app, and counting collapses copies', () => {
  const src = readFileSync(new URL('./streams.ts', import.meta.url), 'utf8')
  assert.match(src, /submission_client/)
  assert.match(src, /source_client: source === 'listenbrainz'/)
  assert.match(src, /const out = withoutCopies\(unique\)/)
})

test('another app copy of a stored ListenBrainz listen is not stored, a new listen is', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const now = Math.floor(Date.now() / 1000)
  const t0 = now - 7200
  // Five listens already stored from LB's Spotify reader.
  const stored = ['Butter', 'Dynamite', 'Film Out', 'Spring Day', 'Euphoria'].map((name, i) => ({ listened_at: t0 + i * 200, track_name: name, source: 'listenbrainz', source_client: 'listenbrainz' }))
  const upserts = []
  const db = {
    from(table) {
      const state = { op: 'select' }
      const chain = {
        select() { return chain }, eq() { return chain }, gte() { return chain }, lte() { return chain },
        in() { return chain }, order() { return chain }, limit() { return chain }, range() { return chain },
        upsert(rows) { state.op = 'upsert'; upserts.push(...rows); return chain },
        update() { state.op = 'update'; return chain },
        maybeSingle: async () => ({ data: table === 'rc_agents' ? { retired_at: null } : null, error: null }),
        then(resolve) {
          if (state.op === 'upsert') return resolve({ data: [] })
          if (table === 'rc_scrobbles') return resolve({ data: stored, error: null })
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
  const md = (name, client) => ({ track_name: name, artist_name: 'BTS', additional_info: { submission_client: client } })
  // The Last.fm importer delivers the same five, end-stamped, plus one new listen.
  const listens = [
    ...stored.map((r) => ({ listened_at: r.listened_at + 170, track_metadata: md(r.track_name, 'ListenBrainz lastfm importer v2') })),
    { listened_at: t0 + 1500, track_metadata: md('Idol', 'ListenBrainz lastfm importer v2') },
    ...stored.map((r) => ({ listened_at: r.listened_at, track_metadata: md(r.track_name, 'listenbrainz') })),
  ]
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ payload: { listens } }))
  try {
    await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }, t0 - 600, now, 1, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  assert.deepEqual(upserts.map((r) => [r.track_name, r.source_client]), [['Idol', 'ListenBrainz lastfm importer v2']])
})
