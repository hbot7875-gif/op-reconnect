// Two-stage ReConnect Quest with a War of Cards stage (Bangtan Seven Bridge):
// the stage rules and the temporary quest pass, including the exploit cases
// reviewed before building it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WAR_COUNTED_RESULTS, WAR_PASS_VIEW_GRACE_MS, hasWarStage, countsForWarStage,
  warStageStep, warStageView, warPassLevel, warPassAllows,
} from './reconnect-war-stage.js'

const UNLOCK = '2026-11-12T10:00:00Z'
const NOW = Date.parse('2026-11-12T12:00:00Z')
const CONFIG = { requiredAgents: 4, sharedTrack: { keys: ['danger'], label: 'Danger', target: 150 }, warOfCards: { gamesEach: 1 } }
const openCards = { status: 'open', phase: 'cards', expires_at: '2026-11-15T10:00:00Z', completed_at: null, cards_unlocked_at: UNLOCK }

test('only a quest with a pooled song and warOfCards has the stage', () => {
  assert.equal(hasWarStage(CONFIG), true)
  assert.equal(hasWarStage({ ...CONFIG, warOfCards: null }), false)
  assert.equal(hasWarStage({ requiredAgents: 4, warOfCards: { gamesEach: 1 } }), false, 'needs a sharedTrack stage one')
  assert.equal(hasWarStage(null), false)
})

test('a finished game counts whether you win or not; quitting never does', () => {
  assert.deepEqual([...WAR_COUNTED_RESULTS], ['won', 'played'])
  const after = '2026-11-12T11:00:00Z'
  assert.equal(countsForWarStage({ result: 'won', finished_at: after }, UNLOCK), true)
  assert.equal(countsForWarStage({ result: 'played', finished_at: after }, UNLOCK), true, 'losing a played-out game counts')
  for (const result of ['forfeited', 'last_standing', 'abandoned', null]) {
    assert.equal(countsForWarStage({ result, finished_at: after }, UNLOCK), false, `${result} must not count`)
  }
})

test('only games finished after stage two opened count — not a game from before', () => {
  assert.equal(countsForWarStage({ result: 'won', finished_at: '2026-11-12T09:59:59Z' }, UNLOCK), false)
  assert.equal(countsForWarStage({ result: 'won', finished_at: UNLOCK }, UNLOCK), true)
  assert.equal(countsForWarStage({ result: 'won', finished_at: null }, UNLOCK), false, 'an unfinished seat')
  assert.equal(countsForWarStage({ result: 'won', finished_at: '2026-11-12T11:00:00Z' }, null), false, 'stage two not open')
})

test('stage one: the full team at the target unlocks stage two instead of completing', () => {
  const base = { phase: 'streaming', status: 'open', requiredAgents: 4, target: 150, playedCount: 0 }
  assert.equal(warStageStep({ ...base, joinedCount: 4, pooled: 150 }), 'unlock')
  assert.equal(warStageStep({ ...base, joinedCount: 4, pooled: 149 }), null)
  assert.equal(warStageStep({ ...base, joinedCount: 3, pooled: 400 }), null, 'a team of 3 cannot unlock')
  assert.equal(warStageStep({ ...base, joinedCount: 4, pooled: 150, status: 'expired' }), null)
})

test('stage two: complete only when every required teammate has played', () => {
  const base = { phase: 'cards', status: 'open', requiredAgents: 4, target: 150, pooled: 150 }
  assert.equal(warStageStep({ ...base, joinedCount: 4, playedCount: 3 }), null)
  assert.equal(warStageStep({ ...base, joinedCount: 4, playedCount: 4 }), 'complete')
  // A teammate left after stage one: three who played don't complete it — the
  // empty seat must be filled and the newcomer must play too.
  assert.equal(warStageStep({ ...base, joinedCount: 3, playedCount: 3 }), null)
  assert.equal(warStageStep({ ...base, joinedCount: 4, playedCount: 4, status: 'complete' }), null)
})

test('the stage view lists every joined teammate; nobody counts while locked', () => {
  const v = warStageView({ phase: 'cards', cardsUnlockedAt: UNLOCK, joined: ['A1', 'A2', 'A3', 'A4'], playedAgents: ['A2', 'A4', 'X9'], requiredAgents: 4 })
  assert.deepEqual([v.unlocked, v.done, v.total], [true, 2, 4])
  assert.deepEqual(v.members.map((m) => m.played), [false, true, false, true], 'a non-member who played changes nothing')
  const locked = warStageView({ phase: 'streaming', cardsUnlockedAt: null, joined: ['A1', 'A2'], playedAgents: ['A1'], requiredAgents: 4 })
  assert.deepEqual([locked.unlocked, locked.done], [false, 0])
})

