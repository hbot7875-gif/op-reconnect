// The Stats.fm precision-duplicate classification, and the promise that it
// only ever changes what a REVIEWER sees.
//
// Background: Stats.fm reports one physical play twice -- once with a
// second-level endTime, once truncated to the minute. rc_scrobbles keys on
// (agent_no, listened_at, track_name), so the two land as two rows. Measured
// on production 2026-10-02: 27,633 pairs across 26 agents. One player
// reported 20 plays of a track and saw 41.
//
// Moon Station walked consecutive rows and flagged the same track again
// inside 8 minutes, so every duplicated play accused someone who had listened
// once: 15,715 of 22,724 repeat flags (69%).
//
// These tests pin two things. The obvious one is that the artifact collapses.
// The one that matters more is everything that must NOT collapse -- real
// people do replay songs, and a rule loose enough to hide the artifact would
// also hide the genuine repeats Moon Station exists to surface.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { canonicalStreamRows, countIngestionDuplicates } from './stream-canonical.ts'
import { flagStreamRows, flagExcessStreamDays, REPEAT_MIN_GAP_SECONDS } from './police-check.ts'

const sfm = (track, listened_at, artist = 'BTS') =>
  ({ track_name: track, artist_name: artist, listened_at, source: 'statsfm' })
const at = (row) => row.listened_at
const MIN = 60

// A real minute boundary, and the second-precision report of the same play.
// 1_767_199_980 is divisible by 60, so it is the shape of Stats.fm's
// truncated endTime; +37s is that same play reported precisely.
const BASE = 1_767_199_980
assert.equal(BASE % 60, 0, 'fixture base must sit on a minute boundary')

/** The same rows as they looked before this change: stored without a source,
 *  so the classification is inert and nothing collapses. */
const unclassified = (rows) => rows.map(({ source: _drop, ...rest }) => rest)

test('a Stats.fm precision pair collapses, and the precise row is the survivor', () => {
  const rows = [sfm('SWIM', BASE), sfm('SWIM', BASE + 37)]
  const canonical = canonicalStreamRows(rows)
  assert.equal(canonical.length, 1)
  assert.equal(at(canonical[0]), BASE + 37,
    'the second-precision row carries the real timing, which is the whole input to a repeat check')
  assert.equal(countIngestionDuplicates(rows), 1)
})

test('two genuine second-precision plays in one minute are NOT collapsed', () => {
  // Neither sits on the boundary, so this is not the artifact. It is either a
  // real pattern or something a human should look at -- not ours to hide.
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 48)]
  assert.equal(canonicalStreamRows(rows).length, 2)
  assert.equal(countIngestionDuplicates(rows), 0)
})

test('two minute-aligned rows are NOT collapsed', () => {
  const rows = [sfm('SWIM', BASE), sfm('SWIM', BASE + 60)]
  assert.equal(canonicalStreamRows(rows).length, 2)
})

test('an ambiguous group is left entirely intact', () => {
  // Two aligned plus one precise in the same minute is not the proven shape.
  // Under-collapsing costs a reviewer a second look; over-collapsing costs
  // someone a wrong verdict, so every row survives.
  const rows = [sfm('SWIM', BASE), sfm('SWIM', BASE), sfm('SWIM', BASE + 20)]
  assert.equal(canonicalStreamRows(rows).length, 3)
})

test('non-Stats.fm rows are never collapsed, even in the identical shape', () => {
  for (const source of ['webhook', 'lb-like', 'musicat', 'listenbrainz', 'direct', '', null, undefined]) {
    const rows = [
      { track_name: 'SWIM', artist_name: 'BTS', listened_at: BASE, source },
      { track_name: 'SWIM', artist_name: 'BTS', listened_at: BASE + 37, source },
    ]
    assert.equal(canonicalStreamRows(rows).length, 2, `source ${String(source)} must be untouched`)
  }
})

test('a mixed-source pair is not collapsed', () => {
  // Only the Stats.fm artifact was measured. A cross-source duplicate is a
  // different defect with its own investigation.
  const rows = [
    sfm('SWIM', BASE),
    { track_name: 'SWIM', artist_name: 'BTS', listened_at: BASE + 37, source: 'webhook' },
  ]
  assert.equal(canonicalStreamRows(rows).length, 2)
})

