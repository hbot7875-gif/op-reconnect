// The district screen's "You're helping …" cards list only ReConnect teams
// the player still has work on: finished and timed-out teams are left off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('only quests still in progress get a card', () => {
  const src = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export function recruitLinks'), src.indexOf('const RECRUIT_LEAVE_ERRORS'))
  assert.match(fn, /\.filter\(\(h\) => h\.districtId !== hereId && !h\.complete && !h\.expired\)/)
  assert.doesNotMatch(fn, /Quest complete|Team ran out of time/)
  assert.match(fn, /HELPING A TEAM · RECONNECT/)
  assert.match(fn, /You're helping at \$\{esc\(h\.districtName\)\}/)
  assert.match(fn, /Not your own district\./)
  assert.match(fn, /Go to team quest/)
})

test("helping cards sit above the district's own missions; own district is labelled", () => {
  const src = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8').split('\r\n').join('\n')
  assert.match(src, /if \(helpingCards\.length\) board\.prepend\(\.\.\.helpingCards\)/)
  assert.match(src, /active: 'YOUR DISTRICT · RESTORING'/)
  const world = readFileSync(new URL('./screen-world.js', import.meta.url), 'utf8')
  assert.match(world, /<span class="op-eyebrow">Your active district<\/span>/)
})

test('starting a district asks first, names it, and offers the way back to a team', () => {
  const src = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export function startConfirmSheet'))
  assert.match(fn, /`Start restoring \$\{esc\(name\)\}\?`/)
  assert.match(fn, /`Yes, start \$\{esc\(name\)\}`/)
  assert.match(fn, /'Cancel'/)
  assert.match(fn, /`Go to my team at \$\{esc\(h\.districtName\)\}`/)
  assert.match(fn, /yes\.onclick = \(\) => \{ hideOverlay\(\); onStart\(\) \}/)
})
