// RUN AMI — card faces and the words for things.
//
// Era Poster cards (artwork in run-ami-art.js): a header band in one of
// four colours carries the value and a shape that repeats the colour for
// anyone who can't rely on hue (● ▲ ■ ◆); below it, artwork after one BTS
// album era. Wilds carry all four colours. Nothing here decides anything;
// the server sends card faces as { c, k } and this only draws them.

import { esc } from './state.js'
import { cardFaceSvg, cardBackSvg } from './run-ami-art.js'

export const COLORS = {
  r: { name: 'Ember', shape: '●' },
  y: { name: 'Solar', shape: '▲' },
  g: { name: 'Jade', shape: '■' },
  b: { name: 'Cobalt', shape: '◆' },
}
export const COLOR_ORDER = ['r', 'y', 'g', 'b']

const WORD = { skip: 'Skip', rev: 'Reverse', d2: 'Draw Two', wild: 'Wild', wd4: 'Wild Draw Four' }

export const isWildKind = (k) => k === 'wild' || k === 'wd4'

export function describeCard(card) {
  if (!card) return 'a card'
  if (isWildKind(card.k)) return WORD[card.k]
  const color = COLORS[card.c]?.name || ''
  return `${color} ${WORD[card.k] || card.k}`.trim()
}

/** One card face. `extra` adds classes (is-playable, is-selected, …). */
export function cardHtml(card, extra = '') {
  const wild = isWildKind(card.k)
  const color = wild ? 'w' : card.c
  const action = /^[0-9]$/.test(card.k) ? '' : ' is-action'
  return `<span class="ra-card is-${color}${action}${extra ? ` ${extra}` : ''}" data-k="${esc(card.k)}">${cardFaceSvg(color, String(card.k))}<span class="ra-sr">${esc(describeCard(card))}</span></span>`
}

export function cardBackHtml(extra = '') {
  return `<span class="ra-card is-back${extra ? ` ${extra}` : ''}" aria-hidden="true">${cardBackSvg()}</span>`
}

export function colorChipHtml(c) {
  const meta = COLORS[c]
  if (!meta) return ''
  return `<span class="ra-color-chip is-${c}"><i aria-hidden="true">${meta.shape}</i>${esc(meta.name)}</span>`
}

/** Plain-language log line. Unknown or seatless events return null and are
 *  simply not shown. `nameOf(seat)` returns a codename (or 'You');
 *  `mySeat` picks the verb form, so the reader's own lines read "You were
 *  skipped", not "You was skipped". */
export function logLine(e, nameOf, mySeat = null) {
  const who = e.seat === null || e.seat === undefined ? null : nameOf(e.seat)
  const you = who !== null && e.seat === mySeat
  const verb = (one, mine) => (you ? mine : one)
  switch (e.type) {
    case 'MATCH_STARTED': return 'Round started'
    case 'CARD_PLAYED': {
      if (!who || !e.card) return null
      const wild = isWildKind(e.card.k) && COLORS[e.color] ? ` → ${COLORS[e.color].name}` : ''
      return `${who} played ${describeCard(e.card)}${wild}`
    }
    case 'CARD_DRAWN':
      if (!who) return null
      if (e.auto) return `${who} ran out of time and drew`
      if (e.forced) return `${who} drew ${e.count}`
      return `${who} drew a card`
    case 'TURN_PASSED': return who ? `${who} passed` : null
    case 'TURN_SKIPPED': return who ? `${who} ${verb('was', 'were')} skipped` : null
    case 'DIRECTION_REVERSED': return 'Direction reversed'
    case 'RUN_AMI_CALLED': return who ? `${who} called RUN AMI.` : null
    case 'PLAYER_CAUGHT': {
      if (!who) return null
      const target = e.target === mySeat ? 'you' : nameOf(e.target)
      return `${who} caught ${target} · +${e.penalty}`
    }
    case 'TURN_TIMEOUT': return null // the auto-draw line already says it
    case 'PLAYER_FORFEITED':
      if (!who) return null
      if (e.reason === 'left') return `${who} left the round`
      if (e.reason === 'timeouts') return `${who} timed out of the round`
      return `${who} lost connection`
    case 'MATCH_WON': return who ? `${who} ${verb('wins', 'win')} the round` : null
    case 'MATCH_ENDED':
      if (e.endReason === 'last_standing' && who) return `${who} ${verb('is', 'are')} the last agent standing`
      return 'Round ended'
    default: return null
  }
}

export const ERRORS = {
  bomb_dark: 'Your ARMY Bomb is dark. Recharge it to enter RUN AMI.',
  room_not_found: 'No open room with that code.',
  room_full: 'That room is full (4 agents).',
  room_in_match: 'That room is already playing. Try again after the round.',
  already_seated: 'You are already in a room.',
  rate_limited: 'Too many tries. Wait a few minutes.',
  need_players: 'You need at least 2 agents to start.',
  not_host: 'Only the host can start.',
  not_your_turn: 'Not your turn.',
  illegal_card: "That card can't be played now.",
  drawn_card_only: 'After drawing, only the drawn card can be played.',
  must_draw_first: 'Draw a card first.',
  already_drew: 'You already drew this turn.',
  color_required: 'Choose a colour.',
  card_not_in_hand: "That card isn't in your hand.",
  match_over: 'This round is over.',
  server_error: 'Something went wrong. Try again.',
  not_in_room: 'You are not in a room any more.',
  no_active_match: 'This round is over.',
  not_in_match: 'You are not playing in this round.',
  already_started: 'The game has already started.',
}

/** The words for an error code. Codes without words (internal ones like
 *  create_failed) never reach the player as raw identifiers; sentences that
 *  already read as text (the network message) pass through. */
export function errorText(code) {
  if (ERRORS[code]) return ERRORS[code]
  if (typeof code === 'string' && /\s/.test(code)) return code
  return ERRORS.server_error
}

/** One line for the end of a round, from the reader's side. */
export function resultLine(r) {
  if (!r) return 'Round ended.'
  if (r.endReason === 'played_out') return r.youWon ? 'You won the round.' : `${r.winnerName || 'An agent'} won the round.`
  if (r.endReason === 'last_standing') return r.youWinner ? 'You were the last agent standing.' : `${r.winnerName || 'An agent'} was the last agent standing.`
  if (r.endReason === 'abandoned') return 'The round was abandoned.'
  return 'Round ended.'
}