test('a different track or a different minute never collapses', () => {
  assert.equal(canonicalStreamRows([sfm('SWIM', BASE), sfm('RUN', BASE + 37)]).length, 2)
  assert.equal(canonicalStreamRows([sfm('SWIM', BASE), sfm('SWIM', BASE + 97)]).length, 2)
})

test('artist disagreement blocks a collapse; a missing artist does not', () => {
  assert.equal(canonicalStreamRows([sfm('SWIM', BASE, 'BTS'), sfm('SWIM', BASE + 37, 'Jimin')]).length, 2)
  // Stats.fm sometimes returns an empty artist. Treating '' as a mismatch
  // would leave the artifact in place for exactly the rows most likely to
  // produce a flag.
  assert.equal(canonicalStreamRows([sfm('SWIM', BASE, ''), sfm('SWIM', BASE + 37, 'BTS')]).length, 1)
})

test('track comparison matches the normalisation flagStreamRows itself uses', () => {
  // If these diverged, a pair Moon Station flags could be one this cannot
  // collapse, and the false positive would survive.
  const rows = [sfm('  swim ', BASE), sfm('SWIM', BASE + 37)]
  assert.equal(canonicalStreamRows(rows).length, 1)
})

test('arrival order is never consulted', () => {
  // The audit disproved "the minute-aligned row is the later import": of
  // 27,746 pairs, 867 (3.1%) arrived aligned-first, by anything from 13
  // seconds to 15 hours. So the survivor is chosen by PRECISION. created_at
  // in either order, or absent entirely, must give the same answer.
  const a = { ...sfm('SWIM', BASE), created_at: '2026-10-02T10:00:00Z' }
  const b = { ...sfm('SWIM', BASE + 37), created_at: '2026-10-01T01:00:00Z' }
  for (const rows of [[a, b], [b, a]]) {
    const canonical = canonicalStreamRows(rows)
    assert.equal(canonical.length, 1)
    assert.equal(at(canonical[0]), BASE + 37)
  }
  const code = readFileSync(new URL('./stream-canonical.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  assert.ok(!code.includes('created_at'), 'no code path may read created_at')
})

test('unrelated rows keep their order and their count', () => {
  const rows = [sfm('RUN', BASE - 600), sfm('SWIM', BASE), sfm('SWIM', BASE + 37), sfm('DNA', BASE + 900)]
  const canonical = canonicalStreamRows(rows)
  assert.deepEqual(canonical.map((r) => r.track_name), ['RUN', 'SWIM', 'DNA'])
  assert.deepEqual(canonical.map(at), [BASE - 600, BASE + 37, BASE + 900])
})

test('an empty or single-row set is returned as a copy, never mutated', () => {
  for (const rows of [[], [sfm('SWIM', BASE)]]) {
    const before = rows.slice()
    const out = canonicalStreamRows(rows)
    assert.notEqual(out, rows, 'callers must not be handed the array they passed in')
    assert.deepEqual(rows, before)
  }
})

// -- what a reviewer now sees ----------------------------------------------

test("AGENT061's reported case: 20 plays read as 20, not 41", () => {
  // Her shape, as fixtures -- not her production rows. 20 plays of one track
  // spaced well clear of the game's 8-minute rule, each with the minute-
  // aligned twin Stats.fm also reported.
  const real = Array.from({ length: 20 }, (_, i) => sfm('SWIM', BASE + 37 + i * 10 * MIN))
  const twins = real.map((r) => sfm('SWIM', r.listened_at - 37))
  const raw = [...real, ...twins].sort((a, b) => a.listened_at - b.listened_at)
  assert.equal(raw.length, 40)

  // Before: the duplicates read as 20 separate too-close replays.
  const before = flagStreamRows(unclassified(raw))
  assert.equal(before.length, 40)
  assert.equal(before.filter((t) => t.flags.includes('repeat')).length, 20)

  // After: 20 plays, and not one accusation.
  const after = flagStreamRows(raw)
  assert.equal(after.length, 20, 'she played it 20 times and the review shows 20')
  assert.equal(after.filter((t) => t.flags.includes('repeat')).length, 0)
  assert.equal(countIngestionDuplicates(raw), 20)
})

test('a genuine too-close replay is still flagged', () => {
  // The whole point of keeping the rule narrow. Two real second-precision
  // plays inside the 8-minute window are what Moon Station exists to surface.
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 111)]
  const flagged = flagStreamRows(rows)
  assert.equal(flagged.length, 2)
  assert.equal(flagged.filter((t) => t.flags.includes('repeat')).length, 1)
  assert.ok(100 < REPEAT_MIN_GAP_SECONDS)
})

