import test from 'node:test'
import assert from 'node:assert/strict'
import {
  districtCaption, districtLyric, liveRedZoneCaption,
  shareTextWithoutUrl, successfulRedZoneCaption,
} from './share-card-copy.js'

test('district copy keeps personal, casual language and the discovery URL', () => {
  const caption = districtCaption('Puple Sky Overlook', 2)
  assert.match(caption, /^my Puple Sky Overlook is still basically dark/)
  assert.match(caption, /hopetrackers\.org$/)
  assert.equal(districtLyric('Puple Sky Overlook', false), 'Just wait, dawn ✦')
})

test('completed district copy celebrates without a forced recruitment line', () => {
  const caption = districtCaption('Map of Seven Crossing', 100)
  assert.match(caption, /100% restored ✦/)
  assert.doesNotMatch(caption, /come light yours/)
})

test('live Red Zone caption carries frozen community state', () => {
  const caption = liveRedZoneCaption({ progress: 1240, target: 2000, targetLabel: 'SWIM', msLeft: 12060000 })
  assert.match(caption, /1\.2k\/2k/)
  assert.match(caption, /KEEP GOING — stream SWIM/)
  assert.match(caption, /3h 21m left/)
})

test('caption keeps a URL that share targets can preserve in visible text', () => {
  const caption = successfulRedZoneCaption({ progress: 2000, target: 2000 })
  assert.match(caption, /Bomb defused/)
  assert.doesNotMatch(shareTextWithoutUrl(caption), /https:/)
})
