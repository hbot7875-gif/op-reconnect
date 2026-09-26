import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hud = readFileSync(new URL('./ui-hud.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../css/reconnect.css', import.meta.url), 'utf8')

test('the compact header shows the level title, not the separate rank title', () => {
  const header = hud.slice(hud.indexOf('container.innerHTML'), hud.indexOf('const levelPill'))
  assert.match(header, /lvl\.name/)
  assert.doesNotMatch(header, /p\.rank\.title/)
})

test('the level popup does not surface the separate rank ladder', () => {
  const popup = hud.slice(hud.indexOf('function progressSheet'), hud.indexOf('export function openProgressSheet'))
  assert.match(popup, /Badges earned/)
  assert.doesNotMatch(popup, /p\.rank\.(?:title|nextTitle)/)
  assert.doesNotMatch(popup, />Rank</)
})

test('photo avatars keep one earned gold ring and the star marker', () => {
  assert.match(css, /\.hud-crest\.has-badge\.has-photo\s*\{\s*border-color:\s*transparent;/)
  assert.match(css, /\.hud-crest\.has-photo::before\s*\{\s*display:\s*none;/)
  assert.match(css, /\.hud-crest\.has-badge\.has-photo \.hud-crest-photo\s*\{\s*border-color:\s*rgba\(217,173,95,/)
  assert.match(css, /\.hud-crest\.has-photo::after\s*\{\s*content:\s*'✦'/)
})
