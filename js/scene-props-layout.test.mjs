// Placed collectibles in the district illustration: grouped into a corner
// each side of the landmark, wall things on a facade, standing things at its
// foot, a rug in front; never over a lamp post, never overlapping, never
// more than MAX_PROPS. Everything still lists in ARMY's Corner.
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutProps, pickShown, placementOf, MAX_PROPS } from './scene-items.js'

const mk = (itemId, kind, rarity = 'common') => ({ id: 'x-' + itemId, itemId, kind, rarity, era: 'Tour', name: itemId })
const TEN = [
  mk('album-arirang', 'album'), mk('lightstick-v4', 'lightstick', 'rare'), mk('rug-hope', 'rug', 'rare'),
  mk('poster-tour', 'poster'), mk('plush-mascot', 'plush'), mk('mug-tracklist', 'mug'),
  mk('hoodie-hope', 'apparel', 'rare'), mk('pc-era', 'photocard', 'rare'), mk('keyring-face', 'keyring'), mk('bottle-souvenir', 'mug'),
]
const model = (buildings = [], lamps = []) => ({
  w: 343, h: 178, groundY: 178 * 0.82, buildings, lamps: lamps.map((x) => ({ x })),
  landmark: { type: 'tower' }, fg: { kind: 'none' },
})
const town = model([{ x: 10, w: 60, y: 60, h: 86 }, { x: 275, w: 60, y: 70, h: 76 }], [40, 300])

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('placement by type', () => {
  assert.equal(placementOf(mk('poster-tour', 'poster')), 'wall')
  assert.equal(placementOf(mk('album-be', 'album')), 'wall')
  assert.equal(placementOf(mk('rug-hope', 'rug')), 'floor')
  assert.equal(placementOf(mk('lightstick-v4', 'lightstick')), 'stand')
  assert.equal(placementOf(mk('picket-image', 'banner')), 'stand', 'a placard on a stick stands up')
})

for (const n of [1, 4, 10]) {
  test(`${n} placed: grounded, inside the frame, no overlaps, clear of lamps`, () => {
    const props = layoutProps(TEN.slice(0, n), town)
    assert.ok(props.length >= 1 && props.length <= Math.min(n, MAX_PROPS))
    const gy = town.groundY
    for (const p of props) {
      assert.ok(p.x >= 0 && p.x + p.w <= town.w, 'inside the frame')
      if (p.place === 'stand') assert.ok(Math.abs(p.y + p.h - (gy + 1)) < 0.01, 'standing on the ground line')
      if (p.place === 'wall') {
        const b = town.buildings.find((b) => p.x >= b.x - 0.01 && p.x + p.w <= b.x + b.w + 0.01)
        assert.ok(b, 'hung on a facade, not in the air')
        assert.ok(p.y >= b.y && p.y + p.h < gy, 'within the facade, above the ground')
      }
      if (p.place === 'floor') assert.ok(p.y > gy, 'rug lies on the pavement')
      if (p.place !== 'floor') for (const lx of [40, 300]) assert.ok(!(lx > p.x - 2 && lx < p.x + p.w + 2), 'off the lamp post')
    }
    for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
      assert.ok(!overlap(props[i], props[j]), `${props[i].item.itemId} overlaps ${props[j].item.itemId}`)
    }
  })
}

test('never more than MAX_PROPS, at most 3 upright per corner, one of each item', () => {
  const props = layoutProps([...TEN, ...TEN.map((i) => ({ ...i, id: i.id + '-2' }))], town)
  assert.ok(props.length <= MAX_PROPS)
  assert.equal(new Set(props.map((p) => p.item.itemId)).size, props.length)
  for (const half of [(p) => p.x < town.w / 2, (p) => p.x >= town.w / 2]) {
    assert.ok(props.filter((p) => p.place !== 'floor' && half(p)).length <= 3)
  }
})

test('no facade: shirts and banners stay out of the picture, posters prop up', () => {
  const props = layoutProps([mk('hoodie-hope', 'apparel'), mk('banner-fanproject', 'banner'), mk('poster-tour', 'poster')], model())
  assert.deepEqual(props.map((p) => p.item.itemId), ['poster-tour'])
  assert.equal(props[0].place, 'stand')
})

test('a rug never lies alone on an empty road', () => {
  assert.deepEqual(layoutProps([mk('rug-hope', 'rug')], town), [])
})

test('variety first when there are more than fit', () => {
  const shown = pickShown([mk('a', 'poster'), mk('b', 'poster'), mk('c', 'poster'), mk('d', 'mug')], 2)
  assert.deepEqual(shown.map((i) => i.itemId), ['a', 'd'])
})
