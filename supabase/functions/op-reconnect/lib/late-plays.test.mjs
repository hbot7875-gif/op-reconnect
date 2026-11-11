import assert from 'node:assert/strict'
import test from 'node:test'
import { copyIndexes, withoutCopies, COPY_WINDOW_SEC } from './listen-copies.ts'
import { isReopenedDay, mergeClosedDay, eligibleAddedPlays, lateXpLedgerRow } from './late-plays.ts'

const lb = (t, name, client) => ({ track_name: name, listened_at: t, source: 'listenbrainz', source_client: client })

test('two apps reporting one ListenBrainz listen count once; a back-to-back repeat counts twice', () => {
  // The importer end-stamps every listen of the reader: each song 170 s on.
  const listens = [0, 400, 800, 1200, 1370] // Butter at 1200 and again at 1370
  const names = ['Dynamite', 'Idol', 'Run', 'Butter', 'Butter']
  const reader = listens.map((t, i) => lb(t, names[i], 'listenbrainz'))
  const importer = listens.map((t, i) => lb(t + 170, names[i], 'ListenBrainz lastfm importer v2'))
  assert.equal(withoutCopies([...reader, ...importer]).length, 5)
})

test('within one feed only a report 1 s after the last one is a resubmission; every other play counts', () => {
  const at = (t) => ({ track_name: 'Butter', listened_at: t, source: 'webhook' })
  assert.equal(withoutCopies([at(100), at(101)]).length, 1)
  assert.equal(withoutCopies([at(100), at(102)]).length, 2)
  assert.equal(withoutCopies([at(100), at(115), at(264)]).length, 3)
  // a 1 s jitter from another app is the same listen too
  assert.equal(withoutCopies([at(100), { ...at(101), source: 'listenbrainz', source_client: 'ListenBrainz lastfm importer v2' }]).length, 1)
  // a chain T, T+1, T+2: T+1 is T's resubmission; T+2 is 2 s after the kept one
  assert.equal(withoutCopies([at(100), at(101), at(102)]).length, 2)
  // the stored one is kept
  assert.deepEqual([...copyIndexes([{ ...at(100), s: false }, { ...at(101), s: true }], (r) => r.s)], [0])
})

test('two devices looping one song with drifting offsets are two plays each time', () => {
  // Same song all day on phone and laptop, but they drift apart: no steady offset.
  const phone = Array.from({ length: 8 }, (_, i) => ({ track_name: 'Butter', listened_at: i * 165, source: 'lb-like' }))
  const laptop = Array.from({ length: 8 }, (_, i) => ({ track_name: 'Butter', listened_at: 40 + i * 165 + (i % 2 ? 60 : -30) * i, source: 'webhook' }))
  assert.equal(withoutCopies([...phone, ...laptop]).length, 16)
})

test('with only a few pairs, only near-simultaneous reports are copies', () => {
  const a = { track_name: 'Butter', listened_at: 1000, source: 'lb-like' }
  assert.equal(withoutCopies([a, { ...a, source: 'webhook', listened_at: 1003 }]).length, 1)
  assert.equal(withoutCopies([a, { ...a, source: 'webhook', listened_at: 1200 }]).length, 2)
})

test('two devices that do not mirror each other keep every play, same song or not', () => {
  // Phone (Pano) and laptop (Web Scrobbler) playing different things, with
  // Butter turning up on both four minutes apart: two real plays.
  const songs = ['Dynamite', 'Film Out', 'Spring Day', 'Euphoria', 'Butter']
  const phone = songs.map((s, i) => ({ track_name: s, listened_at: 1000 + i * 200, source: 'lb-like' }))
  const laptop = ['Fake Love', 'Idol', 'Run', 'Fire', 'Butter'].map((s, i) => ({ track_name: s, listened_at: 1240 + i * 200, source: 'webhook' }))
  assert.equal(withoutCopies([...phone, ...laptop]).length, 10)
  // The same two feeds mirroring every listen: each listen once.
  const mirror = phone.map((r) => ({ ...r, source: 'webhook', listened_at: r.listened_at + 2 }))
  assert.equal(withoutCopies([...phone, ...mirror]).length, 5)
})

