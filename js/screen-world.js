// World screen — the hub.
//
// Reads top to bottom as: the ARMY Bomb (who we are), a breach if there is one
// (drop everything), what I'm restoring right now (the one button that matters),
// how the network is doing, then where I can go.
//
// The map is a stack of ward tiles (ward-tiles.js) — each ward a card with a
// mini skyline, one building per district, lit as they restore. The tiles
// carry the name/count/state text themselves, so there is no separate ward
// list: the map IS the list.

import { el, esc, showOverlay, hideOverlay, unlockAfter } from './state.js'
import { goWard, goDistrict } from './router.js'
import { districtFraction } from './ui-district.js'
import { renderWardTiles } from './ward-tiles.js'
import { districtIcon } from './landmarks.js'
import { openFinder } from './search.js'
import { openShare } from './share.js'
import { tickCountdowns } from './countdown.js'
import { bombSheet } from './bomb-sheet.js'

export function renderWorld(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'world-screen')
  const b = state.bomb || { charge: 0, defuse: null, brownout: false }

  wrap.appendChild(coreBlock(state))
  wrap.appendChild(coreFeed(state))
  if (b.defuse) wrap.appendChild(redZoneCard(state))
  wrap.appendChild(opCard(state))
  wrap.appendChild(statusStrip(state))
  wrap.appendChild(mapHead(state))
  wrap.appendChild(mapField(state))

  container.appendChild(wrap)
}

/* ── The map ────────────────────────────────────────────────────────────
   Ward skyline tiles — see ward-tiles.js. */

function mapHead(state) {
  const row = el('div', 'map-head')
  row.appendChild(el('span', 'world-eyebrow', 'Operations map'))
  const tools = el('span', 'map-tools')
  const share = el('button', 'find-btn', '📤 Share')
  share.onclick = () => showOverlay(openShare(state))
  const find = el('button', 'find-btn', '🔍 Find')
  find.onclick = () => openFinder(state)
  tools.append(share, find)
  row.appendChild(tools)
  return row
}
function mapField(state) {
  const wards = state.map?.wards || []
  if (!wards.length) return el('div')
  return renderWardTiles(wards, state.map?.districts || [],
    (w, origin) => goWard(w.id, origin),
    (d, w) => showOverlay(peekSheet(d, w, state)))
}

/* ── Peeking at one building ────────────────────────────────────────────
   Every building in a ward's skyline is a real district, so tapping one
   should tell you whose it is and let you go there — the skyline stops
   being a picture of the data and becomes the data. */

const PEEK_STATE = {
  restored: 'Restored', active: 'Restoring', available: 'Offline',
  locked: 'Sealed', centerpiece_dark: 'Dormant', centerpiece_lit: 'Awake',
}

