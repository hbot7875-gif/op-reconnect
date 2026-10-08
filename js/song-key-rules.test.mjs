// The client's song-name normalizer, and the goal resolver built on it.
//
// The point of these tests is the drift guard: song-key-rules.js is a hand copy
// of the backend's text.ts, because Vite cannot bundle a Deno/TypeScript module
// out of supabase/functions. If the two ever disagree, Candy Star starts
// resolving goals differently from the way the game counts them, which is the
// exact bug this module was written to fix.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeKey, stripVersionSuffix, normKeyFull, pickCanonicalSong, resolveGoalSong } from './song-key-rules.js'
import {
  normalizeKey as beNormalizeKey,
  stripVersionSuffix as beStripVersionSuffix,
  normKeyFull as beNormKeyFull,
} from '../supabase/functions/op-reconnect/lib/text.ts'

// Real strings from the catalog, district goals and production scrobbles.
const CORPUS = [
  "Killin' It Girl",
  "Killin' It Girl (Solo Version)",
  "Killin' It Girl (feat. GloRilla)",
  'Wild Flower',
  'Wild Flower (with 조유진)',
  'Wild Flower (with youjeen)',
  "they don't know 'bout us",
  'they don’t know ’bout us',
  "Don't Say You Love Me",
  'Don’t Say You Love Me',
  'STOP',
  'STOP (Lollapalooza ver.)',
  'Closer (with Paul Blanco, Mahalia)',
  'Closer (with Paul Blanco & Mahalia)',
  'NORMAL',
  'Normal',
  'NORMAL (Clean Ver.)',
  'No. 29',
  'No 29',
  'Set Me Free Pt.2',
  'Strange (feat. RM)',
  'Strange',
  'Strangers',
  'STRANGER I KNOW',
  'HANGSANG (feat. Supreme Boi)',
  'Hangsang (Feat. Supreme Boi)',
  'Haegeum',
  '해금',
  'Life Goes On',
  'Winter Bear',
  'Winter Flower',
  'Come Over',
  'Come Back Home',
  'Serendipity (Full Length Edition)',
  'Interlude : Showtime',
  'Face-off',
  'ㅠㅠ (Credit Roll)',
  'SWIM with Jimin (Slow Jam R&B Remix)',
  '2.0',
  '',
  '   ',
]

test('the client normalizer agrees with the backend on every corpus string', () => {
  for (const s of CORPUS) {
    assert.equal(normalizeKey(s), beNormalizeKey(s), `normalizeKey disagreed on "${s}"`)
    assert.equal(stripVersionSuffix(s), beStripVersionSuffix(s), `stripVersionSuffix disagreed on "${s}"`)
    assert.equal(normKeyFull(s), beNormKeyFull(s), `normKeyFull disagreed on "${s}"`)
  }
})

test('the mismatches that were losing goal songs now resolve together', () => {
  // Each pair is a district goal label and the catalog's name for the same song,
  // measured on production 2026-10-07.
  const pairs = [
    ["Killin' It Girl", "Killin' It Girl (Solo Version)"],
    ["Killin' It Girl", "Killin' It Girl (feat. GloRilla)"],
    ['Wild Flower', 'Wild Flower (with 조유진)'],
    ['Wild Flower (with youjeen)', 'Wild Flower (with 조유진)'],
    ["they don't know 'bout us", 'they don’t know ’bout us'],
    ["Don't Say You Love Me", 'Don’t Say You Love Me'],
    ['STOP (Lollapalooza ver.)', 'STOP'],
    ['Closer (with Paul Blanco, Mahalia)', 'Closer (with Paul Blanco & Mahalia)'],
    ['Normal', 'NORMAL'],
    ['No. 29', 'No 29'],
  ]
  for (const [goal, cat] of pairs) {
    assert.equal(normKeyFull(goal), normKeyFull(cat), `"${goal}" should key with "${cat}"`)
  }
})

