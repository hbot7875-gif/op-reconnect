// The admin panel leaves expired ReConnect quests out: nothing can be done
// with them. Display only — the rows stay in the database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8').split('\r\n').join('\n')

test('expired quests and past-deadline teams are dropped when the data loads', () => {
  assert.match(html, /reconnectCases = \(health\?\.success \? \(health\.cases \|\| \[\]\) : \[\]\)\.filter\(\(c\) => !\(c\.flags \|\| \[\]\)\.includes\('expired'\)\)/)
  assert.match(html, /reconnectItems = buildQuestItems\([^\n]*\)\.filter\(\(i\) => questStatus\(i\) !== 'expired'\)/)
})

test('no Expired filter chip or expired badge, and the agent file skips expired issues', () => {
  assert.doesNotMatch(html, /\['expired', 'Expired', counts\.expired\]/)
  assert.doesNotMatch(html, /c\.expired \? badge\('muted', `\$\{c\.expired\} expired`\)/)
  assert.match(html, /const issue = \(a\.reconnectHealth \|\| \[\]\)\.find\(\(c\) => !\(c\.flags \|\| \[\]\)\.includes\('expired'\)\)/)
})
