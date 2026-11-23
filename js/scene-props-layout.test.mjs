// Placed collectibles in the district illustration: a small group each side
// of the landmark, standing on the near pavement (on the deck, for a pier),
// never reaching above the ground line, so they can't cover the landmark,
// the train, lamp posts or windows that light up during restoration. Never
// overlapping each other or the near-camera props, never more than
// MAX_PROPS. Everything still lists in ARMY's Corner.
import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutProps, pickShown, placementOf, pavement, MAX_PROPS } from './scene-items.js'

const mk = (itemId, kind, rarity = 'common') => ({ id: 'x-' + itemId, itemId, kind, rarity, era: 'Tour', name: itemId })
const TEN = [
  mk('album-arirang', 'album'), mk('lightstick-v4', 'lightstick', 'rare'), mk('rug-hope', 'rug', 'rare'),
  mk('poster-tour', 'poster'), mk('plush-mascot', 'plush'), mk('mug-tracklist', 'mug'),
  mk('hoodie-hope', 'apparel', 'rare'), mk('pc-era', 'photocard', 'rare'), mk('keyring-face', 'keyring'), mk('bottle-souvenir', 'mug'),
]
const model = (type, fg = { kind: 'none' }) => ({
  w: 343, h: 178, groundY: 178 * 0.82, buildings: [], lamps: [], landmark: type ? { type } : null, fg,
})
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

test('placement by type', () => {
  assert.equal(placementOf(mk('poster-tour', 'poster')), 'stand')
  assert.equal(placementOf(mk('rug-hope', 'rug')), 'floor')
  assert.equal(placementOf(mk('hoodie-hope', 'apparel')), null, 'shirts stay in ARMY\'s Corner')
  assert.equal(placementOf(mk('ticket-voyage', 'ticket')), null)
  assert.equal(placementOf(mk('picket-image', 'banner')), 'stand', 'a placard on a stick stands up')
})

for (const [label, m] of [
  ['station + bench', model('station', { kind: 'bench', x: 0.12, flip: true })],
  ['tower + fence', model('tower', { kind: 'fence', x: 0.1, flip: false })],
  ['shop + bicycle', model('shop', { kind: 'bicycle', x: 0.1, flip: true })],
  ['no landmark', model(null)],
]) {
  for (const n of [1, 4, 10]) {
    test(`${label}, ${n} placed: below the ground line, in frame, no overlaps`, () => {
      const props = layoutProps(TEN.slice(0, n), m)
      assert.ok(props.length >= 1 && props.length <= Math.min(n, MAX_PROPS))
      const { base } = pavement(m)
      for (const p of props) {
        assert.ok(p.x >= 0 && p.x + p.w <= m.w, 'inside the frame')
        assert.ok(p.y > m.groundY, `${p.item.itemId} stays below the ground line`)
        if (p.place === 'stand') assert.ok(Math.abs(p.y + p.h - base) < 0.01, 'standing on the pavement')
      }
      const ups = props.filter((p) => p.place === 'stand')
      for (let i = 0; i < ups.length; i++) for (let j = i + 1; j < ups.length; j++) {
        assert.ok(!overlap(ups[i], ups[j]), `${ups[i].item.itemId} overlaps ${ups[j].item.itemId}`)
      }
      if (m.fg.kind === 'bench' || m.fg.kind === 'bicycle') {
        const fx = m.fg.flip ? m.w - m.fg.x * m.w : m.fg.x * m.w
        for (const p of ups) assert.ok(p.x > fx + 14 || p.x + p.w < fx - 14, 'clear of the near-camera prop')
      }
    })
  }
}

test('a pier: things stand on the deck, not the water', () => {
  const m = model('pier')
  const props = layoutProps(TEN.slice(0, 4), m)
  const s = m.h / 158
  for (const p of props.filter((q) => q.place === 'stand')) {
    assert.ok(Math.abs(p.y + p.h - (m.groundY - 9 * s)) < 0.01)
    assert.ok(p.x > m.w / 2 - 80 * s && p.x + p.w < m.w / 2 + 80 * s, 'on the deck')
  }
})

test('never more than MAX_PROPS, at most 3 upright per group, one of each item', () => {
  const m = model('tower')
  const props = layoutProps([...TEN, ...TEN.map((i) => ({ ...i, id: i.id + '-2' }))], m)
  assert.ok(props.length <= MAX_PROPS)
  assert.equal(new Set(props.map((p) => p.item.itemId)).size, props.length)
  for (const half of [(p) => p.x < m.w / 2, (p) => p.x >= m.w / 2]) {
    assert.ok(props.filter((p) => p.place === 'stand' && half(p)).length <= 3)
  }
})

test('a rug lies under a group, never alone', () => {
  assert.deepEqual(layoutProps([mk('rug-hope', 'rug')], model('tower')), [])
  const props = layoutProps([mk('rug-hope', 'rug'), mk('plush-mascot', 'plush')], model('tower'))
  const rug = props.find((p) => p.place === 'floor'), plush = props.find((p) => p.place === 'stand')
  assert.ok(rug && plush && rug.x <= plush.x && rug.x + rug.w >= plush.x + plush.w)
})

test('variety first when there are more than fit', () => {
  const shown = pickShown([mk('a', 'poster'), mk('b', 'poster'), mk('c', 'poster'), mk('d', 'mug')], 2)
  assert.deepEqual(shown.map((i) => i.itemId), ['a', 'd'])
})
