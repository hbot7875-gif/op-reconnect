// Stream Check rows — the "✓ / not BTS" column.
//
// Every fixture below is a row exactly as lib/signal-log.ts builds it, using
// the artist strings from the reported screenshot. The bug being pinned: the
// sheet read `stream.counted`, which getSignalLog has never sent, so every
// row fell to the negative branch and printed "not BTS" — over rows whose
// own artist column said BTS, and while the header counted 867 of 879 plays
// as BTS.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { streamFlag, STREAM_REASON_LABELS, UNKNOWN_REASON_LABEL } from './signal-log-ui.js'
import { normalizeKey, normKeyFull, countedArtistPlays } from '../supabase/functions/op-reconnect/lib/text.ts'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

// rc_config.bts_artists, as production holds it.
const ALLOW = ['bts', '방탄소년단', 'rm', 'jin', 'suga', 'agust d', 'j hope', 'jhope', 'jimin', 'v', 'jung kook', 'jungkook']

/** Reproduces lib/signal-log.ts's own per-row classification verbatim. */
function classify(track, artist, overrides = {}) {
  const key = normKeyFull(track)
  const eligible = countedArtistPlays({ [normalizeKey(artist || '')]: 1 }, ALLOW, key, overrides) > 0
  return { track, artist, key, eligible, reason: eligible ? null : 'artist_not_eligible' }
}

/* ── The rows from the screenshot ──────────────────────────────────────── */

const SCREENSHOT_ROWS = [
  ['Animal', 'Jo Kwon, J-Hope'],
  ['SWIM with SUGA (Melody Version)', 'BTS'],
  ['The Astronaut', 'Jin'],
  ['Come Over', 'BTS'],
  ['Into the Sun', 'BTS'],
  ['Snow Flower (feat. Peakboy)', 'V, Peakboy'],
  ['SWIM', 'BTS'],
  ['FYA', 'BTS'],
  ['NORMAL', 'BTS'],
  ['No. 29', 'BTS'],
  ['Aliens', 'BTS'],
]

for (const [track, artist] of SCREENSHOT_ROWS) {
  test(`"${track}" by ${artist} counts, and is never labelled "not BTS"`, () => {
    const row = classify(track, artist)
    assert.equal(row.eligible, true, 'the classifier already accepted this play')
    const flag = streamFlag(row)
    assert.equal(flag.counted, true)
    assert.equal(flag.label, '✓')
    assert.notEqual(flag.label, 'not BTS')
  })
}

test('a genuinely non-BTS play is still labelled "not BTS"', () => {
  // The label is not being removed — it was being applied to everything.
  const row = classify('Swim', 'Chase Atlantic')
  assert.equal(row.eligible, false)
  assert.equal(row.reason, 'artist_not_eligible')
  assert.deepEqual(streamFlag(row), { counted: false, label: 'not BTS' })
})

test('a solo member, a feature and a collaboration all count', () => {
  // These follow the existing allowlist rules; nothing is broadened here.
  for (const [track, artist] of [
    ['Haegeum', 'Agust D'],
    ['Wild Flower', 'RM'],
    ['Snow Flower (feat. Peakboy)', 'V, Peakboy'],
    ['Animal', 'Jo Kwon, J-Hope'],
  ]) {
    assert.equal(classify(track, artist).eligible, true, `${track} / ${artist}`)
  }
})

test('a play with no artist string counts, as it does everywhere else', () => {
  assert.equal(classify('SWIM', '').eligible, true)
})

/* ── The flag itself ───────────────────────────────────────────────────── */

test('the flag reads the field the backend actually sends', () => {
  // `counted` is the name the sheet used and the backend never had. A row
  // carrying only that must NOT be treated as counted, or the bug returns
  // wearing the opposite sign.
  assert.equal(streamFlag({ counted: true }).counted, false)
  assert.equal(streamFlag({ eligible: true }).counted, true)
})

test('an unknown reason falls back to a neutral label, never a guess', () => {
  assert.equal(streamFlag({ eligible: false, reason: 'something_new' }).label, UNKNOWN_REASON_LABEL)
  assert.equal(streamFlag({ eligible: false, reason: null }).label, UNKNOWN_REASON_LABEL)
  assert.equal(streamFlag({}).label, UNKNOWN_REASON_LABEL)
  assert.equal(streamFlag(null).label, UNKNOWN_REASON_LABEL)
})

test('every label is short enough for the flag column', () => {
  // .sig-flag is an auto-width grid column at 10px mono; a long label
  // squeezes the track and artist columns beside it.
  for (const label of [...Object.values(STREAM_REASON_LABELS), UNKNOWN_REASON_LABEL, '✓']) {
    assert.ok(label.length <= 12, `"${label}" is too long for the flag column`)
  }
})

/* ── The two sides cannot drift apart again ────────────────────────────── */

test('the sheet reads eligible, and no longer reads counted', () => {
  const sheet = read('js/settings-streams.js')
  const fn = sheet.slice(sheet.indexOf('export function signalLogSheet'), sheet.indexOf('function formatGapSeconds'))
  // Executable lines only — the function keeps a comment explaining which
  // field the bug used to read, and that mention is not the bug.
  const code = fn.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /s\.counted/, 'the sheet is reading a field the backend does not send')
  assert.doesNotMatch(code, /'not BTS'/, 'the label must come from the classifier, not a literal in the markup')
  assert.match(code, /streamFlag\(/)
})

test('the backend still classifies with `eligible` and `artist_not_eligible`', () => {
  // If getSignalLog renames either, this fails here rather than silently
  // blanking every flag in the sheet again.
  const backend = read('supabase/functions/op-reconnect/lib/signal-log.ts')
  assert.match(backend, /eligible,\s*\n\s*reason: eligible \? null : 'artist_not_eligible'/)
  assert.match(backend, /counted24h: visibleStreams\.filter\(\(s\) => s\.eligible\)\.length/)
})

test('the header total and the row flags come from the same field', () => {
  // 867 counted / 879 heard must be the count of rows showing ✓.
  const rows = [
    ...SCREENSHOT_ROWS.map(([t, a]) => classify(t, a)),
    classify('Swim', 'Chase Atlantic'),
    classify('Blinding Lights', 'The Weeknd'),
  ]
  const countedByTotals = rows.filter((r) => r.eligible).length
  const countedByFlags = rows.filter((r) => streamFlag(r).counted).length
  assert.equal(countedByFlags, countedByTotals)
  assert.equal(countedByTotals, SCREENSHOT_ROWS.length)
})
