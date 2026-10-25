// RUN AMI player-facing words: log lines from the reader's side, the end of
// round line, and error codes that must never reach a player raw.

import test from 'node:test'
import assert from 'node:assert/strict'

// state.js wires a document listener at import; nothing here touches it.
globalThis.document ??= { addEventListener() {} }
const { logLine, resultLine, errorText } = await import('./run-ami-cards.js')

const names = ['MOCHI', 'KOYA', 'TATA']
const nameOf = (mySeat) => (seat) => (seat === mySeat ? 'You' : names[seat])

test('the reader\'s own lines agree with "You"', () => {
  const mine = nameOf(0)
  assert.equal(logLine({ type: 'TURN_SKIPPED', seat: 0 }, mine, 0), 'You were skipped')
  assert.equal(logLine({ type: 'MATCH_WON', seat: 0 }, mine, 0), 'You win the round')
  assert.equal(logLine({ type: 'MATCH_ENDED', seat: 0, endReason: 'last_standing' }, mine, 0), 'You are the last agent standing')
})

test('other agents keep the third person', () => {
  const mine = nameOf(0)
  assert.equal(logLine({ type: 'TURN_SKIPPED', seat: 2 }, mine, 0), 'TATA was skipped')
  assert.equal(logLine({ type: 'MATCH_WON', seat: 1 }, mine, 0), 'KOYA wins the round')
  assert.equal(logLine({ type: 'MATCH_ENDED', seat: 1, endReason: 'last_standing' }, mine, 0), 'KOYA is the last agent standing')
})

test('being caught reads "caught you", lower case', () => {
  assert.equal(logLine({ type: 'PLAYER_CAUGHT', seat: 1, target: 0, penalty: 2 }, nameOf(0), 0), 'KOYA caught you · +2')
  assert.equal(logLine({ type: 'PLAYER_CAUGHT', seat: 0, target: 2, penalty: 2 }, nameOf(0), 0), 'You caught TATA · +2')
})

test('without a seat the old wording is unchanged', () => {
  assert.equal(logLine({ type: 'TURN_SKIPPED', seat: 1 }, (s) => names[s]), 'KOYA was skipped')
})

test('the end of a round, from each side', () => {
  assert.equal(resultLine({ endReason: 'played_out', youWon: true, winnerName: 'MOCHI' }), 'You won the round.')
  assert.equal(resultLine({ endReason: 'played_out', youWon: false, winnerName: 'KOYA' }), 'KOYA won the round.')
  assert.equal(resultLine({ endReason: 'last_standing', youWinner: true, winnerName: 'MOCHI' }), 'You were the last agent standing.')
  assert.equal(resultLine({ endReason: 'last_standing', youWinner: false, winnerName: 'TATA' }), 'TATA was the last agent standing.')
  assert.equal(resultLine({ endReason: 'abandoned' }), 'The round was abandoned.')
})

test('error codes without words never reach the player raw', () => {
  assert.equal(errorText('create_failed'), 'Something went wrong. Try again.')
  assert.equal(errorText(undefined), 'Something went wrong. Try again.')
  assert.equal(errorText('room_full'), 'That room is full (4 agents). You can still watch.')
  assert.equal(errorText('not_in_room'), 'You are not in a room any more.')
  // A sentence passes through (the network message).
  assert.equal(errorText('Network error — check your connection'), 'Network error — check your connection')
})