test('a replay beyond the gap rule stays unflagged', () => {
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 11 + REPEAT_MIN_GAP_SECONDS + 1)]
  assert.ok(flagStreamRows(rows).every((t) => t.flags.length === 0))
})

test('the flag id stays `repeat` so both UIs keep rendering it', () => {
  // js/settings-streams.js and public/js/botz.js map this id to a label.
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 111)]
  assert.deepEqual(flagStreamRows(rows).find((t) => t.flags.length)?.flags, ['repeat'])
})

test('a partial provider window still refuses to judge timing', () => {
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 111)]
  assert.ok(flagStreamRows(rows, { trustSequence: false }).every((t) => t.flags.length === 0))
})

test('review-day totals stop counting duplicated ingestion rows', () => {
  // A day of ordinary listening crossed a review ceiling only because every
  // play had been stored twice.
  const real = Array.from({ length: 30 }, (_, i) => sfm('SWIM', BASE + 37 + i * 5 * MIN))
  const raw = [...real, ...real.map((r) => sfm('SWIM', r.listened_at - 37))]

  const before = flagExcessStreamDays(unclassified(raw), 'easy')
  const after = flagExcessStreamDays(raw, 'easy')
  const total = (list) => list.reduce((n, d) => n + d.streams, 0)
  assert.ok(total(after) < total(before) || before.length === 0,
    'the duplicated total must come down')
  for (const day of after) {
    const was = before.find((d) => d.date === day.date)
    if (was) assert.ok(day.streams < was.streams)
  }
})

// -- the promise that nothing a player earns moved -------------------------

test('the ingestion dedup key is untouched and nothing dedupes on source_event_id', () => {
  const streams = readFileSync(new URL('./streams.ts', import.meta.url), 'utf8')
  assert.ok(streams.includes("{ onConflict: 'agent_no,listened_at,track_name', ignoreDuplicates: true }"),
    'the rc_scrobbles upsert key must stay exactly as it is until the streamId question is answered')
  const code = streams.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(!/onConflict:[^)]*source_event_id/.test(code),
    'source_event_id must not be part of any conflict target')
  assert.ok(!/\.eq\('source_event_id'/.test(code), 'nothing may branch on source_event_id yet')
})

test('the migration adds the column without constraining it', () => {
  const sql = readFileSync(
    new URL('../../../migrations/20261002090000_rc_scrobbles_source_event_id.sql', import.meta.url), 'utf8')
  const bare = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase()
  assert.ok(bare.includes('add column if not exists source_event_id text'))
  // Look for uniqueness as DDL, not as the word -- the column's own COMMENT
  // says "not part of any uniqueness rule", which is the opposite claim.
  assert.ok(!/create\s+unique\s+index|\bunique\s*\(|add\s+constraint[^;]*unique/.test(bare),
    'a unique index here would start rejecting inserts before the question is answered')
  // NOT NULL / DEFAULT only matter on the column itself. The partial index
  // deliberately says `where source_event_id is not null`, which is what
  // keeps it off the millions of pre-existing rows.
  const addColumn = bare.slice(bare.indexOf('alter table')).split(';')[0]
  assert.ok(!addColumn.includes('not null'), 'the column must stay nullable')
  assert.ok(!addColumn.includes('default'), 'a default would rewrite the table')
  assert.ok(!/\bupdate\b|\bdelete\b/.test(bare), 'no existing row may be rewritten')
  assert.ok(!/alter column|drop column|drop constraint/.test(bare))
})

test('canonicalisation is confined to the review module', () => {
  // If a counting, XP or progress path ever imports this, the "review only"
  // promise is silently gone.
  const dir = new URL('./', import.meta.url)
  const allowed = new Set(['police-check.ts', 'stream-canonical.ts', 'stream-canonical.test.mjs'])
  for (const name of readdirSync(dir)) {
    if (allowed.has(name) || !/\.(ts|js|mjs)$/.test(name)) continue
    const src = readFileSync(new URL(name, dir), 'utf8')
    // An IMPORT, not a mention. streams.ts names the module in a doc comment
    // to explain why it carries `source` at all, which is not a dependency.
    assert.ok(!/\bfrom\s+['"][^'"]*stream-canonical[^'"]*['"]|\bimport\s*\(\s*['"][^'"]*stream-canonical/.test(src),
      `${name} must not import the review-only canonical layer`)
  }
})
