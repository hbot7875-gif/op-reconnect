import assert from 'node:assert/strict'
import {
  artMembers,
  badgeArtMatches,
  badgeCoverage,
  duplicateBadgeArt,
  escapeBadgeText,
  imageQuality,
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
  { id: 1, templateId: 'common', pool: 'cute', member: 'RM + Jimin', members: ['RM', 'Jimin'], uploadedBy: 'AGENT050', active: true, imageHash: 'aaa' },
  { id: 2, templateId: 'common', pool: 'hot', member: 'V', members: ['V'], uploadedBy: 'AGENT053', active: true, imageHash: 'bbb' },
  { id: 3, templateId: 'rare', pool: 'hot', member: 'SUGA', members: ['SUGA'], uploadedBy: 'AGENT050', active: false, imageHash: 'ccc' },
]

assert.equal(badgeArtMatches(art[0], { style: 'cute' }, templateById), true)
assert.equal(badgeArtMatches(art[1], { style: 'cute' }, templateById), false)
assert.equal(badgeArtMatches(art[2], { status: 'inactive', rarity: 'rare' }, templateById), true)
assert.equal(badgeArtMatches(art[0], { uploader: 'AGENT053' }, templateById), false)
assert.equal(badgeArtMatches(art[0], { member: 'Jimin' }, templateById), true)
assert.equal(badgeArtMatches(art[0], { member: 'V' }, templateById), false)
assert.equal(badgeArtMatches(art[0], { mine: true, viewer: 'AGENT050' }, templateById), true)
assert.equal(badgeArtMatches(art[0], { activeOnly: true }, templateById), true)
assert.deepEqual(artMembers({ member: 'RM + Jin' }), ['RM', 'Jin'])
assert.equal(duplicateBadgeArt(art, 'aaa', 'common')?.id, 1)
assert.equal(duplicateBadgeArt(art, 'aaa', 'rare'), null)
assert.equal(imageQuality(400, 1200).level, 'bad')
assert.equal(imageQuality(700, 1200).level, 'warn')
assert.equal(imageQuality(1200, 1200).level, 'good')

assert.deepEqual(badgeCoverage(templates, art), [
  { id: 'common', name: 'Badge', rarity: 'common', active: 2, preferredPool: 'cute', preferred: 1 },
  { id: 'rare', name: 'Rare Badge', rarity: 'rare', active: 0, preferredPool: 'hot', preferred: 0 },
])

console.log('badge-vault: 19 tests passed')
