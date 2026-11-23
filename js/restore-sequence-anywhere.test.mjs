// The restoration sequence plays on whatever screen the player is on when the
// server reports the district finished — not only on the district's own page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').split('\r\n').join('\n')
const main = read('./main.js')
const celebrate = read('./celebrate.js')
const district = read('./screen-district.js')

test('main.js plays the restoration from any screen, before a level-up', () => {
  assert.match(main, /import \{ playLevelUp, maybePlayRestoration \} from '\.\/celebrate\.js'/)
  assert.match(main, /if \(!maybePlayRestoration\(state, levelUpDue \? playLevel : undefined\) && levelUpDue\) playLevel\(\)/)
})

test('it plays once per district', () => {
  const fn = celebrate.slice(celebrate.indexOf('export function maybePlayRestoration'), celebrate.indexOf('export function playRestoration'))
  assert.match(fn, /if \(!d\?\.restoredNow \|\| d\.id === celebratedRestoreFor\) return false/)
  assert.match(fn, /celebratedRestoreFor = d\.id\n\s+const ward/)
})

test('the district page no longer plays it itself (no double play)', () => {
  assert.doesNotMatch(district, /playRestoration\(/)
})