test('a mirrored feed still counts a song played twice in a row twice', () => {
  const a = [0, 170, 340].map((t) => ({ track_name: 'Butter', listened_at: t, source: 'lb-like' }))
  const b = [2, 172, 342].map((t) => ({ track_name: 'Butter', listened_at: t, source: 'webhook' }))
  assert.equal(withoutCopies([...a, ...b]).length, 3)
})

test('different sources within the window are one listen, outside it two', () => {
  // A mirror: five songs, each re-reported 100 s later by the other feed.
  const songs = ['Dynamite', 'Butter', 'Idol', 'Run', 'Fire']
  const a = songs.map((n, i) => ({ track_name: n, listened_at: i * 1000, source: 'webhook' }))
  const near = [...a, ...a.map((r) => ({ ...r, source: 'lb-like', listened_at: r.listened_at + COPY_WINDOW_SEC - 10 }))]
  const far = [...a, ...a.map((r) => ({ ...r, source: 'lb-like', listened_at: r.listened_at + COPY_WINDOW_SEC + 1 }))]
  assert.equal(withoutCopies(near).length, 5)
  assert.equal(withoutCopies(far).length, 10)
  // Different songs never collapse.
  assert.equal(withoutCopies([{ track_name: 'Dynamite', listened_at: 0, source: 'webhook' }, { track_name: 'Butter', listened_at: 0, source: 'lb-like' }]).length, 2)
})

test('the kept report is the stored one', () => {
  const rows = [{ track_name: 'Butter', listened_at: 0, source: 'musicat', stored: false }, { track_name: 'Butter', listened_at: 2, source: 'webhook', stored: true }]
  assert.deepEqual([...copyIndexes(rows, (r) => r.stored)], [0])
})

test('a reopened day is one closed, then opened after it ended', () => {
  const end = new Date('2026-11-07T15:00:00Z').toISOString() // 11-08 00:00 KST
  assert.equal(isReopenedDay({ finalized: false, updated_at: end }, '2026-11-07', '2026-11-10'), true)
  assert.equal(isReopenedDay({ finalized: false, updated_at: '2026-11-07T14:59:00Z' }, '2026-11-07', '2026-11-10'), false)
  assert.equal(isReopenedDay({ finalized: true, updated_at: end }, '2026-11-07', '2026-11-10'), false)
})

test('a closed-day recount only adds, and never adds what cannot be reconciled', () => {
  const old = { raw: 10, bucket: { butter: { n: 5, a: { bts: 5 } }, dynamite: { n: 4, a: { bts: 4 } }, film: { n: 1, a: { jungkook: 1 } } } }
  const fresh = { raw: 9, bucket: { butter: { n: 7, a: { bts: 7 } }, dynamite: { n: 2, a: { bts: 2 } }, film: { n: 3, a: { jk: 3 } } } }
  const m = mergeClosedDay(old, fresh)
  assert.equal(m.bucket.butter.n, 7)
  assert.equal(m.bucket.dynamite.n, 4) // fewer stored now: kept
  assert.equal(m.bucket.film.n, 1)     // artist split can't be reconciled: kept
  assert.deepEqual([...m.added], [['butter', 2]])
  assert.equal(m.raw, 12)
})

test('late XP pays only goal plays heard while that district was live', () => {
  const district = { goals: { trackGoals: [{ id: 'g', keys: ['butter'] }], albumGoals: [] }, activated_at: new Date(1000 * 1000).toISOString(), completed_at: new Date(2000 * 1000).toISOString() }
  const rows = [
    { track_name: 'Butter', artist_name: 'BTS', listened_at: 900 },  // before activation
    { track_name: 'Butter', artist_name: 'BTS', listened_at: 1500 },
    { track_name: 'Butter', artist_name: 'BTS', listened_at: 1600 },
  ]
  // Two added, one of the three plays was ineligible: at least one eligible.
  assert.equal(eligibleAddedPlays(new Map([['butter', 2]]), rows, [district], ['bts']), 1)
  assert.equal(eligibleAddedPlays(new Map([['butter', 1]]), rows, [district], ['bts']), 0)
  // Not a goal song, or not allowlisted: nothing.
  assert.equal(eligibleAddedPlays(new Map([['butter', 2]]), rows, [{ ...district, goals: { trackGoals: [], albumGoals: [] } }], ['bts']), 0)
  assert.equal(eligibleAddedPlays(new Map([['butter', 2]]), rows, [district], ['jimin']), 0)
})

