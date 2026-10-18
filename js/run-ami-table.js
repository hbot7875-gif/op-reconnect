// RUN AMI — the match table.
//
// Built once per match and updated in place from each server view, so the
// hand's horizontal scroll, the selected card and running animations
// survive the 4s poll and every Realtime nudge. The hand is diffed by card
// id; everything else is small enough to repaint.
//
// Everything rendered comes from the view the server built for this seat
// (lib/run-ami-view.js). Opponents are names, avatars and card COUNTS — this
// file never has anyone else's cards to show.
//
// Deliberately absent: any public cue that a player is on one card. An
// opponent on one card looks exactly like an opponent on five, except for
// the number. The RUN AMI and CAUGHT! controls never change shape, glow or
// position with the game state.

import { el, esc } from './state.js'
import { badgeThumb } from './badge-art.js'
import { cardHtml, cardBackHtml, colorChipHtml, isWildKind, logLine, resultLine } from './run-ami-cards.js'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function avatarHtml(p) {
  if (p.avatar) return `<img class="ra-avatar" src="${esc(badgeThumb(p.avatar))}" alt="" loading="lazy" decoding="async" width="40" height="40">`
  return `<span class="ra-avatar is-initial" aria-hidden="true">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span>`
}

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`

// Why you are watching instead of playing (own seat only).
const OUT_TEXT = {
  disconnect: 'Out of this round · connection lost',
  timeouts: 'Out of this round · timed out',
  left: 'You left this round',
}

// How long the last play stays on screen before the room's result.
const FINALE_MS = 3200

export function createTable(handlers) {
  const root = el('section', 'ra-match')
  root.innerHTML = `
    <header class="ra-top">
      <button class="ra-exit" type="button">← Exit</button>
      <div class="ra-title"><b>RUN AMI</b><span>LAST CARD</span></div>
      <button class="ra-help-q" type="button" aria-label="How to play">?</button>
      <span class="ra-code" aria-label="Room code"></span>
    </header>
    <div class="ra-opps"></div>
    <div class="ra-table">
      <button class="ra-pile ra-draw" type="button" aria-label="Draw a card">${cardBackHtml()}<span class="ra-pile-count"></span></button>
      <div class="ra-pile ra-discard" aria-live="polite"></div>
      <div class="ra-state">
        <span class="ra-color"></span>
        <span class="ra-dir" aria-label="Direction of play"><i aria-hidden="true">↻</i></span>
      </div>
      <p class="ra-finale" role="status" aria-live="polite" hidden></p>
    </div>
    <ol class="ra-log" aria-label="Recent moves"></ol>
    <div class="ra-me">
      <div class="ra-turnbar"><span class="ra-turn-text"></span><span class="ra-turn-time"></span><i class="ra-turn-progress" aria-hidden="true"></i></div>
      <div class="ra-hand" role="list" aria-label="Your hand"></div>
      <div class="ra-controls">
        <button class="ra-btn ra-btn-draw" type="button">Draw</button>
        <button class="ra-btn ra-btn-pass" type="button">Pass</button>
        <button class="ra-btn ra-btn-play" type="button">Play</button>
        <span class="ra-controls-gap"></span>
        <button class="ra-btn ra-btn-runami" type="button">RUN AMI</button>
        <button class="ra-btn ra-btn-catch" type="button">CAUGHT!</button>
      </div>
      <div class="ra-foot"><span class="ra-bomb"></span><span class="ra-private" aria-live="polite"><span class="ra-called-slot"></span><span class="ra-note-slot"></span></span></div>
    </div>`

  const $ = (s) => root.querySelector(s)
  const hand = $('.ra-hand')
  const nodes = new Map() // card id → element
  let view = null
  let selected = null
  let lastSeq = null
  let offset = 0 // serverNow - Date.now()
  let deadlineFired = null
  let busy = false
  let ended = false // the finale is showing: nothing is playable any more

  $('.ra-exit').onclick = () => handlers.onExit()
  $('.ra-help-q').onclick = () => handlers.onHelp()
  $('.ra-draw').onclick = () => { if (view?.me.canDraw && !busy) handlers.onDraw() }
  $('.ra-btn-draw').onclick = () => { if (view?.me.canDraw && !busy) handlers.onDraw() }
  $('.ra-btn-pass').onclick = () => { if (view?.me.canPass && !busy) handlers.onPass() }
  $('.ra-btn-play').onclick = () => { if (selected && !busy) handlers.onPlay(selected, cardOf(selected)) }
  $('.ra-btn-runami').onclick = () => { if (!busy) handlers.onRunAmi(selected && playableNow(selected) ? selected : null, selected ? cardOf(selected) : null) }
  $('.ra-btn-catch').onclick = () => { if (!busy) handlers.onCatch() }

  const cardOf = (id) => view?.me.hand.find((c) => c.id === id) || null
  const playableNow = (id) => !!view?.me.playable.includes(id)
  const nameOf = (seat) => {
    const p = view?.players.find((x) => x.seat === seat)
    return p ? (p.isMe ? 'You' : p.name) : 'An agent'
  }

  function onCardTap(id) {
    if (busy || !playableNow(id)) {
      const node = nodes.get(id)
      if (node && !reducedMotion()) { node.classList.remove('is-nope'); void node.offsetWidth; node.classList.add('is-nope') }
      return
    }
    if (selected === id) { handlers.onPlay(id, cardOf(id)); return }
    selected = id
    paintSelection()
  }

  function paintSelection() {
    for (const [id, node] of nodes) node.classList.toggle('is-selected', id === selected)
    $('.ra-btn-play').disabled = !selected || busy
  }

  function rectOf(node) { return node?.getBoundingClientRect() || null }

  function fly(fromRect, toRect, html, { duration = 260 } = {}) {
    if (!fromRect || !toRect || reducedMotion()) return
    const ghost = el('div', 'ra-flight', html)
    Object.assign(ghost.style, { left: `${fromRect.left}px`, top: `${fromRect.top}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` })
    document.body.appendChild(ghost)
    const dx = toRect.left - fromRect.left
    const dy = toRect.top - fromRect.top
    const scale = toRect.width / Math.max(1, fromRect.width)
    ghost.animate(
      [{ transform: 'translate(0, 0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.9 }],
      { duration, easing: 'cubic-bezier(.2,.7,.2,1)' },
    ).onfinish = () => ghost.remove()
  }

  function flash(node, cls, ms = 700) {
    if (!node) return
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls)
    setTimeout(() => node.classList.remove(cls), ms)
  }

  function paintOpponents() {
    const box = $('.ra-opps')
    const me = view.me.seat
    const n = view.players.length
    const order = view.players.filter((p) => !p.isMe)
      .sort((a, b) => ((a.seat - me + n) % n) - ((b.seat - me + n) % n))
    box.dataset.count = String(order.length)
    box.innerHTML = order.map((p) => `
      <div class="ra-opp${p.isTurn ? ' is-turn' : ''}${p.out ? ' is-out' : ''}${!p.connected && !p.out ? ' is-away' : ''}" data-seat="${p.seat}">
        ${avatarHtml(p)}
        <div class="ra-opp-text">
          <b>${esc(p.name)}</b>
          <span>${p.out ? 'Out of the round' : plural(p.cards)}</span>
          ${!p.connected && !p.out ? '<em class="ra-opp-away">Reconnecting…</em>' : ''}
        </div>
        <span class="ra-opp-time" aria-hidden="true"></span>
      </div>`).join('')
  }

  function paintHand() {
    const ids = view.me.hand.map((c) => c.id)
    for (const [id, node] of nodes) if (!ids.includes(id)) { node.remove(); nodes.delete(id) }
    view.me.hand.forEach((card, i) => {
      let node = nodes.get(card.id)
      if (!node) {
        node = el('button', 'ra-hand-card', cardHtml(card))
        node.type = 'button'
        node.setAttribute('role', 'listitem')
        node.onclick = () => onCardTap(card.id)
        nodes.set(card.id, node)
      }
      if (hand.children[i] !== node) hand.insertBefore(node, hand.children[i] || null)
      const playable = view.me.playable.includes(card.id)
      node.classList.toggle('is-playable', playable)
      node.classList.toggle('is-dim', !playable && isMyTurn())
      node.setAttribute('aria-disabled', playable ? 'false' : 'true')
    })
    if (selected && !view.me.playable.includes(selected)) selected = null
    hand.dataset.count = String(ids.length)
    paintSelection()
  }

  const isMyTurn = () => view.status === 'active' && view.table.turn === view.me.seat && !view.me.out

  function paintTable() {
    const t = view.table
    $('.ra-code').textContent = view.room.code
    $('.ra-discard').innerHTML = cardHtml(t.top, 'is-top')
    $('.ra-pile-count').textContent = String(t.drawCount)
    $('.ra-color').innerHTML = colorChipHtml(t.color)
    const dir = $('.ra-dir')
    dir.classList.toggle('is-ccw', t.dir === -1)
    dir.setAttribute('aria-label', t.dir === 1 ? 'Clockwise' : 'Counter-clockwise')
    $('.ra-draw').disabled = !view.me.canDraw || busy
  }

  function paintMe() {
    const mine = isMyTurn()
    root.classList.toggle('is-my-turn', mine)
    root.classList.toggle('is-out', view.me.out)
    $('.ra-turn-text').textContent = view.me.out
      ? OUT_TEXT[view.me.outReason] || 'You are out of this round'
      : mine ? (view.me.canPass ? 'YOUR TURN · play the drawn card or pass' : 'YOUR TURN') : `${nameOf(view.table.turn)}'s turn`
    $('.ra-btn-draw').disabled = !view.me.canDraw || busy
    $('.ra-btn-pass').disabled = !view.me.canPass || busy
    $('.ra-btn-runami').disabled = view.me.out || busy
    $('.ra-btn-catch').disabled = view.me.out || busy
    $('.ra-bomb').textContent = handlers.bombLabel?.() || ''
    $('.ra-called-slot').innerHTML = view.me.runAmiCalled ? '<span class="ra-called">RUN AMI ✓</span>' : ''
  }

  function paintLog() {
    const lines = view.log.map((e) => logLine(e, nameOf, view.me.seat)).filter(Boolean).slice(-3)
    $('.ra-log').innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join('')
  }

  function tickTimer() {
    if (ended || !view || view.status !== 'active' || view.table.deadline == null) return
    const left = Math.max(0, view.table.deadline - (Date.now() + offset))
    const secs = Math.ceil(left / 1000)
    const total = (Number(view.table.turnSeconds) || 30) * 1000
    $('.ra-turn-time').textContent = isMyTurn() ? `${secs}s` : ''
    $('.ra-turn-progress').style.setProperty('--left', String(Math.max(0, Math.min(1, left / total))))
    root.querySelectorAll('.ra-opp-time').forEach((n) => { n.textContent = '' })
    const tile = root.querySelector(`.ra-opp[data-seat="${view.table.turn}"] .ra-opp-time`)
    if (tile) tile.textContent = `${secs}s`
    if (left <= 0 && deadlineFired !== view.table.deadline) {
      deadlineFired = view.table.deadline
      // The server settles an expired turn on the next request. Stagger it
      // so four phones don't all ask in the same instant.
      setTimeout(() => handlers.onDeadline(), 400 + Math.random() * 900)
    }
  }
  const timer = setInterval(tickTimer, 250)

  function animate(entries, before) {
    for (const e of entries) {
      const oppTile = (seat) => root.querySelector(`.ra-opp[data-seat="${seat}"]`)
      const drawRect = rectOf($('.ra-draw .ra-card'))
      if (e.type === 'CARD_PLAYED') {
        const to = rectOf($('.ra-discard .ra-card'))
        const from = e.seat === view.me.seat ? before.removed : rectOf(oppTile(e.seat))
        fly(from, to, cardHtml(e.card))
        if (!reducedMotion()) flash($('.ra-discard'), 'is-landed', 360)
      } else if (e.type === 'CARD_DRAWN' || e.type === 'PLAYER_CAUGHT') {
        const seat = e.type === 'PLAYER_CAUGHT' ? e.target : e.seat
        if (seat === view.me.seat) {
          for (const id of before.added) fly(drawRect, rectOf(nodes.get(id)), cardBackHtml())
        } else {
          fly(drawRect, rectOf(oppTile(seat)), cardBackHtml())
        }
        if (e.type === 'PLAYER_CAUGHT') flash(seat === view.me.seat ? $('.ra-me') : oppTile(seat), 'is-caught', 900)
      } else if (e.type === 'TURN_SKIPPED') {
        flash(e.seat === view.me.seat ? $('.ra-turnbar') : oppTile(e.seat), 'is-skipped', 800)
      } else if (e.type === 'DIRECTION_REVERSED') {
        flash($('.ra-dir'), 'is-flipping', 600)
      }
    }
  }

  return {
    el: root,
    setBusy(on) {
      busy = on || ended
      root.classList.toggle('is-busy', on)
      if (view) { paintMe(); paintTable(); paintSelection() }
    },
    clearSelection() { selected = null; if (view) paintSelection() },
    flashPrivate(text) {
      const node = el('span', 'ra-private-note', esc(text))
      const slot = $('.ra-note-slot')
      slot.replaceChildren(node)
      setTimeout(() => node.remove(), 1600)
    },
    update(next) {
      offset = (next.serverNow || Date.now()) - Date.now()
      const fresh = lastSeq === null
      const newEntries = fresh ? [] : next.log.filter((e) => e.seq > lastSeq)
      lastSeq = next.log.reduce((m, e) => Math.max(m, e.seq), lastSeq ?? 0)

      // Rects to animate from must be read before the hand changes.
      const prevIds = new Set(nodes.keys())
      const nextIds = new Set(next.me.hand.map((c) => c.id))
      const removedId = [...prevIds].find((id) => !nextIds.has(id))
      const before = { removed: removedId ? rectOf(nodes.get(removedId)) : null }

      view = next
      paintOpponents()
      paintTable()
      paintHand()
      paintMe()
      paintLog()
      tickTimer()
      before.added = [...nextIds].filter((id) => !prevIds.has(id))
      if (!fresh) animate(newEntries, before)
    },
    /** The round just ended (r = the lobby's lastResult). Land the final
     *  card on the pile from whoever played it and say who won, so nobody
     *  jumps straight from mid-round to the lobby. Returns how long to hold
     *  this before showing the room. */
    finale(r) {
      ended = true
      busy = true
      selected = null
      root.classList.add('is-finale', 'is-busy')
      root.classList.remove('is-my-turn')
      root.querySelectorAll('.ra-btn, .ra-draw').forEach((b) => { b.disabled = true })
      $('.ra-turn-time').textContent = ''
      $('.ra-turn-text').textContent = 'Round over'
      const mySeat = view?.me.seat
      if (r?.endReason === 'played_out' && r.top) {
        const tile = root.querySelector(`.ra-opp[data-seat="${r.winnerSeat}"]`)
        let from = null
        if (r.winnerSeat === mySeat) {
          // Your own last card leaves your hand.
          const last = [...nodes.values()].pop()
          from = rectOf(last)
          for (const node of nodes.values()) node.remove()
          nodes.clear()
        } else if (tile) {
          from = rectOf(tile)
          tile.classList.add('is-winner')
          const count = tile.querySelector('.ra-opp-text span')
          if (count) count.textContent = plural(0)
        }
        $('.ra-discard').innerHTML = cardHtml(r.top, 'is-top')
        fly(from, rectOf($('.ra-discard .ra-card')), cardHtml(r.top), { duration: 420 })
        if (!reducedMotion()) flash($('.ra-discard'), 'is-landed', 420)
      } else if (r?.winnerSeat !== null && r?.winnerSeat !== undefined) {
        root.querySelector(`.ra-opp[data-seat="${r.winnerSeat}"]`)?.classList.add('is-winner')
      }
      const banner = $('.ra-finale')
      banner.textContent = resultLine(r)
      banner.classList.toggle('is-you', !!r?.youWinner)
      banner.hidden = false
      return FINALE_MS
    },
    selectedCard: () => (selected ? cardOf(selected) : null),
    destroy() { clearInterval(timer); root.remove() },
  }
}

export { isWildKind }
