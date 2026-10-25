// The HUD badge count and the unlock reveal follow the live Badge Collection
// catalog the server sends (player.badgeCollectionTemplates), not the
// hand-kept list in badges.js — which fell behind every new event: eight event
// badges (370 awards) never got a reveal or a place in the count.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectionBadgeIds, earnedBadgeCount } from './badges.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const EIGHT = [
  'event_vma_community_chest', 'event_mama_2026', 'event_arirang_recelebrate_2026', 'event_rc26_after_party',
  'event_rc26_party_crasher', 'event_rc26_arirang_cult', 'event_rc26_side_quest_aliens', 'event_rc26_side_quest_hooligans',
]

test('the live catalog decides what counts', () => {
  const state = { player: {
    badges: ['district_frag_1:d1', 'event_brand_new_2027', 'streak:7', 'defuse'],
    badgeCollectionTemplates: ['district_frag_1', 'event_brand_new_2027'],
  } }
  assert.deepEqual(collectionBadgeIds(state), ['district_frag_1:d1', 'event_brand_new_2027'])
  assert.equal(earnedBadgeCount(state), 2)
})

test('without the live list, the fallback now includes the eight that fell off it; legacy ids never count', () => {
  const state = { player: { badges: [...EIGHT, 'streak:30', 'defuse', 'ward:mono'] } }
  assert.equal(earnedBadgeCount(state), EIGHT.length + 1)
  assert.equal(earnedBadgeCount({ player: { badges: EIGHT, badgeCollectionTemplates: [] } }), EIGHT.length)
})

test('getGameState sends the active catalog with the player', () => {
  const handlers = read('supabase/functions/op-reconnect/lib/handlers.ts')
  assert.match(handlers, /timed\('badgeCatalog', supabase\.from\('rc_badge_catalog'\)\.select\('id'\)\.eq\('active', true\)\)/)
  assert.match(handlers, /badgeCollectionTemplates: \(catalogRows \|\| \[\]\)\.map\(\(c: any\) => c\.id\)/)
  // Appended last in the batch, so no binding after it shifts.
  assert.match(handlers, /voting, \{ data: catalogRows \},\n  \] = await Promise\.all\(/)
})

test('a badge the app failed to announce at the time is revealed as a catch-up', () => {
  const reveal = read('js/badge-reveal.js')
  assert.match(reveal, /const LATE_REVEAL_MS = 24 \* 3600_000/)
  assert.match(reveal, /EARNED EARLIER/)
})
