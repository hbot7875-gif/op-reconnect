// World screen — the hub.
//
// Reads top to bottom as: any active broadcast (HT has something to say), a
// breach if there is one (drop everything), what I'm restoring right now
// (the one button that matters — the mission dominates, it's the reason
// this screen exists), the ARMY Bomb as a compact status line (real data,
// but it's network status, not the mission), then how the whole city is
// doing and where I can go.
//
// The mission card used to sit after the ARMY Bomb, which by itself was
// most of a screen's height before a player ever reached the thing they
// came here to do. The Bomb still shows real charge/boost data, just
// smaller and lower down the page — see .army-core's ~30%-smaller sizing
// in reconnect.css.
//
// The map is a stack of ward tiles (ward-tiles.js) — each ward a card with a
// mini skyline, one building per district, lit as they restore. The tiles
// carry the name/count/state text themselves, so there is no separate ward
// list: the map IS the list. Home Base itself never gets a tile there — see
// ward-tiles.js's header comment — since it's already this mission card and
// the map's own centre landmark; a third copy was pure repetition.

import { el, esc, showOverlay, hideOverlay, unlockAfter } from './state.js'
import { goWard, goDistrict, goCandyStar } from './router.js'
import { districtFraction } from './ui-district.js'
import { renderWardTiles, glanceStrip, wardDisplayName, districtDisplayName, HOME_BASE_WARD } from './ward-tiles.js'
import { renderCityMap } from './city-map.js'
import { districtIcon } from './landmarks.js'
import { openFinder } from './search.js'
import { openShare } from './share.js'
import { tickCountdowns } from './countdown.js'
import { bombSheet } from './bomb-sheet.js'
import { broadcastCards } from './broadcasts.js'

export function renderWorld(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'world-screen')
  const b = state.bomb || { charge: 0, defuse: null, brownout: false }

  const bc = broadcastCards(state)
  if (bc.children.length) wrap.appendChild(bc)
  if (b.defuse) wrap.appendChild(redZoneCard(state))
  wrap.appendChild(opCard(state))
  wrap.appendChild(coreBlock(state))
  wrap.appendChild(coreFeed(state))
  if (state.eraTimeline) wrap.appendChild(eraTimelineStrip(state.eraTimeline))
  wrap.appendChild(statusStrip(state))
  // The map's heading and its tiles travel together: on desktop the whole
  // group moves into the second column as ONE cell. Kept as two separate
  // children, each landed in its own grid row, and the row heights are set by
  // the much taller core block on the left — which opened a dead gap between
  // "Operations map" and the first tile.
  const map = el('div', 'world-map')
  map.appendChild(mapHead(state))
  // City Recovery used to sit after the map (inside mapField, as the first
  // thing in the ward-tile stack) — reads backward: you'd inspect the whole
  // map before finding out what it's a map OF. It's the map's own header
  // stat now, above the plan itself.
  const wards = state.map?.wards || []
  if (wards.length) map.appendChild(glanceStrip(wards, state.map?.districts || []))
  map.appendChild(cityPlan(state))
  map.appendChild(mapField(state))
  wrap.appendChild(map)

  container.appendChild(wrap)
}

/* ── The map ────────────────────────────────────────────────────────────
   Ward skyline tiles — see ward-tiles.js. */

function mapHead(state) {
  const wrap = el('div')
  const row = el('div', 'map-head')
  row.appendChild(el('span', 'world-eyebrow', 'City map'))
  const tools = el('span', 'map-tools')
  const share = el('button', 'find-btn', '📤 Share')
  share.onclick = () => showOverlay(openShare(state))
  const find = el('button', 'find-btn', '🔍 Find')
  find.onclick = () => openFinder(state)
  tools.append(share, find)
  row.appendChild(tools)
  wrap.appendChild(row)
  // Persistent, not a one-time tip — a stranger's first instinct is to tap
  // the ARMY Bomb (it's the biggest, brightest thing on screen), not this
  // map. Saying outright that the map is the way in beats hoping the visual
  // pulse on the available ward (below) gets noticed on its own. "Tap a
  // ward" is actively wrong early on, when every ward but Home Base is
  // sealed — name the one thing that's actually open instead.
  wrap.appendChild(el('div', 'map-hint', mapHint(state)))
  return wrap
}

