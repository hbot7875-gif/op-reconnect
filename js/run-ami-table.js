// RUN AMI — the match table.
//
// Built once per match and updated in place from each server view, so the
// hand's horizontal scroll, the selected card and running animations
// survive the 4s poll and every Realtime nudge. The hand is diffed by card
// id; everything else is small enough to repaint.
//
// Everything rendered comes from the view the server built for this seat
// (lib/run-ami-view.js). Opponents are names, avatars and card COUNTS — this
// file never has anyone else's cards to show. The small face-down fans by
// each seat are drawn from the count alone.
//
// Layout: everyone sits around one oval table. The reader's own seat is at
// the bottom and the rest follow in seat order clockwise (left, top, right),
// so play moves round the table the way the direction arrow points. A
// watcher has no seat: the lowest seat takes the bottom.
//
// Watching (view.me.watching, lib/run-ami-view.js viewForSpectator): the same
// table with no seat of its own — no hand, no controls, a one-line
// "watching" strip, and the turn follows whoever is up.
//
// Deliberately absent: any public cue that a player is on one card. An
// opponent on one card looks exactly like an opponent on five, except for
// the number (and a fan of one). The MIC CHECK! and RUN AMI controls never
// change shape, glow or position with the game state. Only a MIC CHECK! that
// was actually called — already public in the log — gets its own moment.

