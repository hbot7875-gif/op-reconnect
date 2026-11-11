// One ListenBrainz listen that two or more apps submitted at the same second
// (stored as ONE row, its apps in source_clients). Patterns taken from the
// 2026-11-11 restore dry run: AGENT010 (Last.fm importer + Pano, LB's reader
// ~one track length later), AGENT128/AGENT103 (importer + reader), and the
// small combinations seen for AGENT169, AGENT034, AGENT178, AGENT074, AGENT020.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { copyIndexes, withoutCopies, feedsOf, mergedClients, UNKNOWN_FEED } from './listen-copies.ts'

const IMPORTER = 'ListenBrainz lastfm importer v2'
const PANO = 'Pano Scrobbler'
const READER = 'listenbrainz'
const WEB = 'Web Scrobbler'
const ANDROID = 'ListenBrainz Android'
const SONGS = ['Dynamite', 'Butter', 'Idol', 'Run', 'Fire', 'Spring Day', 'Euphoria', 'Mic Drop', 'DNA', 'Danger']
// A day of real listens, 9:00 KST onwards, one every ~6.5 min; Butter twice back to back.
const DAY = Date.UTC(2026, 9, 13, 0, 0, 0) / 1000
const LISTENS = SONGS.map((name, i) => ({ name, t: DAY + i * 390 })).concat([{ name: 'Butter', t: DAY + 10 * 390 }, { name: 'Butter', t: DAY + 10 * 390 + 200 }])
// The reader stamps the end of a play: a steady offset per song (its length).
const len = (name) => 150 + SONGS.indexOf(name) * 7
const lb = (t, name, client, clients) => ({ track_name: name, listened_at: t, source: 'listenbrainz', source_client: client ?? null, source_clients: clients ?? null })

test('a row several apps reported belongs to all of them; nothing is guessed', () => {
  assert.deepEqual(feedsOf(lb(0, 'Idol', null, [PANO, IMPORTER])), [`listenbrainz:${IMPORTER}`, `listenbrainz:${PANO}`])
  // a recorded single app is kept and joined, never replaced
  assert.deepEqual(feedsOf(lb(0, 'Idol', READER, [IMPORTER, PANO])), [`listenbrainz:${IMPORTER}`, `listenbrainz:${PANO}`, `listenbrainz:${READER}`])
  // no app known: still the unknown feed (no guessing)
  assert.deepEqual(feedsOf(lb(0, 'Idol', null, null)), [UNKNOWN_FEED])
  assert.deepEqual(feedsOf(lb(0, 'Idol', READER, null)), [`listenbrainz:${READER}`])
  // only ListenBrainz rows carry apps
  assert.deepEqual(feedsOf({ track_name: 'Idol', listened_at: 0, source: 'webhook', source_clients: [PANO, IMPORTER] }), ['webhook'])
  assert.deepEqual(mergedClients({ source_client: PANO }, { source_client: IMPORTER }), [IMPORTER, PANO])
  assert.equal(mergedClients({ source_client: PANO }, { source_client: PANO }), null)
})

test('AGENT010: importer+Pano rows and the reader\'s end-stamped copies count once each, repeats still twice', () => {
  const stored = LISTENS.map((l) => lb(l.t, l.name, null, [IMPORTER, PANO]))
  const reader = LISTENS.map((l) => lb(l.t + len(l.name), l.name, READER))
  assert.equal(withoutCopies([...stored, ...reader]).length, LISTENS.length)
  // the multi-app rows are the ones kept
  const idx = copyIndexes([...stored, ...reader])
  assert.ok([...idx].every((i) => i >= stored.length))
  // Before (no apps on these rows) every reader copy counted as a new play.
  const unknown = stored.map((r) => ({ ...r, source_clients: null }))
  assert.equal(withoutCopies([...unknown, ...reader]).length, 2 * LISTENS.length)
})

test('AGENT010: restore candidates that copy a stored multi-app row are not new, a genuinely new listen is', () => {
  const stored = LISTENS.map((l) => ({ ...lb(l.t, l.name, null, [IMPORTER, PANO]), kept: true }))
  const candidates = [
    ...LISTENS.map((l) => ({ ...lb(l.t + len(l.name), l.name, READER), kept: false })),
    { ...lb(DAY + 20000, 'Life Goes On', READER), kept: false },
  ]
  const all = [...stored, ...candidates]
  const idx = copyIndexes(all, (r) => r.kept)
  const inserted = candidates.filter((_, i) => !idx.has(stored.length + i))
  assert.deepEqual(inserted.map((r) => r.track_name), ['Life Goes On'])
})

