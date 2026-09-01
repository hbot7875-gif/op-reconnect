// Agent Pack — currencies and things the agent owns. Nothing else.
//
// Redesigned as a spy/field-kit: a compact Agent ID card, then a case
// illustrated entirely in CSS (see reconnect.css's "Agent Pack — the case"
// block) with fitted compartments for the four spendable resources and a
// front pocket for Backup Pass/Tickets, then Lit Era Cards and collectibles
// clearly outside the case. Iterated as a standalone preview (pack-preview.
// html, kept in the repo for history) against real data shapes before this
// file was rewritten to use the genuine getGameState() response and every
// real action (moveItem/useTicket via items.js's itemSheet, agentChargeSheet,
// magicShopSheet, badgeDrawerSheet, openBackupPassFlow) — nothing about what
// any tap actually DOES changed, only how the screen looks.
//
// Every tool moved to the screen where it's actually used instead of sitting
// behind a second tap here:
//   - Agent Manual → Settings ("How to Play", screen-settings.js)
//   - Weekly Mission Board → the district screen (ui-district.js)
//   - The 148 Protocol → the district screen, as "Build today's stream
//     queue" (ui-district.js) — it's an action for finishing goals, not
//     inventory
//   - Personal Charge → tapping the ARMY Bomb itself on the World screen
//     (screen-world.js's coreBlock)
//   - Magic Shop → the City Map, as its own special location beside Candy
//     Star (city-map.js's toolMarker) — it's somewhere you GO to get/spend
//     things, not inventory you already hold. What you already own (Wings
//     included) still shows here as a read-only compartment below; only the
//     buy/claim actions moved.
// Badge Drawer is the one thing left that doesn't belong on any other
// screen, so it stays here as Quick Access.

import { el, esc, showOverlay, hideOverlay, getState, setState, toast } from './state.js'
import { getAgentNo } from './session.js'
import { call } from './api.js'
import { badgeDrawerSheet } from './badge-drawer.js'
import { itemArt, itemSheet, RARITY } from './items.js'
import { agentChargeSheet } from './agent-charge.js'
import { openBackupPassFlow } from './backup-pass.js'

/* ── Agent ID ─────────────────────────────────────────────────────────── */
function agentIdCard(state) {
  const p = state?.player || {}
  const card = el('div', 'aid-card')
  card.appendChild(el('div', 'aid-scanline'))
  const top = el('div', 'aid-top')
  const photo = el('div', 'aid-photo')
  const artworkUrl = p.equippedBadgeArtwork?.artworkUrl
  if (artworkUrl) {
    const crop = p.avatarCrop || { x: 50, y: 50, zoom: 1 }
    photo.innerHTML = `<img src="${esc(artworkUrl)}" alt="" style="object-position:${crop.x}% ${crop.y}%; transform:scale(${crop.zoom})">`
    // A photo the player equipped themselves is worth letting them frame
    // themselves — object-fit:cover on a 52x52 square can otherwise crop
    // an arbitrary badge photo's interesting part right out of view.
    const adjust = el('button', 'aid-photo-adjust', '✎')
    adjust.type = 'button'
    adjust.setAttribute('aria-label', 'Adjust photo framing')
    adjust.onclick = (e) => { e.stopPropagation(); showOverlay(avatarAdjustSheet(artworkUrl, crop)) }
    photo.appendChild(adjust)
  } else {
    photo.innerHTML = '🛰️'
  }
  const info = el('div', 'aid-info')
  info.appendChild(el('div', 'aid-codename', esc(p.codename || '')))
  info.appendChild(el('div', 'aid-meta', `${esc(getAgentNo() || '')} · LV ${p.level?.level ?? '—'} · ${esc(p.rank?.title || '')}`))
  const active = el('div', 'aid-active', '<i></i>ACTIVE')
  top.append(photo, info, active)
  card.appendChild(top)

  const strip = el('div', 'aid-strip')
  strip.innerHTML = `
    <span><b>District</b> ${esc(state?.activeDistrict?.name || '—')}</span>
    <span><b>Streak</b> ${p.streak?.current ?? 0}d</span>
    <span class="aid-id-no">ID·${esc(getAgentNo() || '')}·${String(p.level?.level ?? 0).padStart(3, '0')}</span>
  `
  card.appendChild(strip)

  // :hover covers desktop; touch devices get the same hologram/badge-shine
  // beat on tap instead, since there's no hover state to trigger it.
  card.addEventListener('click', () => {
    card.classList.add('is-shimmer')
    setTimeout(() => card.classList.remove('is-shimmer'), 1000)
  })
  return card
}

