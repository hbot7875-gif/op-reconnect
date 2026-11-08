// "Your Contributions" for a restored district: the agent's own plays,
// counted exactly as the district counted them, ending at the moment it was
// restored. No XP, no targets, no team totals shown as the agent's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ownGoalTotals } from './districts.ts'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const frozen = {
  trackGoals: [{ id: 'swim', label: 'Swim', artist: null, target: 10, keys: ['swim'] }],
  albumGoals: [{ id: 'arirang', label: 'ARIRANG', target: 3, tracks: [{ label: 'Swim', keys: ['swim'] }, { label: 'Aliens', keys: ['aliens'] }] }],
  reconnect: null, meta: { mode: 'easy', multiplier: 1 },
}
const day = (kst_date, swim, aliens = 0) => ({ kst_date, track_counts: { swim: { n: swim }, aliens: { n: aliens } }, transmission: null })

test('own plays: baseline on the start day, uncapped by the target, leave days skipped', () => {
  const own = ownGoalTotals(frozen, { 't:swim': 2, 'a:arirang:Swim': 2, 'a:arirang:Aliens': 0 },
    [day('2026-11-01', 5, 1), day('2026-11-02', 9, 1), day('2026-11-03', 4, 2), day('2026-10-31', 50, 50)],
    '2026-11-01T03:00:00Z', new Set(['2026-11-03']))
  assert.equal(own.tracks[0].plays, 3 + 9, 'start day minus baseline, then full days; day before start and leave day ignored')
  assert.ok(own.tracks[0].plays > frozen.trackGoals[0].target, 'real plays, not capped at the target')
  assert.deepEqual(own.albums[0].songs.map((s) => s.plays), [12, 2])
  assert.equal(own.albums[0].passes, 2, 'album passes: the fewest plays of any song, up to the target')
})

test('the lookup ends at the restore moment, reads only, and only the asking agent', () => {
  const src = read('./district-contributions.ts')
  assert.match(src, /\.lt\('kst_date', endDate\)/, 'daily totals stop the day before restoration')
  assert.match(src, /track_counts: await rawCounts\(sb, agentNo, kstDayBounds\(endDate\)\.fromTs, endSec\)/, 'restoration day: raw plays up to the exact moment')
  assert.match(src, /if \(!row \|\| row\.status !== 'restored'/)
  assert.match(src, /contributionTotals\(sb, agentNo, me\.joined_at, true, me\.left_at \|\| mission\.completed_at\)/, 'ReConnect: own plays while on the team')
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, 'read-only')
  assert.doesNotMatch(src, /rc_xp_ledger/, 'no XP')
  assert.match(read('../index.ts'), /getDistrictContributions: \{ auth: 'agent'/)
})

test('the screen: restored districts get the record before Kept here; no XP, no targets', () => {
  const screen = read('../../../../js/screen-district.js')
  assert.match(screen, /board\.appendChild\(contributionsSection\(districtId, districtDisplayName\(mapD\)\)\)\s+board\.appendChild\(shelf\(state, mapD\)\)/)
  const ui = read('../../../../js/district-contributions.js')
  assert.doesNotMatch(ui.replace(/^\s*\/\/.*$/gm, ''), /\bXP\b|target|still need/i, 'comments aside')
  assert.match(ui, /No plays of these songs were recorded while you restored it\./, 'a clear empty state, not a misleading zero')
  assert.match(ui, /Your plays · team of/, 'own plays, labelled as such, beside the team')
})
