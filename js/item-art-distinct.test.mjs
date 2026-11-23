// Collectibles that share a kind still look like themselves: a hoodie isn't
// the tee, a bottle isn't the mug, Ver.3 / Ver.4 / boxed ARMY Bombs differ.
// Flat style only (no gradients), and no element opacity (Chrome drops it in
// nested SVGs on buttons). Backup Passes never appear in the district scene.
import test from 'node:test'
import assert from 'node:assert/strict'
import { itemArt, ITEM_IDS_WITH_OWN_ART } from './items-art.js'
import { layoutProps } from './scene-items.js'

const art = (itemId, kind) => itemArt({ itemId, kind, name: itemId })

test('look-alike items each draw differently', () => {
  const groups = [
    [['tee-popup', 'apparel'], ['hoodie-hope', 'apparel'], ['knit-heart', 'apparel']],
    [['bandana-purple', 'banner'], ['picket-image', 'banner'], ['banner-fanproject', 'banner']],
    [['lightstick-v4', 'lightstick'], ['lightstick-v3', 'lightstick'], ['lightstick-v4-full', 'lightstick'], ['lightstick-hat', 'lightstick']],
    [['bottle-souvenir', 'mug'], ['mug-tracklist', 'mug']],
    [['record-crate', 'vinyl'], ['slipmat-set', 'vinyl']],
  ]
  for (const g of groups) {
    const svgs = g.map(([id, k]) => art(id, k))
    assert.equal(new Set(svgs).size, svgs.length, g.map((x) => x[0]).join(' / '))
  }
})

test('own drawings stay flat and Chrome-safe', () => {
  assert.ok(ITEM_IDS_WITH_OWN_ART.length >= 19)
  for (const id of ITEM_IDS_WITH_OWN_ART) {
    const s = art(id, 'apparel')
    assert.doesNotMatch(s, /Gradient|mix-blend-mode| opacity=/, id)
  }
})

test('unknown item ids still draw by kind', () => {
  assert.equal(art('brand-new-tee', 'apparel'), art('another-tee', 'apparel'))
})

test('Backup Passes never stand in the district scene', () => {
  const m = { w: 400, groundY: 300, h: 160, buildings: [] }
  const props = layoutProps([
    { id: 'a', itemId: 'backup-pass', kind: 'utility' },
    { id: 'b', itemId: 'tee-popup', kind: 'apparel' },
  ], m)
  assert.equal(props.length, 1)
  assert.equal(props[0].item.itemId, 'tee-popup')
})
