import assert from 'node:assert/strict'
import {
  badgeArtMatches,
  badgeCoverage,
  escapeBadgeText,
  preferredPoolForRarity,
} from './badge-vault.js'

assert.equal(escapeBadgeText('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;')
assert.equal(preferredPoolForRarity('rare'), 'hot')
assert.equal(preferredPoolForRarity('common'), 'cute')

const templates = [
  { id: 'common', name: 'Badge', rarity: 'common', active: true },
  { id: 'rare', name: 'Rare Badge', rarity: 'rare', active: true },
  { id: 'old', name: 'Old Badge', rarity: 'common', active: false },
]
const templateById = new Map(templates.map((template) => [template.id, template]))
const art = [
  { templateId: 'common', pool: 'cute', member: 'Jimin', uploadedBy: 'AGENT050', active: true },
  { templateId: 'common', pool: 'hot', member: 'V', uploadedBy: 'AGENT053', active: true },
  { templateId: 'rare', pool: 'hot', member: 'SUGA', uploadedBy: 'AGENT050', active: false },
]

assert.equal(badgeArtMatches(art[0], { style: 'cute' }, templateById), true)
assert.equal(badgeArtMatches(art[1], { style: 'cute' }, templateById), false)
assert.equal(badgeArtMatches(art[2], { status: 'inactive', rarity: 'rare' }, templateById), true)
assert.equal(badgeArtMatches(art[0], { uploader: 'AGENT053' }, templateById), false)

assert.deepEqual(badgeCoverage(templates, art), [
  { id: 'common', name: 'Badge', rarity: 'common', active: 2, preferredPool: 'cute', preferred: 1 },
  { id: 'rare', name: 'Rare Badge', rarity: 'rare', active: 0, preferredPool: 'hot', preferred: 0 },
])

console.log('badge-vault: 8 tests passed')