test('late XP carries the remainder and never pays a play twice', () => {
  const first = lateXpLedgerRow({ amount: 40, meta: { counted: 400, remainder: 7 } }, 5, 10)
  assert.deepEqual([first.amount, first.xp, first.meta.remainder, first.meta.late_counted, first.meta.counted], [41, 1, 2, 5, 400])
  const second = lateXpLedgerRow(first, 0, 10)
  assert.equal(second.amount, 41)
})

// ── behavioural: ensureDailyRollups on a reopened day ─────────────────
function memoryDb(tables) {
  const match = (row, filters) => filters.every(([op, col, val]) => {
    const v = row[col]
    if (op === 'eq') return String(v) === String(val)
    if (op === 'in') return val.map(String).includes(String(v))
    if (op === 'gte') return v >= val
    if (op === 'lte') return v <= val
    if (op === 'lt') return v < val
    if (op === 'is') return v === val || (val === null && v == null)
    return true
  })
  const db = {
    tables,
    hooks: {},
    rpc: async () => ({ data: null, error: null }),
    from(name) {
      const t = tables[name] || (tables[name] = [])
      const q = { op: 'select', filters: [], order: null, limit: null, range: null, single: false, payload: null, opts: null }
      const run = () => {
        if (q.op === 'upsert') {
          const keys = (q.opts?.onConflict || '').split(',').map((k) => k.trim()).filter(Boolean)
          const out = []
          for (const row of [].concat(q.payload)) {
            const hit = keys.length ? t.find((r) => keys.every((k) => String(r[k]) === String(row[k]))) : null
            if (hit) { if (!q.opts?.ignoreDuplicates) { Object.assign(hit, row); out.push(hit) } } else { t.push({ ...row }); out.push(row) }
          }
          return { data: out, error: null }
        }
        if (q.op === 'update') {
          db.hooks.beforeUpdate?.(name)
          const hits = t.filter((r) => match(r, q.filters))
          for (const r of hits) Object.assign(r, q.payload)
          return { data: hits, error: null }
        }
        let rows = t.filter((r) => match(r, q.filters))
        if (q.order) rows = rows.slice().sort((a, b) => (a[q.order.col] > b[q.order.col] ? 1 : -1) * (q.order.asc ? 1 : -1))
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1)
        if (q.limit != null) rows = rows.slice(0, q.limit)
        if (q.single) return { data: rows[0] ? { ...rows[0] } : null, error: null }
        return { data: rows.map((r) => ({ ...r })), error: null }
      }
      const chain = {
        select() { return chain },
        upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return chain },
        update(p) { q.op = 'update'; q.payload = p; return chain },
        eq(c, v) { q.filters.push(['eq', c, v]); return chain },
        in(c, v) { q.filters.push(['in', c, v]); return chain },
        gte(c, v) { q.filters.push(['gte', c, v]); return chain },
        lte(c, v) { q.filters.push(['lte', c, v]); return chain },
        lt(c, v) { q.filters.push(['lt', c, v]); return chain },
        is(c, v) { q.filters.push(['is', c, v]); return chain },
        order(col, o) { q.order = { col, asc: o?.ascending !== false }; return chain },
        limit(n) { q.limit = n; return chain },
        range(a, b) { q.range = [a, b]; return chain },
        maybeSingle() { q.single = true; return Promise.resolve(run()) },
        then(resolve, reject) { try { resolve(run()) } catch (e) { reject(e) } },
      }
      return chain
    },
  }
  return db
}