/** Lets the player pan/zoom their equipped badge photo within the ID
 *  card's small square frame — drag to reposition, slider to zoom.
 *  Saved as object-position + scale, applied wherever the photo renders. */
function avatarAdjustSheet(artworkUrl, initialCrop) {
  let crop = { ...initialCrop }
  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', '✎ ADJUST PHOTO'))
  sheet.appendChild(el('p', 'muted', 'Drag to reposition. Use the slider to zoom in.'))

  const frame = el('div', 'avatar-crop-frame')
  const img = document.createElement('img')
  img.src = artworkUrl
  img.alt = ''
  img.draggable = false
  frame.appendChild(img)
  sheet.appendChild(frame)

  const applyCrop = () => {
    img.style.objectPosition = `${crop.x}% ${crop.y}%`
    img.style.transform = `scale(${crop.zoom})`
  }
  applyCrop()

  let dragging = false
  let lastX = 0
  let lastY = 0
  const onPointerDown = (e) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    frame.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!dragging) return
    const rect = frame.getBoundingClientRect()
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    crop.x = Math.min(100, Math.max(0, crop.x - (dx / rect.width) * 100))
    crop.y = Math.min(100, Math.max(0, crop.y - (dy / rect.height) * 100))
    applyCrop()
  }
  const onPointerUp = () => { dragging = false }
  frame.addEventListener('pointerdown', onPointerDown)
  frame.addEventListener('pointermove', onPointerMove)
  frame.addEventListener('pointerup', onPointerUp)
  frame.addEventListener('pointercancel', onPointerUp)

  const zoomRow = el('div', 'avatar-crop-zoom')
  zoomRow.innerHTML = '<span>Zoom</span>'
  const zoomInput = document.createElement('input')
  zoomInput.type = 'range'
  zoomInput.min = '1'
  zoomInput.max = '2'
  zoomInput.step = '0.05'
  zoomInput.value = String(crop.zoom)
  zoomInput.oninput = () => { crop.zoom = Number(zoomInput.value); applyCrop() }
  zoomRow.appendChild(zoomInput)
  sheet.appendChild(zoomRow)

  const reset = el('button', 'btn btn-ghost avatar-crop-reset', 'Reset')
  reset.type = 'button'
  reset.onclick = () => { crop = { x: 50, y: 50, zoom: 1 }; zoomInput.value = '1'; applyCrop() }
  sheet.appendChild(reset)

  const actions = el('div', 'avatar-crop-actions')
  const cancel = el('button', 'btn btn-ghost', 'Cancel')
  cancel.type = 'button'
  cancel.onclick = hideOverlay
  const save = el('button', 'btn btn-primary', 'Save')
  save.type = 'button'
  save.onclick = async () => {
    save.disabled = true
    const res = await call('setAvatarCrop', { agentNo: getAgentNo(), crop })
    if (!res.success) { toast(res.error || "Couldn't save"); save.disabled = false; return }
    const current = getState()
    setState({ ...current, player: { ...current.player, avatarCrop: res.avatarCrop } })
    toast('Photo framing saved')
    hideOverlay()
  }
  actions.append(cancel, save)
  sheet.appendChild(actions)

  return sheet
}

