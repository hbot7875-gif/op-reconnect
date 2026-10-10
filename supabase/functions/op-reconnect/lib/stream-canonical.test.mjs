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

import { canonicalStreamRows, canonicalStreamResult, countIngestionDuplicates, statsFmRowsToSkip } from './stream-canonical.ts'
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

test('a mixed-source pair is not collapsed by the precision rule', () => {
  // The precision rule is Stats.fm-only: both sides must be that source. A
  // cross-source pair this far apart (37s) is two plays as far as this layer
  // is concerned -- see the cross-source section below for the one narrow
  // case that is not.
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

test('a replay beyond the gap rule raises no gap flag', () => {
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 11 + REPEAT_MIN_GAP_SECONDS + 1)]
  const flags = flagStreamRows(rows).flatMap((t) => t.flags)
  assert.ok(!flags.includes('repeat'), 'the 8-minute window is satisfied')
  // These two plays are still consecutive, which is a separate rule and
  // deliberately a separate flag — the gap being fine does not make a song
  // following itself unremarkable.
  assert.deepEqual(flags, ['back_to_back'])
})

test('the flag ids stay stable so both UIs keep rendering them', () => {
  // js/settings-streams.js and public/js/moon-station.js map these ids to
  // labels and fall back to printing the raw id, so a rename here shows up
  // as gibberish in two admin surfaces.
  const rows = [sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 111)]
  assert.deepEqual(flagStreamRows(rows).find((t) => t.flags.length)?.flags,
    ['repeat', 'back_to_back'])

  const selfCheck = readFileSync(new URL('../../../../js/screen-moon.js', import.meta.url), 'utf8')
  const moon = readFileSync(new URL('../../../../public/js/moon-station.js', import.meta.url), 'utf8')
  for (const [name, src] of [['screen-moon.js', selfCheck], ['moon-station.js', moon]]) {
    assert.match(src, /repeat:/, `${name} must label repeat`)
    assert.match(src, /back_to_back:/, `${name} must label back_to_back`)
  }
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

test('the classifier has exactly two consumers: review and ingest', () => {
  // The classifier decides what a duplicate IS. Two things may ask it: the
  // review surfaces, and the collector deciding whether to write a row.
  // Nothing that counts a stream, awards XP or moves district progress may --
  // those still read rc_scrobbles straight, so a change here can never
  // retroactively alter what somebody has already earned.
  const dir = new URL('./', import.meta.url)
  const allowed = new Set([
    'police-check.ts',             // admin review + the agent self-check
    'streams.ts',                  // persistScrobbles: the one writer of rc_scrobbles
    'stream-canonical.ts',
    'stream-canonical.test.mjs',
  ])
  for (const name of readdirSync(dir)) {
    if (allowed.has(name) || !/\.(ts|js|mjs)$/.test(name)) continue
    const src = readFileSync(new URL(name, dir), 'utf8')
    assert.ok(!/\bfrom\s+['"][^'"]*stream-canonical[^'"]*['"]|\bimport\s*\(\s*['"][^'"]*stream-canonical/.test(src),
      `${name} must not import the canonical layer`)
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

test('the collector declines rows, and never deletes or re-keys them', () => {
  const streams = readFileSync(new URL('./streams.ts', import.meta.url), 'utf8')
  const code = streams.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // Row identity is untouched. The guard changes WHICH rows are offered to the
  // upsert, not what makes two rows the same row, so nothing already stored
  // can be merged, re-keyed or reinterpreted by it.
  assert.ok(code.includes("onConflict: 'agent_no,listened_at,track_name'"))

  // source_event_id stays inert as an identity. streamId is one-sided --
  // 98.2% of minute-aligned rows carry one, 0.0% of second-precision rows
  // ever do -- so it can never link a pair, and must never become a key.
  assert.ok(!/source_event_id[^\n]*(onConflict|\.eq\(|exists|dedup)/i.test(code))

  // The collector must never delete. Declining to write is recoverable on the
  // next poll; deleting a stored play is not.
  assert.ok(!/\.delete\(/.test(code), 'no ingest path may delete a scrobble')

  // The decision has to come from the shared classifier, not a second copy of
  // the rule living in the collector and free to drift from the review view.
  assert.match(code, /statsFmRowsToSkip\(/)
  assert.ok(!/% 60/.test(code), 'the collector must not re-implement alignment')
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
  // This guard originally banned every gap comparison outright. It now
  // permits exactly ONE -- the cross-source double-report window -- because
  // that case was measured and is real (see collapseCrossSourceDoubleReports).
  // What it still refuses is a BARE window rule: a gap test that does not
  // first establish the two rows came from two different reporters. That is
  // the version that erases genuine replays, which is the whole reason the
  // ban was here.
  const comparisons = code.match(/listened_at\s*-\s*\w+\.listened_at\s*[<>]/g) || []
  assert.equal(comparisons.length, 1, 'exactly one gap comparison may exist in this layer')
  assert.equal((code.match(/CROSS_SOURCE_DOUBLE_REPORT_SECONDS/g) || []).length, 2,
    'the one allowed window must be the named cross-source constant, declared and used once')
  assert.ok(/sourceOf\(\w+\)\s*===\s*sourceOf\(\w+\)\)\s*return false/.test(code),
    'the gap comparison must be gated on the two rows coming from different sources')
  assert.ok(!/\b(WINDOW|THRESHOLD)\b/.test(code), 'no second window/threshold rule may appear here')
  // What is allowed, and must stay:
  assert.ok(code.includes('% 60 === 0'), 'the on-the-minute shape test must remain')
  assert.ok(/Math\.floor\(\s*row\.listened_at\s*\/\s*60\s*\)/.test(code), 'the minute bucket must remain')
})

// ── one play, two reporters ───────────────────────────────────────────────
//
// Eleven agents run two scrobble sources at once, so a play can reach
// rc_scrobbles twice by two routes. fetchStreamRows already drops rows
// sharing the exact same second; these are the ones a second or two apart,
// and before this they read as a same-song repeat inside 8 minutes.
//
// The window is five seconds, and these tests exist mainly to hold it there.
// The naive sixty-second version would have been a disaster: measured across
// those eleven agents, same-song cross-source pairs within ten minutes peak
// at ONE TO TWO MINUTES, not at zero. That is a looped playlist heard by two
// scrobblers, not one play reported twice, and collapsing it would have
// deleted thousands of real listens from the evidence.

const other = (track, listened_at, artist = 'BTS', source = 'webhook') =>
  ({ track_name: track, artist_name: artist, listened_at, source })

test('one play reported by two sources two seconds apart is one play', () => {
  const rows = [sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)]
  const out = canonicalStreamResult(rows)
  assert.equal(out.rows.length, 1)
  // The earlier report survives: it is closest to when the play happened,
  // and picking it means the outcome never depends on source ordering.
  assert.equal(at(out.rows[0]), BASE + 11)
  assert.deepEqual(out.twins.get(out.rows[0]), [rows[1]])
})

test('the collapse does not depend on which source is listed first', () => {
  const a = canonicalStreamResult([sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)])
  const b = canonicalStreamResult([other('SWIM', BASE + 13), sfm('SWIM', BASE + 11)])
  assert.equal(a.rows.length, 1)
  assert.equal(b.rows.length, 1)
  assert.equal(at(a.rows[0]), at(b.rows[0]))
})

test('a cross-source double report no longer reads as a repeat', () => {
  const rows = [sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)]
  const flagged = flagStreamRows(rows)
  assert.equal(flagged.length, 1)
  assert.deepEqual(flagged[0].flags, [], 'one play must raise nothing')
})

test('the five-second boundary is exactly where it says it is', () => {
  for (const gap of [1, 2, 3, 5]) {
    assert.equal(canonicalStreamRows([sfm('SWIM', BASE + 10), other('SWIM', BASE + 10 + gap)]).length, 1,
      `${gap}s apart is one double report`)
  }
  for (const gap of [6, 10, 30, 60, 177]) {
    assert.equal(canonicalStreamRows([sfm('SWIM', BASE + 10), other('SWIM', BASE + 10 + gap)]).length, 2,
      `${gap}s apart must stay two plays`)
  }
})

test('the measured real-listening distribution survives untouched', () => {
  // The actual shape of production: a looped playlist, two scrobblers, the
  // same song coming back every minute or two. Every one of these is a
  // genuine separate listen and all of them must still be here.
  const rows = []
  for (let i = 0; i < 10; i++) {
    rows.push(sfm('SWIM', BASE + i * 200))
    rows.push(other('SWIM', BASE + i * 200 + 97))
  }
  assert.equal(canonicalStreamRows(rows).length, 20, 'no real play may be collapsed away')
})

test('two reports of one song from the SAME source are left for the repeat rule', () => {
  // This is the case the review tool exists to surface. If the window rule
  // reached it, a genuine immediate replay would vanish instead of being
  // shown -- so a two-second same-source gap must stay two rows.
  for (const source of ['webhook', 'lb-like', 'listenbrainz', 'musicat']) {
    const rows = [other('SWIM', BASE + 11, 'BTS', source), other('SWIM', BASE + 13, 'BTS', source)]
    assert.equal(canonicalStreamRows(rows).length, 2, `${source} must be untouched`)
    assert.ok(flagStreamRows(rows).some((t) => t.flags.includes('repeat')),
      `${source} replay must still be flagged`)
  }
})

test('a cross-source pair of two different songs is never collapsed', () => {
  assert.equal(canonicalStreamRows([sfm('SWIM', BASE + 11), other('RUN', BASE + 13)]).length, 2)
})

test('two songs sharing a title are not one play, whatever the sources', () => {
  // AGENT000's case, now in the cross-source path: same title, different
  // primary artist, two seconds apart. Two different recordings.
  const rows = [sfm('Life Goes On', BASE + 11, 'Agust D'), other('Life Goes On', BASE + 13, 'BTS')]
  assert.equal(canonicalStreamRows(rows).length, 2)
})

test('an unknown artist can never prove two reports are one play', () => {
  // Deliberately stricter than the Stats.fm precision rule, which tolerates
  // an empty artist because same-source-same-minute already pins the play
  // down. Across two sources there is no such corroboration, so an
  // unidentifiable row cannot be collapsed into anything -- the same
  // reasoning police-check's songKey uses.
  for (const [left, right] of [['', 'BTS'], ['BTS', ''], ['', '']]) {
    const rows = [sfm('SWIM', BASE + 11, left), other('SWIM', BASE + 13, right)]
    assert.equal(canonicalStreamRows(rows).length, 2,
      `artists ${JSON.stringify([left, right])} must not collapse`)
  }
})

test('a featured credit is still the same performer across sources', () => {
  const rows = [sfm('SWIM', BASE + 11, 'Agust D, RM'), other('SWIM', BASE + 13, 'Agust D')]
  assert.equal(canonicalStreamRows(rows).length, 1)
})

test('three sources reporting one play collapse to one, not two', () => {
  const rows = [
    sfm('SWIM', BASE + 11),
    other('SWIM', BASE + 12, 'BTS', 'webhook'),
    other('SWIM', BASE + 14, 'BTS', 'lb-like'),
  ]
  const out = canonicalStreamResult(rows)
  assert.equal(out.rows.length, 1)
  assert.equal(at(out.rows[0]), BASE + 11)
  assert.equal(out.twins.get(out.rows[0]).length, 2, 'both set-aside reports must be recoverable')
})

test('a long cross-source run collapses pairwise and keeps every play', () => {
  // Four plays, each reported twice. Four plays out -- not one, and not
  // eight. A chain rule that walked forwards without re-anchoring would
  // swallow the lot.
  const rows = []
  for (let i = 0; i < 4; i++) {
    rows.push(sfm('SWIM', BASE + i * 240))
    rows.push(other('SWIM', BASE + i * 240 + 2))
  }
  const out = canonicalStreamResult(rows)
  assert.equal(out.rows.length, 4)
  assert.deepEqual(out.rows.map(at), [BASE, BASE + 240, BASE + 480, BASE + 720])
})

test('the Stats.fm precision pair still collapses when a third source is present', () => {
  // Both rules run over the same set; neither may consume the other's rows.
  const rows = [sfm('SWIM', BASE), sfm('SWIM', BASE + 37), other('RUN', BASE + 300)]
  const out = canonicalStreamResult(rows)
  assert.equal(out.rows.length, 2)
  assert.deepEqual(out.rows.map(at), [BASE + 37, BASE + 300])
})

test('rows with no source at all are never cross-collapsed', () => {
  // Pre-classification rows carry no source, so every row looks identical to
  // every other and the same-source guard must catch all of them.
  const rows = unclassified([sfm('SWIM', BASE + 11), sfm('SWIM', BASE + 13)])
  assert.equal(canonicalStreamRows(rows).length, 2)
})

test('cross-source collapses are reported as duplicate reports to the reader', () => {
  // So a collapsed row set never looks like missing data.
  assert.equal(countIngestionDuplicates([sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)]), 1)
  assert.equal(countIngestionDuplicates([sfm('SWIM', BASE + 11), other('SWIM', BASE + 90)]), 0)
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
  // crossSource: false — BOTZ counts "jams today" and its 24h totals off
  // this list, so the cross-source collapse is kept out of it. The Stats.fm
  // precision pair still collapses here, as it always has.
  assert.match(src, /const canonical = canonicalStreamResult\(rows, undefined, \{ crossSource: false \}\)/)
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

// ── the ingest guard (shipped 2026-10-07) ─────────────────────────────────
//
// Review-only canonicalisation stopped the artifact being held against a
// player, but it never stopped it being created: 39,628 pairs by 2026-10-07,
// about 2,500 a day. statsFmRowsToSkip is the refusal at the write itself.
//
// Its contract is narrow on purpose. Declining a write loses nothing a later
// poll cannot bring back; writing a duplicate is repairable and visible. Both
// of those are recoverable. Collapsing two real plays into one is not, so
// every ambiguous shape below has to come out KEPT.

const keptOf = (incoming, stored) => {
  const skip = statsFmRowsToSkip(incoming, stored)
  return incoming.filter((_, i) => !skip.has(i))
}

test('the second representation of a stored play is refused, either way round', () => {
  const aligned = sfm('SWIM', BASE)
  const precise = sfm('SWIM', BASE + 37)
  // B stored, A offered.
  assert.deepEqual(keptOf([aligned], [precise]), [])
  // A stored, B offered. Order-independence is the whole point: Stats.fm
  // flips representation between polls, and 3.1% of pairs arrived A-first.
  assert.deepEqual(keptOf([precise], [aligned]), [])
})

test('a batch carrying both representations writes exactly one row', () => {
  const aligned = sfm('SWIM', BASE)
  const precise = sfm('SWIM', BASE + 37)
  // Whichever the provider listed first survives. Keeping the precise row
  // instead would mean deleting a stored row mid-poll, which the collector
  // must never do -- so the trade is a truncated timestamp, not a lost play.
  assert.deepEqual(keptOf([aligned, precise], []).map((r) => r.listened_at), [BASE])
  assert.deepEqual(keptOf([precise, aligned], []).map((r) => r.listened_at), [BASE + 37])
})

test('a play with no twin is always written', () => {
  assert.equal(keptOf([sfm('SWIM', BASE + 37)], []).length, 1)
  assert.equal(keptOf([sfm('SWIM', BASE)], []).length, 1)
  // A different track, or a different minute, is not a twin.
  assert.equal(keptOf([sfm('SWIM', BASE)], [sfm('NORMAL', BASE + 37)]).length, 1)
  assert.equal(keptOf([sfm('SWIM', BASE)], [sfm('SWIM', BASE + 67)]).length, 1)
})

test('one aligned row and two new plays in a minute keeps all three', () => {
  // The defect that forced the whole-minute rule. Deciding row by row, the
  // first new play paired off against the stored aligned row and was declined,
  // leaving {A, B+41} -- a 1A+1B minute the review layer then collapses AGAIN,
  // so a real play vanished with nothing recording that it had. Counting the
  // minute first sees 1A+2B, which is not the proven shape, and keeps all of
  // it. Overcounting is visible and repairable; this was neither.
  const kept = keptOf([sfm('SWIM', BASE + 12), sfm('SWIM', BASE + 41)], [sfm('SWIM', BASE)])
  assert.deepEqual(kept.map((r) => r.listened_at), [BASE + 12, BASE + 41])
})

test('ambiguity is written, never guessed at', () => {
  // Two second-precision rows in the minute is not the proven shape -- it is
  // either a rapid replay or the separate clustered-B defect. Either way the
  // aligned row is kept and stays visible to a reviewer.
  const twoB = [sfm('SWIM', BASE + 12), sfm('SWIM', BASE + 41)]
  assert.equal(keptOf([sfm('SWIM', BASE)], twoB).length, 1)
  // The opposite side cannot be doubled at all: minute-aligned means
  // listened_at % 60 === 0, so one minute admits exactly one such timestamp,
  // and (agent_no, listened_at, track_name) is unique. A 2A minute is
  // arithmetically impossible rather than merely unobserved.
  assert.equal(BASE % 60, 0)
  assert.equal(keptOf([sfm('SWIM', BASE)], [sfm('SWIM', BASE)]).length, 1,
    'an identical re-send is the upsert’s job, not the guard’s')
})

test('a different artist in the same minute is a different play', () => {
  const kept = keptOf([sfm('SWIM', BASE, 'Chase Atlantic')], [sfm('SWIM', BASE + 37, 'BTS')])
  assert.equal(kept.length, 1)
  // An ABSENT artist still pairs: Stats.fm returns '' often enough that
  // treating it as a mismatch would leave the artifact exactly where it is
  // most common. Same rule the review path uses.
  assert.equal(keptOf([sfm('SWIM', BASE, '')], [sfm('SWIM', BASE + 37, 'BTS')]).length, 0)
})

test('a re-sent row never blocks a collapse it should have allowed', () => {
  // The provider listing the same play twice must not inflate a bucket to
  // two and make the minute look ambiguous. Identity is (listened_at, track).
  const stored = [sfm('SWIM', BASE + 37), sfm('SWIM', BASE + 37)]
  assert.deepEqual(keptOf([sfm('SWIM', BASE)], stored), [])
})

test('the guard agrees with the review layer about the same minute', () => {
  // If these ever disagree, the admin view starts describing a ledger that
  // was written by a different rule -- the drift this module exists to stop.
  const pair = [sfm('SWIM', BASE), sfm('SWIM', BASE + 37)]
  assert.equal(canonicalStreamRows(pair).length, keptOf(pair, []).length)
  const ambiguous = [sfm('SWIM', BASE), sfm('SWIM', BASE + 12), sfm('SWIM', BASE + 41)]
  assert.equal(canonicalStreamRows(ambiguous).length, 3)
  assert.equal(keptOf(ambiguous, []).length, 3)
})

test('an empty batch is a no-op', () => {
  assert.equal(statsFmRowsToSkip([], []).size, 0)
  assert.equal(statsFmRowsToSkip([], [sfm('SWIM', BASE)]).size, 0)
})

// ── a repeat is the same RECORDING, not the same title (2026-10-09) ───────
//
// AGENT000 reported a red "repeated-play pattern" on their own log for
// "Life Goes On — Agust D" at 12:40 followed by "Life Goes On — BTS" at
// 12:43. Two different songs sharing a name. The check compared titles only.
//
// Measured on production: 992 distinct titles are carried by two or more
// different primary artists, and 473 same-title-inside-8-minutes pairs across
// 48 agents are artist mismatches — every one an accusation about a replay
// that never happened.

test('two different songs sharing a title are not a repeat', () => {
  // The exact pair from the report, at the real 2m 45s gap.
  const rows = [
    sfm('Life Goes On', BASE + 120, 'Agust D'),
    sfm('Life Goes On', BASE + 285, 'BTS'),
  ]
  const flagged = flagStreamRows(rows)
  assert.equal(flagged.length, 2)
  for (const f of flagged) {
    assert.deepEqual(f.flags, [], `${f.artist} must not be flagged`)
  }
})

test('the same song actually replayed is still flagged', () => {
  // The check must keep doing its job — this is what it exists for.
  const rows = [
    sfm('Life Goes On', BASE + 120, 'BTS'),
    sfm('Life Goes On', BASE + 285, 'BTS'),
  ]
  const flags = flagStreamRows(rows).flatMap((f) => f.flags)
  // Adjacent as well as inside the window, so both patterns apply.
  assert.deepEqual(flags, ['repeat', 'back_to_back'])
})

test('a featured credit is the same performer, not a different one', () => {
  // Sources disagree about listing featured artists, so comparing the whole
  // credit string would read one play as a different song from the next and
  // quietly stop flagging real repeats.
  const rows = [
    sfm('Haegeum', BASE + 120, 'Agust D'),
    sfm('Haegeum', BASE + 285, 'Agust D, RM'),
  ]
  const flags = flagStreamRows(rows).flatMap((f) => f.flags)
  assert.deepEqual(flags, ['repeat', 'back_to_back'],
    'Agust D and "Agust D, RM" are one performer')
})

test('artist comparison ignores case and surrounding space', () => {
  const rows = [
    sfm('Haegeum', BASE + 120, ' agust d '),
    sfm('Haegeum', BASE + 285, 'Agust D'),
  ]
  assert.deepEqual(flagStreamRows(rows).flatMap((f) => f.flags), ['repeat', 'back_to_back'])
})

test('a missing artist cannot be matched to a known recording', () => {
  // 33 rows in 1,510,754 carry no artist. An earlier version let those match
  // any play of the same title, which rebuilds the exact false positive the
  // primary-artist rule removed: untitled "Haegeum" could be anyone's.
  // Unknown identity produces no evidence, in either direction.
  const rows = [
    sfm('Haegeum', BASE + 120, ''),
    sfm('Haegeum', BASE + 285, 'Agust D'),
  ]
  assert.deepEqual(flagStreamRows(rows).flatMap((f) => f.flags), [])
})

test('a missing artist cannot be matched the other way round either', () => {
  const rows = [
    sfm('Life Goes On', BASE + 120, 'Agust D'),
    sfm('Life Goes On', BASE + 285, ''),
  ]
  assert.deepEqual(flagStreamRows(rows).flatMap((f) => f.flags), [],
    'the second play could just as easily be the BTS song')
})

test('a missing artist followed by a known one is still unknown', () => {
  const rows = [
    sfm('Life Goes On', BASE + 120, ''),
    sfm('Life Goes On', BASE + 285, 'BTS'),
  ]
  assert.deepEqual(flagStreamRows(rows).flatMap((f) => f.flags), [])
})

test('two plays that both lack an artist match nothing, including each other', () => {
  // Unknown and unknown is not a pair. Neither can be placed, so neither can
  // be evidence about the other.
  const rows = [
    sfm('Haegeum', BASE + 120, ''),
    sfm('Haegeum', BASE + 285, ''),
  ]
  assert.deepEqual(flagStreamRows(rows).flatMap((f) => f.flags), [])
})

test('an unidentifiable play still appears in the log, with no new warning', () => {
  // Moon Station is a review surface. A row it cannot identify is shown
  // normally; it does not vanish, and missing metadata is not itself a flag.
  const rows = [
    sfm('Haegeum', BASE + 120, ''),
    sfm('Haegeum', BASE + 285, 'Agust D'),
  ]
  const out = flagStreamRows(rows)
  assert.equal(out.length, 2, 'both plays are listed')
  assert.equal(out.find((r) => r.artist === '')?.sinceSameSong, null,
    'an unidentifiable play reports no same-song gap')
  for (const r of out) assert.deepEqual(r.flags, [])
})

test('a different title is never a repeat, whatever the artist', () => {
  const rows = [
    sfm('Haegeum', BASE + 120, 'Agust D'),
    sfm('AMYGDALA', BASE + 285, 'Agust D'),
  ]
  assert.deepEqual(flagStreamRows(rows).flatMap((f) => f.flags), [])
})

// ── the 8-minute rule measures the same SONG, not the previous row ────────
//
// The window only means what it says if it is measured against the last time
// THIS song played. Comparing adjacent rows meant a single unrelated track in
// between hid the repeat completely.

const flagsOf = (rows) => flagStreamRows(rows).slice().reverse().map((f) => f.flags)

test('one track in between no longer hides a six-minute repeat', () => {
  // The reported failure. SWIM returns after 6 minutes, but the row before it
  // is Film out, so an adjacent comparison saw nothing.
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 3 * MIN, 'BTS'),
    sfm('SWIM', BASE + 6 * MIN, 'BTS'),
  ]
  assert.deepEqual(flagsOf(rows), [[], [], ['repeat']])
})

test('eight minutes exactly is not inside the window', () => {
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 3 * MIN, 'BTS'),
    sfm('SWIM', BASE + 8 * MIN, 'BTS'),
  ]
  assert.equal(REPEAT_MIN_GAP_SECONDS, 8 * MIN)
  assert.deepEqual(flagsOf(rows), [[], [], []])
})

