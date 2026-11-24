// Weekly collectible XP: values, one copy per collectible, cap, restoring
// weeks only, no pay before the start week, and nothing a move can farm.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  collectibleWeeklyXp, eligibleCollectibles, planAwards, weekPlays, weekQualifies, weekInfo,
  dedupKey, awardCollectibleXp, START_WEEK, WEEKLY_CAP, QUALIFY_PLAYS,
} from './collectible-rewards.ts'

const it = (id, itemId, kind, districtId, extra = {}) => ({ id, itemId, name: itemId, kind, districtId, usedAt: null, ...extra })

test('values by kind; tickets, Backup Passes and unknowns earn nothing', () => {
  assert.equal(collectibleWeeklyXp({ kind: 'album', era: 'BE' }), 15)
  assert.equal(collectibleWeeklyXp({ kind: 'album', era: 'Media' }), 12)
  assert.equal(collectibleWeeklyXp({ kind: 'lightstick' }), 12)
  assert.equal(collectibleWeeklyXp({ kind: 'apparel' }), 10)
  assert.equal(collectibleWeeklyXp({ kind: 'photocard' }), 8)
  for (const k of ['poster', 'banner', 'figure', 'plush']) assert.equal(collectibleWeeklyXp({ kind: k }), 7)
  for (const k of ['mug', 'cushion', 'rug', 'lightbox', 'keyring', 'blanket', 'tray', 'magnet', 'record']) assert.equal(collectibleWeeklyXp({ kind: k }), 5)
  for (const k of ['ticket', 'utility', '']) assert.equal(collectibleWeeklyXp({ kind: k }), 0)
  assert.equal(WEEKLY_CAP, 50)
})

test('only districts the player restored; copies never stack; used items never earn', () => {
  const restored = new Set(['d1', 'd2'])
  const got = eligibleCollectibles([
    it('a', 'album-be', 'album', 'd1'), it('b', 'album-be', 'album', 'd2'), // second copy
    it('c', 'album-proof', 'album', 'd2'),
    it('d', 'mug', 'mug', 'active-district'), // placed but not restored by them
    it('e', 'poster', 'poster', null), // in the Pack
    it('f', 'ticket', 'ticket', 'd1'),
    it('g', 'pc', 'photocard', 'd1', { usedAt: '2026-11-01' }),
  ], restored)
  assert.deepEqual(got.map((g) => [g.itemId, g.xp]), [['album-be', 15], ['album-proof', 15]])
})

test('cap: highest value first, the last one trimmed to land on 50', () => {
  const eligible = [15, 15, 12, 10, 8].map((xp, i) => ({ itemId: `i${i}`, name: '', xp }))
  const { award, earned } = planAwards(eligible, new Map())
  assert.equal(earned, 50)
  assert.deepEqual(award.map((a) => a.xp), [15, 15, 12, 8])
  // Already paid this week is never paid again, and counts toward the cap.
  const again = planAwards(eligible, new Map([['i0', 15], ['i1', 15], ['i2', 12], ['i3', 8]]))
  assert.equal(again.award.length, 0)
})

test('a move can never pay twice: one ledger key per player + week + collectible', () => {
  assert.equal(dedupKey('A1', '2026-11-30', 'album-be'), 'collectible:A1:2026-11-30:album-be')
  const src = readFileSync(new URL('./collectible-rewards.ts', import.meta.url), 'utf8')
  // Written only through the locked writer, whose dedup key is unique.
  assert.match(src, /rpc\('rc_award_collectible_xp'/)
  assert.doesNotMatch(src, /from\('rc_xp_ledger'\)\.(upsert|insert)/)
})

test('restoring week: 10 goal-song plays, a restore, or ReConnect help', () => {
  const weekKey = '2026-11-30'
  const ws = new Date('2026-11-30T00:00:00+09:00').toISOString()
  const rollups = [
    { kst_date: '2026-11-29', track_counts: { swim: { n: 50 } } }, // last week: ignored
    { kst_date: '2026-11-30', track_counts: { swim: { n: 4 }, danger: { n: 6 } } },
    { kst_date: '2026-12-01', track_counts: { swim: { n: 5 } } },
  ]
  const activePd = { activated_at: '2026-11-20T00:00:00Z', goals: { trackGoals: [{ keys: ['swim'] }] } }
  assert.deepEqual(weekQualifies({ weekKey, rollups, activePd, pdRows: [], helpingQuests: [], weekStartIso: ws }), { qualified: false, reason: null, plays: 9 })
  rollups[2].track_counts.swim.n = 6
  assert.equal(weekQualifies({ weekKey, rollups, activePd, pdRows: [], helpingQuests: [], weekStartIso: ws }).reason, 'goal_plays')
  // No active district (everything restored), helping a team with Danger.
  assert.equal(weekQualifies({ weekKey, rollups, activePd: null, pdRows: [], helpingQuests: [{ keys: ['danger'] }], weekStartIso: ws }).qualified, false)
  rollups[2].track_counts.danger = { n: 4 }
  assert.equal(weekQualifies({ weekKey, rollups, activePd: null, pdRows: [], helpingQuests: [{ keys: ['danger'] }], weekStartIso: ws }).reason, 'reconnect')
  // A district restored this week qualifies on its own.
  assert.equal(weekQualifies({ weekKey, rollups: [], activePd: null, pdRows: [{ status: 'restored', completed_at: '2026-12-02T10:00:00Z' }], helpingQuests: [], weekStartIso: ws }).reason, 'restored')
  // Plays before the district was started don't count.
  assert.equal(weekPlays(rollups, ['swim'], weekKey, '2026-12-01'), 6)
  assert.equal(QUALIFY_PLAYS, 10)
})

test('week info and the start week: nothing is paid before it', async () => {
  assert.equal(START_WEEK, '2026-11-30')
  const w = weekInfo('2026-12-03')
  assert.equal(w.weekKey, '2026-11-30')
  assert.equal(w.resetsAt, new Date('2026-12-07T00:00:00+09:00').toISOString())
  let wrote = false
  const db = { from: () => ({ select() { return this }, eq() { return this }, gte() { return this }, upsert() { wrote = true; return this }, then: (ok) => ok({ data: [] }) }) }
  const res = await awardCollectibleXp(db, { agentNo: 'A1', today: '2026-11-25', items: [it('a', 'album-be', 'album', 'd1')], restored: new Set(['d1']), rollups: [], activePd: null, pdRows: [], helpingQuests: [] })
  assert.equal(res.started, false)
  assert.equal(res.awardedXp, 0)
  assert.equal(wrote, false)
})
