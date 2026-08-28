import assert from 'node:assert/strict'
import {
  BADGE_MEMBERS,
  canonicalBadgeMember,
  canonicalBadgePool,
  canManageBadgeArt,
} from './badge-admin-rules.js'

assert.deepEqual(BADGE_MEMBERS, ['BTS', 'RM', 'Jin', 'SUGA', 'j-hope', 'Jimin', 'V', 'Jung Kook'])
assert.equal(canonicalBadgeMember(' j-HOPE '), 'j-hope')
assert.equal(canonicalBadgeMember('unknown'), null)
assert.equal(canonicalBadgePool(' HOT '), 'hot')
assert.equal(canonicalBadgePool('untagged'), null)

assert.equal(canManageBadgeArt('AGENT050', 'AGENT050'), true)
assert.equal(canManageBadgeArt('agent050', 'AGENT050'), true)
assert.equal(canManageBadgeArt('AGENT050', 'AGENT053'), false)
assert.equal(canManageBadgeArt('AGENT050', null), false)
assert.equal(canManageBadgeArt('AGENT000', 'AGENT053'), true)
assert.equal(canManageBadgeArt('AGENT000', null), true)

console.log('badge-admin-rules: 11 tests passed')
