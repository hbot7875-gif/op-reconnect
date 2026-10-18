// RUN AMI — LAST CARD: the rules engine.
//
// Pure functions over one plain-object match state, shared by the Edge
// Function (run-ami.ts, through run-ami-service.js) and node --test. Nothing
// here reads the clock, the database or Math.random: every call is handed
// `now` (ms) and an `rng` (() => [0, 1)), so a test can replay a whole match
// exactly and the server can use crypto randomness.
//
// The state this produces is the server's whole truth — every hand and the
// draw pile included. It is stored in rc_run_ami_match_secrets and never sent
// to a browser; run-ami-view.js is the only thing that turns it into what one
// seat is allowed to see, and publicState() below is the only shape that goes
// in the readable rc_run_ami_matches.public_state column.
//
// V1 house rules (approved 2026-10-11): one 0 and two each of 1–9, Skip,
// Reverse and Draw Two per colour, plus four Wild and four Wild Draw Four.
// Starter is always a number card. No stacking; Draw Two/Four hit the next
// player and skip them; Wild Draw Four is legal any time, no challenge.
// Reverse with two players is a Skip. Draw one when you can't or won't play;
// the drawn card may be played at once if legal, otherwise the turn passes.
//
// Layout (split for the repo's ~300-line rule, behaviour unchanged):
//   run-ami-deck.js    — config, deck composition, shuffle, card ids
//   run-ami-rules.js   — the state model: new match, table queries, the
//                        shared state transitions, public projection
//   run-ami-actions.js — what a seat (or the clock) does to the state

import { HAND_SIZE, MIN_PLAYERS, MAX_PLAYERS, assignIds, buildDeck, isNumber, isWild, resolveConfig, shuffle } from './run-ami-deck.js'

export {
  COLORS, HAND_SIZE, MIN_PLAYERS, MAX_PLAYERS, DEFAULT_CONFIG,
  resolveConfig, isWild, isNumber, buildDeck, shuffle,
} from './run-ami-deck.js'

export const RULES_VERSION = 1

function freshSeat() {
  return {
    hand: [],
    out: false,
    outReason: null,
    timeouts: 0,
    // The one-card state. oneAt is when this seat played down to exactly
    // one card; called is whether RUN AMI was registered for THAT state;
    // catchOpen is whether an opponent may still catch it. Every draw
    // clears all three, so a new one-card state needs a new call.
    oneAt: null,
    called: false,
    catchOpen: false,
    stats: { calls: 0, caught: 0, catches: 0, timeouts: 0 },
  }
}

export function newMatch({ seatCount, rng, now, config }) {
  if (!Number.isInteger(seatCount) || seatCount < MIN_PLAYERS || seatCount > MAX_PLAYERS) {
    throw new Error('seat_count_out_of_range')
  }
  const cfg = resolveConfig(config)
  const draw = shuffle(assignIds(buildDeck(), rng), rng)
  const seats = Array.from({ length: seatCount }, freshSeat)
  for (let round = 0; round < HAND_SIZE; round++) {
    for (const seat of seats) seat.hand.push(draw.pop())
  }

  // Starter must be a number card. Anything else goes back into the pile
  // at a random depth and we flip again; 76 of 108 cards are numbers, so
  // this ends almost immediately.
  let starter = draw.pop()
  while (!isNumber(starter)) {
    draw.splice(Math.floor(rng() * (draw.length + 1)), 0, starter)
    starter = draw.pop()
  }

  const state = {
    rulesVersion: RULES_VERSION,
    cfg,
    status: 'active',
    seats,
    draw,
    discard: [starter],
    color: starter.c,
    dir: 1,
    turn: Math.floor(rng() * seatCount),
    turnNo: 0,
    drewThisTurn: false,
    drawnId: null,
    deadline: null,
    winner: null,
    endReason: null,
  }
  beginTurn(state, state.turn, now)
  return state
}

export const topCard = (state) => state.discard[state.discard.length - 1]
export const activeSeats = (state) => state.seats.map((_, i) => i).filter((i) => !state.seats[i].out)

/** Can `card` go on the pile right now (ignoring whose turn it is)? */
export function canPlay(state, card) {
  if (isWild(card)) return true
  const top = topCard(state)
  return card.c === state.color || card.k === top.k
}

/** The cards `seat` may legally play this instant. After a draw, only the
 *  drawn card is eligible. */
