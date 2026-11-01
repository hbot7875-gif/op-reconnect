import test from 'node:test'
import assert from 'node:assert/strict'
import { mamaPopupKind, markMamaTeamPopupSeen, mamaTeamPopupCopy, closingSoon, leftLabel } from './mama-team-popup-rules.js'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }
const voting = (o = {}) => ({
  campaignId: 'mama_2026_r2', title: 'MAMA 2026', roundLabel: 'Round 2', phase: 'open',
  opensAt: '2026-10-28T09:00:00Z', closesAt: '2026-11-08T14:59:59Z', done: 0, total: 6,
  battle: { myTeam: 'hooligans', teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: 10 }, { id: 'aliens', label: 'ALIENS', points: 9 }] },
  ...o,
})
// 22:45 KST on Oct 31 = 13:45 UTC; reset at 15:00 UTC.
const late = new Date('2026-10-31T13:45:00Z')
const early = new Date('2026-10-31T11:00:00Z') // 20:00 KST

test('last call from 21:00 KST while nothing is verified today', () => {
  assert.equal(closingSoon(voting(), late), true)
  assert.equal(closingSoon(voting(), early), false)
  assert.equal(closingSoon(voting({ done: 1 }), late), false)
  assert.equal(closingSoon(voting({ phase: 'soon' }), late), false)
})

test('closing wins over live, once per KST day, never on the voting screen', () => {
  const storage = mem()
  assert.equal(mamaPopupKind(voting(), { agentNo: 'A1', storage, now: late }), 'closing')
  assert.equal(mamaPopupKind(voting(), { agentNo: 'A1', storage, now: late, screen: 'voting' }), null)
  markMamaTeamPopupSeen(storage, 'A1', voting(), 'closing', late)
  // Seen: falls back to the day's live popup if that wasn't seen either.
  assert.equal(mamaPopupKind(voting(), { agentNo: 'A1', storage, now: late }), 'live')
  markMamaTeamPopupSeen(storage, 'A1', voting(), 'live', late)
  assert.equal(mamaPopupKind(voting(), { agentNo: 'A1', storage, now: late }), null)
  // Next KST evening it's back.
  assert.equal(mamaPopupKind(voting(), { agentNo: 'A1', storage, now: new Date('2026-11-01T13:45:00Z') }), 'closing')
})

test('a seen live popup does not hide the evening last call', () => {
  const storage = mem()
  markMamaTeamPopupSeen(storage, 'A1', voting(), 'live', early)
  assert.equal(mamaPopupKind(voting(), { agentNo: 'A1', storage, now: late }), 'closing')
})

test('no team: still the team popup', () => {
  assert.equal(mamaPopupKind(voting({ battle: { myTeam: null, teams: [] } }), { agentNo: 'A1', storage: mem(), now: late }), 'team')
})

test('copy: countdown, no later button, last day says closes', () => {
  const c = mamaTeamPopupCopy(voting(), null, 'closing', late)
  assert.equal(c.title, 'Votes reset in 1h 15m')
  assert.equal(c.later, undefined)
  assert.match(c.body, /00:00 KST/)
  assert.match(c.body, /HOOLIGANS/)
  const last = mamaTeamPopupCopy(voting(), null, 'closing', new Date('2026-11-08T14:30:00Z'))
  assert.equal(last.title, 'Voting closes in 29m')
  assert.equal(leftLabel(10_000), '1m')
})
