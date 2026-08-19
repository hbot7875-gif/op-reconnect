import assert from 'node:assert/strict'
import { earnedBadgeCount, equippedBadge } from './badges.js'

const state = {
  player: {
    badges: ['streak:7', 'event_vma_voter'],
    equippedBadgeId: null,
    level: { level: 5 },
    xp: 1000,
  },
  map: { wards: [{ restoredCount: 1 }] },
}

assert.equal(earnedBadgeCount(state), 5)
assert.equal(equippedBadge(state), null)
assert.equal(equippedBadge({
  ...state,
  player: { ...state.player, equippedBadgeId: 'level:5' },
})?.id, 'level:5')
assert.equal(equippedBadge({
  ...state,
  player: { ...state.player, equippedBadgeId: 'level:20' },
}), null)

console.log('4 badge UI state regression tests passed')