test('a legitimate ten-minute gap stays clean across two fillers', () => {
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 3 * MIN, 'BTS'),
    sfm('Haegeum', BASE + 6 * MIN, 'Agust D'),
    sfm('SWIM', BASE + 10 * MIN, 'BTS'),
  ]
  assert.deepEqual(flagsOf(rows), [[], [], [], []])
})

test('the rule does not depend on adjacency at any distance', () => {
  // Five unrelated tracks in between, still inside the window at the end.
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 1 * MIN, 'BTS'),
    sfm('Haegeum', BASE + 2 * MIN, 'Agust D'),
    sfm('NORMAL', BASE + 3 * MIN, 'BTS'),
    sfm('tokyo', BASE + 4 * MIN, 'RM'),
    sfm('Promise', BASE + 5 * MIN, 'Jimin'),
    sfm('SWIM', BASE + 7 * MIN, 'BTS'),
  ]
  const flags = flagsOf(rows)
  assert.deepEqual(flags[6], ['repeat'], 'six rows apart and still inside 8 minutes')
  assert.deepEqual(flags.slice(0, 6), [[], [], [], [], [], []])
})

test('each song carries its own clock', () => {
  // Two songs interleaved, only one of them repeating too soon.
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Haegeum', BASE + 1 * MIN, 'Agust D'),
    sfm('SWIM', BASE + 9 * MIN, 'BTS'),        // 9 min, clean
    sfm('Haegeum', BASE + 10 * MIN, 'Agust D'), // 9 min, clean
    sfm('SWIM', BASE + 12 * MIN, 'BTS'),        // 3 min since SWIM, flagged
  ]
  assert.deepEqual(flagsOf(rows), [[], [], [], [], ['repeat']])
})

