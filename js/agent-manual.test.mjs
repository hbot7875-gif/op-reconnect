import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manual = readFileSync('js/agent-manual.js', 'utf8')

test('How to Play explains Skip without calling it Quest completion', () => {
  assert.match(manual, /remove the ReConnect requirement from this district attempt/)
  assert.match(manual, /still finish its Track and Album goals/)
  assert.match(manual, /Skipped is not completed/)
  assert.match(manual, /will not count as a completed ReConnect Quest/)
  assert.match(manual, /Mission Bond is only earned by completing one/)
  assert.doesNotMatch(manual, /Quest rewards/)
  assert.match(manual, /stay counted for your teammates/)
})

test('How to Play lists eligibility, prices and free exits truthfully', () => {
  assert.match(manual, /Easy\+: 150 XP \+ 15 Cells/)
  assert.match(manual, /mode you had when you joined/)
  assert.match(manual, /24 hours after you join/)
  assert.match(manual, /once every 7 days/)
  assert.match(manual, /Teammate Rescue is free after verified 48-hour inactivity/)
  assert.match(manual, /system-stuck Quest is skipped for free/)
  assert.doesNotMatch(manual, /leave a mission yourself at any time/i)
})

test('How to Play explains spendable XP does not remove progression', () => {
  assert.match(manual, /Spendable XP can buy Wings or Skip a ReConnect Quest/)
  assert.match(manual, /never lowers a Level, Rank, badge, or reward/)
})
