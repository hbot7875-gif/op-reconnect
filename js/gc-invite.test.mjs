import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gcInviteDue, markNewAgent, markGcInviteSeen, markGcInviteDone, GC_LINKS } from './gc-invite-rules.js'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }
const T0 = new Date('2026-11-01T03:00:00Z')
const at = (h) => new Date(T0.getTime() + h * 3600_000)

test('only agents onboarded on this device in the last 3 days', () => {
  const s = mem()
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: T0 }), false)
  markNewAgent(s, 'A1', T0)
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(1) }), true)
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(73) }), false)
  assert.equal(gcInviteDue({ agentNo: 'A2', storage: s, now: at(1) }), false)
})

test('AGENT201 onwards and AGENT139 are asked without the device mark', () => {
  for (const a of ['AGENT201', 'AGENT215', 'AGENT1000', 'AGENT139', 'agent139']) {
    assert.equal(gcInviteDue({ agentNo: a, storage: mem(), now: T0 }), true, a)
  }
  for (const a of ['AGENT200', 'AGENT138', 'AGENT140', 'AGENT001']) {
    assert.equal(gcInviteDue({ agentNo: a, storage: mem(), now: T0 }), false, a)
  }
  const s = mem()
  markGcInviteDone(s, 'AGENT139')
  assert.equal(gcInviteDue({ agentNo: 'AGENT139', storage: s, now: T0 }), false)
})

test('once per KST day until they join', () => {
  const s = mem()
  markNewAgent(s, 'A1', T0)
  markGcInviteSeen(s, 'A1', at(1))
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(5) }), false)
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(24) }), true)
  markGcInviteDone(s, 'A1')
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(48) }), false)
})

test('never over the voting screen until today’s vote is in', () => {
  const s = mem()
  markNewAgent(s, 'A1', T0)
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(1), screen: 'voting' }), false)
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(1), screen: 'voting', votedToday: true }), true)
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: at(1), screen: 'world' }), true)
})

test('broken storage never nags', () => {
  const s = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
  assert.equal(gcInviteDue({ agentNo: 'A1', storage: s, now: T0 }), false)
})

test('same chat links as Settings → Community', () => {
  const settings = readFileSync(new URL('./screen-settings.js', import.meta.url), 'utf8')
  assert.ok(settings.includes(GC_LINKS.updates))
  assert.ok(settings.includes(GC_LINKS.discussion))
})

test('onboarding marks the new agent on both paths, and main.js checks the invite', () => {
  const ob = readFileSync(new URL('./ui-onboarding.js', import.meta.url), 'utf8')
  assert.equal((ob.match(/markNew\(agentNo\)/g) || []).length, 2)
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
  assert.match(main, /checkForGcInvite\(state\)/)
})
