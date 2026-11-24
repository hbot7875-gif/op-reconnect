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
  assert.match(fn, /Streaming \$\{h\.trackLabel\} together — see your team/)
})