/* ── Bag compartments ─────────────────────────────────────────────────── */
const SLOT_DEFS = [
  { key: 'chargeCells', cls: 'slot-cell', icon: '⚡', label: 'Charge Cells',
    desc: 'Powers your ARMY Bomb. Earned from Album Goal streams.' },
  { key: 'wings', cls: 'slot-wing', icon: '🪽', label: 'Wings',
    desc: 'Spent on the Candy Star Generator. Bought with XP in the Magic Shop.' },
  { key: 'streakFreezeCharges', cls: 'slot-freeze', icon: '🧊', label: 'Streak Freeze',
    desc: 'Protects your streak for one missed day.' },
  { key: 'deadlineExtensionCharges', cls: 'slot-ext', icon: '⏳', label: 'Extension',
    desc: 'Adds extra days to a district\'s restoration deadline.' },
]
const SLOT_ACCENTS = {
  'slot-cell': () => `<span class="slot-accent slot-accent-cell"></span>`,
  'slot-wing': () => `<span class="slot-accent slot-accent-wing l"></span><span class="slot-accent slot-accent-wing r"></span>`,
  'slot-freeze': () => `<span class="slot-accent slot-accent-freeze"></span>`,
  'slot-ext': () => `<span class="slot-accent slot-accent-ext"></span>`,
}

function slotDetailSheet(def, value, cellProgress) {
  const progressLine = cellProgress
    ? `<p class="muted"><b style="color:var(--text)">${cellProgress.remaining} more stream${cellProgress.remaining === 1 ? '' : 's'}</b> in this district's Album Goals until your next cell.</p>`
    : ''
  const sheet = el('div', 'sheet')
  sheet.append(el('div', 'eyebrow', esc(def.label)))
  sheet.appendChild(el('div', '', `
    <div style="font-size:38px; text-align:center; margin:10px 0;">${def.icon}</div>
    <p class="muted" style="text-align:center; font-family:var(--disp); font-size:20px; font-weight:800; color:var(--text);">${value}</p>
    <p class="muted">${esc(def.desc)}</p>
    ${progressLine}
  `))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.style.marginTop = '14px'
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function compartments(state) {
  const p = state?.player || {}
  const cellProgress = state?.activeDistrict?.chargeCellProgress
  const grid = el('div', 'bag-compartments')
  for (const def of SLOT_DEFS) {
    const value = p[def.key] || 0
    const slot = el('button', `slot ${def.cls}`)
    slot.type = 'button'
    // Real progress data exists only for Charge Cells — every other
    // resource has no "toward next" number anywhere in the app, so no fill
    // bar is drawn for them rather than faking one.
    const fillHtml = def.key === 'chargeCells' && cellProgress
      ? `<span class="slot-fill"><span class="slot-fill-bar" style="width:${Math.min(100, Math.round(cellProgress.streams / cellProgress.required * 100))}%"></span></span>`
      : ''
    slot.innerHTML = `
      <span class="slot-buckle"></span>
      ${SLOT_ACCENTS[def.cls]?.() || ''}
      <span class="slot-icon">${def.icon}</span>
      <span class="slot-val">${value}</span>
      <span class="slot-label">${esc(def.label)}</span>
      ${fillHtml}
    `
    slot.onclick = () => showOverlay(slotDetailSheet(def, value, def.key === 'chargeCells' ? cellProgress : null))
    grid.appendChild(slot)
  }
  return grid
}

function frontPocket(state) {
  const items = state.items || []
  const wrap = el('div', 'bag-pocket')
  wrap.appendChild(el('span', 'pocket-seam-label', 'FRONT POCKET'))
  const grid = el('div', 'pocket-items')

  const backup = items.find((i) => i.itemId === 'backup-pass' && !i.usedAt)
  const backupSlot = el('button', 'pocket-slot' + (backup ? '' : ' is-locked'))
  backupSlot.type = 'button'
  backupSlot.innerHTML = `
    <span class="ps-icon">🤝</span>
    <span><span class="ps-name">Backup Pass</span><span class="ps-status">${backup ? 'Ready — tap to open' : '0 — earn one from a Supply Chest'}</span></span>
  `
  if (backup) backupSlot.onclick = () => openBackupPassFlow(backup)
  else backupSlot.disabled = true
  grid.appendChild(backupSlot)

  const tickets = items.filter((i) => i.kind === 'ticket')
  const unusedTickets = tickets.filter((i) => !i.usedAt)
  const ticketSlot = el('button', 'pocket-slot' + (tickets.length ? '' : ' is-locked'))
  ticketSlot.type = 'button'
  ticketSlot.innerHTML = `
    <span class="ps-icon">🎟️</span>
    <span><span class="ps-name">Tickets</span><span class="ps-status">${unusedTickets.length ? `${unusedTickets.length} ready` : tickets.length ? 'All used' : 'None yet'}</span></span>
  `
  if (tickets.length) {
    // The real "Use the ticket" action lives in itemSheet — reused
    // directly, not reimplemented, so Launch the Voyage keeps working
    // exactly as it did before this screen's layout changed.
    ticketSlot.onclick = () => showOverlay(itemSheet(unusedTickets[0] || tickets[0]))
  } else {
    ticketSlot.disabled = true
  }
  grid.appendChild(ticketSlot)

  wrap.appendChild(grid)
  return wrap
}

function agentBag(state) {
  const wrap = el('div', 'bag-wrap')
  const handle = el('div', 'bag-handle')
  handle.append(el('span', 'bag-handle-rivet l'), el('span', 'bag-handle-rivet r'))
  wrap.appendChild(handle)
  const body = el('div', 'bag-body')
  body.appendChild(el('div', 'bag-seam'))
  const emblem = el('div', 'bag-emblem')
  for (let i = 0; i < 7; i++) emblem.appendChild(el('span'))
  body.appendChild(emblem)
  const header = el('div', 'bag-header')
  header.innerHTML = `<span class="bag-title">AGENT PACK</span>`
  const zip = el('div', 'bag-zip')
  for (let i = 0; i < 8; i++) zip.appendChild(el('i'))
  zip.appendChild(el('div', 'bag-zip-pull'))
  header.appendChild(zip)
  body.appendChild(header)
  body.appendChild(compartments(state))
  body.appendChild(frontPocket(state))
  wrap.appendChild(body)
  return wrap
}

/** Pack-only shelf object. District shelves can keep their collectible-card
 * treatment; the Agent Pack is a physical locker, so objects sit directly on
 * a shelf with a small label instead of inside another rectangle. */
function collectionObject(item) {
  const rarity = RARITY[item.rarity] || RARITY.common
  const button = el('button', `collection-object ${rarity.cls}${item.usedAt ? ' is-used' : ''}`)
  const location = item.districtName ? `Kept at ${item.districtName}` : item.usedAt ? 'Used' : 'In Pack'
  button.setAttribute('aria-label', `${item.name}. ${rarity.label}. ${location}.`)
  button.innerHTML = `
    <span class="co-art">${itemArt(item)}</span>
    <span class="co-name">${esc(item.name)}</span>
    <span class="co-meta"><i></i>${esc(rarity.label)}</span>
    <span class="co-place">${esc(location)}</span>
  `
  button.onclick = () => showOverlay(itemSheet(item))
  return button
}

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'pack', label: 'In Pack', test: (i) => !i.districtId },
  { key: 'placed', label: 'Placed', test: (i) => !!i.districtId },
  { key: 'used', label: 'Used', test: (i) => !!i.usedAt },
]
// Module-level, same pattern screen-ranking.js's activeTab already uses —
// survives the poll-driven re-render so the chosen filter doesn't reset
// every 90s.
let activeFilter = 'all'
let deckOpen = false

