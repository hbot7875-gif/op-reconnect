// The admin panel leaves expired and cancelled ReConnect quests out: nothing
// can be done with them. Display only — the rows stay in the database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8').split('\r\n').join('\n')

test('expired and cancelled quests, and past-deadline teams, are dropped when the data loads', () => {
  assert.match(html, /reconnectCases = \(health\?\.success \? \(health\.cases \|\| \[\]\) : \[\]\)\.filter\(\(c\) => !\(c\.flags \|\| \[\]\)\.includes\('expired'\)\)/)
  assert.ok(html.includes(".filter((i) => !['expired', 'cancelled'].includes(questStatus(i)))"))
})

test('no Expired or Cancelled filter chips or badges, and the agent file skips expired issues', () => {
  assert.ok(!html.includes("['expired', 'Expired', counts.expired]"))
  assert.ok(!html.includes("['cancelled', 'Cancelled', counts.cancelled]"))
  assert.ok(!html.includes('c.expired ? badge'))
  assert.ok(!html.includes('c.cancelled ? badge'))
  assert.match(html, /const issue = \(a\.reconnectHealth \|\| \[\]\)\.find\(\(c\) => !\(c\.flags \|\| \[\]\)\.includes\('expired'\)\)/)
})