// ── back-to-back is a separate rule from the gap ──────────────────────────

test('a nine-minute replay with nothing in between is consecutive, not a gap breach', () => {
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('SWIM', BASE + 9 * MIN, 'BTS'),
  ]
  assert.deepEqual(flagsOf(rows), [[], ['back_to_back']],
    'the 8-minute rule passes; the plays are still consecutive')
})

test('an immediate replay inside the window carries both patterns', () => {
  // They are separate concepts and both are true here.
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('SWIM', BASE + 2 * MIN, 'BTS'),
  ]
  assert.deepEqual(flagsOf(rows), [[], ['repeat', 'back_to_back']])
})

test('a filler in between is never back-to-back, whatever the gap', () => {
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 3 * MIN, 'BTS'),
    sfm('SWIM', BASE + 6 * MIN, 'BTS'),
  ]
  assert.deepEqual(flagsOf(rows), [[], [], ['repeat']])
})

// ── song identity survives the rewrite ────────────────────────────────────

test('two songs sharing a title still key apart under the last-seen map', () => {
  const rows = [
    sfm('Life Goes On', BASE, 'Agust D'),
    sfm('Life Goes On', BASE + 165, 'BTS'),
  ]
  assert.deepEqual(flagsOf(rows), [[], []])
})

test('a featured credit is still one performer under the last-seen map', () => {
  const rows = [
    sfm('Haegeum', BASE, 'Agust D'),
    sfm('Film out', BASE + 2 * MIN, 'BTS'),
    sfm('Haegeum', BASE + 5 * MIN, 'Agust D, RM'),
  ]
  assert.deepEqual(flagsOf(rows), [[], [], ['repeat']])
})

