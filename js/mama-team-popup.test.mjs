// The MAMA team choice is offered from the City (once per KST day) to an
// agent with no team while voting is open — not only inside Voting.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mamaTeamPopupDue, mamaPopupKind, markMamaTeamPopupSeen, mamaTeamPopupCopy } from './mama-team-popup-rules.js'

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }
const voting = (o = {}) => ({ campaignId: 'mama_2026', title: 'MAMA 2026', phase: 'open',
  battle: { myTeam: null, teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: 812 }, { id: 'aliens', label: 'ALIENS', points: 790 }] }, ...o })
const NOW = new Date('2026-10-21T03:00:00Z') // 12:00 KST

test('shown to an agent with no team while voting is open, on any screen but Voting', () => {
  const s = store()
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT100', now: NOW, storage: s, screen: 'world' }), true)
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT100', now: NOW, storage: s, screen: 'district' }), true)
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT100', now: NOW, storage: s, screen: 'voting' }), false, 'the chooser starts there anyway')
})

test('never for someone on a team, outside the voting window, or without a battle', () => {
  const s = store()
  const due = (v) => mamaTeamPopupDue(v, { agentNo: 'AGENT100', now: NOW, storage: s, screen: 'world' })
  assert.equal(due(voting({ battle: { ...voting().battle, myTeam: 'aliens' } })), false)
  for (const phase of ['upcoming', 'verifying', 'final']) assert.equal(due(voting({ phase })), false, phase)
  assert.equal(due(voting({ battle: null })), false)
  assert.equal(due(null), false)
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: null, now: NOW, storage: s }), false)
})

test('once per KST day until they pick; storage trouble never nags', () => {
  const s = store()
  const due = (now) => mamaTeamPopupDue(voting(), { agentNo: 'AGENT100', now, storage: s, screen: 'world' })
  markMamaTeamPopupSeen(s, 'AGENT100', voting(), 'team', NOW)
  assert.equal(due(NOW), false, 'not again today')
  assert.equal(due(new Date('2026-10-21T14:59:00Z')), false, '23:59 KST, same day')
  assert.equal(due(new Date('2026-10-21T15:00:00Z')), true, 'next KST day')
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT101', now: NOW, storage: s }), true, 'per agent')
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT100', now: NOW, storage: broken }), false)
})

test('copy names both teams and the live score; the button opens Voting', () => {
  const c = mamaTeamPopupCopy(voting())
  assert.deepEqual([c.eyebrow, c.title, c.action], ['MAMA 2026 · Battle', 'The MAMA Battle is LIVE', 'Choose my team'])
  assert.equal(c.body, 'HOOLIGANS vs ALIENS. Pick your side, vote for BTS on Mnet and X, then upload your proof. Every verified vote scores for your team.')
  assert.deepEqual(c.teams.map((t) => [t.label, t.points]), [['HOOLIGANS', 812], ['ALIENS', 790]])
  assert.equal(c.later, 'Not now')
  const src = readFileSync(new URL('./mama-team-popup.js', import.meta.url), 'utf8')
  assert.match(src, /go\.onclick = \(\) => \{ hideOverlay\(\); goVoting\(\) \}/)
  assert.match(readFileSync(new URL('./voting.js', import.meta.url), 'utf8'), /!status\.battle\.myTeam && \(status\.campaign\.phase === 'open' \|\| status\.campaign\.promo\) && !local\.chooser\) startChooser\(\)/, 'Voting starts the choice on arrival')
  assert.match(readFileSync(new URL('./main.js', import.meta.url), 'utf8'), /checkForMamaTeamPopup\(state\)/)
})

test('on a team while voting is open: "The MAMA Battle is LIVE", once a KST day, until today’s votes are in', () => {
  const s = store()
  const onTeam = (o = {}) => voting({ battle: { ...voting().battle, myTeam: 'aliens' }, done: 1, total: 6, ...o })
  const kind = (v, now = NOW, screen = 'world') => mamaPopupKind(v, { agentNo: 'AGENT100', now, storage: s, screen })
  assert.equal(kind(onTeam()), 'live')
  assert.equal(kind(onTeam(), NOW, 'voting'), null, 'already on Voting')
  assert.equal(kind(onTeam({ done: 6 })), null, 'every vote in today')
  assert.equal(kind(onTeam({ phase: 'soon' })), null, 'not before voting opens')
  assert.equal(kind(voting()), 'team', 'no team: the choice instead')
  markMamaTeamPopupSeen(s, 'AGENT100', onTeam(), 'live', NOW)
  assert.equal(kind(onTeam()), null, 'not again today')
  assert.equal(kind(onTeam(), new Date('2026-10-21T15:00:00Z')), 'live', 'next KST day')
  const c = mamaTeamPopupCopy(onTeam({ roundLabel: 'Round 2 · Fans’ Choice' }), null, 'live')
  assert.deepEqual([c.eyebrow, c.title, c.action, c.later], ['MAMA 2026 · Round 2 · Fans’ Choice', 'The MAMA Battle is LIVE', 'Upload now', 'Later'])
  assert.equal(c.body, 'HOOLIGANS vs ALIENS. Vote for BTS on Mnet and X, then upload your proof. Every verified vote scores for ALIENS.')
  assert.deepEqual(c.teams.map((t) => t.label), ['HOOLIGANS', 'ALIENS'])
})

test('a team choice seen during the promo does not hide the live one on opening day', () => {
  const s = store()
  const soon = voting({ phase: 'soon' })
  markMamaTeamPopupSeen(s, 'AGENT100', soon, 'team', NOW)
  assert.equal(mamaPopupKind(soon, { agentNo: 'AGENT100', now: NOW, storage: s }), null)
  assert.equal(mamaPopupKind(voting(), { agentNo: 'AGENT100', now: NOW, storage: s }), 'team')
})