test('rows sharing an app never collapse with each other beyond the 1-second rule', () => {
  // importer+Pano at T, Pano alone 30 s later: two plays (Pano reported both)
  assert.equal(withoutCopies([lb(DAY, 'Butter', null, [IMPORTER, PANO]), lb(DAY + 30, 'Butter', PANO)]).length, 2)
  // importer alone 1 s later: the importer's 1 s re-import, one listen
  assert.equal(withoutCopies([lb(DAY, 'Butter', null, [IMPORTER, PANO]), lb(DAY + 1, 'Butter', IMPORTER)]).length, 1)
  // importer-only and Pano-only reports of the same song 200 s apart: had they
  // been one listen both apps would carry the same second -> two plays
  const importerOnly = LISTENS.map((l) => lb(l.t, l.name, IMPORTER))
  const panoOnly = LISTENS.slice(0, 3).map((l) => lb(l.t + 200, l.name, PANO))
  const multi = LISTENS.map((l) => lb(l.t + 50000, l.name, null, [IMPORTER, PANO]))
  assert.equal(withoutCopies([...multi, ...importerOnly, ...panoOnly]).length, multi.length + importerOnly.length + panoOnly.length)
})

test('a third app that is a separate device, not a mirror, keeps every play', () => {
  // one song looped on the phone (importer+Pano) and on a laptop (reader),
  // the two drifting apart: no steady offset, so these are two plays each time
  const stored = Array.from({ length: 8 }, (_, k) => lb(DAY + k * 400, 'Butter', null, [IMPORTER, PANO]))
  const reader = Array.from({ length: 8 }, (_, k) => lb(DAY + k * 400 + 40 + k * 37, 'Butter', READER))
  assert.equal(withoutCopies([...stored, ...reader]).length, 16)
})

test('AGENT128 / AGENT103: importer+reader rows next to Pano posting to us directly count once', () => {
  const stored = LISTENS.map((l) => lb(l.t, l.name, null, [IMPORTER, READER]))
  // Pano's own feed (lb-like), stamped 2 s later
  const direct = LISTENS.map((l) => ({ track_name: l.name, listened_at: l.t + 2, source: 'lb-like' }))
  assert.equal(withoutCopies([...stored, ...direct]).length, LISTENS.length)
  // and a later re-read of the same listens by the reader (same second) is the stored row itself
  const again = LISTENS.map((l) => lb(l.t, l.name, READER))
  const seen = new Set(stored.map((r) => `${r.listened_at}|${r.track_name}`))
  assert.ok(again.every((r) => seen.has(`${r.listened_at}|${r.track_name}`)))
})

for (const [agents, apps, third] of [
  ['AGENT010', [IMPORTER, PANO], READER],
  ['AGENT128, AGENT103', [IMPORTER, READER], PANO],
  ['AGENT010 (13 rows)', [IMPORTER, PANO, READER], WEB],
  ['AGENT169 / AGENT034', [PANO, WEB], READER],
  ['AGENT178 / AGENT074', [PANO, READER], IMPORTER],
  ['AGENT020', [ANDROID, READER], IMPORTER],
]) {
  test(`every app combination seen in production: ${apps.join(' + ')} (${agents})`, () => {
    const stored = LISTENS.map((l) => lb(l.t, l.name, null, [...apps].reverse()))
    const copies = LISTENS.map((l) => lb(l.t + len(l.name), l.name, third))
    assert.equal(withoutCopies([...stored, ...copies]).length, LISTENS.length, 'mirrored third app collapses')
    // against each member app on its own, the multi-app row is never a second play
    for (const app of apps) {
      const single = LISTENS.map((l) => lb(l.t + len(l.name), l.name, app))
      assert.equal(withoutCopies([...stored, ...single]).length, 2 * LISTENS.length, `${app} shares the row: its later reports are its own plays`)
    }
  })
}