export function playableIds(state, seat) {
  if (state.status !== 'active' || state.turn !== seat || state.seats[seat].out) return []
  const hand = state.seats[seat].hand
  if (state.drewThisTurn) {
    const drawn = hand.find((c) => c.id === state.drawnId)
    return drawn && canPlay(state, drawn) ? [drawn.id] : []
  }
  return hand.filter((c) => canPlay(state, c)).map((c) => c.id)
}

/** `steps` seats onward in the current direction, skipping anyone out. */
export function stepFrom(state, from, steps) {
  const n = state.seats.length
  let at = from
  for (let moved = 0; moved < steps;) {
    at = (at + state.dir + n) % n
    if (!state.seats[at].out) moved++
    if (at === from && state.seats[at].out) break
  }
  return at
}

export function beginTurn(state, seat, now) {
  state.turn = seat
  state.turnNo += 1
  state.drewThisTurn = false
  state.drawnId = null
  state.deadline = now + state.cfg.turnSeconds * 1000
}

export function clearOneCard(seat) {
  seat.oneAt = null
  seat.called = false
  seat.catchOpen = false
}

/** "The next valid gameplay action closes the catch window" — run at the
 *  start of every play/draw/pass/timeout, before the action's own effects. */
export function closeCatchWindows(state) {
  for (const seat of state.seats) seat.catchOpen = false
}

export function drawCards(state, seatIndex, count, rng) {
  const seat = state.seats[seatIndex]
  const drawn = []
  for (let i = 0; i < count; i++) {
    if (!state.draw.length) {
      // Reshuffle everything under the top card back into the pile.
      const top = state.discard.pop()
      state.draw = shuffle(state.discard, rng)
      state.discard = [top]
    }
    if (!state.draw.length) break
    const card = state.draw.pop()
    seat.hand.push(card)
    drawn.push(card)
  }
  if (drawn.length) clearOneCard(seat)
  return drawn
}

export function finish(state, winner, endReason, events) {
  state.status = endReason === 'abandoned' ? 'abandoned' : 'finished'
  state.winner = winner
  state.endReason = endReason
  state.deadline = null
  state.drewThisTurn = false
  state.drawnId = null
  closeCatchWindows(state)
  events.push(endReason === 'played_out'
    ? ev('MATCH_WON', winner, { endReason })
    : ev('MATCH_ENDED', winner, { endReason }))
}

export function ev(type, seat, pub = {}, priv = {}) {
  return { type, seat, pub, priv }
}

export function forfeitInPlace(state, seat, reason, now, rng, events) {
  const s = state.seats[seat]
  if (!s || s.out || state.status !== 'active') return
  s.out = true
  s.outReason = reason
  state.draw.push(...s.hand)
  s.hand = []
  shuffle(state.draw, rng)
  clearOneCard(s)
  events.push(ev('PLAYER_FORFEITED', seat, { reason }))

  const left = activeSeats(state)
  if (left.length === 0) finish(state, null, 'abandoned', events)
  else if (left.length === 1) finish(state, left[0], 'last_standing', events)
  else if (state.turn === seat) beginTurn(state, stepFrom(state, seat, 1), now)
}

/** The only projection of the state that may be stored where it is
 *  readable outside the secrets table: counts, never card identities. */
export function publicState(state) {
  return {
    rulesVersion: state.rulesVersion,
    status: state.status,
    top: { c: topCard(state).c, k: topCard(state).k },
    color: state.color,
    dir: state.dir,
    turn: state.turn,
    turnNo: state.turnNo,
    deadline: state.deadline,
    drewThisTurn: state.drewThisTurn,
    drawCount: state.draw.length,
    discardCount: state.discard.length,
    winner: state.winner,
    endReason: state.endReason,
    seats: state.seats.map((s) => ({
      cards: s.hand.length, out: s.out, outReason: s.outReason, timeouts: s.timeouts,
    })),
  }
}

/** Per-seat history rows for rc_run_ami_match_players, written once when a
 *  match ends. 'won' is only ever a played-out win; last_standing and
 *  abandoned are recorded as exactly that, so a future reward system can't
 *  mistake a walkover for a victory. */
export function finalResults(state) {
  return state.seats.map((s, seat) => {
    let result = 'played'
    if (s.out) result = 'forfeited'
    else if (state.winner === seat) result = state.endReason === 'played_out' ? 'won' : 'last_standing'
    else if (state.endReason === 'abandoned') result = 'abandoned'
    return {
      seat, result, final_cards: s.hand.length, forfeit_reason: s.outReason,
      run_ami_calls: s.stats.calls, times_caught: s.stats.caught,
      catches: s.stats.catches, timeouts: s.stats.timeouts,
    }
  })
}
