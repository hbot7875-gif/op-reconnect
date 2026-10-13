import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const map = readFileSync(new URL('./city-map.js', import.meta.url), 'utf8')

test('MAMA uses its own free seam without repositioning existing City markers', () => {
  assert.match(map, /const candyAngle = onParty \? Math\.PI : opts\.birthdayAtTop \? Math\.PI \/ 2 - 0\.20 : -Math\.PI \/ 2 - 0\.20/)
  assert.match(map, /toolMarker\(opts\.birthdayAtTop \? Math\.PI \/ 2 \+ 0\.20 : Math\.PI \/ 2 - \(onGoldenCorner \? 0\.20 : 0\), '⚡', 'VMA'/)
  assert.match(map, /const marker = toolMarker\(opts\.birthdayAtTop \? -Math\.PI \/ 2 - 0\.20 : Math\.PI \/ 2 \+ \(onVma \? 0\.20 : 0\), opts\.birthdayIcon \|\| '🐰'/)
  assert.match(map, /votingMarker\(onParty \? Math\.PI \/ 2 : 0, opts\.voting\)/)
  assert.doesNotMatch(map, /bottomKeys|bottomAngle|bottomStep/)
})

test('the MAMA marker keeps the standard edge-safe label and temporary-event treatment', () => {
  assert.match(map, /toolMarker\(angle, '', v\.label \|\| 'MAMA 2026', v\.onOpen, `vt-map-mama/)
  assert.match(map, /Math\.abs\(nx\) > 0\.55 && words\.length > 1 \? 1 : 0/)
})