test('a missing artist is not matched across intervening tracks either', () => {
  // The non-adjacent path uses the same identity as the adjacent one, so an
  // unidentifiable play cannot become evidence just because something else
  // played in between.
  const rows = [
    sfm('Haegeum', BASE, ''),
    sfm('Film out', BASE + 2 * MIN, 'BTS'),
    sfm('Haegeum', BASE + 5 * MIN, 'Agust D'),
  ]
  assert.deepEqual(flagsOf(rows), [[], [], []])
})

test('a known recording still repeats across an unidentifiable play of itself', () => {
  // The unknown row in the middle must neither satisfy nor break the rule:
  // the two Agust D plays are 5 minutes apart and that is what counts.
  const rows = [
    sfm('Haegeum', BASE, 'Agust D'),
    sfm('Haegeum', BASE + 2 * MIN, ''),
    sfm('Haegeum', BASE + 5 * MIN, 'Agust D'),
  ]
  assert.deepEqual(flagsOf(rows), [[], [], ['repeat']])
})

test('sinceSameSong reports the gap the rule actually used', () => {
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 3 * MIN, 'BTS'),
    sfm('SWIM', BASE + 6 * MIN, 'BTS'),
  ]
  const oldestFirst = flagStreamRows(rows).slice().reverse()
  assert.equal(oldestFirst[0].sinceSameSong, null, 'first play of SWIM')
  assert.equal(oldestFirst[1].sinceSameSong, null, 'first play of Film out')
  assert.equal(oldestFirst[2].sinceSameSong, 6 * MIN, 'measured against SWIM, not Film out')
  assert.equal(oldestFirst[2].gapSeconds, 3 * MIN, 'gapSeconds still describes the previous row')
})