async function reopenedFixture() {
  const { todayKst, addDaysStr, kstDayBounds } = await import('./kst.ts')
  const day = addDaysStr(todayKst(), -10)
  const { fromTs, toTs } = kstDayBounds(day)
  const at = (h) => fromTs + h * 3600
  const play = (h, name) => ({ agent_no: 'AGENT900', track_name: name, artist_name: 'BTS', album_name: null, listened_at: at(h), source: 'webhook', source_client: null })
  const db = memoryDb({
    rc_agents: [{ agent_no: 'AGENT900', retired_at: null }],
    rc_daily_activity: [{
      agent_no: 'AGENT900', kst_date: day, raw_streams: 2, finalized: false, mode: 'normal',
      track_counts: { butter: { n: 2, a: { bts: 2 } } },
      // Last counted ten minutes after the day ended, then reopened.
      updated_at: new Date((toTs + 600) * 1000).toISOString(),
    }],
    rc_scrobbles: [play(9, 'Butter'), play(10, 'Butter'), play(12, 'Butter'), play(13, 'Butter'), play(14, 'Dynamite')],
    rc_xp_ledger: [{ agent_no: 'AGENT900', amount: 3, source: 'streams', dedup_key: `streams:AGENT900:${day}`, meta: { counted: 2, remainder: 0 } }],
    // Butter is a goal of a district live from 11:00 that day (restored since).
    rc_player_districts: [{ agent_no: 'AGENT900', status: 'restored', goals: { trackGoals: [{ id: 'g', keys: ['butter'] }], albumGoals: [] }, activated_at: new Date(at(11) * 1000).toISOString(), completed_at: new Date((toTs + 86400 * 3) * 1000).toISOString() }],
    rc_stream_sync_state: [],
  })
  const agent = { agent_no: 'AGENT900', lb_username: null, stream_source_preference: 'direct', statsfm_username: null, musicat_public_id: null }
  const player = { agent_no: 'AGENT900', mode: 'normal', joined_at: new Date((fromTs - 86400 * 30) * 1000).toISOString() }
  const content = { config: { bts_artists: ['bts'], xp_rules: { streamsPerXpByMode: { normal: 1 } } }, goals: [], wards: [], districts: [] }
  const key = `streams:AGENT900:${day}`
  return { db, agent, player, content, day, key, fromTs }
}

test('a reopened day gains its late plays, and pays nothing it cannot prove eligible', async () => {
  const { ensureDailyRollups } = await import('./derive.ts')
  const { db, agent, player, content, day, key } = await reopenedFixture()
  await ensureDailyRollups(db, agent, player, content)
  const row = db.tables.rc_daily_activity.find((r) => r.kst_date === day)
  assert.equal(row.finalized, true)
  assert.deepEqual([row.track_counts.butter.n, row.track_counts.dynamite.n, row.raw_streams], [4, 1, 5])
  // Two Butter plays added; two of the four were heard before the district
  // started, so none of the added two is provably eligible. Dynamite is no goal.
  assert.equal(db.tables.rc_xp_ledger.find((r) => r.dedup_key === key).amount, 3)
  await ensureDailyRollups(db, agent, player, content)
  assert.equal(db.tables.rc_daily_activity.find((r) => r.kst_date === day).track_counts.butter.n, 4)
})

test('late goal plays inside the district window earn XP exactly once', async () => {
  const { ensureDailyRollups } = await import('./derive.ts')
  const { db, agent, player, content, day, key, fromTs } = await reopenedFixture()
  db.tables.rc_player_districts[0].activated_at = new Date((fromTs - 3600) * 1000).toISOString()
  await ensureDailyRollups(db, agent, player, content)
  const ledger = () => db.tables.rc_xp_ledger.filter((r) => r.dedup_key === key)
  assert.deepEqual([ledger().length, ledger()[0].amount, ledger()[0].meta.late_counted], [1, 5, 2])
  // Reopened again with nothing new: no more XP, still one ledger row.
  const row = db.tables.rc_daily_activity.find((r) => r.kst_date === day)
  row.finalized = false
  row.updated_at = new Date().toISOString()
  await ensureDailyRollups(db, agent, player, content)
  assert.deepEqual([ledger().length, ledger()[0].amount], [1, 5])
})