function peekSheet(d, ward, state) {
  const live = state.activeDistrict?.id === d.id ? state.activeDistrict : null
  const pct = d.status === 'restored' || d.status === 'centerpiece_lit' ? 100
    : d.status === 'active' ? Math.round(districtFraction(live) * 100)
    : 0

  const sheet = el('div', 'sheet peek')
  sheet.appendChild(el('div', 'peek-head', `
    <span class="peek-icon">${districtIcon(d.name)}</span>
    <span class="peek-id">
      <span class="peek-name">${esc(d.name)}</span>
      <span class="peek-ward">${esc(ward?.name || '')} &middot; ${PEEK_STATE[d.status] || ''}</span>
    </span>
  `))

  if (d.echoOf) {
    sheet.appendChild(el('div', 'peek-guardian', `<span>👤 Guardian</span><b>${esc(d.echoOf)}</b>`))
  }

  if (d.status !== 'locked' && d.status !== 'centerpiece_dark') {
    sheet.appendChild(el('div', 'goal-line', `
      <div class="pbar" style="flex:1"><div class="pfill${pct === 100 ? ' done' : ''}" style="width:${pct}%"></div></div>
      <span class="count">${pct}%</span>`))
  }

  if (d.memory && (d.status === 'restored' || d.status === 'centerpiece_lit')) {
    sheet.appendChild(el('div', 'file-body', esc(d.memory)))
  } else if (d.status === 'centerpiece_dark') {
    sheet.appendChild(el('div', 'dim', 'Nobody keeps this one. It stays dark until every district around it is back.'))
  } else if (d.status === 'locked') {
    const gate = unlockAfter(state.map?.wards || [], d.wardId)
    sheet.appendChild(el('div', 'dim', gate
      ? `🔒 Sealed until ${esc(gate.name)} is whole.`
      : '🔒 Opens later in the operation.'))
  }

  const open = el('button', 'btn btn-primary', 'Open district')
  open.onclick = (e) => { hideOverlay(); goDistrict(ward.id, d.id, { x: e.clientX, y: e.clientY }) }
  sheet.appendChild(open)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/* ── The ARMY Bomb ──────────────────────────────────────────────────────── */

function coreBlock(state) {
  const b = state.bomb || { charge: 0, defuse: null, brownout: false }
  const underAttack = !!b.defuse
  const pct = Math.round((b.charge || 0) * 100)

  const zone = el('div', 'core-block')
  zone.appendChild(el('div', 'core-eyebrow', 'Network core'))
  zone.appendChild(el('div', 'core-title', 'ARMY Bomb'))

  const btn = el('button', 'army-core' + (underAttack ? ' is-attack' : b.brownout ? ' is-brownout' : ''))
  btn.setAttribute('aria-label', `ARMY Bomb — ${pct}% charged. Open details.`)
  // The lightstick is the Launch the Voyage bomb (the .cs-bomb build from
  // app.js's concert mode): glassy sphere, ⟭⟬ logo, dark handle, gentle sway.
  // The outer arc is live data: community charge (or, under attack, how far
  // the defuse has come).
  const CIRC = 2 * Math.PI * 106
  const arcFrac = underAttack
    ? Math.min(1, b.defuse.progress / Math.max(1, b.defuse.target))
    : (b.charge || 0)
  btn.innerHTML = `
    <div class="core-glow"></div>
    <svg class="core-rings" viewBox="0 0 220 220" aria-hidden="true">
      <circle class="ring-outer" cx="110" cy="110" r="98"></circle>
      <circle class="ring-charge-bg" cx="110" cy="110" r="106"></circle>
      <circle class="ring-charge" cx="110" cy="110" r="106" transform="rotate(-90 110 110)"
        stroke-dasharray="${(CIRC * arcFrac).toFixed(1)} ${CIRC.toFixed(1)}"></circle>
    </svg>
    <div class="rc-bomb">
      <div class="rc-sphere"><span class="rc-fill"></span><span class="rc-logo">⟭⟬</span></div>
      <div class="rc-handle"></div>
    </div>
  `
  btn.onclick = () => showOverlay(bombSheet(state))
  zone.appendChild(btn)

  const read = el('div', 'core-read' + (underAttack ? ' is-attack' : ''))
  const deadline = underAttack ? (b.defuse.activeUntil || b.defuse.active_until || null) : null
  read.innerHTML = underAttack ? `
    <div class="core-pct"${deadline ? ` data-deadline="${esc(deadline)}"` : ''}>${deadline ? '--:--:--' : 'BREACH'}</div>
    <div class="core-lbl">until detonation &middot; stream to defuse</div>
  ` : `
    <div class="core-pct">${pct}%</div>
    <div class="core-lbl">power charged</div>
  `
  zone.appendChild(read)
  if (deadline) tickCountdowns()
  return zone
}

/* ── The conduit ────────────────────────────────────────────────────────
   The bomb isn't decoration sitting above a list — it powers the city, and
   the city feeds it back. A pulse runs down this line into the operations
   map, faster the fuller the core is. During a breach it runs crimson and
   urgent; in a brownout it stops, which is the whole point of a brownout. */

function coreFeed(state) {
  const b = state.bomb || { charge: 0 }
  const feed = el('div', 'core-feed'
    + (b.defuse ? ' is-attack' : b.brownout ? ' is-brownout' : ''))
  feed.setAttribute('aria-hidden', 'true')
  feed.innerHTML = '<i class="cf-line"></i><i class="cf-pulse"></i><i class="cf-pulse d2"></i>'

  // A charged network visibly moves more signal: 2.6s idle → 1.2s at full.
  const secs = (2.6 - Math.min(1, b.charge || 0) * 1.4).toFixed(2)
  for (const p of feed.querySelectorAll('.cf-pulse')) p.style.animationDuration = `${secs}s`
  return feed
}

/* ── Red Zone ───────────────────────────────────────────────────────────── */

function redZoneCard(state) {
  const d = state.bomb.defuse
  const pct = Math.min(100, Math.round((d.progress / Math.max(1, d.target)) * 100))

  const card = el('section', 'redzone')
  card.innerHTML = `
    <div class="rz-head"><span class="rz-dot"></span>Red Zone &middot; active</div>
    <div class="rz-title">${esc(d.title || 'Signal breach detected')}</div>
    <p class="rz-msg">${esc(d.message || 'Everyone stream. That\'s how we defuse it.')}</p>
    <div class="rz-goal-top"><span>Global target</span><span class="rz-num">${d.progress.toLocaleString()}<i>/${d.target.toLocaleString()}</i></span></div>
    <div class="rz-bar"><i style="width:${pct}%"></i></div>
    ${(d.activeUntil || d.active_until)
      ? `<div class="rz-timer">Time left <b data-deadline="${esc(d.activeUntil || d.active_until)}">--:--:--</b></div>`
      : ''}
    <div class="rz-foot">You've routed ${d.yourStreams} &middot; everyone who helps gets +${d.rewardXp} XP</div>
  `
  const go = el('button', 'btn btn-alert', 'View Red Zone')
  go.onclick = () => showOverlay(bombSheet(state))
  card.appendChild(go)
  return card
}

/* ── The one thing the player is here to do ─────────────────────────────── */

function goalsLeft(d) {
  let left = 0
  for (const g of d.trackGoals || []) if (!g.done) left++
  if (d.album && !d.album.done) left++
  return left
}

function opCard(state) {
  const wards = state.map?.wards || []
  const districts = state.map?.districts || []
  const active = districts.find((d) => d.status === 'active')
  const card = el('section', 'op-card')

  if (active) {
    const ward = wards.find((w) => w.id === active.wardId)
    const live = state.activeDistrict?.id === active.id ? state.activeDistrict : null
    const pct = Math.round((live ? districtFraction(live) : 0) * 100)
    const left = live ? goalsLeft(live) : null

    card.classList.add('is-live')
    card.innerHTML = `
      <div class="op-top">
        <span class="op-eyebrow">Now restoring</span>
        <span class="op-badge">${pct}%</span>
      </div>
      <div class="op-name">${esc(active.name)}</div>
      <div class="op-where">${esc(ward?.name || '')}${active.echoOf ? ` &middot; kept by ${esc(active.echoOf)}` : ''}</div>
      <div class="op-meter"><div class="op-meter-fill" style="width:${pct}%"></div></div>
      <div class="op-note">${left === null ? 'Loading&hellip;'
        : left === 0 ? "All done — go switch the lights on"
        : `${left} more to go and it's back online`}</div>
    `
    const go = el('button', 'btn btn-primary op-go', left === 0 ? 'Finish it' : 'Keep going')
    go.onclick = (e) => goDistrict(active.wardId, active.id, { x: e.clientX, y: e.clientY })
    card.appendChild(go)
    return card
  }

  const ward = wards.find((w) => w.status === 'active')
    || wards.find((w) => w.status === 'available')
    || wards.find((w) => w.status !== 'locked')

  card.innerHTML = `
    <div class="op-top"><span class="op-eyebrow">You're up</span></div>
    <div class="op-name">Pick a district</div>
    <div class="op-note">${ward
      ? `Head into ${esc(ward.name)} and pick who you're bringing back.`
      : 'All quiet out there. Check back tomorrow.'}</div>
  `
  if (ward) {
    const go = el('button', 'btn btn-primary op-go', `Open ${ward.name}`)
    go.onclick = (e) => goWard(ward.id, { x: e.clientX, y: e.clientY })
    card.appendChild(go)
  }
  return card
}

/* ── Network + transmission ─────────────────────────────────────────────── */

function statusStrip(state) {
  const row = el('div', 'status-strip')
  const b = state.bomb

  if (b && !b.defuse) {
    const pct = Math.round((b.charge || 0) * 100)
    const tile = el('button', 'status-tile' + (b.brownout ? ' dim' : ''))
    tile.setAttribute('aria-label', `ARMY Bomb network power ${pct}%`)
    tile.innerHTML = `
      <div class="st-head">
        <span class="st-label">${b.brownout ? 'Brownout' : 'Network'}</span>
        <span class="st-val">${pct}%</span>
      </div>
      <div class="st-bar"><div class="st-fill" style="width:${pct}%"></div></div>
      <div class="st-sub">Boost &times;${b.multiplier}</div>
    `
    tile.onclick = () => showOverlay(bombSheet(state))
    row.appendChild(tile)
  }

  const t = state.transmission
  if (t) {
    const pct = Math.min(100, Math.round((t.progress / Math.max(1, t.required)) * 100))
    const tile = el('button', 'status-tile' + (t.done ? ' done' : ''))
    tile.setAttribute('aria-label', t.done
      ? "Today's transmission complete"
      : `Today's transmission — ${t.progress} of ${t.required}`)
    tile.innerHTML = `
      <div class="st-head">
        <span class="st-label">Today</span>
        <span class="st-val">${t.done ? 'Done' : `${t.progress}/${t.required}`}</span>
      </div>
      <div class="st-bar"><div class="st-fill${t.done ? ' done' : ''}" style="width:${pct}%"></div></div>
      <div class="st-sub">${t.done ? 'Done for today' : `+${t.xpOnComplete} XP`}</div>
    `
    tile.onclick = () => showOverlay(transmissionSheet(t))
    row.appendChild(tile)
  }
  return row
}

/* ── Sheets ─────────────────────────────────────────────────────────────── */

function transmissionSheet(t) {
  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', 'Daily transmission'))
  sheet.appendChild(el('p', 'muted', esc(t.text)))
  const pct = Math.min(100, Math.round((t.progress / Math.max(1, t.required)) * 100))
  sheet.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1"><div class="pfill${t.done ? ' done' : ''}" style="width:${pct}%"></div></div>
    <span class="count">${t.done ? 'complete' : `${t.progress} / ${t.required}`}</span>`))
  sheet.appendChild(el('div', 'dim', t.done
    ? `+${t.xpOnComplete} XP banked &middot; new one tomorrow`
    : `+${t.xpOnComplete} XP &middot; resets midnight KST`))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

// The bomb's panel lives in bomb-sheet.js — it grew into a real dashboard.
