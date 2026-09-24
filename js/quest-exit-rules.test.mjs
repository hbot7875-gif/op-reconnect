// Regression tests for every quest-exit path the UI can render.
// The server decides which action applies; these lock down that each one is
// presented correctly — and, critically, that a free exit never advertises a
// price or the paid cooldown, and a blocked exit never offers a live button.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { questExitView, untilLabel, EXIT_ACTIONS } from './quest-exit-rules.js'

const NOW = Date.parse('2026-09-24T12:00:00Z')
const inHours = (h) => new Date(NOW + h * 3600_000).toISOString()

const paid = (over = {}) => ({
  success: true, action: 'skip', free: false, freeReason: null,
  costXp: 150, costCells: 15, balanceXp: 640, balanceCells: 292,
  shortXp: 0, shortCells: 0, canAfford: true,
  waitingPeriod: false, onCooldown: false, hasContributed: true, ...over,
})
const freeQuote = (reason, over = {}) => ({
  success: true, action: reason, free: true, freeReason: reason,
  costXp: 0, costCells: 0, balanceXp: 640, balanceCells: 292,
  shortXp: 0, shortCells: 0, canAfford: true,
  waitingPeriod: false, onCooldown: false, ...over,
})

test('paid skip shows the price on the button and is actionable', () => {
  const v = questExitView(paid(), NOW)
  assert.equal(v.action, 'skip')
  assert.equal(v.free, false)
  assert.equal(v.button, 'Skip Quest')
  assert.equal(v.confirm, 'Skip for 150 XP + 15 Cells')
  assert.equal(v.showPrice, true)
  assert.equal(v.blocked, false)
  assert.equal(v.hold, null)
})

test('singular Cell is not pluralised', () => {
  const v = questExitView(paid({ costCells: 1 }), NOW)
  assert.equal(v.confirm, 'Skip for 150 XP + 1 Cell')
})

test('each free path gets its own label and never shows a price', () => {
  for (const reason of ['cancel_join', 'teammate_rescue', 'expired', 'system_stuck']) {
    const v = questExitView(freeQuote(reason), NOW)
    assert.equal(v.action, reason, reason)
    assert.equal(v.free, true, reason)
    assert.equal(v.showPrice, false, reason)
    assert.equal(v.blocked, false, reason)
    assert.ok(!/\d/.test(v.confirm), `${reason} confirm must not quote a price: ${v.confirm}`)
    // A free exit must never claim the paid 7-day cooldown or the XP caveat.
    assert.ok(!v.notes.some((n) => n.includes('7 days')), reason)
    assert.ok(!v.notes.some((n) => n.includes('Spending XP')), reason)
  }
})

test('the four free paths have distinct buttons', () => {
  const labels = ['cancel_join', 'teammate_rescue', 'expired', 'system_stuck']
    .map((r) => questExitView(freeQuote(r), NOW).button)
  assert.equal(labels[0], 'Cancel Join')
  assert.equal(labels[2], 'Exit Expired Quest')
  assert.equal(new Set(labels).size >= 3, true, 'labels should be distinguishable')
})

test('every free path still promises teammates keep the streams', () => {
  for (const reason of ['cancel_join', 'teammate_rescue', 'expired', 'system_stuck']) {
    const v = questExitView(freeQuote(reason), NOW)
    assert.ok(v.notes.some((n) => n.includes('remain counted for your teammates')), reason)
  }
})

test('within 24h after contributing: blocked, and says why', () => {
  const v = questExitView(paid({ waitingPeriod: true, eligibleAt: inHours(5), hasContributed: true }), NOW)
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'waiting')
  assert.match(v.hold, /in 5 hours/)
  assert.match(v.hold, /already streamed/)
})

test('cooldown blocks and names the date', () => {
  const v = questExitView(paid({ onCooldown: true, cooldownUntil: inHours(96) }), NOW)
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'cooldown')
  assert.match(v.hold, /in 4 days/)
})

test('insufficient balance blocks and names both shortfalls', () => {
  const v = questExitView(paid({ canAfford: false, shortXp: 110, shortCells: 9, balanceXp: 40, balanceCells: 6 }), NOW)
  assert.equal(v.blocked, true)
  assert.equal(v.reason, 'insufficient')
  assert.match(v.hold, /110 more XP/)
  assert.match(v.hold, /9 more Cells/)
})

test('insufficient by one cell reads singular', () => {
  const v = questExitView(paid({ canAfford: false, shortXp: 0, shortCells: 1 }), NOW)
  assert.match(v.hold, /1 more Cell\b/)
  assert.ok(!/more XP/.test(v.hold), 'must not list a resource that is not short')
})

test('a free exit is never blocked by cooldown or balance', () => {
  const v = questExitView(freeQuote('expired', { onCooldown: true, canAfford: true }), NOW)
  assert.equal(v.free, true)
  assert.equal(v.blocked, false)
})

test('paid path always warns that XP spending is safe', () => {
  const v = questExitView(paid(), NOW)
  assert.ok(v.notes.some((n) => n.includes("won't lower your level")))
  assert.ok(v.notes.some((n) => n.includes('once every 7 days')))
})

test('an unknown action falls back to the paid path, never to free', () => {
  const v = questExitView({ ...paid(), action: 'something_new' }, NOW)
  assert.equal(v.action, 'skip')
  assert.equal(v.showPrice, true)
})

test('EXIT_ACTIONS covers every action the view can return', () => {
  for (const a of EXIT_ACTIONS) {
    const q = a === 'skip' ? paid() : freeQuote(a)
    assert.equal(questExitView(q, NOW).action, a)
  }
})

test('untilLabel reads in minutes, hours then days', () => {
  assert.equal(untilLabel(inHours(0.5), NOW), 'in 30 min')
  assert.equal(untilLabel(inHours(5), NOW), 'in 5 hours')
  assert.equal(untilLabel(inHours(1), NOW), 'in 1 hour')
  assert.equal(untilLabel(inHours(96), NOW), 'in 4 days')
  assert.equal(untilLabel(inHours(-3), NOW), 'shortly')
})