/** The card the closed deck shows its face as: the most relevant one to
 *  surface, not just the first in the list. A ready card is the most
 *  actionable thing on the whole screen, so it wins outright; short of
 *  that, whichever in-progress card is closest to activating is more
 *  useful to see at a glance than an arbitrary fixed first card. */
function frontCardFor(cards) {
  const special = cards.find((c) => c.isSpecial && c.status !== 'keepsake')
  if (special) return special
  const lit = cards.find((c) => c.status === 'lit')
  if (lit) return lit
  const inProgress = cards.filter((c) => c.status !== 'used')
  if (!inProgress.length) return cards[0]
  return inProgress.reduce((best, c) => (c.done / c.total > best.done / best.total ? c : best), inProgress[0])
}

function eraCardButton(card, newlyLit) {
  const button = el('button', `era-pack-card era-${card.status}${newlyLit.has(card.id) ? ' just-lit' : ''}`)
  button.type = 'button'
  const status = card.status === 'lit' ? '+10H READY'
    : card.status === 'used' ? 'USED'
    : card.status === 'keepsake' ? 'COLLECTED · 09.01'
    : `${card.done}/${card.total}`
  button.setAttribute('aria-label', `${card.name}. ${status}.`)
  button.innerHTML = `
    <span class="epc-icon">${card.icon}</span>
    <span class="epc-name">${esc(card.name)}</span>
    <span class="epc-status">${status}</span>
    ${card.status === 'lit' ? '<i>USE</i>' : ''}
  `
  button.onclick = () => showOverlay(agentChargeSheet(card.id))
  return button
}

