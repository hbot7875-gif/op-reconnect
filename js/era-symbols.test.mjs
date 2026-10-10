import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ERA_SYMBOLS, eraSymbol } from './era-symbols.js'

// Era Card symbols: one custom mark per era, one family, state-coloured.

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const timeline = read('supabase/functions/op-reconnect/lib/era-timeline.ts')
const birthdays = read('supabase/functions/op-reconnect/lib/birthday-eras.ts')
const world = read('js/screen-world.js')

test('every era defined on the backend has its own symbol', () => {
  const ids = [...timeline.matchAll(/id: '([a-z0-9-]+)', name: '/g)].map((m) => m[1])
  assert.ok(ids.length >= 8, 'expected the era timeline to define its eras')
  if (/id: 'golden'/.test(birthdays)) ids.push('golden')
  for (const id of ids) assert.ok(ERA_SYMBOLS[id], `no symbol for era "${id}"`)
  assert.equal(new Set(Object.values(ERA_SYMBOLS)).size, Object.keys(ERA_SYMBOLS).length, 'two eras share a symbol')
})

test('symbols are one family: stroke-only geometry with a single duotone layer, no colour of their own', () => {
  for (const [id, svg] of Object.entries(ERA_SYMBOLS)) {
    assert.match(svg, /class="d"/, `${id} has no duotone layer`)
    assert.doesNotMatch(svg, /fill="|stroke="|style=|#[0-9a-f]{3,6}/i, `${id} carries its own colour`)
    assert.doesNotMatch(svg, /\p{Extended_Pictographic}/u, `${id} contains an emoji`)
  }
  assert.match(eraSymbol('school'), /^<svg viewBox="0 0 24 24"/)
  assert.match(eraSymbol('not-an-era'), /<circle/, 'unknown eras get the neutral fallback')
})

test('the City Era Cards use the symbol, never the emoji icon', () => {
  const fn = world.slice(world.indexOf('function weeklyEraCards'), world.indexOf('function recoverySignal'))
  assert.match(fn, /<span class="era-sym">\$\{eraSymbol\(e\.id\)\}<\/span>/)
  assert.doesNotMatch(fn, /e\.icon/)
  // state logic untouched: the same four statuses decide the copy
  assert.match(fn, /e\.status === 'lit' \? 'Ready · \+10h'/)
  assert.match(fn, /e\.status === 'used' \? 'Used this week'/)
  assert.match(fn, /e\.status === 'lit'\n\s*\? showOverlay\(agentChargeSheet\(e\.id\)\)/)
})
