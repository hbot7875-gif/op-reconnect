// RUN AMI — LAST CARD: actions.
//
// Everything a seat (play, draw, pass, RUN AMI, CAUGHT!) or the clock
// (timeouts, disconnect forfeits) does to a match state. Pure, like the
// rest of the engine: each function takes the state and returns a new one
// (structuredClone), never mutating its input. Split out of
// run-ami-rules.js unchanged.

import { COLORS, isWild } from './run-ami-deck.js'
import {
  activeSeats, beginTurn, canPlay, clearOneCard, closeCatchWindows, drawCards, ev, finish,
  forfeitInPlace, stepFrom,
} from './run-ami-rules.js'

const fail = (error) => ({ ok: false, error })

/**
 * Apply one action for `seat`. Never mutates `input`.
 *
 * Returns { ok:false, error } for a rejected action (nothing changes), or
 * { ok:true, changed, state, events, reply }. changed:false means the action
 * was accepted but had nothing to do (a RUN AMI call with nothing to call, a
 * catch with nobody to catch) — the caller must not commit anything, so
 * those leave no public trace at all. `reply` is private to the actor.
 */
export function applyAction(input, seat, action, { now, rng }) {
  if (!input || input.status !== 'active') return fail('match_over')
  if (!Number.isInteger(seat) || !input.seats[seat]) return fail('not_in_match')
  if (input.seats[seat].out) return fail('not_in_match')
  const type = action?.type

  if (type === 'call') return callRunAmi(input, seat, now)
  if (type === 'catch') return catchPlayer(input, seat, now, rng)
  if (type !== 'play' && type !== 'draw' && type !== 'pass') return fail('unknown_action')
  if (input.turn !== seat) return fail('not_your_turn')

  const state = structuredClone(input)
  const me = state.seats[seat]
  const events = []
  const reply = {}

  if (type === 'play') {
    const cardId = String(action.cardId || '')
    const index = me.hand.findIndex((c) => c.id === cardId)
    if (index < 0) return fail('card_not_in_hand')
    if (state.drewThisTurn && state.drawnId !== cardId) return fail('drawn_card_only')
    const card = me.hand[index]
    if (!canPlay(state, card)) return fail('illegal_card')
    if (isWild(card) && !COLORS.includes(action.color)) return fail('color_required')

    closeCatchWindows(state)
    me.timeouts = 0
    const handBefore = me.hand.length
    me.hand.splice(index, 1)
    state.discard.push(card)
    state.color = isWild(card) ? action.color : card.c
    events.push(ev('CARD_PLAYED', seat, { card: { c: card.c, k: card.k }, color: state.color }, { cardId }))
    if (isWild(card)) events.push(ev('COLOR_SELECTED', seat, { color: state.color }))

    if (me.hand.length === 0) {
      finish(state, seat, 'played_out', events)
      return { ok: true, changed: true, state, events, reply }
    }

    if (me.hand.length === 1 && handBefore === 2) {
      // The 2 → 1 play. RUN AMI counts if it rides on this very action
      // (option A); otherwise the grace window for callRunAmi opens now.
      me.oneAt = now
      me.called = action.runAmi === true
      me.catchOpen = !me.called
      if (me.called) {
        me.stats.calls += 1
        events.push(ev('RUN_AMI_CALLED', seat))
        reply.runAmi = 'called'
      }
    } else {
      clearOneCard(me)
    }

    const twoLeft = activeSeats(state).length === 2
    if (card.k === 'skip' || (card.k === 'rev' && twoLeft)) {
      const skipped = stepFrom(state, seat, 1)
      events.push(ev('TURN_SKIPPED', skipped))
      beginTurn(state, stepFrom(state, seat, 2), now)
    } else if (card.k === 'rev') {
      state.dir = -state.dir
      events.push(ev('DIRECTION_REVERSED', seat, { dir: state.dir }))
      beginTurn(state, stepFrom(state, seat, 1), now)
    } else if (card.k === 'd2' || card.k === 'wd4') {
      const victim = stepFrom(state, seat, 1)
      const got = drawCards(state, victim, card.k === 'd2' ? 2 : 4, rng)
      events.push(ev('CARD_DRAWN', victim, { count: got.length, forced: true }, { cardIds: got.map((c) => c.id) }))
      events.push(ev('TURN_SKIPPED', victim))
      beginTurn(state, stepFrom(state, seat, 2), now)
    } else {
      beginTurn(state, stepFrom(state, seat, 1), now)
    }
    return { ok: true, changed: true, state, events, reply }
  }

  if (type === 'draw') {
    if (state.drewThisTurn) return fail('already_drew')
    closeCatchWindows(state)
    me.timeouts = 0
    const [card] = drawCards(state, seat, 1, rng)
    state.drewThisTurn = true
    state.drawnId = card ? card.id : null
    events.push(ev('CARD_DRAWN', seat, { count: card ? 1 : 0 }, { cardIds: card ? [card.id] : [] }))
    reply.drawnId = state.drawnId
    if (!card || !canPlay(state, card)) {
      events.push(ev('TURN_PASSED', seat))
      beginTurn(state, stepFrom(state, seat, 1), now)
      reply.autoPassed = true
    }
    return { ok: true, changed: true, state, events, reply }
  }

  // pass
  if (!state.drewThisTurn) return fail('must_draw_first')
  closeCatchWindows(state)
  me.timeouts = 0
  events.push(ev('TURN_PASSED', seat))
  beginTurn(state, stepFrom(state, seat, 1), now)
  return { ok: true, changed: true, state, events, reply }
}