test('a recount that lost the race to a newer reopen writes and pays nothing', async () => {
  const { ensureDailyRollups } = await import('./derive.ts')
  const { db, agent, player, content, day, key, fromTs } = await reopenedFixture()
  db.tables.rc_player_districts[0].activated_at = new Date((fromTs - 3600) * 1000).toISOString()
  // A late play lands (moving updated_at) between the read and the write.
  db.hooks.beforeUpdate = (name) => {
    if (name === 'rc_daily_activity') db.tables.rc_daily_activity[0].updated_at = new Date(Date.now() + 5).toISOString()
    db.hooks.beforeUpdate = null
  }
  await ensureDailyRollups(db, agent, player, content)
  const row = db.tables.rc_daily_activity.find((r) => r.kst_date === day)
  assert.deepEqual([row.finalized, row.track_counts.butter.n], [false, 2])
  assert.equal(db.tables.rc_xp_ledger.find((r) => r.dedup_key === key).amount, 3)
})

test('late plays heard before an active district started go into its baseline, never its progress', async () => {
  const { activationDayBaselineBump } = await import('./late-plays.ts')
  const goals = { trackGoals: [{ id: 'g1', keys: ['butter'] }], albumGoals: [{ id: 'al', tracks: [{ label: 'Dynamite', keys: ['dynamite'] }] }] }
  const act = new Date(5000 * 1000).toISOString()
  const rows = [
    { track_name: 'Butter', listened_at: 4000 }, { track_name: 'Butter', listened_at: 4500 }, { track_name: 'Butter', listened_at: 6000 },
    { track_name: 'Dynamite', listened_at: 7000 },
  ]
  // 2 Butter plays added; two Butter plays were before activation: both go to the baseline.
  assert.deepEqual(activationDayBaselineBump(new Map([['butter', 2], ['dynamite', 1]]), rows, goals, act), { 't:g1': 2, 'xp:goal-streams': 2 })
  // Only 1 added: at most 1 into the baseline.
  assert.deepEqual(activationDayBaselineBump(new Map([['butter', 1]]), rows, goals, act), { 't:g1': 1, 'xp:goal-streams': 1 })
})

test('rows with no recorded app are not one feed: copies of them need a near-simultaneous report', async () => {
  const { UNKNOWN_FEED } = await import('./listen-copies.ts')
  assert.equal(UNKNOWN_FEED, 'listenbrainz:')
  // Historic rows of three apps, stored before the app was recorded.
  const songs = ['Dynamite', 'Butter', 'Idol', 'Run', 'Fire', 'Spring Day']
  const old = songs.map((n, i) => ({ track_name: n, listened_at: i * 400, source: 'listenbrainz', source_client: null, kept: true }))
  // The importer re-reports four of them 1 s later, plus two genuinely new listens.
  const fresh = [
    ...old.slice(0, 4).map((r) => ({ ...r, listened_at: r.listened_at + 1, source_client: 'ListenBrainz lastfm importer v2', kept: false })),
    { track_name: 'Butter', listened_at: 400 + 200, source: 'listenbrainz', source_client: 'listenbrainz', kept: false },
    { track_name: 'Euphoria', listened_at: 3000, source: 'listenbrainz', source_client: 'listenbrainz', kept: false },
  ]
  const all = [...old, ...fresh]
  const idx = copyIndexes(all, (r) => r.kept)
  // The four 1-second copies go; the Butter played again 200 s later and Euphoria stay.
  assert.deepEqual([...idx].sort((a, b) => a - b), [6, 7, 8, 9])
  // Two unknown-app rows never collapse with each other.
  assert.equal(withoutCopies([old[0], { ...old[0], listened_at: 2 }]).length, 2)
})

