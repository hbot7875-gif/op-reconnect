// RUN AMI — How to Play.
//
// One sheet, opened from the entry screen, the lobby and the match header.
// It describes the rules as run-ami-rules.js / run-ami-actions.js implement
// them, and takes its numbers (hand size, timer, grace, penalty, timeouts,
// disconnect grace) from the same config defaults the server starts every
// match with, so the words can't drift from the game.

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { cardHtml } from './run-ami-cards.js'
import { DEFAULT_CONFIG, HAND_SIZE, MIN_PLAYERS, MAX_PLAYERS } from '../supabase/functions/op-reconnect/lib/run-ami-deck.js'

const cfg = DEFAULT_CONFIG
const sec = (ms) => `${Math.round(ms / 1000)} second${Math.round(ms / 1000) === 1 ? '' : 's'}`

const ACTIONS = [
  [{ c: 'g', k: 'skip' }, 'Skip', 'The next agent misses their turn.'],
  [{ c: 'b', k: 'rev' }, 'Reverse', `Play changes direction. With ${MIN_PLAYERS} agents it works like Skip.`],
  [{ c: 'r', k: 'd2' }, 'Pick Two', 'The next agent picks 2 cards and misses their turn.'],
  [{ c: null, k: 'wild' }, 'Wild', 'Play it on anything, then choose the next colour.'],
  [{ c: null, k: 'wd4' }, 'Wild Pick Four', 'Play it on anything and choose the colour. The next agent picks 4 cards and misses their turn.'],
]

/** The sheet's content, separate from showing it (tests read this). */
export function howToPlayHtml() {
  const actions = ACTIONS.map(([card, name, text]) => `
    <li class="ra-help-action">${cardHtml(card)}<span><b>${esc(name)}</b>${esc(text)}</span></li>`).join('')
  return `
    <h3>How to play War of Cards</h3>
    <p class="ra-help-lede">Be the first agent to play every card in your hand.</p>

    <h4>Get a room</h4>
    <ul>
      <li><b>Create room</b> and share the 6-character code, or type a friend's code and tap <b>Join</b>.</li>
      <li>${MIN_PLAYERS}–${MAX_PLAYERS} agents per room. The host taps <b>Start game</b>.</li>
      <li>You need an active ARMY Bomb to enter. Playing costs no charge.</li>
    </ul>

    <h4>Your turn</h4>
    <ul>
      <li>Everyone starts with ${HAND_SIZE} cards.</li>
      <li>Play one card that matches the top card's <b>colour</b>, <b>number</b> or <b>action</b>. Wilds go on anything.</li>
      <li>Can't play, or don't want to? Tap <b>Pick</b> to take a card from the pile. If the card you picked fits, you can play it straight away. If it doesn't, your turn passes by itself.</li>
      <li>After picking you can also tap <b>Pass</b> and keep the card.</li>
    </ul>

    <h4>Action cards</h4>
    <ul class="ra-help-actions">${actions}</ul>
    <p class="ra-help-note">No stacking: a Pick Two can't be passed on with another one.</p>

    <h4>MIC CHECK!</h4>
    <ul>
      <li>When you play your second-to-last card, call <b>MIC CHECK!</b></li>
      <li>Easiest: select that card and tap <b>MIC CHECK!</b> It plays the card and calls in one go.</li>
      <li>Or play the card, then tap <b>MIC CHECK!</b> within ${sec(cfg.runAmiGraceMs)}.</li>
    </ul>

    <h4>RUN AMI!</h4>
    <ul>
      <li>If an agent drops to one card without calling, they get a ${Math.round(cfg.runAmiGraceMs / 1000)}-second grace period.</li>
      <li>After that, anyone can tap <b>RUN AMI</b>. The forgetful agent picks ${cfg.catchPenalty} cards.</li>
      <li>Be quick: the chance ends as soon as anyone plays, picks or passes.</li>
      <li>Tapping when there's nobody to catch does nothing, and nobody sees it.</li>
    </ul>

    <h4>Timer</h4>
    <ul>
      <li>Each turn has ${cfg.turnSeconds} seconds. If time runs out, you pick a card automatically and play moves on.</li>
      <li>Run out of time ${cfg.maxTimeouts} turns in a row and you're out of the round.</li>
    </ul>

    <h4>Connection</h4>
    <ul>
      <li>Lost signal? Your seat waits ${cfg.disconnectGraceSeconds} seconds. Come back in time and carry on.</li>
      <li>Gone longer, and you're out of the round. Your cards go back into the pile.</li>
      <li>Leaving during a round also puts you out of it.</li>
    </ul>

    <h4>Winning</h4>
    <ul>
      <li>Play your last card and you win the round.</li>
      <li>If everyone else drops out or leaves, the round ends and you're the last agent standing.</li>
    </ul>`
}

export function openHowToPlay() {
  const sheet = el('div', 'sheet ra-sheet ra-help', howToPlayHtml())
  const close = el('button', 'btn btn-primary', 'Got it')
  close.type = 'button'
  close.onclick = hideOverlay
  sheet.appendChild(close)
  showOverlay(sheet)
}

/** The small "How to play" button the entry and lobby screens use. */
export function howToPlayButton() {
  const b = el('button', 'ra-help-btn', 'How to play')
  b.type = 'button'
  b.onclick = openHowToPlay
  return b
}