/** Closed-deck state: reads as a physical stack, not a grid. The front
 *  card is the real, tappable, currently-most-relevant card; two more
 *  real cards sit behind it, stacked upward with just enough of each
 *  exposed (icon + start of its name) to show this is a collection of
 *  different eras, not identical layers. Tap anywhere to expand into the
 *  same rack used when open. */
function eraDeck(cards, ready, newlyLit, onOpen) {
  const front = frontCardFor(cards)
  const deck = el('button', 'era-deck')
  deck.type = 'button'
  deck.setAttribute('aria-label', `Lit Era Cards, ${cards.length} total, ${ready} ready. Tap to open.`)

  const stack = el('div', 'era-deck-stack')

  const rest = cards.filter((c) => c.id !== front.id)
  const restLive = rest.filter((c) => c.status !== 'used')
  const restOrdered = restLive.length >= 2 ? restLive : rest
  const [strip2Card, strip3Card] = restOrdered
  if (strip3Card) {
    const s3 = el('div', 'era-deck-strip s3', `<span class="strip-icon">${strip3Card.icon}</span><span class="strip-name">${esc(strip3Card.name)}</span>`)
    if (rest.length > 2) s3.classList.add('has-more')
    stack.appendChild(s3)
  }
  if (strip2Card) {
    const s2 = el('div', 'era-deck-strip s2', `<span class="strip-icon">${strip2Card.icon}</span><span class="strip-name">${esc(strip2Card.name)}</span>`)
    stack.appendChild(s2)
  }

  const faceCls = `era-deck-face era-${front.status}${newlyLit.has(front.id) ? ' just-lit' : ''}`
  const face = el('div', faceCls)
  const statusText = front.status === 'lit' ? '+10H READY'
    : front.status === 'used' ? 'USED'
    : front.status === 'keepsake' ? 'COLLECTED · 09.01'
    : `${front.done}/${front.total}`
  face.innerHTML = `
    <span class="epc-icon">${front.icon}</span>
    <span class="epc-name">${esc(front.name)}</span>
    <span class="epc-status">${statusText}</span>
  `
  stack.appendChild(face)

  deck.appendChild(stack)
  deck.appendChild(el('div', 'era-deck-hint', `${cards.length} cards · tap to open`))
  deck.onclick = onOpen
  return deck
}

/** Opening the deck is the one moment this section is deliberately brought
 *  into view, and it expands into a rack tall enough to finish under the
 *  fixed tab bar — the card then reads as cropped rather than as content
 *  the bar happens to be over. Scrolls the lit card (the one you opened the
 *  deck for) just far enough to clear the bar, using block:'nearest' so it
 *  does nothing at all when the rack is already comfortably visible. The
 *  clearance itself is scroll-margin-bottom in reconnect.css; nothing here
 *  changes layout or affects any other screen. */
function revealEraDeck(container) {
  const target = container.querySelector('.era-pack-card.just-lit')
    || container.querySelector('.era-pack-card.era-lit')
    || container.querySelector('.era-pack-rack')
  if (!target) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const reveal = () => target.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
  // A just-lit card enters on eraCardActivate, which starts it at
  // translateY(8px) scale(.9). scrollIntoView measures the VISUAL box, so
  // running it mid-animation compares a shrunken, shifted card and decides
  // no scroll is needed — the card then settles under the bar and stays
  // there. Wait for the entrance to finish so the box being measured is
  // the one the player ends up looking at. Everything else scrolls on the
  // next frame, as before.
  const entrance = target.getAnimations ? target.getAnimations().find((a) => a.playState === 'running') : null
  if (entrance) entrance.finished.then(reveal, reveal)
  else requestAnimationFrame(reveal)
}

