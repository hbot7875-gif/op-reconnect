// Renaming Relay Zero to Home Base (2026-11-25) must not redraw it: the
// scene, its landmark, its variation and its icon all come from the name.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { landmarkType, districtIcon, artName } from './landmarks.js'

test('Home Base keeps the tower it had as Relay Zero', () => {
  assert.equal(artName('Home Base'), 'Relay Zero')
  assert.equal(landmarkType('Home Base'), 'tower')
  assert.equal(districtIcon('Home Base'), districtIcon('Relay Zero'))
  assert.equal(artName('Hopesize Station'), 'Hopesize Station', 'other names untouched')
})

test('the scene builder reads the artwork name first, so variation and landmark match', () => {
  const src = readFileSync(new URL('./scene.js', import.meta.url), 'utf8').split('\r\n').join('\n')
  const fn = src.slice(src.indexOf('export function buildModel'))
  const firstLines = fn.split('\n').slice(0, 4).join('\n')
  assert.match(firstLines, /name = artName\(name\)/)
})