test('an ingestion duplicate pair is still never repeat evidence', () => {
  // The Stats.fm precision artifact: one play stored twice, 37s apart. It
  // must stay collapsed before any of this runs, or every duplicated play
  // reads as both a repeat and a back-to-back.
  const rows = [sfm('SWIM', BASE, 'BTS'), sfm('SWIM', BASE + 37, 'BTS')]
  const out = flagStreamRows(rows)
  assert.equal(out.length, 1, 'collapsed to one play')
  assert.deepEqual(out[0].flags, [])
})

test('partial history still suppresses every flag', () => {
  const rows = [
    sfm('SWIM', BASE, 'BTS'),
    sfm('Film out', BASE + 3 * MIN, 'BTS'),
    sfm('SWIM', BASE + 6 * MIN, 'BTS'),
  ]
  const out = flagStreamRows(rows, { trustSequence: false })
  assert.deepEqual(out.flatMap((f) => f.flags), [],
    'an incomplete window cannot support a sequence claim')
})

// ── the collapse stays out of BOTZ's totals ──
//
// Review evidence and a player's own activity feed are different things.
// BOTZ counts "jams today" and its 24h totals off the list getSignalLog
// returns, so a cross-source collapse there would lower a number the
// player reads as theirs. Measured before this was scoped out: 54 rows in
// one day across three agents.