function mapHint(state) {
  const home = (state.map?.wards || []).find((w) => w.id === HOME_BASE_WARD)
  return home && home.status !== 'restored'
    ? 'Home Base is open — tap the center to begin.'
    : 'Tap a ward to enter the city.'
}
/* The whole world, on the home screen — the entire valley at once, one block
   per district, each lighting as that district comes back. city-map.js has
   drawn this for a long time but nothing ever mounted it; the World screen
   showed only the ward tiles below, so you could see a ward's skyline but
   never the city those wards add up to. Tapping a ward opens it, same as its
   tile. The tiles stay: this answers "how much of the world is back", the
   tiles answer "what do I do next". */
function cityPlan(state) {
  const wards = state.map?.wards || []
  if (!wards.length) return el('div')
  const box = el('div', 'city-plan')
  box.appendChild(renderCityMap(wards, state.map?.districts || [],
    (w, origin) => goWard(w.id, origin), state.bomb,
    (origin) => goCandyStar(origin)))
  return box
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
      <span class="peek-name">${esc(districtDisplayName(d))}</span>
      <span class="peek-ward">${esc(wardDisplayName(ward))} &middot; ${PEEK_STATE[d.status] || ''}</span>
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

  if (d.status === 'centerpiece_dark') {
    sheet.appendChild(el('div', 'dim', 'Nobody keeps this one. It stays dark until every district around it is back.'))
  } else if (d.status === 'locked') {
    const gate = unlockAfter(state.map?.wards || [], d.wardId)
    sheet.appendChild(el('div', 'dim', gate
      ? `🔒 Sealed until ${esc(wardDisplayName(gate))} is whole.`
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

// The World screen re-renders on every poll (main.js, every 90s + tab focus)
// — the power-on entrance and the count-up should only ever play the first
// time an agent sees the bomb this session, not replay on every refresh,
// which would read as glitchy rather than as an entrance.
let bombIntroPlayed = false
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function coreBlock(state) {
  const b = state.bomb || { charge: 0, defuse: null, brownout: false }
  const underAttack = !!b.defuse
  const pct = Math.round((b.charge || 0) * 100)
  const firstReveal = !bombIntroPlayed
  bombIntroPlayed = true

  const zone = el('div', 'core-block')
  zone.appendChild(el('div', 'core-eyebrow', 'Network core'))
  zone.appendChild(el('div', 'core-title', 'ARMY Bomb'))

  const btn = el('button', 'army-core'
    + (underAttack ? ' is-attack' : b.brownout ? ' is-brownout' : '')
    + (firstReveal && !reducedMotion() ? ' core-intro' : ''))
  // Worded as secondary status, not a call to action — the ARMY Bomb is the
  // biggest, brightest thing on this screen, and a first-time agent's first
  // instinct is to tap it. It's real data (community charge), but it isn't
  // where missions are picked; that's the map below.
  btn.setAttribute('aria-label', `Network power — ${pct}% charged. Tap for details.`)
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
      <circle class="ring-inner" cx="110" cy="110" r="90"></circle>
      <circle class="ring-charge-bg" cx="110" cy="110" r="106"></circle>
      <circle class="ring-charge" cx="110" cy="110" r="106" transform="rotate(-90 110 110)"
        stroke-dasharray="${(CIRC * arcFrac).toFixed(1)} ${CIRC.toFixed(1)}"></circle>
    </svg>
    <div class="core-particles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div class="rc-bomb">
      <div class="rc-sphere">
        <span class="rc-fill"></span>
        <span class="rc-shine"></span>
        <span class="rc-shine-2"></span>
        <span class="rc-logo">⟭⟬</span>
      </div>
      <div class="rc-handle"><span class="rc-grip"></span><span class="rc-grip"></span></div>
    </div>
  `
  // The ring arc already carries real charge — the glow/sphere didn't, so the
  // bomb looked fully lit from 0% on. --charge scales glow opacity and
  // box-shadow spread in CSS so a fresh network reads as dim/embers and
  // brightens as it actually charges, same intensity-follows-state language
  // the map and auth screen already use elsewhere.
  btn.style.setProperty('--charge', arcFrac.toFixed(3))
  btn.onclick = () => showOverlay(bombSheet(state))
  zone.appendChild(btn)

  const read = el('div', 'core-read' + (underAttack ? ' is-attack' : ''))
  const deadline = underAttack ? (b.defuse.activeUntil || b.defuse.active_until || null) : null
  read.innerHTML = underAttack ? `
    <div class="core-pct"${deadline ? ` data-deadline="${esc(deadline)}"` : ''}>${deadline ? '--:--:--' : 'BREACH'}</div>
    <div class="core-lbl">until detonation &middot; stream to defuse</div>
  ` : `
    <div class="core-pct">${pct}%</div>
    <div class="core-lbl">network power &middot; tap for details</div>
  `
  zone.appendChild(read)
  if (deadline) tickCountdowns()

  // Signal ports — a discrete "how many bars" companion to the exact
  // percentage above: real tiers off the same arcFrac driving the ring,
  // not decoration. Under attack this reads defuse progress instead of
  // charge, same swap the ring/percentage already make. Math.ceil (not
  // round) so any nonzero charge lights at least one port — a 3% network
  // rounding down to "0 lit" looked identical to a dead one.
  const litPorts = arcFrac > 0 ? Math.max(1, Math.ceil(arcFrac * 4)) : 0
  const ports = el('div', 'core-ports' + (underAttack ? ' is-attack' : b.brownout ? ' is-brownout' : ''))
  ports.innerHTML = Array.from({ length: 4 }, (_, i) => `<span class="wp${i < litPorts ? ' lit' : ''}"></span>`).join('')
  zone.appendChild(ports)

  // Charges up from 0 rather than just appearing, same "this is happening
  // live" feeling the count-up rings already sell — but only on the entrance,
  // never on a routine poll where the value usually hasn't moved.
  if (firstReveal && !underAttack && !reducedMotion()) {
    const numEl = read.querySelector('.core-pct')
    const start = performance.now()
    const dur = 900
    requestAnimationFrame(function frame(now) {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      numEl.textContent = `${Math.round(pct * eased)}%`
      if (t < 1) requestAnimationFrame(frame)
    })
  }
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

/* ── Era Timeline ───────────────────────────────────────────────────────
   How much of the whole discography the NETWORK has collectively streamed,
   era by era — not per-district (districts are just agent names, nothing
   to do with BTS eras) and not per-team (this game doesn't have teams).
   One shared strip everyone sees the same numbers on, same framing as City
   Recovery below it.
   Each chip used to be read-only — a count with nothing to tap. But
   "12/16" doesn't tell you which 4 songs are still missing, and there was
   nowhere in the whole game that named them. Tapping a chip now opens the
   exact album/track list for that era, checkmarked against what the
   network has already crossed the stream threshold on. */

function eraTimelineStrip(timeline) {
  const wrap = el('div', 'era-strip')
  wrap.appendChild(el('div', 'era-strip-label', 'Era Timeline'))
  const row = el('div', 'era-row')
  for (const e of timeline.eras || []) {
    const chip = el('button', 'era-chip' + (e.done >= e.total && e.total > 0 ? ' done' : ''))
    if (e.description) chip.title = e.description
    chip.setAttribute('aria-label', `${e.name} — ${e.done} of ${e.total} streamed. Tap to see which songs.`)
    chip.innerHTML = `
      <span class="era-icon">${e.icon}</span>
      <span class="era-name">${esc(e.name)}</span>
      <span class="era-count">${e.done}/${e.total}</span>
    `
    chip.onclick = () => showOverlay(eraTracksSheet(e))
    row.appendChild(chip)
  }
  wrap.appendChild(row)
  return wrap
}

function eraTracksSheet(e) {
  const sheet = el('div', 'sheet era-tracks')
  sheet.appendChild(el('div', 'eyebrow', `${e.icon} ${esc(e.name)}`))
  if (e.description) sheet.appendChild(el('p', 'muted', esc(e.description)))
  if (e.albums?.length) {
    sheet.appendChild(el('div', 'et-albums', `From: ${esc(e.albums.join(', '))}`))
  }
  sheet.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1"><div class="pfill${e.done >= e.total && e.total > 0 ? ' done' : ''}" style="width:${e.total ? Math.round((e.done / e.total) * 100) : 0}%"></div></div>
    <span class="count">${e.done} / ${e.total} streamed</span>`))
  sheet.appendChild(el('div', 'dim', 'Stream a song enough for the whole network to cross its threshold, and it lights up here for everyone.'))

  const list = el('div', 'et-list')
  for (const t of e.tracks || []) {
    const row = el('div', 'et-row' + (t.done ? ' done' : ''))
    row.innerHTML = `<span class="et-mark">${t.done ? '✓' : '○'}</span><span class="et-title">${esc(t.title)}</span>`
    list.appendChild(row)
  }
  sheet.appendChild(list)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
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
    <div class="rz-foot">You've routed ${(d.yourStreams || 0).toLocaleString()} &middot; everyone who helps gets +${d.rewardXp} XP</div>
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
  for (const a of d.albums || []) if (!a.done) left++
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

    // Home base's single district carries the same raw name as the ward
    // around it, so the two lines below would render "Relay Zero" twice —
    // on the most prominent card of the first screen after sign-in.
    // districtDisplayName/wardDisplayName both promote it to "Home Base",
    // so drop the "where" line whenever it would only repeat the title back
    // (kept general: any ward whose centrepiece shares its name hits the
    // same thing).
    const wardName = wardDisplayName(ward)
    const name = districtDisplayName(active)
    const echo = active.echoOf ? `kept by ${esc(active.echoOf)}` : ''
    const where = wardName === name ? echo
      : [esc(wardName), echo].filter(Boolean).join(' &middot; ')

    card.classList.add('is-live')
    card.innerHTML = `
      <div class="op-top">
        <span class="op-eyebrow">Now restoring</span>
        <span class="op-badge">${pct}%</span>
      </div>
      <div class="op-name">${esc(name)}</div>
      ${where ? `<div class="op-where">${where}</div>` : ''}
      <div class="op-meter"><div class="op-meter-fill" style="width:${pct}%"></div></div>
      <div class="op-note">${left === null ? 'Loading&hellip;'
        : left === 0 ? "All done — go switch the lights on"
        : `${left} more to go and it's back online`}</div>
    `
    const go = el('button', 'btn btn-primary op-go', left === 0 ? 'Finish it' : `Enter ${esc(name)}`)
    go.onclick = (e) => goDistrict(active.wardId, active.id, { x: e.clientX, y: e.clientY })
    card.appendChild(go)
    return card
  }

  const ward = wards.find((w) => w.status === 'active')
    || wards.find((w) => w.status === 'available')
    || wards.find((w) => w.status !== 'locked')

  // Nothing open yet, so this card doubles as the tutorial: it names the
  // exact ward that's pulsing on the map below (see .wt-tile.available /
  // .cm-ward.available in reconnect.css) instead of just saying "pick one".
  card.classList.add('is-spotlight')
  card.innerHTML = `
    <div class="op-top"><span class="op-eyebrow">You're up</span></div>
    <div class="op-name">Pick a district</div>
    <div class="op-note">${ward
      ? `Start here — <b>${esc(wardDisplayName(ward))}</b> is highlighted on the map below. Open it and pick who you're bringing back.`
      : 'All quiet out there. Check back tomorrow.'}</div>
  `
  if (ward) {
    const go = el('button', 'btn btn-primary op-go', `Choose a district in ${wardDisplayName(ward)}`)
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
