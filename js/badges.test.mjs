import assert from 'node:assert/strict'
import { earnedBadgeCount, equippedBadge } from './badges.js'

const state = {
  player: {
    badges: ['streak:7', 'event_vma_voter', 'district_frag_1:home-base'],
    equippedBadgeId: null,
    level: { level: 5 },
    xp: 1000,
  },
  map: { wards: [{ restoredCount: 1 }] },
}

assert.equal(earnedBadgeCount(state), 2)
assert.equal(equippedBadge(state), null)
assert.equal(equippedBadge({
  ...state,
  player: { ...state.player, equippedBadgeId: 'level:5' },
}), null)
assert.equal(equippedBadge({
  ...state,
  player: { ...state.player, equippedBadgeId: 'level:20' },
}), null)

console.log('4 badge UI state regression tests passed')
