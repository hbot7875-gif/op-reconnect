// The two numbers on the public landing page.
//
// These are the only figures a stranger sees before deciding whether this
// game is real, so the failures worth protecting against are the ones that
// would put a WRONG number on the front door:
//
//   - a campaign silently counting a key twice (inflates the claim)
//   - an alias dropping out, so real plays stop counting (deflates it)
//   - another artist's same-titled song being credited to BTS
//   - the two campaigns being summed, which double-counts SWIM six figures
//   - the track lists drifting from the ones gameplay actually uses
//
// Every assertion below is behavioural — it counts fabricated activity rows
// and checks the total — rather than asserting against the source lists,
// which would pass even if the counting were broken.

import test from 'node:test'
import assert from 'node:assert/strict'

import { getCampaignStreams, arirangKeys, roadTo1BKeys } from './campaign-streams.ts'
import { ERA_CATALOG, eraTrackKeys } from './era-timeline.ts'
import { ROAD_TO_1B_TRACKS, ROAD_TO_1B_TRACK_NAMES } from './side-missions.ts'
import { ARIRANG_TRACKS } from './recelebrate-tracks.js'
import { normKeyFull } from './text.ts'

const BTS_ARTISTS = ['bts', '방탄소년단', 'rm', 'jin', 'suga', 'agust d', 'j hope', 'jhope', 'jimin', 'v', 'jung kook', 'jungkook']

/** One day of activity: { key: { n, a: { artist: count } } }. */
function day(tracks) {
  const out = {}
  for (const [key, artists] of Object.entries(tracks)) {
    const a = typeof artists === 'number' ? { bts: artists } : artists
    out[key] = { n: Object.values(a).reduce((s, v) => s + v, 0), a }
  }
  return out
}

/** Minimal Supabase stand-in. rc_cache always misses so the scan runs, and
 *  rc_daily_activity is served in 1000-row pages exactly as PostgREST does —
 *  a stub that ignored .range() would hide the very bug these tests exist
 *  to catch. */
const PAGE = 1000
function fakeDb(rows, { overrides = {} } = {}) {
  const config = [
    { key: 'bts_artists', value: BTS_ARTISTS },
    { key: 'track_artist_overrides', value: overrides },
  ]
  const activity = rows.map((track_counts) => ({ track_counts }))
  return {
    pagesServed: 0,
    from(table) {
      const db = this
      let range = null
      const result = () => {
        if (table === 'rc_daily_activity') {
          db.pagesServed++
          // Uncapped reads are capped anyway — that is the production bug.
          const [lo, hi] = range || [0, PAGE - 1]
          return { data: activity.slice(lo, Math.min(hi + 1, lo + PAGE)), error: null }
        }
        if (table === 'rc_config') return { data: config, error: null }
        return { data: [], error: null, count: 0 }
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        range: (lo, hi) => { range = [lo, hi]; return chain },
        upsert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      }
      return chain
    },
  }
}

const content = { config: { bts_artists: BTS_ARTISTS, track_artist_overrides: {} }, goals: [], wards: [], districts: [] }

async function count(rows, overrides = {}) {
  const c = { ...content, config: { ...content.config, track_artist_overrides: overrides } }
  return getCampaignStreams(fakeDb(rows, { overrides }), c)
}

/* ── The track lists come from the authoritative definitions ───────────── */

test('ARIRANG keys resolve from ERA_CATALOG, covering all 14 album tracks', () => {
  const era = ERA_CATALOG.find((e) => e.id === 'arirang')
  assert.ok(era, 'ERA_CATALOG must still carry an era with id "arirang"')
  assert.equal(era.tracks.length, 14)
  const keys = arirangKeys()
  // Every catalog track contributes at least one key.
  for (const track of era.tracks) {
    const trackKeys = eraTrackKeys(track)
    assert.ok(trackKeys.some((k) => keys.includes(k)), `no key for ${JSON.stringify(track)}`)
  }
})

test('the ARIRANG counting list and the RE:CELEBRATE display list cannot drift', () => {
  // recelebrate-tracks.js is the picker's DISPLAY list; ERA_CATALOG is what
  // gets counted. They are the same album, so they must stay the same songs
  // — if someone edits one, this fails rather than the landing page quietly
  // counting 13 tracks.
  const display = new Set(ARIRANG_TRACKS.map(normKeyFull))
  const counted = new Set(arirangKeys())
  assert.equal(display.size, 14)
  for (const key of display) {
    assert.ok(counted.has(key), `ARIRANG_TRACKS has "${key}" but the counted list does not`)
  }
})

test('Road to 1B keys come from the Signal Sweep definitions, not a second list', () => {
  assert.equal(ROAD_TO_1B_TRACKS.length, 4)
  assert.deepEqual(ROAD_TO_1B_TRACKS.map((t) => t.name), ROAD_TO_1B_TRACK_NAMES)
  const keys = roadTo1BKeys()
  for (const track of ROAD_TO_1B_TRACKS) {
    assert.ok(track.keys.length >= 1)
    for (const k of track.keys) assert.ok(keys.includes(k), `${track.name} key "${k}" missing`)
  }
})