test('ingest learns the app of older stored ListenBrainz rows from the provider response', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const now = Math.floor(Date.now() / 1000)
  const t0 = now - 7200
  const names = ['Dynamite', 'Butter', 'Idol', 'Run', 'Fire', 'Spring Day', 'Euphoria', 'Mic Drop', 'DNA', 'Fake Love', 'Life Goes On', 'Permission to Dance']
  // Stored before the app was recorded: a mix of the reader's and Pano's reports.
  const stored = names.map((name, i) => ({ listened_at: t0 + i * 400, track_name: name, source: 'listenbrainz', source_client: null }))
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
          if (table === 'rc_scrobbles') return resolve({ data: stored.map((r) => ({ ...r })), error: null })
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
  const md = (name, client) => ({ track_name: name, artist_name: 'BTS', additional_info: { submission_client: client } })
  const listens = [
    // the stored ones, as the provider reports them (reader for even, Pano for odd)
    ...stored.map((r, i) => ({ listened_at: r.listened_at, track_metadata: md(r.track_name, i % 2 ? 'Pano Scrobbler' : 'listenbrainz') })),
    // the importer's end-stamped copies of every one, 170 s later
    ...stored.map((r) => ({ listened_at: r.listened_at + 170, track_metadata: md(r.track_name, 'ListenBrainz lastfm importer v2') })),
    // one listen nobody stored yet
    { listened_at: t0 + 5000, track_metadata: md('Spring Day', 'listenbrainz') },
  ]
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ payload: { listens } }))
  try {
    await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }, t0 - 600, now, 1, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  assert.deepEqual(upserts.map((r) => r.track_name), ['Spring Day'])
})

test('a genuine late listen next to an older stored listen of the same app is stored, not taken for a copy', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const now = Math.floor(Date.now() / 1000)
  const t0 = now - 14400
  // The LB reader's plays of Butter on loop, every 340 s; the ones at even
  // slots were stored long ago (before the app was recorded), the ones in
  // between arrived late and were never stored.
  const storedRows = Array.from({ length: 10 }, (_, i) => ({ listened_at: t0 + i * 340, track_name: 'Butter', source: 'listenbrainz', source_client: null }))
  const lateRows = Array.from({ length: 10 }, (_, i) => ({ listened_at: t0 + i * 340 + 170, track_name: 'Butter' }))
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
          if (table === 'rc_scrobbles') return resolve({ data: storedRows.map((r) => ({ ...r })), error: null })
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
  const md = (name) => ({ track_name: name, artist_name: 'BTS', additional_info: { submission_client: 'listenbrainz' } })
  const listens = [...storedRows, ...lateRows].map((r) => ({ listened_at: r.listened_at, track_metadata: md(r.track_name) }))
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ payload: { listens } }))
  try {
    await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }, t0 - 600, now, 1, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  assert.equal(upserts.length, 10)
})

