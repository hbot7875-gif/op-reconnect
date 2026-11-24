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
    { id: 'b', itemId: 'plush-mascot', kind: 'plush' },
  ], m)
  assert.equal(props.length, 1)
  assert.equal(props[0].item.itemId, 'plush-mascot')
})

test('merch drawings: own colours, flat, no logos or likeness hooks, albums untouched', async () => {
  const { MERCH_ART } = await import('./items-art-merch.js')
  for (const [id, body] of Object.entries(MERCH_ART)) {
    assert.doesNotMatch(body, /Gradient|mix-blend-mode| opacity=|<image/, id)
    assert.match(art(id, 'mug'), /class="ia ia-merch"/, id)
  }
  // the era album sleeves keep their cover art
  assert.match(itemArt({ itemId: 'album-be', kind: 'album', era: 'BE', name: 'BE' }), /ia-album-cover/)
  // the media cases are merch drawings now, not records
  assert.match(itemArt({ itemId: 'media-concert', kind: 'album', era: 'Media', name: 'x' }), /ia-merch/)
  // Ver.3 and Ver.4 differ: Ver.3's grip is shorter, with two buttons
  assert.notEqual(MERCH_ART['lightstick-v3'], MERCH_ART['lightstick-v4'])
  assert.equal((MERCH_ART['lightstick-v3'].match(/<ellipse/g) || []).length, 2)
})
