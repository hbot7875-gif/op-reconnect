// RUN AMI — the privacy boundary.
//
// The only code that turns the server's full match state (every hand, the
// draw pile) into a response. Each function builds its output field by
// field from an explicit list; nothing is spread or passed through, so a
// field added to the state later can't leak by accident.
//
// What a seat receives:
//   me       — its own hand, which of those cards are playable, and its own
//              private RUN AMI status
//   players  — for everyone: seat, codename, avatar, card COUNT, turn,
//              connection state. Never agent numbers, never card identities.
//   log      — public event fields only (event.pub, filtered again here);
//              event.priv (drawn card ids) never leaves the server.

import { playableIds, topCard } from './run-ami-rules.js'

const LOG_FIELDS = ['color', 'count', 'forced', 'auto', 'dir', 'target', 'penalty', 'reason', 'endReason']

function card(c) {
  return { c: c.c ?? null, k: String(c.k) }
}

/** One public log line. `event` is a stored row: { seq, type, seat, pub }. */
export function logEntry(event) {
  const out = { seq: Number(event.seq) || 0, type: String(event.type), seat: event.seat ?? null }
  const pub = event.pub || {}
  if (pub.card) out.card = card(pub.card)
  for (const key of LOG_FIELDS) if (pub[key] !== undefined) out[key] = pub[key]
  return out
}

/** players: [{ seat, name, avatar, connected, isHost }] — already stripped
 *  of agent numbers by the caller (run-ami-service.js's publicPlayers). */
function playerRow(p, state, mySeat) {
  const s = state ? state.seats[p.seat] : null
  return {
    seat: p.seat,
    name: String(p.name || 'AGENT'),
    avatar: p.avatar || null,
    connected: !!p.connected,
    isHost: !!p.isHost,
    isMe: p.seat === mySeat,
    cards: s ? s.hand.length : null,
    out: s ? !!s.out : false,
    isTurn: !!(s && state.status === 'active' && state.turn === p.seat),
  }
}

/** Who is watching the room: a count and codenames only. */
function watcherList(watchers) {
  const names = (watchers?.names || []).slice(0, 12).map((n) => String(n || 'AGENT'))
  return { count: Number(watchers?.count) || 0, names }
}

function tableOf(state) {
  return {
    top: card(topCard(state)),
    color: state.color,
    dir: state.dir,
    turn: state.turn,
    turnNo: state.turnNo,
    deadline: state.deadline,
    turnSeconds: state.cfg.turnSeconds,
    drawCount: state.draw.length,
    drewThisTurn: state.drewThisTurn,
  }
}

export function viewForMatch({ state, seat, players, version, now, log = [], room, watchers = null }) {
  const mine = state.seats[seat]
  const isTurn = state.status === 'active' && state.turn === seat && !mine.out
  return {
    phase: 'match',
    version,
    serverNow: now,
    room: { code: room.code, isHost: !!room.isHost, topic: room.topic || null, version: room.version },
    status: state.status,
    endReason: state.endReason,
    winnerSeat: state.winner,
    table: tableOf(state),
    watchers: watcherList(watchers),
    players: players.map((p) => playerRow(p, state, seat)),
    me: {
      seat,
      out: !!mine.out,
      // Own seat only, and already public in the log: 'left' | 'timeouts' | 'disconnect'.
      outReason: mine.out ? mine.outReason || null : null,
      hand: mine.hand.map((c) => ({ id: String(c.id), ...card(c) })),
      playable: playableIds(state, seat),
      canDraw: isTurn && !state.drewThisTurn,
      canPass: isTurn && state.drewThisTurn,
      drawnId: isTurn && state.drewThisTurn ? state.drawnId : null,
      runAmiCalled: mine.hand.length === 1 && !!mine.called,
    },
    log: log.map(logEntry),
  }
}

/** A watcher at a live table: everything public, nobody's cards. `me`
 *  keeps the seat view's shape (empty hand, nothing playable) so the table
 *  renders without a seat of its own, and says `watching`. */
export function viewForSpectator({ state, players, version, now, log = [], room, watchers = null }) {
  return {
    phase: 'match',
    version,
    serverNow: now,
    room: { code: room.code, isHost: false, topic: room.topic || null, version: room.version },
    status: state.status,
    endReason: state.endReason,
    winnerSeat: state.winner,
    table: tableOf(state),
    watchers: watcherList(watchers),
    players: players.map((p) => playerRow(p, state, null)),
    me: {
      seat: null,
      watching: true,
      out: false,
      outReason: null,
      hand: [],
      playable: [],
      canDraw: false,
      canPass: false,
      drawnId: null,
      runAmiCalled: false,
    },
    log: log.map(logEntry),
  }
}

export function viewForLobby({ room, players, mySeat, bombActive, lastResult = null, minPlayers = 2, watching = false, watchers = null }) {
  const seated = players.length
  return {
    phase: 'lobby',
    version: null,
    room: {
      code: room.code,
      isHost: !!room.isHost,
      topic: room.topic || null,
      version: room.version,
      canStart: !!room.isHost && seated >= minPlayers,
      // A watcher can sit in while a seat is free (the room is waiting here).
      canSeat: !!watching && seated < 4,
      minPlayers,
      maxPlayers: 4,
    },
    watchers: watcherList(watchers),
    players: players.map((p) => playerRow(p, null, mySeat)),
    me: { seat: mySeat, bombActive: !!bombActive, watching: !!watching },
    lastResult,
  }
}

/** Not in a room: whether this agent may enter, plus — only for an agent
 *  dropped from a round that has since ended — how that round finished. */
export function viewForEntry({ bombActive, lastResult = null }) {
  const view = { phase: 'entry', me: { bombActive: !!bombActive } }
  if (lastResult) view.lastResult = lastResult
  return view
}