function pagedDb(storedRows, { failAt = -1 } = {}) {
  const upserts = []
  let reads = 0
  const db = {
    upserts,
    get reads() { return reads },
    from(table) {
      const q = { op: 'select', range: null }
      const chain = {
        select() { return chain }, eq() { return chain }, gte() { return chain }, lte() { return chain },
        in() { return chain }, order() { return chain }, limit() { return chain },
        range(a, b) { q.range = [a, b]; return chain },
        upsert(rows) { q.op = 'upsert'; upserts.push(...rows); return chain },
        update() { q.op = 'update'; return chain },
        maybeSingle: async () => ({ data: table === 'rc_agents' ? { retired_at: null } : null, error: null }),
        then(resolve) {
          if (q.op === 'upsert') return resolve({ data: [] })
          if (table === 'rc_scrobbles') {
            reads++
            if (reads - 1 === failAt) return resolve({ data: null, error: { message: 'boom' } })
            // the API never returns more than 1000 rows per request
            const [a, b] = q.range || [0, 999]
            return resolve({ data: storedRows.slice(a, Math.min(b + 1, a + 1000)).map((r) => ({ ...r })), error: null })
          }
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
  return db
}

test('the stored-row lookup reads every page, so a heavy listener\'s copies are still caught', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const { kstDayBounds, todayKst, addDaysStr } = await import('./kst.ts')
  const now = Math.floor(Date.now() / 1000)
  const t0 = kstDayBounds(addDaysStr(todayKst(), -6)).fromTs
  // 2,500 stored listens (reader), one every 200 s
  const stored = Array.from({ length: 2500 }, (_, i) => ({ listened_at: t0 + i * 200, track_name: `Song ${i % 40}`, source: 'listenbrainz', source_client: 'listenbrainz' }))
  const md = (name, client) => ({ track_name: name, artist_name: 'BTS', additional_info: { submission_client: client } })
  // the provider has them, the importer's end-stamped copies of all of them, and one new listen
  const listens = [
    ...stored.map((r) => ({ listened_at: r.listened_at, track_metadata: md(r.track_name, 'listenbrainz') })),
    ...stored.map((r) => ({ listened_at: r.listened_at + 170, track_metadata: md(r.track_name, 'ListenBrainz lastfm importer v2') })),
    { listened_at: t0 + 2500 * 200 + 50, track_metadata: md('Song 0', 'listenbrainz') },
  ].sort((a, b) => b.listened_at - a.listened_at)
  const db = pagedDb(stored)
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => { const max = Number(/max_ts=(\d+)/.exec(String(url))[1]); return new Response(JSON.stringify({ payload: { listens: listens.filter((l) => l.listened_at <= max).slice(0, 1000) } })) }
  try {
    await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }, t0 - 600, now, 100, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  assert.ok(db.reads >= 3, `read ${db.reads} pages`)
  assert.equal(db.upserts.length, 1)
})

test('if the stored rows cannot all be read, nothing new is stored this run', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const now = Math.floor(Date.now() / 1000)
  const stored = Array.from({ length: 1500 }, (_, i) => ({ listened_at: now - 86400 + i * 50, track_name: 'Butter', source: 'listenbrainz', source_client: 'listenbrainz' }))
  const db = pagedDb(stored, { failAt: 1 })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ payload: { listens: [{ listened_at: now - 100, track_metadata: { track_name: 'Idol', artist_name: 'BTS', additional_info: { submission_client: 'listenbrainz' } } }] } }))
  try {
    await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }, now - 86400 - 600, now, 1, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  assert.equal(db.upserts.length, 0)
})

test('a thin day at the edge of a capture borrows the mirror verdict of the whole batch (ingest only)', async () => {
  const { kstDayBounds } = await import('./kst.ts')
  const d1 = kstDayBounds('2026-11-05').fromTs, d2 = kstDayBounds('2026-11-06').fromTs
  const songs = ['Dynamite', 'Butter', 'Idol', 'Run', 'Fire', 'DNA', 'Euphoria', 'Mic Drop']
  const reader = (t, n) => ({ track_name: n, listened_at: t, source: 'listenbrainz', source_client: 'listenbrainz' })
  const importer = (t, n) => ({ track_name: n, listened_at: t, source: 'listenbrainz', source_client: 'ListenBrainz lastfm importer v2' })
  // Day 1: the importer copies every listen 170 s later (plenty of evidence).
  const day1 = songs.flatMap((n, i) => [reader(d1 + 3600 + i * 600, n), importer(d1 + 3600 + i * 600 + 170, n)])
  // Day 2, at the edge of the window: two listens and their copies.
  const day2 = [reader(d2 + 82000, 'Dynamite'), importer(d2 + 82170, 'Dynamite'), reader(d2 + 82600, 'Butter'), importer(d2 + 82770, 'Butter')]
  const rows = [...day1, ...day2]
  const thin = (idx) => [...idx].filter((i) => i >= day1.length).length
  // Counting (one day's own evidence): too few pairs on day 2, so nothing is taken for a copy there.
  assert.equal(thin(copyIndexes(rows)), 0)
  // Ingest: the two 170 s copies on day 2 are recognised from day 1's pattern.
  assert.equal(thin(copyIndexes(rows, undefined, { acrossDays: true })), 2)
  // A genuine replay on day 2 at an unusual offset is kept.
  const replay = [...rows, reader(d2 + 83500, 'Idol'), importer(d2 + 83500 + 400, 'Idol')]
  const idx = copyIndexes(replay, undefined, { acrossDays: true })
  assert.equal(idx.has(replay.length - 1), false)
})

