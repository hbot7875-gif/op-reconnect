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

import { canonicalStreamRows, canonicalStreamResult, countIngestionDuplicates } from './stream-canonical.ts'
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
  // js/settings-streams.js and public/js/moon-station.js map this id to a label.
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

// ── the A/B shape asymmetry, measured on production 2026-10-02 ─────────────
//
// Stats.fm serves a play in one of two shapes, consistently per account at a
// given time, and every one of the 27 Stats.fm agents holds both historically:
//
//   Shape A  streamId present, endTime truncated to the minute
//   Shape B  streamId absent,  endTime second-precision, carries contextId
//            and a top-level durationMs (the play's own length)
//
// Post-deploy writes split perfectly: minute-aligned 127/128 carry an id,
// second-precision 0/65 do. So streamId identifies the A-side only, and can
// never match an A row to its B twin -- which is why it is still not a dedup
// key. These tests pin the consequences for the review layer.

test('a 1A + many-B minute is refused, not guessed at', () => {
  // AGENT160's real shape: one minute-aligned row plus five second-precision
  // rows of one track inside 55 seconds. Which B is the A's twin is
  // indeterminate, and no field present in BOTH shapes can decide it: the
  // only B-side discriminators (contextId, play durationMs) are absent from A,
  // and A's only discriminator (streamId) is absent from B. 43 such groups
  // exist in production, which is why ingestion dedup is not built on this.
  const rows = [
    sfm('SWIM', BASE),
    ...[9, 21, 30, 45, 55].map((s) => sfm('SWIM', BASE + s)),
  ]
  assert.equal(canonicalStreamRows(rows).length, 6, 'every row must survive')
  assert.equal(countIngestionDuplicates(rows), 0)
})

test('a many-B minute with no A side is left alone', () => {
  // 138 such groups exist. They are either real rapid replays or a SECOND,
  // separate duplication defect (clusters of second-precision rows seconds
  // apart). Either way it is a reviewer's call, not ours to erase.
  const rows = [4, 5, 6, 8, 10].map((s) => sfm("Killin' It Girl", BASE + s))
  assert.equal(canonicalStreamRows(rows).length, 5)
})

test('the fingerprint can never span two tracks or two artists', () => {
  // Grouping is by normalised track AND artist, so these are structurally
  // impossible rather than merely unobserved. Production confirms zero of each.
  const twoTracks = [sfm('SWIM', BASE), sfm('NORMAL', BASE + 37)]
  assert.equal(canonicalStreamRows(twoTracks).length, 2)
  const twoArtists = [sfm('SWIM', BASE, 'BTS'), sfm('SWIM', BASE + 37, 'Chase Atlantic')]
  assert.equal(canonicalStreamRows(twoArtists).length, 2)
})

test('an A-side row is recognisable without consulting arrival order', () => {
  // Shape, not timing of import, is what tells the two representations apart.
  // 3.1% of pairs arrived aligned-first, so arrival order is not a signal.
  const aligned = sfm('SWIM', BASE)
  const precise = sfm('SWIM', BASE + 37)
  assert.equal(aligned.listened_at % 60, 0, 'A-side sits on the minute')
  assert.notEqual(precise.listened_at % 60, 0, 'B-side does not')
  for (const order of [[aligned, precise], [precise, aligned]]) {
    const out = canonicalStreamRows(order)
    assert.equal(out.length, 1)
    assert.equal(out[0].listened_at, BASE + 37, 'the B-side always survives')
  }
})