export function renderResources(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'res-screen')

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">🎒 Agent Pack</span>
  `))

  wrap.appendChild(agentIdCard(state))
  wrap.appendChild(agentBag(state))

  // Weekly emergency power is inventory, not a passive stat. Lit cards wait
  // here until deliberately used; dark cards show the shortest route to the
  // next activation, and spent cards stay visible until Monday's reset.
  // Kept clearly OUTSIDE the case (pack-after-bag) rather than crammed into
  // a compartment — these aren't things the case physically holds.
  const eraCards = state?.agentCharge?.eraCards || []
  if (eraCards.length) {
    const ready = eraCards.filter((e) => e.status === 'lit').length
    const newlyLit = new Set(state?.agentCharge?.newlyLitEraIds || [])
    wrap.appendChild(el('div', 'pack-section era-pack-head pack-after-bag', `
      <span class="ps-title">Era Cards</span>
      <span class="ps-count">${ready ? `${ready} ready` : 'Your collection'}</span>
    `))
    if (deckOpen) {
      const rack = el('div', 'era-pack-rack')
      for (const card of eraCards) rack.appendChild(eraCardButton(card, newlyLit))
      wrap.appendChild(rack)
      const close = el('button', 'era-deck-close', '↑ Close deck')
      close.type = 'button'
      close.onclick = () => { deckOpen = false; renderResources(container, state) }
      wrap.appendChild(close)
      wrap.appendChild(el('p', 'era-pack-note', eraCards.some((card) => card.isSpecial)
        ? 'Weekly cards reset Monday. Birthday keepsakes stay in your collection.'
        : 'Complete every track in an era this week to activate its card. Use only when your ARMY Bomb needs emergency power.'))
    } else {
      wrap.appendChild(eraDeck(eraCards, ready, newlyLit, () => {
        deckOpen = true
        renderResources(container, state)
        revealEraDeck(container)
      }))
    }
  }

  // ── Merch — Backup Pass/Tickets now live in the case's front pocket
  // above, so they're excluded here to avoid showing the same item twice.
  const allItems = state.items || []
  const items = allItems.filter((i) => i.itemId !== 'backup-pass' && i.kind !== 'ticket')
  const inPack = items.filter((i) => !i.districtId).length
  const placed = items.length - inPack

  wrap.appendChild(el('div', `pack-section${eraCards.length ? '' : ' pack-after-bag'}`, `
    <span class="ps-title">Recovered Objects</span>
    <span class="ps-count">${inPack} in Pack &middot; ${placed} placed</span>
  `))

  if (!items.length) {
    wrap.appendChild(el('div', 'dim pack-hint', 'Restore a district to find your first thing worth keeping.'))
  } else {
    if (!inPack) wrap.appendChild(el('div', 'dim pack-hint', 'All collectibles are placed.'))

    let visible = items
    // Filter tabs only earn their keep once there's enough to actually sift
    // through — under ~15 items the grid alone already answers everything
    // these would ask.
    if (items.length >= 15) {
      const tabs = el('div', 'filter-tabs')
      for (const f of FILTERS) {
        const btn = el('button', 'filter-tab' + (f.key === activeFilter ? ' sel' : ''), f.label)
        btn.onclick = () => { activeFilter = f.key; renderResources(container, state) }
        tabs.appendChild(btn)
      }
      wrap.appendChild(tabs)
      visible = items.filter((FILTERS.find((f) => f.key === activeFilter) || FILTERS[0]).test)
    }

    if (visible.length) {
      const grid = el('div', 'collection-shelf')
      for (const it of visible) grid.appendChild(collectionObject(it))
      wrap.appendChild(grid)
    } else {
      wrap.appendChild(el('div', 'dim pack-hint', 'Nothing in this filter yet.'))
    }
  }

  // ── Quick access — the one thing that doesn't live anywhere else ──
  const quick = el('div', 'quick-links')
  const badges = el('button', 'quick-link')
  badges.innerHTML = '<span class="ql-icon">🎖️</span><span class="ql-name">Badge Drawer</span><span class="ql-go">›</span>'
  badges.onclick = () => showOverlay(badgeDrawerSheet(state))
  quick.append(badges)
  wrap.appendChild(quick)

  container.appendChild(wrap)
}