test('a parenthetical holding a TRANSLATED title is not a version suffix', () => {
  // The trap that broke Excusemeee Boulevard's Hangsang goal on 2026-10-06.
  // stripVersionSuffix removes trailing parentheticals, which is right for
  // "(Live)" or "(Instrumental)" — but some titles put the ENGLISH NAME in
  // there, so the half a goal label is written from is the half that gets
  // discarded. 919 of 1,271 Hangsang plays (72%) keyed as "항상" and matched
  // nothing until the Korean alias was added.
  assert.equal(normKeyFull('항상 (HANGSANG)'), normKeyFull('항상'))
  assert.equal(normKeyFull('Hangsang (feat. Supreme Boi)'), 'hangsang')
  assert.notEqual(normKeyFull('항상 (HANGSANG)'), normKeyFull('Hangsang (feat. Supreme Boi)'))
  // Same shape, already handled by an alias since the goal was written.
  assert.equal(normKeyFull('야생화 (Wild Flower)'), normKeyFull('야생화'))
  // So a goal for one of these needs BOTH spellings as keys. Nothing in the
  // normalizer can infer one from the other, and it should not try: collapsing
  // a parenthetical into its stem is what makes "(Live)" work.
})

test('a Korean key is NFD Jamo, not the precomposed syllables you type', () => {
  // The subtler half, and the one that nearly shipped a fix that did nothing.
  // normalizeKey runs NFD to strip diacritics, and NFD also DECOMPOSES Hangul
  // syllables. So the emitted key is Jamo, and a precomposed literal written
  // into a frozen goal's keys array would be stored, match nothing, and look
  // identical in every log and query output.
  const key = normKeyFull('항상 (HANGSANG)')
  assert.equal([...key].map((c) => c.codePointAt(0).toString(16)).join(' '),
    '1112 1161 11bc 1109 1161 11bc')
  assert.notEqual(key, '항상', 'precomposed must NOT equal the key')
  assert.equal(key.normalize('NFC'), '항상', 'but it is the same text')
  // Aliases are safe either way, because goalKeys runs normKeyFull over each
  // one at read time. Only post-normalization keys stored in the frozen
  // rc_player_districts.goals have to be written decomposed.
  assert.equal(normKeyFull('항상'), key)
})

test('a version named only in a parenthetical cannot be told from the original', () => {
  // The other half of the same incident: the quest checklist carried both
  // "Be Mine" and "Be Mine - English Version" as separate entries, but the
  // provider reports the latter as "Be Mine (English Version)". Both reduce to
  // one key, so the English entry was unreachable and the quest unwinnable.
  assert.equal(normKeyFull('Be Mine (English Version)'), 'be mine')
  assert.equal(normKeyFull('Be Mine'), 'be mine')
  // The dash spelling survives, which is exactly why the two disagreed.
  assert.equal(normKeyFull('Be Mine - English Version'), 'be mine english version')
  // Therefore: two checklist entries must never rely on a parenthetical to
  // tell them apart. Same for every other remix/version pair.
  assert.equal(normKeyFull('Like Crazy (English Version)'), normKeyFull('Like Crazy'))
  assert.equal(normKeyFull('Like Crazy (Deep House Remix)'), normKeyFull('Like Crazy'))
})

test('songs that are genuinely different still key apart', () => {
  // The whole risk of normalizing is collapsing two real songs into one.
  const distinct = [
    ['Strange', 'Strangers'],
    ['Strange', 'STRANGER I KNOW'],
    ['Come Over', 'Come Back Home'],
    ['Winter Flower', 'Winter Bear'],
    ['No. 29', 'No. 2'],
    ['Set Me Free Pt.2', 'Set Me Free'],
    ['Wild Flower', 'Running Wild'],
  ]
  for (const [a, b] of distinct) {
    assert.notEqual(normKeyFull(a), normKeyFull(b), `"${a}" must not key with "${b}"`)
  }
})

test('a shared key picks the plainest title, and picks it stably', () => {
  const group = [
    { key: 'c', name: 'STOP (Lollapalooza ver.)' },
    { key: 'a', name: 'STOP' },
    { key: 'b', name: 'STOP (Live)' },
  ]
  assert.equal(pickCanonicalSong(group).key, 'a')
  // Order of the catalog must not change the answer.
  assert.equal(pickCanonicalSong(group.slice().reverse()).key, 'a')
  // Equal-length titles fall back to alphabetical, so it is still stable.
  const tie = [{ key: 'z', name: 'Bbb' }, { key: 'y', name: 'Aaa' }]
  assert.equal(pickCanonicalSong(tie).key, 'y')
  assert.equal(pickCanonicalSong(tie.slice().reverse()).key, 'y')
  assert.equal(pickCanonicalSong([]), null)
  assert.equal(pickCanonicalSong(null), null)
})

