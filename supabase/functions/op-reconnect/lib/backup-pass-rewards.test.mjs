// The Backup Pass level rule, in the two sentences it has to satisfy:
// never two levels in a row, and never two levels in a row without one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backupPassLevelGrants, nextLevelGrantsBackupPass } from './backup-pass-rewards.js'

const grants = (o) => backupPassLevelGrants(o).levels

test('the very first level-up grants one', () => {
  assert.deepEqual(grants({ fromLevel: 1, toLevel: 2, lastPassLevel: 0 }), [2])
})

test('the level straight after a grant does not', () => {
  assert.deepEqual(grants({ fromLevel: 2, toLevel: 3, lastPassLevel: 2 }), [])
})

test('the level after that does', () => {
  assert.deepEqual(grants({ fromLevel: 3, toLevel: 4, lastPassLevel: 2 }), [4])
})

test('a multi-level jump still alternates instead of paying every level', () => {
  assert.deepEqual(grants({ fromLevel: 1, toLevel: 7, lastPassLevel: 0 }), [2, 4, 6])
})

test('a jump that starts right after a grant skips its first level', () => {
  assert.deepEqual(grants({ fromLevel: 2, toLevel: 6, lastPassLevel: 2 }), [4, 6])
})

test('no level crossed, nothing granted', () => {
  assert.deepEqual(grants({ fromLevel: 9, toLevel: 9, lastPassLevel: 4 }), [])
  assert.deepEqual(grants({ fromLevel: 9, toLevel: 8, lastPassLevel: 4 }), [])
})

test('never two levels in a row, over a long climb', () => {
  const levels = grants({ fromLevel: 1, toLevel: 40, lastPassLevel: 0 })
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] - levels[i - 1] >= 2, `granted at ${levels[i - 1]} and ${levels[i]}`)
  }
})

test('never two levels in a row WITHOUT one, over a long climb', () => {
  const levels = grants({ fromLevel: 1, toLevel: 40, lastPassLevel: 0 })
  for (let i = 1; i < levels.length; i++) {
    assert.ok(levels[i] - levels[i - 1] <= 2, `gap of ${levels[i] - levels[i - 1]} levels`)
  }
})

test('minLevel holds the first pass back without breaking the alternation', () => {
  assert.deepEqual(grants({ fromLevel: 1, toLevel: 9, lastPassLevel: 0, minLevel: 5 }), [5, 7, 9])
})

test('everyOther:false pays at every level from minLevel', () => {
  assert.deepEqual(grants({ fromLevel: 1, toLevel: 5, lastPassLevel: 0, everyOther: false }), [2, 3, 4, 5])
})

test('the returned lastPassLevel is what the caller should store', () => {
  const r = backupPassLevelGrants({ fromLevel: 1, toLevel: 5, lastPassLevel: 0 })
  assert.equal(r.lastPassLevel, 4)
  assert.equal(r.count, 2)
  // Storing it and continuing must not re-pay a level already paid.
  assert.deepEqual(grants({ fromLevel: 5, toLevel: 6, lastPassLevel: r.lastPassLevel }), [6])
})

test('an unchanged lastPassLevel is returned when nothing is granted', () => {
  const r = backupPassLevelGrants({ fromLevel: 2, toLevel: 3, lastPassLevel: 2 })
  assert.equal(r.lastPassLevel, 2)
})

test('a corrupt lastPassLevel ahead of the level holds grants back, never doubles them', () => {
  assert.deepEqual(grants({ fromLevel: 3, toLevel: 4, lastPassLevel: 99 }), [])
})

test('garbage input grants nothing rather than throwing', () => {
  assert.deepEqual(grants({}), [])
  assert.deepEqual(grants({ fromLevel: null, toLevel: undefined, lastPassLevel: NaN }), [])
  assert.deepEqual(backupPassLevelGrants(undefined).levels, [])
})

test('the preview agrees with what the next level-up will actually do', () => {
  for (const [level, lastPassLevel] of [[2, 2], [3, 2], [4, 4], [9, 4], [1, 0]]) {
    const preview = nextLevelGrantsBackupPass(level, lastPassLevel)
    const real = grants({ fromLevel: level, toLevel: level + 1, lastPassLevel }).length > 0
    assert.equal(preview, real, `level ${level}, lastPass ${lastPassLevel}`)
  }
})
