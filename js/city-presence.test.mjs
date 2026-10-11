import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const world = readFileSync('js/screen-world.js', 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync('css/reconnect.css', 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const recovery = world.slice(world.indexOf('function recoverySignal'), world.indexOf('function commandTools'))
const rulesFor = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((x) => x.trim()).some((x) => x === sel))
  .map((m) => m[2]).join('\n')

test('City presence keeps the live count and shows at most two codenames', () => {
  assert.match(recovery, /const n = state\.onlineNow\?\.count \|\| 0/)
  assert.match(recovery, /Math\.min\(2, codenames\.length, n\)/)
  assert.match(recovery, /n - shownCount/)
  assert.match(recovery, /\$\{n\} agent\$\{n === 1 \? '' : 's'\} active now/)
})

test('City presence separates status, names and the accurate remainder', () => {
  assert.match(recovery, /class="active-now-status"/)
  assert.match(recovery, /class="active-now-names"/)
  assert.match(recovery, /class="active-now-more">· \+\$\{more\}/)
  assert.match(recovery, /aria-hidden="true"/)
})

test('City presence is an understated single-line component', () => {
  const row = rulesFor('.active-now')
  assert.match(row, /display: grid/)
  assert.match(row, /width: max-content/)
  assert.match(row, /max-width: calc\(100vw - 48px\)/)
  assert.match(row, /white-space: nowrap/)
  assert.match(row, /overflow: hidden/)
  assert.doesNotMatch(row, /background|border|box-shadow/)
  assert.match(rulesFor('.active-now-dot'), /box-shadow: none/)

  assert.match(rulesFor('.world-screen .recovery-signal'), /max-width: calc\(100% - 48px\)/)
  const names = rulesFor('.world-screen .active-now-names')
  assert.match(names, /font-size: 12px/)
  assert.match(names, /color: var\(--v-ink-3\)/)
})
