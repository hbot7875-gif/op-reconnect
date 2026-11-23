// Pack collection: albums draw as records with their era on the label,
// films as a disc in a case, everything else keeps its own drawing; the
// tile says where an item is placed (the game doesn't record where it was
// found).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { itemArt, setAlbumStyle } from './items-art.js'

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').split('\r\n').join('\n')

test('albums are records with their era on the label', () => {
  const proof = itemArt({ kind: 'album', era: 'Proof', name: 'Proof' })
  assert.match(proof, /class="ia ia-album-vinyl"/)
  assert.match(proof, />PROOF<\/text>/)
  assert.notEqual(itemArt({ kind: 'album', era: 'BE', name: 'BE' }), proof)
  // A new album row with an unknown era still draws as its own record.
  assert.match(itemArt({ kind: 'album', era: 'Golden', name: 'Golden' }), />GOLDEN<\/text>/)
  setAlbumStyle('sleeve')
  assert.match(itemArt({ kind: 'album', era: 'Proof', name: 'Proof' }), /ia-sleeve-edge/)
  setAlbumStyle('disc')
})

test('films are not records; other kinds keep their drawings', () => {
  const film = itemArt({ kind: 'album', era: 'Media', name: 'Concert film' })
  assert.doesNotMatch(film, /ia-album-vinyl/)
  assert.match(film, /ia-film-disc/)
  assert.doesNotMatch(itemArt({ kind: 'mug', name: 'Tracklist mug' }), /ia-album-vinyl/)
})

test('tile wording: placed / in your Pack / used, never "Kept at"', () => {
  const src = read('./screen-resources.js')
  const fn = src.slice(src.indexOf('function collectionObject('), src.indexOf('function packReconnectRow('))
  assert.match(fn, /item\.usedAt \? 'Used' : item\.districtName \? `Placed in \$\{item\.districtName\}` : 'In your Pack'/)
  assert.doesNotMatch(fn, /Kept at/)
  assert.match(fn, /button\.onclick = \(\) => showOverlay\(itemSheet\(item\)\)/, 'tap opens the existing details')
})
