// The MAMA team choice is offered from the City (once per KST day) to an
// agent with no team while voting is open — not only inside Voting.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mamaTeamPopupDue, markMamaTeamPopupSeen, mamaTeamPopupCopy } from './mama-team-popup-rules.js'

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
  markMamaTeamPopupSeen(s, 'AGENT100', 'mama_2026', NOW)
  assert.equal(due(NOW), false, 'not again today')
  assert.equal(due(new Date('2026-10-21T14:59:00Z')), false, '23:59 KST, same day')
  assert.equal(due(new Date('2026-10-21T15:00:00Z')), true, 'next KST day')
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT101', now: NOW, storage: s }), true, 'per agent')
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(mamaTeamPopupDue(voting(), { agentNo: 'AGENT100', now: NOW, storage: broken }), false)
})

test('copy names both teams and the live score; the button opens Voting', () => {
  const c = mamaTeamPopupCopy(voting())
  assert.deepEqual([c.eyebrow, c.title, c.action], ['MAMA 2026 · Battle', 'Pick your side', 'Choose my team'])
  assert.equal(c.body, 'Every verified vote adds a point for your team. Choose a side so your votes count.')
  assert.deepEqual(c.teams.map((t) => [t.label, t.points]), [['HOOLIGANS', 812], ['ALIENS', 790]])
  assert.equal(c.later, 'Not now')
  const src = readFileSync(new URL('./mama-team-popup.js', import.meta.url), 'utf8')
  assert.match(src, /go\.onclick = \(\) => \{ hideOverlay\(\); goVoting\(\) \}/)
  assert.match(readFileSync(new URL('./voting.js', import.meta.url), 'utf8'), /!status\.battle\.myTeam && \(status\.campaign\.phase === 'open' \|\| status\.campaign\.promo\) && !local\.chooser\) startChooser\(\)/, 'Voting starts the choice on arrival')
  assert.match(readFileSync(new URL('./main.js', import.meta.url), 'utf8'), /checkForMamaTeamPopup\(state\)/)
})