test('capturing the event id still never affects what is stored or counted', () => {
  // Defence in depth for the Phase 2 decision: the column exists, and it is
  // still inert. If this ever fails, an un-approved dedup identity shipped.
  const streams = readFileSync(new URL('./streams.ts', import.meta.url), 'utf8')
  const code = streams.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.ok(code.includes("onConflict: 'agent_no,listened_at,track_name'"))
  assert.ok(!/source_event_id[^\n]*(onConflict|\.eq\(|exists|dedup)/i.test(code))
  // And no ingestion path may consult the canonical layer.
  assert.ok(!/stream-canonical/.test(code))
})

// ── guards for the clustered-B investigation (2026-10-02) ─────────────────
//
// Observed directly by polling one account's /streams/recent feed: at 09:02:36
// it returned 45 plays in shape A (minute-aligned, streamId, no play
// duration); 34 seconds later the SAME 45 plays came back in shape B
// (second-precision, no streamId, with contextId and a play duration). The
// A/B duplication is that flip, and alignment is therefore a reliable shape
// proxy -- shape-B feeds showed a 0-4% aligned rate, which is just the 1-in-60
// chance of a play ending on the minute.
//
// Separately, 182 "B clusters" exist: 2+ second-precision rows for one
// agent/track/artist inside one minute, 81% written in a single batch (so
// present together in one response). Shape B reports durationMs == the full
// track length, so each record claims a COMPLETE play -- and for 123 of 123
// clusters whose track length is known, the rows are far too close together
// for that to be possible (e.g. 12 rows of a 179s track spanning 15s).
//
// That makes a correct cluster rule provider-backed rather than a timing
// guess -- but it needs the provider's duration, which rc_scrobbles does not
// store. So no cluster rule is implemented here, and these guard that nobody
// adds a bare time-window one instead.

test('the canonical layer has no bare "same song within N seconds" rule', () => {
  const code = readFileSync(new URL('./stream-canonical.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  // The ONLY timestamp arithmetic allowed is the minute bucket and the
  // on-the-minute test. A gap/window comparison would mean a heuristic crept
  // in that could erase a real repeated listen.
  assert.ok(!/listened_at\s*[-+]\s*\w+\s*[<>]/.test(code), 'no gap comparison may appear here')
  assert.ok(!/\b(gap|within|SECONDS|WINDOW|THRESHOLD)\b/i.test(code), 'no window/threshold rule may appear here')
  // What is allowed, and must stay:
  assert.ok(code.includes('% 60 === 0'), 'the on-the-minute shape test must remain')
  assert.ok(/Math\.floor\(\s*row\.listened_at\s*\/\s*60\s*\)/.test(code), 'the minute bucket must remain')
})

test('a cluster is still refused no matter how many rows it holds', () => {
  // The widest real cluster was 12 rows spanning 15 seconds. Whatever the
  // size, with no clean one-A-one-B shape the group is a reviewer's call.
  for (const n of [2, 3, 6, 12]) {
    const rows = Array.from({ length: n }, (_, i) => sfm('Come Over', BASE + 3 + i))
    assert.equal(canonicalStreamRows(rows).length, n, `${n}-row cluster must survive intact`)
    assert.equal(countIngestionDuplicates(rows), 0)
  }
  // Adding one A-side row does not make it decidable either.
  const withA = [sfm('Come Over', BASE), ...Array.from({ length: 5 }, (_, i) => sfm('Come Over', BASE + 3 + i))]
  assert.equal(canonicalStreamRows(withA).length, 6)
})

// ── following a play across a collapse (2026-10-04) ───────────────────────
//
// BOTZ renders getSignalLog's stream list, which was never canonicalised, so
// a Stats.fm player saw every play of theirs listed twice with a doubled jam
// count above it. Measured for one agent: 546 stored rows in 24h, 232 of them
// the same plays reported twice.
//
// Collapsing that list exposed a trap: the RE:CELEBRATE badge keys on
// (listened_at, track_name), and the battle ledger holds the minute-aligned
// side for some plays and the second-precision side for others (1,803 aligned
// of 26,880 rows). Dropping the aligned row without carrying its identity
// would have silently un-badged plays that really are in the ledger.

test('a collapsed pair reports the row it set aside', () => {
  const alignedRow = sfm('SWIM', BASE)
  const preciseRow = sfm('SWIM', BASE + 37)
  const { rows, twins } = canonicalStreamResult([alignedRow, preciseRow])
  assert.equal(rows.length, 1)
  assert.equal(rows[0], preciseRow, 'the second-precision row survives')
  assert.deepEqual(twins.get(preciseRow), [alignedRow],
    'the survivor must carry the dropped row, or anything keyed on it is lost')
})

test('a row that was never collapsed has no twins', () => {
  const only = sfm('SWIM', BASE + 11)
  const { rows, twins } = canonicalStreamResult([only, sfm('RUN', BASE + 90)])
  assert.equal(rows.length, 2)
  assert.equal(twins.get(only), undefined)
  assert.equal(twins.size, 0)
})

test('a refused cluster reports no twins, so nothing is quietly re-keyed', () => {
  const rows = [sfm('Come Over', BASE), ...[3, 5, 9].map((s) => sfm('Come Over', BASE + s))]
  const out = canonicalStreamResult(rows)
  assert.equal(out.rows.length, 4)
  assert.equal(out.twins.size, 0)
})

test('canonicalStreamRows and canonicalStreamResult cannot drift', () => {
  // One implementation, two entry points.
  for (const rows of [
    [sfm('SWIM', BASE), sfm('SWIM', BASE + 37)],
    [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 48)],
    [sfm('SWIM', BASE), sfm('SWIM', BASE + 3), sfm('SWIM', BASE + 9)],
    [],
  ]) {
    assert.deepEqual(canonicalStreamRows(rows), canonicalStreamResult(rows).rows)
  }
})

test('getSignalLog judges the canonical list and keeps the battle badge', () => {
  const src = readFileSync(new URL('./signal-log.ts', import.meta.url), 'utf8')
  assert.match(src, /const canonical = canonicalStreamResult\(rows\)/)
  assert.match(src, /canonical\.rows\.map\(/, 'the displayed list must come from the canonical rows')
  assert.doesNotMatch(src, /const allStreams: any\[\] = rows\.map\(/, 'the raw list must not be rendered')
  // The badge has to check the twin too.
  assert.match(src, /canonical\.twins\.get\(r\)/)
  assert.match(src, /ingestionDuplicates/)
})

test('the three review surfaces all import the layer through police-check', () => {
  // police-check is the single gateway, so the self-check, BOTZ and Moon
  // Station cannot disagree about what one play is.
  for (const f of ['signal-log.ts', 'admin-agent.ts']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    assert.match(src, /from '\.\/police-check\.ts'/)
    assert.doesNotMatch(src, /from '\.\/stream-canonical\.ts'/, `${f} must go through police-check`)
  }
})