test('quest pass: plays until the member has finished their game', () => {
  assert.equal(warPassLevel({ mission: openCards, played: false, route: 'createRoom', nowMs: NOW }), 'play')
  assert.equal(warPassLevel({ mission: openCards, played: false, route: 'act', nowMs: NOW }), 'play')
})

test('quest pass: after the counted game only look and leave — no rematch, no new room', () => {
  for (const route of ['createRoom', 'joinRoom', 'startMatch', 'act', 'seat']) {
    assert.equal(warPassLevel({ mission: openCards, played: true, route, nowMs: NOW }), null, route)
  }
  for (const route of ['getState', 'leaveRoom', 'watchRoom', 'sendChat']) {
    assert.equal(warPassLevel({ mission: openCards, played: true, route, nowMs: NOW }), 'view', route)
  }
})

test('quest pass: none before stage two, after expiry, or for a cancelled quest', () => {
  assert.equal(warPassLevel({ mission: { ...openCards, phase: 'streaming', cards_unlocked_at: null }, played: false, route: 'createRoom', nowMs: NOW }), null)
  assert.equal(warPassLevel({ mission: { ...openCards, expires_at: '2026-11-12T11:00:00Z' }, played: false, route: 'createRoom', nowMs: NOW }), null, 'past its 7 days')
  assert.equal(warPassLevel({ mission: { ...openCards, status: 'expired' }, played: false, route: 'getState', nowMs: NOW }), null)
  assert.equal(warPassLevel({ mission: { ...openCards, status: 'cancelled' }, played: false, route: 'getState', nowMs: NOW }), null)
  assert.equal(warPassLevel({ mission: null, played: false, route: 'getState', nowMs: NOW }), null)
})

test('quest pass: a completed quest only lets members see the table, briefly', () => {
  const done = { ...openCards, status: 'complete', completed_at: '2026-11-12T11:30:00Z' }
  assert.equal(warPassLevel({ mission: done, played: true, route: 'getState', nowMs: NOW }), 'view')
  assert.equal(warPassLevel({ mission: done, played: true, route: 'createRoom', nowMs: NOW }), null)
  assert.equal(warPassLevel({ mission: done, played: false, route: 'act', nowMs: NOW }), null, 'no play after completion')
  const later = Date.parse(done.completed_at) + WAR_PASS_VIEW_GRACE_MS + 1
  assert.equal(warPassLevel({ mission: done, played: true, route: 'getState', nowMs: later }), null)
})

test('warPassAllows: play allows everything, view only looks', () => {
  assert.equal(warPassAllows('play', 'startMatch'), true)
  assert.equal(warPassAllows('view', 'leaveRoom'), true)
  assert.equal(warPassAllows('view', 'act'), false)
  assert.equal(warPassAllows(null, 'getState'), false)
})

// ── Wiring (source checks: refreshMission and run-ami need a live database) ──
import { readFileSync } from 'node:fs'
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')

test('refreshMission: stage one moves to cards once; completion only from the cards stage', () => {
  const fn = src('./reconnect-missions.ts')
  const war = fn.slice(fn.indexOf("if (variant === 'connect' && hasWarStage(config))"), fn.indexOf('// The cipher phase'))
  assert.ok(war.length > 200, 'war branch sits before the cipher/complete block')
  assert.match(war, /update\(\{ phase: 'cards', cards_unlocked_at: unlockedAt \}\)[\s\S]*?\.eq\('status', 'open'\)\.eq\('phase', 'streaming'\)/, 'unlock is a one-way guarded transition')
  assert.match(war, /update\(\{ status: 'complete'[\s\S]*?\.eq\('phase', 'cards'\)/, 'completion requires stage two')
  assert.match(war, /return mission\s*\n\s*\}\s*$/, 'never falls through to the ordinary pooled completion')
})

test('War of Cards access: tester, full album, or a quest pass for this route', () => {
  const ami = src('./run-ami.ts')
  assert.match(ami, /isTester\(agentNo\)[\s\S]*isComplete\(agentNo\)[\s\S]*warQuestPassAllows\(supabase, agentNo, route\)/)
  const pass = src('./war-quest-pass.ts')
  assert.doesNotMatch(pass, /rc_album_covers|rc_album_gift|\.insert\(|\.update\(|\.upsert\(/, 'the pass never writes, and never touches the album')
})
