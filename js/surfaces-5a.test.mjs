import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Phase 5A of the visual polish: the shared surface + tint system, opted into
// by a limited set of components (City's Now restoring, Signal Sweep and City
// News; Moon Station's panel, metrics, notes, log and warnings; the Rankings
// board lines). These pin the token values, the one tint recipe, the nav's
// shipped colours, and the absence of gradients and coloured shadows.

const css = readFileSync('css/reconnect.css', 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
const world = readFileSync('js/screen-world.js', 'utf8').replace(/\r\n/g, '\n')
const root = css.match(/:root \{[^}]*--v-surface-1[^}]*\}/)[0]
const token = (name) => (root.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim()
const rulesFor = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((x) => x.trim()).some((x) => x === sel || x.startsWith(sel + ' ') || x.startsWith(sel + '.') || x.startsWith(sel + ':')))
  .map((m) => m[2]).join('\n')

test('surfaces step up visibly: ground → 1 → 2 → 3', () => {
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) }
  const steps = ['#0a0910', token('v-surface-1'), token('v-surface-2'), token('v-surface-3')]
  for (let i = 1; i < steps.length; i++) assert.ok(lum(steps[i]) - lum(steps[i - 1]) >= 24, `${steps[i - 1]} → ${steps[i]} is too small a step`)
})

test('one tint recipe: every semantic hue has an 11% fill and a 50% line', () => {
  for (const [fill, line] of [['v-tint-violet', 'v-violet-line'], ['v-tint-gold', 'v-gold-line'], ['v-tint-red', 'v-red-line']]) {
    assert.match(token(fill), /,\s*\.11\)$/, fill)
    assert.match(token(line), /,\s*\.50\)$/, line)
  }
})

test('the bottom nav keeps the exact colours it shipped with', () => {
  assert.equal(token('v-nav-surface'), '#181528')
  assert.equal(token('v-nav-line'), 'rgba(255,255,255,.10)')
  const tabs = rulesFor('.hud-tabs')
  assert.match(tabs, /background: var\(--v-nav-surface\); border: 1px solid var\(--v-nav-line\)/)
  assert.doesNotMatch(tabs, /--v-surface-1|--v-line-1/)
})

const MIGRATED = ['.op-card', '.op-meter', '.side-missions', '.feed-card', '.moon-panel', '.moon-metric', '.moon-note', '.moon-streams', '.moon-filters', '.moon-row', '.moon-alt', '.rank-row', '.rank-list']

test('migrated components use the shared tokens', () => {
  for (const sel of MIGRATED) assert.match(rulesFor(sel), /var\(--v-/, `${sel} does not use the --v- tokens`)
})

test('no gradients and no coloured shadows on migrated components', () => {
  for (const sel of MIGRATED) {
    const body = rulesFor(sel)
    assert.doesNotMatch(body, /gradient\(/, `${sel} has a gradient`)
    for (const m of body.matchAll(/box-shadow:\s*([^;]+)/g)) {
      const v = m[1]
      if (/^none$|^inset 2px 0 0 var\(--purple\)$/.test(v.trim())) continue // spotlight's inset edge is a rule, not a glow
      assert.fail(`${sel} has box-shadow: ${v}`)
    }
  }
})

test('"Now restoring" is flat violet on a Surface 3 track', () => {
  assert.match(rulesFor('.op-meter-fill'), /background: var\(--v-violet\); box-shadow: none;/)
  assert.match(rulesFor('.op-meter'), /background: var\(--v-surface-3\)/)
  assert.match(rulesFor('.mission-beacon'), /box-shadow: none/)
})

test('City moves the existing ReConnect notice below City News', () => {
  const news = world.indexOf('wrap.appendChild(cityFeedCard(state))')
  const notice = world.indexOf("document.getElementById('hudReconnectStatus')")
  const sweep = world.indexOf('wrap.appendChild(sideMissionsPanel(state.sideMissions')
  assert.ok(news >= 0 && news < notice && notice < sweep)
  assert.match(world.slice(notice, sweep), /removeAttribute\('id'\)/)
  assert.match(world.slice(notice, sweep), /classList\.add\('city-reconnect-notice'\)/)
  assert.match(world.slice(notice, sweep), /wrap\.appendChild\(reconnectNotice\)/)
})

test('City ReConnect is compact, sentence case and neutral even when urgent', () => {
  const notice = rulesFor('.world-screen .city-reconnect-notice')
  assert.match(notice, /padding: 7px 10px/)
  assert.match(notice, /grid-template-columns: 28px minmax\(0,1fr\) auto auto/)
  assert.match(notice, /background: var\(--city-surface-quiet\)/)
  assert.doesNotMatch(notice, /v-tint-red|v-red-line|crimson/)
  assert.match(world, /className = 'city-reconnect-icon'/)
  assert.match(world, /<svg viewBox="0 0 24 24"/)
  const cityIcon = world.slice(world.indexOf("icon.innerHTML = '<svg"), world.indexOf('const unread'))
  assert.doesNotMatch(cityIcon, /🤝/)
})