function db(storedRows) {
  const upserts = [], updates = []
  return {
    upserts, updates,
    from(table) {
      const q = { op: 'select', range: null }
      const chain = {
        select() { return chain }, eq() { return chain }, gte() { return chain }, lte() { return chain },
        in() { return chain }, order() { return chain }, limit() { return chain },
        range(a, b) { q.range = [a, b]; return chain },
        upsert(rows) { q.op = 'upsert'; upserts.push(...rows.map((r) => ({ table, ...r }))); return chain },
        update(v) { q.op = 'update'; updates.push({ table, v }); return chain },
        maybeSingle: async () => ({ data: table === 'rc_agents' ? { retired_at: null } : null, error: null }),
        then(resolve) {
          if (q.op !== 'select') return resolve({ data: [] })
          if (table === 'rc_scrobbles') { const [a, b] = q.range || [0, 999]; return resolve({ data: storedRows.slice(a, b + 1).map((r) => ({ ...r })), error: null }) }
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }
}
const md = (name, client) => ({ track_name: name, artist_name: 'BTS', additional_info: { submission_client: client } })
const agent = { agent_no: 'AGENT900', lb_username: 'x', stream_source_preference: 'lb', statsfm_username: null, musicat_public_id: null }
async function ingest(stored, listens) {
  const { fetchStreamRows } = await import('./streams.ts')
  const d = db(stored)
  const realFetch = globalThis.fetch
  const api = listens.slice().sort((a, b) => b.listened_at - a.listened_at)
  globalThis.fetch = async (url) => { const max = Number(/max_ts=(\d+)/.exec(String(url))[1]); return new Response(JSON.stringify({ payload: { listens: api.filter((l) => l.listened_at <= max).slice(0, 1000) } })) }
  let res
  try {
    const now = Math.floor(Date.now() / 1000)
    res = await fetchStreamRows(d, agent, Math.min(...listens.map((l) => l.listened_at)) - 600, now, 100, { useStoredCoverage: false })
  } finally { globalThis.fetch = realFetch }
  return { d, res, scrobbles: d.upserts.filter((r) => r.table === 'rc_scrobbles') }
}
// Recent listens, all on one KST day (see the midnight note in late-plays.test.mjs).
const recent = () => {
  const now = Math.floor(Date.now() / 1000)
  let t0 = now - 3 * 3600
  const midnight = Math.floor((t0 - 600 + 9 * 3600) / 86400) * 86400 + 86400 - 9 * 3600
  if (midnight <= t0 + 6000) t0 = midnight - 6000
  return LISTENS.map((l) => ({ ...l, t: l.t - DAY + t0 }))
}

test('ingest stores one row per second and title with every app that reported it', async () => {
  const ls = recent()
  const listens = ls.flatMap((l) => [{ listened_at: l.t, track_metadata: md(l.name, PANO) }, { listened_at: l.t, track_metadata: md(l.name, IMPORTER) }])
  const { scrobbles } = await ingest([], listens)
  assert.equal(scrobbles.length, ls.length)
  assert.ok(scrobbles.every((r) => JSON.stringify(r.source_clients) === JSON.stringify([IMPORTER, PANO])))
})

test('ingest judges a third app against stored rows by every app the provider shows, and rewrites nothing stored', async () => {
  const ls = recent()
  // stored by the backfill era with no app (two apps reported each one)
  const stored = ls.map((l) => ({ listened_at: l.t, track_name: l.name, source: 'listenbrainz', source_client: null, source_clients: null }))
  const listens = [
    ...ls.flatMap((l) => [{ listened_at: l.t, track_metadata: md(l.name, PANO) }, { listened_at: l.t, track_metadata: md(l.name, IMPORTER) }]),
    ...ls.map((l) => ({ listened_at: l.t + len(l.name), track_metadata: md(l.name, READER) })),
    { listened_at: ls[0].t + 9000, track_metadata: md('Life Goes On', READER) },
  ]
  const { d, scrobbles } = await ingest(stored, listens)
  assert.deepEqual(scrobbles.map((r) => r.track_name), ['Life Goes On'])
  assert.equal(d.updates.filter((u) => u.table === 'rc_scrobbles').length, 0)
  // stored rows come back from the DB untouched (in-memory learning only)
  assert.ok(stored.every((r) => r.source_clients === null && r.source_client === null))
})

test('ingest uses source_clients already stored, even when the provider no longer returns those reports', async () => {
  const ls = recent()
  const stored = ls.map((l) => ({ listened_at: l.t, track_name: l.name, source: 'listenbrainz', source_client: null, source_clients: [IMPORTER, PANO] }))
  const listens = ls.map((l) => ({ listened_at: l.t + len(l.name), track_metadata: md(l.name, READER) }))
  const { scrobbles } = await ingest(stored, listens)
  assert.equal(scrobbles.length, 0)
})

test('counting merges the apps of one listen whose titles differ only in case', async () => {
  const ls = recent()
  const listens = [
    ...ls.flatMap((l) => [{ listened_at: l.t, track_metadata: md(l.name, IMPORTER) }, { listened_at: l.t, track_metadata: md(l.name.toUpperCase(), PANO) }]),
    ...ls.map((l) => ({ listened_at: l.t + len(l.name), track_metadata: md(l.name, READER) })),
  ]
  const { res } = await ingest([], listens)
  assert.equal(res.rows.length, ls.length)
})

test('the column ships in its own migration, with a check that it only holds 2+ ListenBrainz apps', () => {
  const sql = readFileSync(new URL('../../../migrations/20261111180000_rc_scrobble_source_clients.sql', import.meta.url), 'utf8')
  assert.match(sql, /add column if not exists source_clients text\[\]/)
  assert.match(sql, /source = 'listenbrainz' and cardinality\(source_clients\) >= 2/)
  assert.doesNotMatch(sql, /\bupdate\b|\bdelete\b|source_client\s*=/i)
})
