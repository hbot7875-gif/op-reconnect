import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const migration = read('supabase/migrations/20261013090000_rc_jimin_birthday_badge.sql')
const badgeMaker = read('badge-admin.html')

test('Jimin Birthday Badge is the next active Event template', () => {
  assert.match(migration, /'event_jimin_birthday_2026', 'event', 'rare', 'Jimin Birthday Badge'/)
  assert.match(migration, /Complete the MUSE Birthday Era on October 13, 2026\./)
  assert.match(migration, /146, true/)
})

test('badge-only migration contains no award, Era Card, reward, popup, or room logic', () => {
  assert.doesNotMatch(migration, /rc_award_badge|rc_claim_birthday_era|rc_agent_lit_eras|charged_until/i)
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function|insert\s+into\s+rc_goals/i)
})

test('active catalog templates use the existing Badge Maker upload workflow', () => {
  assert.match(badgeMaker, /templates\.filter\(\(template\) => template\.active !== false\)/)
  assert.match(badgeMaker, /\(bySection\[t\.section\] \|\|= \[\]\)\.push\(t\)/)
  assert.match(badgeMaker, /call\('addBadgeArt', \{/)
  assert.match(badgeMaker, /templateId: upload\.template\.id/)
})
