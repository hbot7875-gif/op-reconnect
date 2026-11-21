// Red Zone counted 0 of AGENT273's 52 SWIM/Haegeum plays (Nov 21 2026): they
// have a ListenBrainz name, but their plays arrive from Pano Scrobbler.
import assert from 'node:assert/strict'
import test from 'node:test'
import { redZoneSourceAllowed, redZoneFeedAllowed, redZoneEligibleRows } from './red-zone-feeds.ts'

const LB = new Map([['A1', 'listenbrainz']])

test('a ListenBrainz agent’s Pano and Web Scrobbler plays count', () => {
  assert.equal(redZoneFeedAllowed('listenbrainz', 'lb-like'), true)
  assert.equal(redZoneFeedAllowed('listenbrainz', 'webhook'), true)
  assert.equal(redZoneFeedAllowed('listenbrainz', 'listenbrainz'), true)
  assert.equal(redZoneFeedAllowed('listenbrainz', 'statsfm'), false)
  assert.equal(redZoneFeedAllowed('listenbrainz', 'musicat'), false)
})

test('other sources keep their old rule', () => {
  for (const [sel, stored, want] of [
    ['direct', 'lb-like', true], ['direct', 'listenbrainz', false],
    ['statsfm', 'statsfm', true], ['statsfm', 'lb-like', false],
    ['musicat', 'webhook', false], [undefined, 'lb-like', false],
  ]) {
    assert.equal(redZoneFeedAllowed(sel, stored), want, `${sel}/${stored}`)
    assert.equal(redZoneFeedAllowed(sel, stored), redZoneSourceAllowed(sel, stored))
  }
  // The battle's rule is unchanged.
  assert.equal(redZoneSourceAllowed('listenbrainz', 'lb-like'), false)
})

test('Pano-only plays all count', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ agent_no: 'A1', track_name: 'SWIM', listened_at: 1000 + i * 240, source: 'lb-like' }))
  assert.equal(redZoneEligibleRows(rows, LB).length, 7)
})

test('one listen sent by Pano to both us and ListenBrainz counts once', () => {
  const rows = []
  for (let i = 0; i < 6; i++) {
    const t = 1000 + i * 240
    rows.push({ agent_no: 'A1', track_name: 'SWIM', listened_at: t, source: 'lb-like' })
    rows.push({ agent_no: 'A1', track_name: 'SWIM', listened_at: t, source: 'listenbrainz', source_client: 'Pano Scrobbler' })
  }
  rows.sort((a, b) => a.listened_at - b.listened_at)
  const kept = redZoneEligibleRows(rows, LB)
  assert.equal(kept.length, 6)
  // Order preserved.
  assert.deepEqual(kept.map((r) => r.listened_at), [...kept.map((r) => r.listened_at)].sort((a, b) => a - b))
})

test('a Stats.fm agent’s direct rows still do not count', () => {
  const rows = [{ agent_no: 'B1', track_name: 'SWIM', listened_at: 1, source: 'lb-like' }]
  assert.equal(redZoneEligibleRows(rows, new Map([['B1', 'statsfm']])).length, 0)
})

test('a direct agent with two scrobblers reporting the same listens counts each once', () => {
  // AGENT005's pattern: Web Scrobbler and Pano, ~80 s apart, every play.
  const rows = []
  for (let i = 0; i < 6; i++) {
    const t = 1000 + i * 240
    rows.push({ agent_no: 'D1', track_name: 'SWIM', listened_at: t, source: 'webhook' })
    rows.push({ agent_no: 'D1', track_name: 'SWIM', listened_at: t + 80, source: 'lb-like' })
  }
  rows.sort((a, b) => a.listened_at - b.listened_at)
  assert.equal(redZoneEligibleRows(rows, new Map([['D1', 'direct']])).length, 6)
})

test('a single-feed agent is never checked for copies', () => {
  const rows = [1, 2, 3].map((i) => ({ agent_no: 'D2', track_name: 'SWIM', listened_at: 1000 + i * 30, source: 'webhook' }))
  assert.equal(redZoneEligibleRows(rows, new Map([['D2', 'direct']])).length, 3)
})
