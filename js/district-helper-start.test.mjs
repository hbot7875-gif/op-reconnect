// A player who helped another team on a district (reconnectHelping) must
// still be able to start that district themselves once the team's quest is
// done. The district page used to show only the finished quest and return,
// so "Light it up" never appeared for the 3 days a finished quest stays.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8').split('\r\n').join('\n')

test('a finished helped quest on an open district shows Light it up first, then the quest', () => {
  assert.match(src, /const helpedAndCanStart = !!helping && !helping\.expired && helping\.complete && mapD\.status === 'available'/)
  // Only the quest (and return) when they can't start here.
  assert.match(src, /if \(!helpedAndCanStart\) \{[\s\S]*?board\.append\(head, box\)\s*return\s*\}/)
  // Otherwise the start card is built as usual and the quest follows it.
  const end = src.indexOf("board.appendChild(card)\n  if (helpedQuest) board.append(...helpedQuest)")
  assert.ok(end > 0, 'quest appended after the start card')
  assert.ok(src.indexOf("'Light it up'") < end)
})

test('a page opened while the quest ran gets the start card once it finishes', () => {
  assert.match(src, /mounted\?\.dataset\.districtId === districtId && \(!helpedAndCanStart \|\| board\.querySelector\('\.op-go'\)\)/)
})