import { el, esc } from './state.js'
import { badgeThumb } from './badge-art.js'
import { COLORS, cardHtml, cardBackHtml, colorChipHtml, isWildKind, logLine, resultLine } from './run-ami-cards.js'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function avatarHtml(p) {
  if (p.avatar) return `<img class="ra-avatar" src="${esc(badgeThumb(p.avatar))}" data-badge-full="${esc(p.avatar)}" alt="" loading="lazy" decoding="async" width="40" height="40">`
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

// Seats round the table, starting from the bottom and going clockwise.
const POSITIONS = { 1: ['bottom'], 2: ['bottom', 'top'], 3: ['bottom', 'left', 'right'], 4: ['bottom', 'left', 'top', 'right'] }

// The most face-down cards a seat's fan shows; the number says the rest.
const FAN_MAX = 6

// Short marks for the activity feed's card chips.
const MARK = { skip: '⊘', rev: '⇄', d2: '+2', wild: 'W', wd4: '+4' }
const markOf = (k) => MARK[k] || esc(String(k))

const sameCard = (a, b) => !!a && !!b && a.k === b.k && (a.c ?? null) === (b.c ?? null)
// A small, steady tilt per played card, so the pile looks thrown, not stacked.
const tilt = (seq, spread) => ((Number(seq) * 47) % (spread * 2 + 1)) - spread

export function createTable(handlers) {
  const root = el('section', 'ra-match')
  root.innerHTML = `
    <header class="ra-top">
      <button class="ra-exit" type="button">← Exit</button>
      <div class="ra-title"><b>WAR OF CARDS</b></div>
      <button class="ra-help-q" type="button" aria-label="How to play">?</button>
      <span class="ra-code" aria-label="Room code"></span>
    </header>
    <div class="ra-arena">
      <div class="ra-opps"></div>
      <div class="ra-table">
        <div class="ra-piles">
          <button class="ra-pile ra-draw" type="button" aria-label="Pick a card from the pile">${cardBackHtml()}<span class="ra-pile-count"></span></button>
          <div class="ra-pile ra-discard" aria-live="polite"></div>
        </div>
        <div class="ra-state">
          <span class="ra-color"></span>
          <span class="ra-dir" aria-label="Direction of play"><i aria-hidden="true">↻</i></span>
        </div>
        <p class="ra-finale" role="status" aria-live="polite" hidden></p>
      </div>
    </div>
    <section class="ra-feed" aria-label="Activity">
      <div class="ra-feed-head"><span>Activity</span><button class="ra-feed-more" type="button" aria-expanded="false" hidden>History</button></div>
      <ol class="ra-log" aria-label="Recent moves"></ol>
    </section>
    <div class="ra-me">
      <div class="ra-turnbar"><i class="ra-turn-dot" aria-hidden="true"></i><span class="ra-turn-text"></span><span class="ra-turn-time"></span><i class="ra-turn-progress" aria-hidden="true"></i></div>
      <div class="ra-hand" role="list" aria-label="Your hand"></div>
      <p class="ra-watch-strip" hidden><b>Watching</b><span class="ra-watch-text"></span></p>
      <div class="ra-controls">
        <button class="ra-btn ra-btn-draw" type="button">Pick</button>
        <button class="ra-btn ra-btn-pass" type="button">Pass</button>
        <button class="ra-btn ra-btn-play" type="button">Play</button>
        <span class="ra-controls-gap"></span>
        <button class="ra-btn ra-btn-runami" type="button" aria-describedby="ra-hint-mic">MIC CHECK!</button>
        <button class="ra-btn ra-btn-catch" type="button" aria-describedby="ra-hint-run">RUN AMI</button>
        <span class="ra-call-hint" id="ra-hint-mic">As you play your second-to-last card</span>
        <span class="ra-call-hint" id="ra-hint-run">On anyone left on 1 card who didn't call</span>
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
  let pileKey = null
  let feedOpen = false
  let feedSeen = null // newest log seq already shown in the feed

  $('.ra-exit').onclick = () => handlers.onExit()
  $('.ra-help-q').onclick = () => handlers.onHelp()
  $('.ra-draw').onclick = () => { if (view?.me.canDraw && !busy) handlers.onDraw() }
  $('.ra-btn-draw').onclick = () => { if (view?.me.canDraw && !busy) handlers.onDraw() }
  $('.ra-btn-pass').onclick = () => { if (view?.me.canPass && !busy) handlers.onPass() }
  $('.ra-btn-play').onclick = () => { if (selected && !busy) handlers.onPlay(selected, cardOf(selected)) }
  // MIC CHECK! plays the selected card only when it's your second-to-last:
  // the one moment a call means anything. Otherwise it's a plain call, so a
  // card picked up just to look at is never played by accident. Either way
  // the server sees an ordinary play or call; nobody else can tell.
  $('.ra-btn-runami').onclick = () => {
    if (busy) return
    const playIt = !!selected && playableNow(selected) && view?.me.hand.length === 2
    handlers.onRunAmi(playIt ? selected : null, playIt ? cardOf(selected) : null)
  }
  $('.ra-btn-catch').onclick = () => { if (!busy) handlers.onCatch() }
  $('.ra-feed-more').onclick = () => {
    feedOpen = !feedOpen
    if (view) paintLog()
  }

  const cardOf = (id) => view?.me.hand.find((c) => c.id === id) || null
  const playableNow = (id) => !!view?.me.playable.includes(id)
  const nameOf = (seat) => {
    const p = view?.players.find((x) => x.seat === seat)
    return p ? (p.isMe ? 'You' : p.name) : 'An agent'
  }
  // The seat's place at the table: an opponent's pod, or your own.
  const seatTile = (seat) => root.querySelector(`.ra-pod[data-seat="${seat}"]`)
  const oppTile = (seat) => root.querySelector(`.ra-opp[data-seat="${seat}"]`)

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

  /** A card flying between two places. The ghost is card-sized (`card`, a
   *  rect) and travels centre to centre, scaled to fit whatever it leaves
   *  and lands on, so a seat pod or a fan never stretches it. */
  function fly(fromRect, toRect, html, { duration = 320, card = null, spin = 0 } = {}) {
    if (!fromRect || !toRect || reducedMotion()) return
    const size = card || toRect
    const w = Math.max(1, size.width)
    const h = Math.max(1, size.height)
    const fit = (r) => Math.min(r.width / w, r.height / h)
    const s0 = Math.min(1.1, fit(fromRect))
    const s1 = Math.min(1.1, fit(toRect))
    const x0 = fromRect.left + fromRect.width / 2 - w / 2
    const y0 = fromRect.top + fromRect.height / 2 - h / 2
    const dx = toRect.left + toRect.width / 2 - w / 2 - x0
    const dy = toRect.top + toRect.height / 2 - h / 2 - y0
    const ghost = el('div', 'ra-flight', html)
    Object.assign(ghost.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` })
    document.body.appendChild(ghost)
    const lift = Math.min(36, Math.hypot(dx, dy) * 0.18)
    ghost.animate(
      [
        { transform: `translate(0, 0) rotate(0deg) scale(${s0})`, opacity: 0.85 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - lift}px) rotate(${spin * 0.6}deg) scale(${Math.max(s0, s1) * 1.06})`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${s1})`, opacity: 1 },
      ],
      { duration, easing: 'cubic-bezier(.25,.8,.3,1)' },
    ).onfinish = () => ghost.remove()
  }

  function flash(node, cls, ms = 700) {
    if (!node) return
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls)
    setTimeout(() => node.classList.remove(cls), ms)
  }

  /** A short word on the felt (REVERSE, SKIP, a new colour) that rises and
   *  fades. Motion only: the activity feed carries the same news. */
  // Cues queue rather than stack: a Wild Pick Four sets a colour AND hits
  // the next agent, and both words used to land on the same spot at once.
  let cueFreeAt = 0
  function cue(text, cls = '') {
    if (reducedMotion()) return
    const now = Date.now()
    const wait = Math.max(0, cueFreeAt - now)
    cueFreeAt = Math.max(now, cueFreeAt) + 950
    setTimeout(() => {
      if (!root.isConnected) return
      const node = el('span', `ra-felt-cue${cls ? ` ${cls}` : ''}`, text)
      node.setAttribute('aria-hidden', 'true')
      $('.ra-table').appendChild(node)
      setTimeout(() => node.remove(), 1100)
    }, wait)
  }

  function fanHtml(n) {
    const shown = Math.max(0, Math.min(FAN_MAX, Number(n) || 0))
    return `<span class="ra-fan" data-n="${shown}" aria-hidden="true">${'<i></i>'.repeat(shown)}</span>`
  }

  function paintOpponents() {
    const box = $('.ra-opps')
    // Bottom is your own seat; a watcher, who has none, puts the lowest
    // seat there. Everyone else follows clockwise in seat order.
    const anchor = view.me.seat ?? Math.min(...view.players.map((p) => p.seat))
    const n = view.players.length
    const order = [...view.players].sort((a, b) => ((a.seat - anchor + n) % n) - ((b.seat - anchor + n) % n))
    const places = POSITIONS[Math.min(4, Math.max(1, n))]
    box.dataset.count = String(n - (view.me.watching ? 0 : 1))
    $('.ra-arena').dataset.players = String(n)
    box.innerHTML = order.map((p, i) => {
      const cls = `ra-pod${p.isMe ? ' is-me' : ' ra-opp'}${p.isTurn ? ' is-turn' : ''}${p.out ? ' is-out' : ''}${!p.connected && !p.out ? ' is-away' : ''}`
      return `
      <div class="${cls}" data-seat="${p.seat}" data-pos="${places[i] || 'top'}">
        <span class="ra-pod-av">${avatarHtml(p)}</span>
        <div class="ra-opp-text">
          <b>${esc(p.isMe ? 'You' : p.name)}</b>
          <span>${p.out ? 'Out of the round' : plural(p.cards ?? 0)}</span>
          ${!p.connected && !p.out ? '<em class="ra-opp-away">Reconnecting…</em>' : ''}
        </div>
        ${p.isMe || p.out ? '' : fanHtml(p.cards)}
        <span class="ra-opp-time" aria-hidden="true"></span>
      </div>`
    }).join('')
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

  /** The discard pile: the top card, with the two plays before it (from the
   *  public log) tilted underneath, so it reads as a pile. */
  function paintDiscard() {
    const t = view.table
    const played = view.log.filter((e) => e.type === 'CARD_PLAYED' && e.card)
    const last = played.at(-1)
    const topIsLast = !!last && sameCard(last.card, t.top)
    const under = (topIsLast ? played.slice(0, -1) : played).slice(-2)
    const topSeq = topIsLast ? last.seq : 0
    const key = `${topSeq}:${t.top.c}${t.top.k}|${under.map((e) => e.seq).join(',')}`
    if (key === pileKey) return
    pileKey = key
    const depth = played.length > under.length + (topIsLast ? 1 : 0) ? '<span class="ra-under is-edge" style="--rot:4deg;--dx:2px"></span>' : ''
    const unders = under.map((e) => `<span class="ra-under" style="--rot:${tilt(e.seq, 9)}deg;--dx:${tilt(e.seq * 3, 4)}px">${cardHtml(e.card)}</span>`).join('')
    $('.ra-discard').innerHTML = `${cardHtml(t.top, 'is-top')}${depth}${unders}`
    $('.ra-discard .is-top').style.setProperty('--rot', `${topSeq ? tilt(topSeq, 3) : 0}deg`)
  }

  function paintTable() {
    const t = view.table
    $('.ra-code').textContent = view.room.code
    paintDiscard()
    $('.ra-pile-count').textContent = String(t.drawCount)
    $('.ra-draw').dataset.depth = String(Math.min(2, Math.max(0, t.drawCount - 1)))
    $('.ra-color').innerHTML = colorChipHtml(t.color)
    root.dataset.color = t.color || ''
    const dir = $('.ra-dir')
    dir.classList.toggle('is-ccw', t.dir === -1)
    dir.setAttribute('aria-label', t.dir === 1 ? 'Clockwise' : 'Counter-clockwise')
    $('.ra-draw').disabled = !view.me.canDraw || busy
  }

  function paintMe() {
    const mine = isMyTurn()
    const watching = !!view.me.watching
    root.classList.toggle('is-my-turn', mine)
    root.classList.toggle('is-out', view.me.out)
    root.classList.toggle('is-watching', watching)
    $('.ra-watch-strip').hidden = !watching
    // Same short label as a player's: the sheet it opens says "Stop watching?".
    $('.ra-exit').setAttribute('aria-label', watching ? 'Stop watching' : 'Exit')
    $('.ra-turn-text').textContent = watching ? `${nameOf(view.table.turn)}'s turn`
      : view.me.out ? OUT_TEXT[view.me.outReason] || 'You are out of this round'
      : mine ? (view.me.canPass ? 'YOUR TURN · play the card you picked, or pass' : 'YOUR TURN') : `${nameOf(view.table.turn)}'s turn`
    $('.ra-btn-draw').disabled = !view.me.canDraw || busy
    $('.ra-btn-pass').disabled = !view.me.canPass || busy
    $('.ra-btn-runami').disabled = view.me.out || watching || busy
    $('.ra-btn-catch').disabled = view.me.out || watching || busy
    const w = view.watchers?.count || 0
    $('.ra-watch-text').textContent = `👀 ${w} watching · hands hidden`
    $('.ra-bomb').textContent = watching
      ? `👀 Watching${w > 1 ? ` with ${w - 1} other${w === 2 ? '' : 's'}` : ''}`
      : `${handlers.bombLabel?.() || ''}${w ? ` · 👀 ${w} watching` : ''}`
    $('.ra-called-slot').innerHTML = view.me.runAmiCalled ? '<span class="ra-called">MIC CHECK ✓</span>' : ''
  }

  /** The feed's mark for one event: the card that was played (with the
   *  colour a wild set), or a symbol for everything else. */
  function feedMark(e) {
    if (e.type === 'CARD_PLAYED' && e.card) {
      const wild = isWildKind(e.card.k)
      const chip = `<i class="ra-fi-card is-${wild ? 'w' : e.card.c}">${markOf(e.card.k)}</i>`
      return wild && COLORS[e.color] ? `${chip}<i class="ra-fi-dot is-${e.color}"></i>` : chip
    }
    const sym = {
      CARD_DRAWN: `+${e.count || 1}`, TURN_PASSED: '→', TURN_SKIPPED: '⊘', DIRECTION_REVERSED: e.dir === -1 ? '↺' : '↻',
      RUN_AMI_CALLED: '!', PLAYER_CAUGHT: `+${e.penalty || 2}`, MATCH_STARTED: '▸', MATCH_WON: '★', MATCH_ENDED: '■', PLAYER_FORFEITED: '–',
    }[e.type] || '·'
    return `<i class="ra-fi-sym is-${e.type.toLowerCase().replace(/_/g, '-')}">${esc(sym)}</i>`
  }

  function paintLog() {
    const items = view.log.map((e) => {
      const line = logLine(e, nameOf, view.me.seat)
      if (!line) return null
      const who = e.seat === null || e.seat === undefined ? '' : nameOf(e.seat)
      const named = who && line.startsWith(who)
      let rest = named ? line.slice(who.length) : line
      if (e.type === 'DIRECTION_REVERSED' && (e.dir === 1 || e.dir === -1)) rest += e.dir === -1 ? ' · now counter-clockwise' : ' · now clockwise'
      return { seq: e.seq, html: `<span class="ra-fi">${feedMark(e)}</span><span class="ra-ft">${named ? `<b>${esc(who)}</b>` : ''}<span class="ra-fr">${esc(rest)}</span></span>` }
    }).filter(Boolean).reverse() // newest first
    const more = $('.ra-feed-more')
    more.hidden = items.length <= 3
    more.textContent = feedOpen ? 'Less' : `History · ${items.length}`
    more.setAttribute('aria-expanded', String(feedOpen))
    $('.ra-feed').classList.toggle('is-open', feedOpen)
    const fresh = feedSeen
    feedSeen = items[0]?.seq ?? feedSeen
    $('.ra-log').innerHTML = items.map((it, i) => `<li class="${i >= 3 ? 'is-older' : ''}${fresh !== null && it.seq > fresh ? ' is-new' : ''}">${it.html}</li>`).join('')
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
    const topCard = () => $('.ra-discard .ra-card.is-top')
    // Seats hit by a Pick Two / Wild Pick Four in this batch: their skip is
    // part of the same story, told once by the +N cue.
    const hit = new Set()
    for (const e of entries) {
      const drawCard = $('.ra-draw .ra-card')
      const drawRect = rectOf(drawCard)
      if (e.type === 'CARD_PLAYED') {
        const to = rectOf(topCard())
        const from = e.seat === view.me.seat ? before.removed : rectOf(oppTile(e.seat)?.querySelector('.ra-fan') || oppTile(e.seat))
        fly(from, to, cardHtml(e.card), { spin: e.seat === view.me.seat ? -6 : 10 })
        if (!reducedMotion()) {
          flash($('.ra-discard'), 'is-landed', 420)
          if (isWildKind(e.card.k) && COLORS[e.color]) {
            flash($('.ra-discard'), 'is-recolor', 900)
            cue(`${COLORS[e.color].shape} ${COLORS[e.color].name}`, `is-color is-${e.color}`)
          }
        }
      } else if (e.type === 'CARD_DRAWN' || e.type === 'PLAYER_CAUGHT') {
        const seat = e.type === 'PLAYER_CAUGHT' ? e.target : e.seat
        if (!reducedMotion()) flash($('.ra-draw'), 'is-drawing', 320)
        if (seat === view.me.seat) {
          before.added.forEach((id, i) => setTimeout(() => fly(drawRect, rectOf(nodes.get(id)), cardBackHtml(), { card: drawRect, spin: 4 }), i * 90))
        } else {
          const tile = oppTile(seat)
          const n = Math.min(4, e.count || e.penalty || 1)
          for (let i = 0; i < n; i++) setTimeout(() => fly(drawRect, rectOf(tile?.querySelector('.ra-fan') || tile), cardBackHtml(), { card: drawRect, spin: -8 }), i * 90)
        }
        if (e.type === 'PLAYER_CAUGHT') flash(seat === view.me.seat ? $('.ra-me') : oppTile(seat), 'is-caught', 900)
        if (e.type === 'CARD_DRAWN' && e.forced && e.count) {
          hit.add(seat)
          const n = Number(e.count)
          cue(seat === view.me.seat ? `+${n} · You pick ${n} and skip` : `+${n} · ${esc(nameOf(seat))} picks ${n} and skips`, 'is-pick')
        }
      } else if (e.type === 'TURN_SKIPPED') {
        flash(seatTile(e.seat), 'is-skipped', 900)
        if (e.seat === view.me.seat) flash($('.ra-turnbar'), 'is-skipped', 900)
        if (!hit.has(e.seat)) cue(`⊘ Skip · ${esc(nameOf(e.seat))}`)
      } else if (e.type === 'DIRECTION_REVERSED') {
        flash($('.ra-dir'), 'is-flipping', 600)
        flash($('.ra-table'), 'is-reversing', 900)
        cue(e.dir === -1 ? '↺ Reverse' : '↻ Reverse')
      } else if (e.type === 'RUN_AMI_CALLED') {
        flash(seatTile(e.seat), 'is-calling', 1600)
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
    flashPrivate(text, ms = 1600) {
      const node = el('span', 'ra-private-note', esc(text))
      const slot = $('.ra-note-slot')
      slot.replaceChildren(node)
      setTimeout(() => node.remove(), ms)
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
      if (!fresh) {
        animate(newEntries, before)
        // Cards you just picked glow for a moment, so you can find them.
        for (const id of before.added) flash(nodes.get(id), 'is-new', 2400)
      }
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
      root.querySelectorAll('.ra-pod.is-turn').forEach((n) => n.classList.remove('is-turn'))
      root.querySelectorAll('.ra-opp-time').forEach((n) => { n.textContent = '' })
      $('.ra-turn-time').textContent = ''
      $('.ra-turn-text').textContent = 'Round over'
      const mySeat = view?.me.seat
      const winnerTile = r?.winnerSeat !== null && r?.winnerSeat !== undefined ? seatTile(r.winnerSeat) : null
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
          from = rectOf(tile.querySelector('.ra-fan') || tile)
          tile.querySelector('.ra-fan')?.replaceChildren()
        }
        const count = winnerTile?.querySelector('.ra-opp-text span')
        if (count) count.textContent = plural(0)
        // The winning card replaces the top; the pile under it stays.
        const winning = el('span', '', cardHtml(r.top, 'is-top')).firstElementChild
        const top = $('.ra-discard .ra-card.is-top')
        if (top) top.replaceWith(winning)
        else $('.ra-discard').prepend(winning)
        pileKey = null
        fly(from, rectOf($('.ra-discard .ra-card.is-top')), cardHtml(r.top), { duration: 460, spin: 8 })
        if (!reducedMotion()) flash($('.ra-discard'), 'is-landed', 420)
      }
      winnerTile?.classList.add('is-winner')
      const banner = $('.ra-finale')
      banner.textContent = resultLine(r)
      banner.classList.toggle('is-you', !!r?.youWinner)
      banner.classList.toggle('is-won', r?.endReason === 'played_out' || r?.endReason === 'last_standing')
      banner.hidden = false
      return FINALE_MS
    },
    selectedCard: () => (selected ? cardOf(selected) : null),
    destroy() { clearInterval(timer); root.remove() },
  }
}

export { isWildKind }
