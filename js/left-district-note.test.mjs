// The team note for someone who stopped counting matches what happened.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8').split('\r\n').join('\n')
const fn = src.slice(src.indexOf('export function leftDistrictNote'), src.indexOf('/** "You\'re helping …" links'))

test('each reason has its own wording; only a lapse says ran out of time', () => {
  const finished = fn.slice(fn.indexOf("case 'finished'"), fn.indexOf("case 'restored_here'"))
  assert.match(finished, /finished \$\{from\}, so you no longer fill the \$\{from\} spot on this team/)
  assert.doesNotMatch(finished, /ran out of time/)
  assert.match(fn.slice(fn.indexOf("case 'restored_here'"), fn.indexOf("case 'no_district'")), /finished restoring this district/)
  assert.match(fn.slice(fn.indexOf("case 'no_district'"), fn.indexOf('default:')), /isn't restoring a district right now/)
  assert.match(fn.slice(fn.indexOf('default:')), /ran out of time restoring this district/)
  // The viewer reads about themselves as "You", not their own codename.
  assert.match(fn, /const who = me \? 'You' : esc\(p\.codename\)/)
  assert.match(src, /for \(const p of dropped\) \{\s+problemHost\.appendChild\(el\('p', 'muted reconnect-expired-note', leftDistrictNote\(p, getState\(\), need\)\)\)/)
})