/** RUN AMI after the 2 → 1 play (option B). Valid only inside the grace
 *  window for the current one-card state. A 2-card hand can't pre-arm
 *  anything: with no oneAt there is nothing to register the call against.
 *  Every refusal is the same private 'not_now', with no state change. */
function callRunAmi(input, seat, now) {
  const me = input.seats[seat]
  if (me.hand.length === 1 && me.called) return { ok: true, changed: false, reply: { runAmi: 'called' } }
  const valid = me.hand.length === 1 && me.oneAt !== null && me.catchOpen
    && now - me.oneAt <= input.cfg.runAmiGraceMs
  if (!valid) return { ok: true, changed: false, reply: { runAmi: 'not_now' } }

  const state = structuredClone(input)
  const target = state.seats[seat]
  target.called = true
  target.catchOpen = false
  target.stats.calls += 1
  return {
    ok: true, changed: true, state,
    events: [ev('RUN_AMI_CALLED', seat)],
    reply: { runAmi: 'called' },
  }
}

/** Every opponent who is on one card, never called for it, is past the
 *  grace window, and whose window the next action has not closed. Nobody
 *  catchable → a private 'nothing', no state change, no event. */
export function catchableSeats(state, catcher, now) {
  return state.seats.map((_, i) => i).filter((i) => {
    const s = state.seats[i]
    return i !== catcher && !s.out && s.hand.length === 1 && s.catchOpen && !s.called
      && s.oneAt !== null && now - s.oneAt > state.cfg.runAmiGraceMs
  })
}

function catchPlayer(input, seat, now, rng) {
  const targets = catchableSeats(input, seat, now)
  if (!targets.length) return { ok: true, changed: false, reply: { caught: false } }

  const state = structuredClone(input)
  const events = []
  for (const target of targets) {
    const got = drawCards(state, target, state.cfg.catchPenalty, rng)
    state.seats[target].stats.caught += 1
    state.seats[seat].stats.catches += 1
    events.push(ev('PLAYER_CAUGHT', seat, { target, penalty: got.length }, { cardIds: got.map((c) => c.id) }))
  }
  return { ok: true, changed: true, state, events, reply: { caught: true, count: targets.length } }
}

/** Remove a seat from play. Their hand goes back into the draw pile — the
 *  cleanest rule: no cards leave the game and nobody inherits a hand. */
export function forfeitSeat(input, seat, reason, { now, rng }) {
  const state = structuredClone(input)
  const events = []
  forfeitInPlace(state, seat, reason, now, rng, events)
  return { state, events }
}

/**
 * Everything the clock owes the match, applied deterministically on any
 * request (and by the cron sweep): forfeit seats gone past the disconnect
 * grace, then resolve an expired turn. `goneSeats` comes from heartbeats,
 * which live outside this state.
 *
 * If every remaining seat is gone, the match is abandoned with no winner —
 * the last one to drop must not be handed a 'last_standing' result just for
 * being forfeited second.
 */
export function resolveClock(input, { now, rng, goneSeats = [] }) {
  if (!input || input.status !== 'active') return { changed: false, state: input, events: [] }
  const state = structuredClone(input)
  const events = []
  const gone = [...new Set(goneSeats)].filter((i) => state.seats[i] && !state.seats[i].out)

  if (gone.length && gone.length === activeSeats(state).length) {
    for (const i of gone) {
      const s = state.seats[i]
      s.out = true
      s.outReason = 'disconnect'
      state.draw.push(...s.hand)
      s.hand = []
      clearOneCard(s)
      events.push(ev('PLAYER_FORFEITED', i, { reason: 'disconnect' }))
    }
    finish(state, null, 'abandoned', events)
    return { changed: true, state, events }
  }
  for (const i of gone) forfeitInPlace(state, i, 'disconnect', now, rng, events)

  // One timeout per call at most: the new turn's deadline is measured from
  // `now`, so a long-idle match advances one seat per sweep, never skipping
  // a seat's whole timer in a single burst.
  if (state.status === 'active' && state.deadline !== null && now >= state.deadline) {
    const seat = state.turn
    const me = state.seats[seat]
    closeCatchWindows(state)
    me.timeouts += 1
    me.stats.timeouts += 1
    if (!state.drewThisTurn) {
      const got = drawCards(state, seat, 1, rng)
      events.push(ev('CARD_DRAWN', seat, { count: got.length, auto: true }, { cardIds: got.map((c) => c.id) }))
    }
    events.push(ev('TURN_TIMEOUT', seat))
    if (me.timeouts >= state.cfg.maxTimeouts) forfeitInPlace(state, seat, 'timeouts', now, rng, events)
    else beginTurn(state, stepFrom(state, seat, 1), now)
  }
  return { changed: events.length > 0, state, events }
}