test('resolveGoalSong prefers an exact name before normalizing', () => {
  const exactSong = { key: 'exact', name: 'Wild Flower' }
  const normSong = { key: 'norm', name: 'Wild Flower (with 조유진)' }
  const byExact = { 'wild flower': exactSong }
  const byNorm = { 'wild flower': [normSong, exactSong] }
  assert.equal(resolveGoalSong('Wild Flower', byExact, byNorm).key, 'exact')
  // With no exact entry it falls through to the normalized group.
  assert.equal(resolveGoalSong('Wild Flower', {}, byNorm).key, 'exact',
    'the plainest title in the group wins')
  assert.equal(resolveGoalSong("Killin' It Girl", {}, { 'killin it girl': [{ key: 'k', name: "Killin' It Girl (Solo Version)" }] }).key, 'k')
})

test('resolveGoalSong returns null rather than guessing', () => {
  // A goal whose song the catalog genuinely does not have must stay absent, not
  // land on something approximate. Measured: Come Over, Normal, Winter Ahead,
  // No. 29, Set Me Free Pt.2, Strange (feat. RM), NEURON and Winter Flower are
  // all missing from bts_song_catalog, which no amount of normalizing fixes.
  const byNorm = { 'come back home': [{ key: 'cbh', name: 'Come Back Home' }] }
  assert.equal(resolveGoalSong('Come Over', {}, byNorm), null)
  assert.equal(resolveGoalSong('', {}, byNorm), null)
  assert.equal(resolveGoalSong(null, {}, byNorm), null)
  assert.equal(resolveGoalSong('Anything', {}, {}), null)
  assert.equal(resolveGoalSong('Anything', undefined, undefined), null)
})

test('Candy Star resolves goal labels through the normalizing resolver', () => {
  const src = readFileSync(new URL('./candy-star.js', import.meta.url), 'utf8')
  assert.match(src, /import \{ normKeyFull, resolveGoalSong \} from '\.\/song-key-rules\.js'/)
  assert.match(src, /resolveGoalSong\(name, byExactLower, window\._candyStar\.songsByNormKey\)/)
  // The typed-input resolver must keep refusing ambiguous bare names, so it
  // must NOT have been switched over to the normalizing one.
  assert.match(src, /function candyResolveSongKey/)
  const typed = src.slice(src.indexOf('function candyResolveSongKey'))
  assert.ok(!/songsByNormKey/.test(typed.slice(0, 700)),
    'the typed-input resolver must not start accepting normalized matches')
})

// ── the Pack card's level name ────────────────────────────────────────────
//
// The HUD strip and the Pack's ID card were showing different ladders for the
// same player: "armybots · LV 15" at the top, "LV 15 · Reconnect One" on the
// card. Level names (rc_config.level_names) and rank titles (rc_config.ranks)
// are two separate systems, so one in each place read as a bug.

test('the Pack card shows the level name, like the HUD does', () => {
  const pack = readFileSync(new URL('./screen-resources.js', import.meta.url), 'utf8')
  const preview = readFileSync(new URL('./pack-preview.js', import.meta.url), 'utf8')
  const hud = readFileSync(new URL('./ui-hud.js', import.meta.url), 'utf8')

  // The HUD is the reference: it renders level.name next to LV n.
  assert.match(hud, /lvl\.name \? `<em>\$\{esc\(lvl\.name\)\}<\/em>/)

  for (const [name, src] of [['screen-resources.js', pack], ['pack-preview.js', preview]]) {
    const meta = src.split('\n').find((l) => l.includes("'aid-meta'"))
    assert.ok(meta, `${name} has no aid-meta line`)
    assert.ok(/level(\?)?\.name/.test(meta), `${name} must print the level name`)
    assert.ok(/LV /.test(meta), `${name} must still print LV n`)
    // Rank is kept: nothing else in the client prints a rank title, so dropping
    // it here would make rank invisible everywhere.
    assert.ok(/rank(\?)?\.title/.test(meta), `${name} must keep the rank title`)
  }
})
