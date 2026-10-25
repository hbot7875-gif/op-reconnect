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
  [{ c: 'g', k: 'skip' }, 'Skip', 'The next agent misses a turn.'],
  [{ c: 'b', k: 'rev' }, 'Reverse', `Turns go the other way. With ${MIN_PLAYERS} agents it works like Skip.`],
  [{ c: 'r', k: 'd2' }, 'Pick Two', 'The next agent picks 2 cards and misses a turn.'],
  [{ c: null, k: 'wild' }, 'Wild', 'Goes on anything. You choose the next colour.'],
  [{ c: null, k: 'wd4' }, 'Wild Pick Four', 'Goes on anything. You choose the colour, and the next agent picks 4 cards and misses a turn.'],
]

/** The sheet's content, separate from showing it (tests read this).
 *  Easy first: four steps, the special cards and the two shouts are all a
 *  new player needs; the fine print folds away under "More rules". */
export function howToPlayHtml() {
  const actions = ACTIONS.map(([card, name, text]) => `
    <li class="ra-help-action">${cardHtml(card)}<span><b>${esc(name)}</b>${esc(text)}</span></li>`).join('')
  return `
    <h3 tabindex="-1" data-autofocus="true">How to play War of Cards</h3>
    <p class="ra-help-lede">Be the first to get rid of every card in your hand.</p>

    <h4>The basics</h4>
    <ol class="ra-help-steps">
      <li><b>Match the top card.</b> Play one card with the same <b>colour</b>, <b>number</b> or <b>action</b> symbol. Wilds go on anything.</li>
      <li><b>Nothing to play?</b> Tap <b>Pick</b> to take a card from the pile. If it fits, play it. If you'd rather keep it, tap <b>Pass</b>.</li>
      <li><b>Down to your last card?</b> On your second-to-last card, select it and tap <b>MIC CHECK!</b> It plays the card and calls in one go.</li>
      <li><b>No cards left = you win!</b></li>
    </ol>
    <p class="ra-help-note">Everyone starts with ${HAND_SIZE} cards, and each turn has ${cfg.turnSeconds} seconds.</p>

    <h4>Special cards</h4>
    <ul class="ra-help-actions">${actions}</ul>
    <p class="ra-help-note">No stacking: you can't answer a Pick Two with another one.</p>

    <h4>The two shouts</h4>
    <div class="ra-help-shouts">
      <p class="ra-help-shout"><b>MIC CHECK!</b>Tap it on your second-to-last card, so everyone knows you're almost out.</p>
      <p class="ra-help-shout"><b>RUN AMI</b>Someone is on 1 card and forgot MIC CHECK!? Tap RUN AMI and they pick ${cfg.catchPenalty} cards.</p>
    </div>

    <details class="ra-help-more">
      <summary>More rules</summary>

      <h4>Rooms</h4>
      <ul>
        <li><b>Create room</b> and share the 6-character code, or type a friend's code and tap <b>Join</b>.</li>
        <li>${MIN_PLAYERS}–${MAX_PLAYERS} agents per room. The host taps <b>Start game</b>.</li>
        <li>You need an active ARMY Bomb to enter. Playing costs no charge.</li>
      </ul>

      <h4>Picking</h4>
      <ul>
        <li>If the card you picked doesn't fit, your turn passes by itself.</li>
        <li>After picking, only the card you picked can be played.</li>
      </ul>

      <h4>Calling and catching</h4>
      <ul>
        <li>Forgot to select first? Play your second-to-last card, then tap <b>MIC CHECK!</b> within ${sec(cfg.runAmiGraceMs)}.</li>
        <li>An agent who drops to one card without calling gets a ${Math.round(cfg.runAmiGraceMs / 1000)}-second grace period before anyone can tap <b>RUN AMI</b>.</li>
        <li>Be quick: the chance ends as soon as anyone plays, picks or passes.</li>
        <li>Tapping either one when it doesn't apply does nothing, and nobody else sees it.</li>
      </ul>

      <h4>Timer</h4>
      <ul>
        <li>If your ${cfg.turnSeconds} seconds run out, you pick a card automatically and play moves on.</li>
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
      </ul>
    </details>`
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