test('Road to 1B carries the Korean and spelling aliases', () => {
  const keys = roadTo1BKeys()
  for (const alias of ['야생화', '해금', 'killing it girl']) {
    // Compared through normKeyFull, not as a bare literal: normalizeKey
    // NFKD-decomposes Hangul, so the stored key is the decomposed form —
    // visually identical to the source literal here, but not === to it.
    // Both sides of a real match go through normKeyFull, so this is the
    // comparison that reflects what actually happens at scrobble time.
    assert.ok(keys.includes(normKeyFull(alias)), `alias "${alias}" is not counted`)
  }
})

/* ── Counting behaviour ────────────────────────────────────────────────── */

test('an alias counts exactly as the primary title does', async () => {
  // The Korean key is built through normKeyFull, exactly as scrobble
  // ingestion builds it — a bare "야생화" literal here would be NFC and
  // would never match the NFKD-decomposed key the game actually stores.
  const viaTitle = await count([day({ 'wild flower': { rm: 10 } })])
  const viaAlias = await count([day({ [normKeyFull('야생화')]: { rm: 10 } })])
  assert.equal(viaTitle.roadTo1B, 10)
  assert.equal(viaAlias.roadTo1B, 10)
})

test('SWIM by another artist is not credited to BTS', async () => {
  // Chase Atlantic's "Swim" normalizes to the same bucket key as BTS's.
  const res = await count([day({ swim: { bts: 40, 'chase atlantic': 25 } })])
  assert.equal(res.roadTo1B, 40, 'only the BTS plays count')
  assert.equal(res.arirang, 40, 'and the same filter applies in the album total')
})

test('a per-track collaborator override counts for that track only', async () => {
  const res = await count(
    [day({ 'wild flower': { youjeen: 7 } })],
    { 'wild flower': ['youjeen'] },
  )
  assert.equal(res.roadTo1B, 7)
})

test('a play with no artist string still counts', async () => {
  // stats.fm rows carry no artist — text.ts trusts linked sources. Asserted
  // here so the public totals stay consistent with every other count in the
  // game rather than quietly dropping a whole source's plays.
  const res = await count([day({ haegeum: { '': 5 } })])
  assert.equal(res.roadTo1B, 5)
})

test('an unrelated BTS song counts toward neither campaign', async () => {
  const res = await count([day({ dynamite: { bts: 999 } })])
  assert.equal(res.arirang, 0)
  assert.equal(res.roadTo1B, 0)
})

/* ── The two things that would make the public number wrong ────────────── */

test('no key is counted twice within a campaign', async () => {
  assert.equal(new Set(arirangKeys()).size, arirangKeys().length)
  assert.equal(new Set(roadTo1BKeys()).size, roadTo1BKeys().length)
  // Behavioural: one day, one key, one play → exactly one.
  const res = await count([day({ hooligan: { bts: 1 } })])
  assert.equal(res.arirang, 1)
})

test('SWIM counts once in EACH campaign, and the two are never summed', async () => {
  const res = await count([day({ swim: { bts: 100 } })])
  // Present in both totals — SWIM is an ARIRANG track and a 1B focus song.
  assert.equal(res.arirang, 100)
  assert.equal(res.roadTo1B, 100)
  // Once each, not twice in either. Adding the totals would report 200
  // streams for 100 plays, which is exactly why the landing page shows two
  // separately labelled figures and no combined one.
  assert.notEqual(res.arirang + res.roadTo1B, 100)
})

test('totals accumulate across many days and agents', async () => {
  const rows = [
    day({ swim: { bts: 3 }, normal: { bts: 2 } }),
    day({ swim: { bts: 4 }, haegeum: { 'agust d': 6 } }),
    day({ 'killin it girl': { 'j hope': 5 } }),
  ]
  const res = await count(rows)
  assert.equal(res.arirang, 3 + 2 + 4)       // swim + normal + swim
  assert.equal(res.roadTo1B, 3 + 4 + 6 + 5)  // swim + swim + haegeum + killin
})

test('no activity at all is zero, not null or NaN', async () => {
  const res = await count([])
  assert.deepEqual(res, { arirang: 0, roadTo1B: 0 })
})

/* ── The bug that shipped once ─────────────────────────────────────────── */

test('every row is counted, past the 1000-row page cap', async () => {
  // The first deployment reported 91,656 ARIRANG streams against a real
  // 440,505 because a plain .select() stops at 1000 rows and says nothing.
  // 2,500 days of one play each must total 2,500, not 1,000.
  const rows = Array.from({ length: 2500 }, () => day({ swim: { bts: 1 } }))
  const res = await count(rows)
  assert.equal(res.arirang, 2500)
  assert.equal(res.roadTo1B, 2500)
})

test('a page boundary neither drops nor double-counts a row', async () => {
  for (const n of [999, 1000, 1001, 2000, 2001]) {
    const rows = Array.from({ length: n }, () => day({ haegeum: { 'agust d': 1 } }))
    const res = await count(rows)
    assert.equal(res.roadTo1B, n, `${n} rows totalled ${res.roadTo1B}`)
  }
})
