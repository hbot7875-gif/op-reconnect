import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDeck, finalResults, newMatch, playableIds, publicState, resolveConfig, DEFAULT_CONFIG,
} from './run-ami-rules.js'
import { applyAction, catchableSeats, forfeitSeat, resolveClock } from './run-ami-actions.js'
import { mulberry32 } from './run-ami-test-store.mjs'

const NOW = 1_000_000
const C = (id, c, k) => ({ id, c, k })
const filler = (n, c = 'b', k = '7') => Array.from({ length: n }, (_, i) => C(`d${i}`, c, k))
const ctx = (now = NOW, seed = 7) => ({ now, rng: mulberry32(seed) })

/** A match with hand-picked hands and table, built from a real newMatch so
 *  every field the engine relies on exists. */
function table({ hands, top, color, turn = 0, dir = 1, draw, cfg = {} }) {
  const st = newMatch({ seatCount: hands.length, rng: mulberry32(1), now: NOW, config: cfg })
  st.seats.forEach((s, i) => { s.hand = hands[i] })
  st.discard = [top]
  st.color = color ?? top.c
  st.turn = turn
  st.dir = dir
  st.draw = draw ?? filler(30)
  st.drewThisTurn = false
  st.drawnId = null
  st.deadline = NOW + 30_000
  return st
}

const totalCards = (st) => st.draw.length + st.discard.length + st.seats.reduce((n, s) => n + s.hand.length, 0)
const play = (st, seat, cardId, extra = {}, at = NOW) => applyAction(st, seat, { type: 'play', cardId, ...extra }, ctx(at))

// ── Deck and deal ─────────────────────────────────────────────────────

test('deck: 108 original cards in the approved composition', () => {
  const deck = buildDeck()
  assert.equal(deck.length, 108)
  for (const c of ['r', 'y', 'g', 'b']) {
    const mine = deck.filter((x) => x.c === c)
    assert.equal(mine.length, 25)
    assert.equal(mine.filter((x) => x.k === '0').length, 1)
    for (const k of ['1', '9', 'skip', 'rev', 'd2']) assert.equal(mine.filter((x) => x.k === k).length, 2)
  }
  assert.equal(deck.filter((x) => x.k === 'wild').length, 4)
  assert.equal(deck.filter((x) => x.k === 'wd4').length, 4)
})

test('initial deal: 7 each, number starter, unique ids, nothing lost', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const n of [2, 3, 4]) {
      const st = newMatch({ seatCount: n, rng: mulberry32(seed), now: NOW, config: {} })
      assert.ok(st.seats.every((s) => s.hand.length === 7))
      assert.match(st.discard[0].k, /^[0-9]$/)
      assert.equal(st.color, st.discard[0].c)
      assert.equal(totalCards(st), 108)
      const ids = [...st.draw, ...st.discard, ...st.seats.flatMap((s) => s.hand)].map((c) => c.id)
      assert.equal(new Set(ids).size, 108)
      assert.ok(st.turn >= 0 && st.turn < n)
      assert.equal(st.deadline, NOW + DEFAULT_CONFIG.turnSeconds * 1000)
    }
  }
})

test('player count is enforced (2–4)', () => {
  assert.throws(() => newMatch({ seatCount: 1, rng: mulberry32(1), now: NOW }))
  assert.throws(() => newMatch({ seatCount: 5, rng: mulberry32(1), now: NOW }))
})

test('config is clamped and defaults fill gaps', () => {
  const cfg = resolveConfig({ turnSeconds: 2, catchPenalty: 99, runAmiGraceMs: 'x' })
  assert.equal(cfg.turnSeconds, 10)
  assert.equal(cfg.catchPenalty, 4)
  assert.equal(cfg.runAmiGraceMs, DEFAULT_CONFIG.runAmiGraceMs)
})

// ── Legal moves ───────────────────────────────────────────────────────

