import assert from 'node:assert/strict'
import { allocateTrackHits } from './era-match.js'

const entries = [
  { id: 'original', canonicalKey: 'black swan', keys: ['black swan'] },
  { id: 'japanese', canonicalKey: 'black swan japanese ver', keys: ['black swan japanese ver', 'black swan'] },
]

{
  const result = allocateTrackHits(entries, new Map([['black swan', 1]]))
  assert.equal(result.get('original'), 1)
  assert.equal(result.get('japanese'), 0, 'one ambiguous play must not unlock both recordings')
}

{
  const result = allocateTrackHits(entries, new Map([['black swan', 2]]))
  assert.equal(result.get('original'), 1)
  assert.equal(result.get('japanese'), 1, 'two bare Apple Music plays can fill the two distinct requirements')
}

{
  const result = allocateTrackHits(entries, new Map([
    ['black swan', 1],
    ['black swan japanese ver', 1],
  ]))
  assert.equal(result.get('original'), 1)
  assert.equal(result.get('japanese'), 1, 'an explicit Japanese title must fill its own slot first')
}

{
  const dope = [{
    id: 'dope-jp',
    canonicalKey: 'dope japanese ver',
    keys: ['dope japanese ver', 'dope chou yabee japanese ver'],
  }]
  const result = allocateTrackHits(dope, new Map([['dope chou yabee japanese ver', 1]]))
  assert.equal(result.get('dope-jp'), 1)
}

{
  const result = allocateTrackHits(entries, new Map([['black swan', 39]]), 20)
  assert.equal(result.get('original'), 20)
  assert.equal(result.get('japanese'), 19)
  const complete = allocateTrackHits(entries, new Map([['black swan', 40]]), 20)
  assert.equal(complete.get('japanese'), 20)
}

{
  const goldenSeven = [
    { id: 'seven-explicit', canonicalKey: 'seven', keys: ['seven'] },
    { id: 'seven-clean', canonicalKey: 'seven', keys: ['seven'] },
  ]
  const onePlay = allocateTrackHits(goldenSeven, new Map([['seven', 1]]))
  assert.equal((onePlay.get('seven-explicit') || 0) + (onePlay.get('seven-clean') || 0), 1,
    'one Seven play must fill only one GOLDEN album slot')
  const twoPlays = allocateTrackHits(goldenSeven, new Map([['seven', 2]]))
  assert.equal(twoPlays.get('seven-explicit'), 1)
  assert.equal(twoPlays.get('seven-clean'), 1)
}

console.log('era-match: 6 tests passed')