test('crossSource: false leaves a double report in place', () => {
  const rows = [sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)]
  assert.equal(canonicalStreamRows(rows).length, 1, 'review collapses it')
  assert.equal(canonicalStreamRows(rows, undefined, { crossSource: false }).length, 2,
    "BOTZ's list keeps both")
})

test('the Stats.fm precision pair still collapses with crossSource off', () => {
  // That one is not review evidence -- one play written at two precisions
  // is one row of history by any reading, and BOTZ has always collapsed it.
  const rows = [sfm('SWIM', BASE), sfm('SWIM', BASE + 37)]
  assert.equal(canonicalStreamRows(rows, undefined, { crossSource: false }).length, 1)
  assert.equal(at(canonicalStreamRows(rows, undefined, { crossSource: false })[0]), BASE + 37)
})

test('the option defaults to on, so a review surface cannot forget it', () => {
  const rows = [sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)]
  for (const opts of [undefined, {}, { crossSource: true }]) {
    assert.equal(canonicalStreamResult(rows, undefined, opts).rows.length, 1, JSON.stringify(opts))
  }
})

test('both review surfaces still see the collapse through police-check', () => {
  // flagStreamRows and flagExcessStreamDays are Moon Station's two checks;
  // neither may quietly opt out.
  const police = readFileSync(new URL('./police-check.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(police, /crossSource/,
    'the review path must take the default, not disable the collapse')
  const rows = [sfm('SWIM', BASE + 11), other('SWIM', BASE + 13)]
  assert.equal(flagStreamRows(rows).length, 1)
})

test('an unidentifiable row is reported as such rather than as flag-free', () => {
  const rows = [{ track_name: 'SWIM', artist_name: '', listened_at: BASE, source: 'webhook' },
    sfm('SWIM', BASE + 600)]
  const out = flagStreamRows(rows)
  const noArtist = out.find((t) => !t.artist)
  assert.equal(noArtist.identified, false)
  assert.deepEqual(noArtist.flags, [], 'it still raises nothing')
  assert.equal(out.find((t) => t.artist).identified, true)
})