test('valid number match (different colour, same number)', () => {
  const st = table({ hands: [[C('a', 'y', '5'), C('a2', 'g', '1')], [C('b', 'g', '2')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.ok(r.ok)
  assert.equal(r.state.color, 'y')
  assert.equal(r.state.turn, 1)
})

test('valid colour match', () => {
  const st = table({ hands: [[C('a', 'r', '9'), C('a2', 'g', '1')], [C('b', 'g', '2')]], top: C('t', 'r', '5') })
  assert.ok(play(st, 0, 'a').ok)
})

test('invalid card is rejected and changes nothing', () => {
  const st = table({ hands: [[C('a', 'y', '9'), C('a2', 'g', '1')], [C('b', 'g', '2')]], top: C('t', 'r', '5') })
  const before = JSON.stringify(st)
  assert.deepEqual(play(st, 0, 'a'), { ok: false, error: 'illegal_card' })
  assert.equal(JSON.stringify(st), before)
})

test('action matches action across colours', () => {
  const st = table({ hands: [[C('a', 'y', 'skip'), C('x', 'g', '1')], [C('b', 'g', '2')], [C('c', 'g', '3')]], top: C('t', 'r', 'skip') })
  assert.ok(play(st, 0, 'a').ok)
})

test('playableIds lists exactly the legal cards, only on your turn', () => {
  const st = table({ hands: [[C('a', 'r', '1'), C('b', 'y', '5'), C('c', 'g', '2'), C('w', null, 'wild')], [C('z', 'g', '2')]], top: C('t', 'r', '5') })
  assert.deepEqual(playableIds(st, 0).sort(), ['a', 'b', 'w'])
  assert.deepEqual(playableIds(st, 1), [])
})

// ── Action cards ──────────────────────────────────────────────────────

test('skip: 3 players, next is skipped', () => {
  const st = table({ hands: [[C('a', 'r', 'skip'), C('x', 'g', '1')], [C('b', 'g', '2')], [C('c', 'g', '3')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.equal(r.state.turn, 2)
  assert.ok(r.events.some((e) => e.type === 'TURN_SKIPPED' && e.seat === 1))
})

test('reverse with 2 players behaves as skip (same player again)', () => {
  const st = table({ hands: [[C('a', 'r', 'rev'), C('x', 'g', '1')], [C('b', 'g', '2')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.equal(r.state.turn, 0)
  assert.equal(r.state.dir, 1)
})

test('reverse with 3 and 4 players flips direction', () => {
  for (const n of [3, 4]) {
    const hands = Array.from({ length: n }, (_, i) => [C(`h${i}`, 'g', '1'), C(`h${i}b`, 'g', '2')])
    hands[1] = [C('rv', 'r', 'rev'), C('x', 'g', '4')]
    const st = table({ hands, top: C('t', 'r', '5'), turn: 1 })
    const r = play(st, 1, 'rv')
    assert.equal(r.state.dir, -1)
    assert.equal(r.state.turn, 0)
    // and play continues backwards from there
    const r2 = applyAction(r.state, 0, { type: 'draw' }, ctx())
    const passed = r2.state.turn === 0 ? applyAction(r2.state, 0, { type: 'pass' }, ctx()).state : r2.state
    assert.equal(passed.turn, n - 1)
  }
})

test('draw two: next player draws 2 and loses the turn', () => {
  const st = table({ hands: [[C('a', 'r', 'd2'), C('x', 'g', '1')], [C('b', 'g', '2')], [C('c', 'g', '3')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.equal(r.state.seats[1].hand.length, 3)
  assert.equal(r.state.turn, 2)
  assert.equal(totalCards(r.state), totalCards(st))
})

test('draw two with 2 players: the victim draws and the player goes again', () => {
  const st = table({ hands: [[C('a', 'r', 'd2'), C('x', 'g', '1')], [C('b', 'g', '2')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.equal(r.state.seats[1].hand.length, 3)
  assert.equal(r.state.turn, 0)
})

test('wild needs a colour and sets it', () => {
  const st = table({ hands: [[C('w', null, 'wild'), C('x', 'g', '1')], [C('b', 'g', '2')]], top: C('t', 'r', '5') })
  assert.deepEqual(play(st, 0, 'w'), { ok: false, error: 'color_required' })
  assert.deepEqual(play(st, 0, 'w', { color: 'purple' }), { ok: false, error: 'color_required' })
  const r = play(st, 0, 'w', { color: 'g' })
  assert.equal(r.state.color, 'g')
  assert.ok(r.events.some((e) => e.type === 'COLOR_SELECTED' && e.pub.color === 'g'))
  // colour change: green now plays, red does not
  assert.deepEqual(playableIds(r.state, 1), ['b'])
})

test('wild draw four: legal any time, +4, skip, colour chosen', () => {
  const st = table({ hands: [[C('w', null, 'wd4'), C('x', 'r', '1')], [C('b', 'g', '2')], [C('c', 'y', '3')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'w', { color: 'y' })
  assert.equal(r.state.seats[1].hand.length, 5)
  assert.equal(r.state.turn, 2)
  assert.equal(r.state.color, 'y')
})

test('no stacking: a victim of draw two cannot answer with draw two', () => {
  const st = table({ hands: [[C('a', 'r', 'd2'), C('x', 'g', '1')], [C('b', 'y', 'd2')], [C('c', 'g', '3')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.deepEqual(applyAction(r.state, 1, { type: 'play', cardId: 'b' }, ctx()), { ok: false, error: 'not_your_turn' })
})

// ── Turn order and ownership ──────────────────────────────────────────

test('turn progression wraps around the table', () => {
  let st = table({ hands: [[C('a', 'r', '1'), C('a2', 'r', '2')], [C('b', 'r', '3'), C('b2', 'r', '4')], [C('c', 'r', '6'), C('c2', 'r', '8')]], top: C('t', 'r', '5') })
  st = play(st, 0, 'a').state
  assert.equal(st.turn, 1)
  st = play(st, 1, 'b').state
  assert.equal(st.turn, 2)
  st = play(st, 2, 'c').state
  assert.equal(st.turn, 0)
})

test('cannot play out of turn', () => {
  const st = table({ hands: [[C('a', 'r', '1')], [C('b', 'r', '3'), C('b2', 'r', '4')]], top: C('t', 'r', '5') })
  assert.deepEqual(play(st, 1, 'b'), { ok: false, error: 'not_your_turn' })
})

test("cannot play another player's card (or an invented id)", () => {
  const st = table({ hands: [[C('a', 'r', '1'), C('a2', 'g', '1')], [C('b', 'r', '3')]], top: C('t', 'r', '5') })
  assert.deepEqual(play(st, 0, 'b'), { ok: false, error: 'card_not_in_hand' })
  assert.deepEqual(play(st, 0, 'zzzz'), { ok: false, error: 'card_not_in_hand' })
})

// ── Draw / pass ───────────────────────────────────────────────────────

test('draw 1; a playable drawn card may be played immediately, only that card', () => {
  const st = table({
    hands: [[C('a', 'r', '1'), C('x', 'y', '2')], [C('b', 'g', '3')]],
    top: C('t', 'r', '5'), draw: [...filler(5), C('dr', 'r', '9')],
  })
  const d = applyAction(st, 0, { type: 'draw' }, ctx())
  assert.equal(d.state.turn, 0)
  assert.equal(d.reply.drawnId, 'dr')
  assert.deepEqual(applyAction(d.state, 0, { type: 'draw' }, ctx()), { ok: false, error: 'already_drew' })
  assert.deepEqual(play(d.state, 0, 'a'), { ok: false, error: 'drawn_card_only' })
  assert.deepEqual(playableIds(d.state, 0), ['dr'])
  assert.ok(play(d.state, 0, 'dr').ok)
  // or pass instead
  assert.equal(applyAction(d.state, 0, { type: 'pass' }, ctx()).state.turn, 1)
})

test('drawn card not playable → the turn passes automatically', () => {
  const st = table({ hands: [[C('x', 'y', '2')], [C('b', 'g', '3')]], top: C('t', 'r', '5'), draw: [C('dr', 'g', '9')] })
  const d = applyAction(st, 0, { type: 'draw' }, ctx())
  assert.equal(d.reply.autoPassed, true)
  assert.equal(d.state.turn, 1)
})

test('cannot pass without drawing', () => {
  const st = table({ hands: [[C('x', 'y', '2')], [C('b', 'g', '3')]], top: C('t', 'r', '5') })
  assert.deepEqual(applyAction(st, 0, { type: 'pass' }, ctx()), { ok: false, error: 'must_draw_first' })
})

test('empty draw pile reshuffles the discard pile under the top card', () => {
  const st = table({ hands: [[C('x', 'y', '2')], [C('b', 'g', '3')]], top: C('t', 'r', '5'), draw: [] })
  st.discard = [C('o1', 'g', '1'), C('o2', 'g', '8'), C('t', 'r', '5')]
  const before = totalCards(st)
  const d = applyAction(st, 0, { type: 'draw' }, ctx())
  assert.equal(d.state.discard.length, 1)
  assert.equal(d.state.discard[0].id, 't')
  assert.equal(totalCards(d.state), before)
})

// ── RUN AMI ───────────────────────────────────────────────────────────

const twoCardTable = () => table({
  hands: [[C('a', 'r', '1'), C('k', 'g', '9')], [C('b', 'g', '3'), C('b2', 'g', '4'), C('b3', 'y', '4')], [C('c', 'g', '6'), C('c2', 'y', '6')]],
  top: C('t', 'r', '5'),
})

test('RUN AMI included in the exact play that takes the hand 2 → 1', () => {
  const r = play(twoCardTable(), 0, 'a', { runAmi: true })
  assert.equal(r.reply.runAmi, 'called')
  assert.ok(r.events.some((e) => e.type === 'RUN_AMI_CALLED' && e.seat === 0))
  assert.equal(r.state.seats[0].called, true)
  assert.deepEqual(catchableSeats(r.state, 1, NOW + 60_000), [])
})

test('runAmi on a play that does not go 2 → 1 is ignored, silently', () => {
  const st = twoCardTable()
  st.turn = 1
  st.color = 'g'
  const r = play(st, 1, 'b', { runAmi: true })
  assert.ok(r.ok)
  assert.equal(r.reply.runAmi, undefined)
  assert.ok(!r.events.some((e) => e.type === 'RUN_AMI_CALLED'))
})

test('RUN AMI called during the grace period', () => {
  const r = play(twoCardTable(), 0, 'a')
  const call = applyAction(r.state, 0, { type: 'call' }, ctx(NOW + 1500))
  assert.equal(call.changed, true)
  assert.equal(call.reply.runAmi, 'called')
  assert.deepEqual(catchableSeats(call.state, 1, NOW + 60_000), [])
})

test('RUN AMI after the grace period is not registered', () => {
  const r = play(twoCardTable(), 0, 'a')
  const call = applyAction(r.state, 0, { type: 'call' }, ctx(NOW + 2500))
  assert.equal(call.changed, false)
  assert.equal(call.reply.runAmi, 'not_now')
})

test('RUN AMI cannot be pre-armed from a 2-card resting state', () => {
  const st = twoCardTable()
  const early = applyAction(st, 0, { type: 'call' }, ctx(NOW - 100))
  assert.equal(early.changed, false)
  assert.equal(early.reply.runAmi, 'not_now')
  assert.equal(early.events, undefined)
  // the play that follows, without runAmi, is NOT covered by the early press
  const r = play(st, 0, 'a')
  assert.equal(r.state.seats[0].called, false)
  assert.deepEqual(catchableSeats(r.state, 1, NOW + 2001), [0])
})

test('invalid RUN AMI calls change nothing and emit nothing', () => {
  const st = twoCardTable()
  const r = applyAction(st, 1, { type: 'call' }, ctx())
  assert.deepEqual(r, { ok: true, changed: false, reply: { runAmi: 'not_now' } })
})

test('catch cannot succeed during the grace period', () => {
  const r = play(twoCardTable(), 0, 'a')
  const c = applyAction(r.state, 1, { type: 'catch' }, ctx(NOW + 1999))
  assert.deepEqual(c, { ok: true, changed: false, reply: { caught: false } })
})

test('catch succeeds after grace when the call is missing: +2', () => {
  const r = play(twoCardTable(), 0, 'a')
  const c = applyAction(r.state, 2, { type: 'catch' }, ctx(NOW + 2001))
  assert.equal(c.changed, true)
  assert.equal(c.reply.caught, true)
  assert.equal(c.state.seats[0].hand.length, 3)
  const ev = c.events.find((e) => e.type === 'PLAYER_CAUGHT')
  assert.equal(ev.seat, 2)
  assert.equal(ev.pub.target, 0)
  assert.equal(ev.pub.penalty, 2)
  // the catcher's turn order is untouched
  assert.equal(c.state.turn, r.state.turn)
})

test('the next committed player action closes the catch window', () => {
  const r = play(twoCardTable(), 0, 'a')
  // seat 1 acts (draws) before anyone catches
  const next = applyAction(r.state, 1, { type: 'draw' }, ctx(NOW + 500))
  assert.ok(next.ok)
  const c = applyAction(next.state, 2, { type: 'catch' }, ctx(NOW + 5000))
  assert.equal(c.changed, false)
})

test('a missed call cannot be fixed after the window closes', () => {
  const r = play(twoCardTable(), 0, 'a')
  const next = applyAction(r.state, 1, { type: 'draw' }, ctx(NOW + 500))
  const call = applyAction(next.state, 0, { type: 'call' }, ctx(NOW + 600))
  assert.equal(call.changed, false)
})

test('catch spam: the second catch finds nothing, one penalty only', () => {
  const r = play(twoCardTable(), 0, 'a')
  const first = applyAction(r.state, 1, { type: 'catch' }, ctx(NOW + 2500))
  const second = applyAction(first.state, 1, { type: 'catch' }, ctx(NOW + 2600))
  const third = applyAction(first.state, 2, { type: 'catch' }, ctx(NOW + 2700))
  assert.equal(first.state.seats[0].hand.length, 3)
  assert.equal(second.changed, false)
  assert.equal(third.changed, false)
})

test('you cannot catch yourself', () => {
  const r = play(twoCardTable(), 0, 'a')
  assert.equal(applyAction(r.state, 0, { type: 'catch' }, ctx(NOW + 5000)).changed, false)
})

test('invalid catch with nobody on one card: private nothing, no event', () => {
  const st = twoCardTable()
  assert.deepEqual(applyAction(st, 2, { type: 'catch' }, ctx(NOW + 5000)), { ok: true, changed: false, reply: { caught: false } })
})

test('a forced draw clears the one-card state: a new 2 → 1 needs a new call', () => {
  const st = table({
    hands: [[C('a', 'r', '1'), C('k', 'g', '9')], [C('d2', 'g', 'd2'), C('b2', 'g', '4'), C('b3', 'g', '5')]],
    top: C('t', 'r', '5'),
  })
  const r = play(st, 0, 'a', { runAmi: true })
  assert.equal(r.state.seats[0].called, true)
  // 2-player: seat 0 played a number → seat 1's turn; Draw Two hits seat 0
  r.state.color = 'g'
  const hit = play(r.state, 1, 'd2', {}, NOW + 3000)
  assert.equal(hit.state.seats[0].hand.length, 3)
  assert.equal(hit.state.seats[0].called, false)
})

// ── Winning ───────────────────────────────────────────────────────────

test('win detection: last card ends the match, played_out', () => {
  const st = table({ hands: [[C('a', 'r', '1')], [C('b', 'g', '3')]], top: C('t', 'r', '5') })
  const r = play(st, 0, 'a')
  assert.equal(r.state.status, 'finished')
  assert.equal(r.state.winner, 0)
  assert.equal(r.state.endReason, 'played_out')
  assert.ok(r.events.some((e) => e.type === 'MATCH_WON'))
  assert.deepEqual(play(r.state, 1, 'b'), { ok: false, error: 'match_over' })
  assert.equal(finalResults(r.state)[0].result, 'won')
})

test('a winning wild still needs its colour', () => {
  const st = table({ hands: [[C('w', null, 'wild')], [C('b', 'g', '3')]], top: C('t', 'r', '5') })
  assert.equal(play(st, 0, 'w').error, 'color_required')
  assert.equal(play(st, 0, 'w', { color: 'b' }).state.winner, 0)
})

// ── Clock, timeouts, forfeits ─────────────────────────────────────────

test('timeout without a draw: server draws 1 and passes', () => {
  const st = twoCardTable()
  const r = resolveClock(st, { now: NOW + 30_000, rng: mulberry32(3) })
  assert.ok(r.changed)
  assert.equal(r.state.seats[0].hand.length, 3)
  assert.equal(r.state.turn, 1)
  assert.equal(r.state.seats[0].timeouts, 1)
  assert.ok(r.events.some((e) => e.type === 'TURN_TIMEOUT'))
})

test('timeout after a draw: just passes', () => {
  const st = table({ hands: [[C('x', 'y', '2')], [C('b', 'g', '3')]], top: C('t', 'r', '5'), draw: [C('dr', 'r', '9')] })
  const d = applyAction(st, 0, { type: 'draw' }, ctx())
  const r = resolveClock(d.state, { now: d.state.deadline, rng: mulberry32(3) })
  assert.equal(r.state.seats[0].hand.length, 2)
  assert.equal(r.state.turn, 1)
})

test('before the deadline the clock does nothing', () => {
  const st = twoCardTable()
  assert.equal(resolveClock(st, { now: NOW + 29_999, rng: mulberry32(3) }).changed, false)
})

test('repeated timeouts forfeit the seat; hand returns to the pile', () => {
  let st = table({ hands: [[C('x', 'y', '2'), C('y', 'y', '3')], [C('b', 'g', '3'), C('b2', 'g', '1')], [C('c', 'g', '4'), C('c2', 'g', '6')]], top: C('t', 'r', '5'), cfg: { maxTimeouts: 2 } })
  const total = totalCards(st)
  st = resolveClock(st, { now: st.deadline, rng: mulberry32(3) }).state // seat 0 timeout #1
  st.turn = 0; st.deadline = NOW + 100_000; st.drewThisTurn = false
  const r = resolveClock(st, { now: NOW + 100_000, rng: mulberry32(3) }) // #2 → forfeit
  assert.equal(r.state.seats[0].out, true)
  assert.equal(r.state.seats[0].outReason, 'timeouts')
  assert.equal(r.state.seats[0].hand.length, 0)
  assert.equal(r.state.status, 'active')
  assert.notEqual(r.state.turn, 0)
  assert.equal(totalCards(r.state), total + 0)
})

test('forfeit down to one player: last_standing, which is not a win', () => {
  const st = twoCardTable()
  st.seats[2].out = true
  const { state } = forfeitSeat(st, 1, 'left', ctx())
  assert.equal(state.status, 'finished')
  assert.equal(state.endReason, 'last_standing')
  assert.equal(state.winner, 0)
  const results = finalResults(state)
  assert.equal(results[0].result, 'last_standing')
  assert.ok(results.every((r) => r.result !== 'won'))
})

test('a brief disconnect is not abandonment; only gone seats forfeit', () => {
  const st = twoCardTable()
  const none = resolveClock(st, { now: NOW + 1000, rng: mulberry32(3), goneSeats: [] })
  assert.equal(none.changed, false)
  const one = resolveClock(st, { now: NOW + 1000, rng: mulberry32(3), goneSeats: [2] })
  assert.equal(one.state.seats[2].out, true)
  assert.equal(one.state.status, 'active')
})

test('everyone gone: abandoned, no winner', () => {
  const st = twoCardTable()
  const r = resolveClock(st, { now: NOW + 1000, rng: mulberry32(3), goneSeats: [0, 1, 2] })
  assert.equal(r.state.status, 'abandoned')
  assert.equal(r.state.winner, null)
  assert.equal(r.state.endReason, 'abandoned')
  assert.ok(finalResults(r.state).every((x) => x.result === 'forfeited'))
})

test('skip and turn order step over forfeited seats', () => {
  const st = table({ hands: [[C('a', 'r', 'skip'), C('x', 'g', '1')], [C('b', 'g', '2')], [C('c', 'g', '3')], [C('d', 'g', '4')]], top: C('t', 'r', '5') })
  st.seats[1].out = true
  const r = play(st, 0, 'a')
  assert.equal(r.state.turn, 3) // skips seat 2 (seat 1 is out)
})

// ── Invariants and privacy of the stored public projection ───────────

test('random full games conserve all 108 cards and always end legally', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed)
    const n = 2 + (seed % 3)
    let st = newMatch({ seatCount: n, rng, now: NOW, config: {} })
    let t = NOW
    for (let step = 0; step < 3000 && st.status === 'active'; step++) {
      t += 1000
      const seat = st.turn
      const legal = playableIds(st, seat)
      let r
      if (legal.length) {
        const id = legal[Math.floor(rng() * legal.length)]
        r = applyAction(st, seat, { type: 'play', cardId: id, color: 'g', runAmi: rng() < 0.5 }, { now: t, rng })
      } else if (!st.drewThisTurn) {
        r = applyAction(st, seat, { type: 'draw' }, { now: t, rng })
      } else {
        r = applyAction(st, seat, { type: 'pass' }, { now: t, rng })
      }
      assert.ok(r.ok, `seed ${seed} step ${step}: ${r.error}`)
      st = r.state
      if (rng() < 0.3) {
        const c = applyAction(st, Math.floor(rng() * n), { type: 'catch' }, { now: t + 2500, rng })
        if (c.ok && c.changed) st = c.state
      }
      assert.equal(totalCards(st), 108)
    }
    assert.equal(st.status, 'finished', `seed ${seed} did not finish`)
    assert.equal(st.seats[st.winner].hand.length, 0)
  }
})

test('publicState carries counts, never card ids or hands', () => {
  const st = newMatch({ seatCount: 4, rng: mulberry32(9), now: NOW, config: {} })
  const json = JSON.stringify(publicState(st))
  for (const c of [...st.draw, ...st.seats.flatMap((s) => s.hand)]) assert.ok(!json.includes(c.id), `leaked ${c.id}`)
  assert.ok(!('hand' in publicState(st).seats[0]))
  assert.deepEqual(publicState(st).seats.map((s) => s.cards), [7, 7, 7, 7])
})