test('property: nothing ingest stores is a copy in the eyes of counting (randomised multi-app histories)', async () => {
  const { fetchStreamRows } = await import('./streams.ts')
  const { kstDayBounds, todayKst, addDaysStr } = await import('./kst.ts')
  let seed = 20261111
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const songs = ['Butter', 'Dynamite', 'Idol', 'Run', 'Fire', 'DNA', 'Euphoria', 'Mic Drop', 'Danger', 'Spring Day']
  const apps = ['listenbrainz', 'ListenBrainz lastfm importer v2', 'Pano Scrobbler']
  for (let trial = 0; trial < 12; trial++) {
    const now = Math.floor(Date.now() / 1000)
    const start = kstDayBounds(addDaysStr(todayKst(), -3)).fromTs + Math.floor(rand() * 80000)
    // real listens, some repeated back to back
    const listens = []
    let t = start
    while (t < now - 3600) { const song = songs[Math.floor(rand() * songs.length)]; listens.push({ t, song }); t += 150 + Math.floor(rand() * 900); if (rand() < 0.2) { listens.push({ t, song }); t += 200 } }
    // each app reports a share of them with its own steady offset (start/end stamps), sometimes a 1 s jitter repeat
    const reports = []
    apps.forEach((app, k) => {
      const share = [1, 0.9 * rand() + 0.1, rand()][k]
      for (const l of listens) if (rand() < share) {
        const ts = l.t + [0, 170, 2][k]
        reports.push({ listened_at: ts, name: l.song, app })
        if (k === 1 && rand() < 0.05) reports.push({ listened_at: ts + 1, name: l.song, app })
      }
    })
    // half of what existed before the window was already stored (apps unknown)
    const cut = start + 86400
    const seen = new Set()
    const stored = reports.filter((r) => r.listened_at < cut && rand() < 0.5).filter((r) => { const k = `${r.listened_at}|${r.name}`; if (seen.has(k)) return false; seen.add(k); return true })
      .map((r) => ({ listened_at: r.listened_at, track_name: r.name, source: 'listenbrainz', source_client: null }))
      .sort((a, b) => a.listened_at - b.listened_at)
    const db = pagedDb(stored)
    const api = reports.map((r) => ({ listened_at: r.listened_at, track_metadata: { track_name: r.name, artist_name: 'BTS', additional_info: { submission_client: r.app } } })).sort((a, b) => b.listened_at - a.listened_at)
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url) => { const max = Number(/max_ts=(\d+)/.exec(String(url))[1]); return new Response(JSON.stringify({ payload: { listens: api.filter((l) => l.listened_at <= max).slice(0, 1000) } })) }
    try {
      await fetchStreamRows(db, { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }, start - 600, now, 100, { useStoredCoverage: false })
    } finally { globalThis.fetch = realFetch }
    // counting's view: stored rows (apps learnt from the provider, as ingest does) + what was stored now
    const appOf = new Map(reports.map((r) => [`${r.listened_at}|${r.name}`, r.app]))
    const after = [...stored.map((r) => ({ ...r, source_client: appOf.get(`${r.listened_at}|${r.track_name}`) || null, kept: true })), ...db.upserts.map((r) => ({ ...r, kept: false }))]
    const idx = copyIndexes(after, (r) => r.kept)
    const bad = db.upserts.filter((_, i) => idx.has(stored.length + i)).length
    assert.equal(bad, 0, `trial ${trial}: ${bad} stored rows are copies`)
  }
})
