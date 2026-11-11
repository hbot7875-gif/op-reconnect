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

test('within one feed every play counts, however close (only exact duplicates collapse elsewhere)', () => {
  const at = (t) => ({ track_name: 'Butter', listened_at: t, source: 'webhook' })
  assert.equal(withoutCopies([at(100), at(101)]).length, 2)
  assert.equal(withoutCopies([at(100), at(115), at(264)]).length, 3)
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
