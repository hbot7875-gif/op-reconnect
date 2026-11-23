// Pack collection: albums draw as records with their era on the label,
// films as a disc in a case, everything else keeps its own drawing; the
// tile says where an item is placed (the game doesn't record where it was
// found).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { itemArt } from './items-art.js'

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').split('\r\n').join('\n')

test('albums: a record in a sleeve made from the War of Cards cover art', () => {
  const be = itemArt({ kind: 'album', era: 'BE', name: 'BE' })
  assert.match(be, /class="ia ia-album-vinyl ia-album-cover"/)
  assert.match(be, /life goes on/, 'the BE cover artwork itself')
  assert.match(itemArt({ kind: 'album', era: 'MOTS', name: 'Map of the Soul: 7' }), /MAP OF THE SOUL/)
  assert.match(itemArt({ kind: 'album', era: 'Arirang', name: 'Arirang' }), /class="ia ia-album-vinyl ia-album-cover"/)
  // Chrome-safe copy: no blend modes, no element opacity inside the sleeve.
  const mots = itemArt({ kind: 'album', era: 'MOTS', name: 'x' })
  assert.doesNotMatch(mots, /mix-blend-mode/)
  // An era with no cover artwork still draws as its own labelled record.
  assert.match(itemArt({ kind: 'album', era: 'Golden', name: 'Golden' }), />GOLDEN<\/text>/)
})

test('War of Cards keeps its own artwork untouched', () => {
  const src = read('./run-ami-art.js')
  assert.match(src, /export function eraCoverBody\(era\) \{\s+const art = MOTIF\[era\]/)
  assert.match(src, /style="mix-blend-mode:multiply"/, 'cards keep their blend')
})

test('films are not records; other kinds keep their drawings', () => {
  const film = itemArt({ kind: 'album', era: 'Media', name: 'Concert film' })
  assert.doesNotMatch(film, /ia-album-vinyl/)
  assert.match(film, /ia-film-disc/)
  assert.doesNotMatch(itemArt({ kind: 'mug', name: 'Tracklist mug' }), /ia-album-vinyl/)
})

test('tile wording: placed / in your Pack / used, never "Kept at"', () => {
  const fn = read('./collectible-tile.js')
  assert.match(fn, /item\.usedAt \? 'Used' : item\.districtName \? `Placed in \$\{item\.districtName\}` : 'In your Pack'/)
  assert.doesNotMatch(fn, /Kept at/)
  assert.match(fn, /if \(opts\.onPick\) button\.onclick = \(\) => opts\.onPick\(item\)/, 'tap opens what the caller passes (the existing details)')
})

test('districts: only collectibles on the shelf and in the picker; safe Move to Pack', () => {
  const district = read('./screen-district.js')
  assert.match(district, /const kept = itemsAt\(state, mapD\.id\)\.filter\(isCollectible\)/)
  assert.match(district, /const spare = itemsInPack\(state\)\.filter\(isCollectible\)/)
  assert.match(district, /collectibleTile\(it, ctx, \{\s+showPlace: false,/, 'shelf reuses the Pack tile')
  assert.doesNotMatch(district, /itemTile\(/)
  const tile = read('./collectible-tile.js')
  assert.match(tile, /return !!item && item\.kind !== 'utility' && item\.itemId !== 'backup-pass'/, 'tickets stay placeable keepsakes')
  assert.match(tile, /return isCollectible\(item\) && item\.kind !== 'ticket'/, 'Pack grid leaves tickets to the front pocket')
  const items = read('./items.js')
  assert.match(items, /'Tap again to move it to your Pack'/, 'moving off a shelf asks twice')
  assert.doesNotMatch(items, /'btn btn-ghost', 'Back to Pack'/)
})

test('one-time Weekly Collection XP announcement is wired in', () => {
  const ann = read('./collection-xp-announce.js')
  assert.match(ann, /const KEY = 'rc_collection_xp_intro_seen:'/)
  assert.match(ann, /if \(localStorage\.getItem\(`\$\{KEY\}\$\{agentNo\}`\) === '1'\) return/)
  assert.match(ann, /if \(overlay && !overlay\.hidden\) return/, 'never over another sheet')
  assert.match(read('./main.js'), /checkForCollectionXpIntro\(state\)/)
})

test('district scene draws an album as its framed cover, one image per album', () => {
  const scene = read('./scene-items.js')
  assert.match(scene, /const svg = itemSceneArt\(item\)/)
  assert.match(scene, /item\.kind === 'album' \? item\.era \|\| item\.itemId \|\| '' : item\.itemId \|\| ''/)
  const art = read('./items-art.js')
  assert.doesNotMatch(art.slice(art.indexOf('export function coverSleeveArt')), /clip-path="url\(#/, 'no clipPath: it blacked out the cover as an image')
})
