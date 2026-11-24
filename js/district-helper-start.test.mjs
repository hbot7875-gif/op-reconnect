// A player who helped another team on a district (reconnectHelping) must
// still be able to start that district themselves once the team's quest is
// done. The district page used to show only the finished quest and return,
// so "Light it up" never appeared for the 3 days a finished quest stays.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8').split('\r\n').join('\n')

test('a helped quest on an open district shows the team quest first, then the start card (with a confirmation)', () => {
  assert.match(src, /const helpedAndCanStart = !!helping && !helping\.expired && mapD\.status === 'available' && !state\.activeDistrict/)
  // Only the quest (and return) when they can't start here.
  assert.match(src, /if \(!helpedAndCanStart\) \{[\s\S]*?board\.append\(head, box\)\s*return\s*\}/)
  // Otherwise the team quest comes first and the start card follows it.
  const end = src.indexOf("if (helpedQuest) board.append(...helpedQuest)\n  board.appendChild(card)")
  assert.ok(end > 0, 'quest appended before the start card')
  // Starting still goes through a confirmation, never one tap.
  assert.match(src, /go\.onclick = \(\) => showOverlay\(startConfirmSheet\(state, mapD, start\)\)/)
})

test('a page opened while the quest ran gets the start card once it finishes', () => {
  assert.match(src, /mounted\?\.dataset\.districtId === districtId && \(!helpedAndCanStart \|\| board\.querySelector\('\.op-go'\)\)/)
})
