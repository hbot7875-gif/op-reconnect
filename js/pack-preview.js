// Agent Pack redesign — PREVIEW ONLY (see pack-preview.html). Renders the
// spy/field-kit UI against mock data shaped exactly like the real
// getGameState() response. All taps open a read-only detail sheet — no
// backend calls, no mutation, nothing here touches the live game.

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { itemArt, RARITY } from './items.js'
import { MOCK_STATE } from './pack-preview-data.js'

function inertSheet(title, bodyHtml) {
  const sheet = el('div', 'sheet')
  sheet.append(el('div', 'eyebrow', esc(title)))
  sheet.appendChild(el('div', '', bodyHtml))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.style.marginTop = '14px'
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/* ── Agent ID ─────────────────────────────────────────────────────────── */
function agentIdCard(state) {
  const p = state.player
  const card = el('div', 'aid-card')
  card.appendChild(el('div', 'aid-scanline'))
  const top = el('div', 'aid-top')
  const photo = el('div', 'aid-photo')
  photo.innerHTML = p.equippedBadgeArtwork?.artworkUrl
    ? `<img src="${esc(p.equippedBadgeArtwork.artworkUrl)}" alt="">`
    : '🛰️'
  const info = el('div', 'aid-info')
  info.appendChild(el('div', 'aid-codename', esc(p.codename)))
  info.appendChild(el('div', 'aid-meta', `${esc(state.agentNo)} · LV ${p.level.level} · ${esc(p.rank.title)}`))
  const active = el('div', 'aid-active', '<i></i>ACTIVE')
  top.append(photo, info, active)
  card.appendChild(top)

  const strip = el('div', 'aid-strip')
  strip.innerHTML = `
    <span><b>District</b> ${esc(state.activeDistrict?.name || '—')}</span>
    <span><b>Streak</b> ${p.streak.current}d</span>
    <span class="aid-id-no">ID·${esc(state.agentNo)}·${p.level.level.toString().padStart(3, '0')}</span>
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

/* ── Bag compartments ─────────────────────────────────────────────────── */
const SLOT_DEFS = [
  { key: 'chargeCells', cls: 'slot-cell', icon: '⚡', label: 'Charge Cells',
    desc: 'Powers your ARMY Bomb. Earned from Album Goal streams.' },
  { key: 'wings', cls: 'slot-wing', icon: '🪽', label: 'Wings',
    desc: 'Spent in the Magic Shop.' },
  { key: 'streakFreezeCharges', cls: 'slot-freeze', icon: '🧊', label: 'Streak Freeze',
    desc: 'Protects your streak for one missed day.' },
  { key: 'deadlineExtensionCharges', cls: 'slot-ext', icon: '⏳', label: 'Extension',
    desc: 'Adds extra days to a district\'s restoration deadline.' },
]

function slotDetailSheet(def, value, cellProgress) {
  const progressLine = cellProgress
    ? `<p class="muted"><b style="color:var(--text)">${cellProgress.remaining} more streams</b> in this district's Album Goals until your next cell.</p>`
    : ''
  return inertSheet(def.label, `
    <div style="font-size:38px; text-align:center; margin:10px 0;">${def.icon}</div>
    <p class="muted" style="text-align:center; font-family:var(--disp); font-size:20px; font-weight:800; color:var(--text);">${value}</p>
    <p class="muted">${esc(def.desc)}</p>
    ${progressLine}
  `)
}

// Type-specific hardware accent per compartment — real elements, not CSS
// pseudo-classes, since ::before/::after are already the corner brackets.
const SLOT_ACCENTS = {
  'slot-cell': () => `<span class="slot-accent slot-accent-cell"></span>`,
  'slot-wing': () => `<span class="slot-accent slot-accent-wing l"></span><span class="slot-accent slot-accent-wing r"></span>`,
  'slot-freeze': () => `<span class="slot-accent slot-accent-freeze"></span>`,
  'slot-ext': () => `<span class="slot-accent slot-accent-ext"></span>`,
}

function compartments(state) {
  const grid = el('div', 'bag-compartments')
  const cellProgress = state.activeDistrict?.chargeCellProgress
  for (const def of SLOT_DEFS) {
    const value = state.player[def.key] || 0
    const slot = el('button', `slot ${def.cls}`)
    slot.type = 'button'
    // Real progress data exists only for Charge Cells (activeDistrict.
    // chargeCellProgress) — every other resource has no "toward next"
    // number anywhere in the app, so no fill bar is drawn for them rather
    // than faking one.
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

function pocketDetailSheet(item) {
  const status = item.usedAt ? 'Used' : item.districtId ? `Kept at ${item.districtName}` : 'In Pack, ready to use'
  return inertSheet(item.name, `
    <div style="font-size:38px; text-align:center; margin:10px 0;">${itemArt(item)}</div>
    <p class="muted">${esc(item.blurb || '')}</p>
    <p class="muted"><b style="color:var(--text)">Status:</b> ${esc(status)}</p>
  `)
}

function frontPocket(state) {
  const wrap = el('div', 'bag-pocket')
  wrap.appendChild(el('span', 'pocket-seam-label', 'FRONT POCKET'))
  const grid = el('div', 'pocket-items')

  const backup = state.items.find((i) => i.itemId === 'backup-pass' && !i.usedAt)
  const backupSlot = el('button', 'pocket-slot' + (backup ? '' : ' is-locked'))
  backupSlot.type = 'button'
  backupSlot.innerHTML = `
    <span class="ps-icon">🤝</span>
    <span><span class="ps-name">Backup Pass</span><span class="ps-status">${backup ? 'Ready — tap to open' : '0 — earn one from a Supply Chest'}</span></span>
  `
  if (backup) backupSlot.onclick = () => showOverlay(pocketDetailSheet(backup))
  else backupSlot.disabled = true
  grid.appendChild(backupSlot)

  const tickets = state.items.filter((i) => i.kind === 'ticket')
  const ticketSlot = el('button', 'pocket-slot' + (tickets.length ? '' : ' is-locked'))
  ticketSlot.type = 'button'
  ticketSlot.innerHTML = `
    <span class="ps-icon">🎟️</span>
    <span><span class="ps-name">Tickets</span><span class="ps-status">${tickets.length ? `${tickets.length} ready` : 'None yet'}</span></span>
  `
  if (tickets.length) ticketSlot.onclick = () => showOverlay(pocketDetailSheet(tickets[0]))
  else ticketSlot.disabled = true
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

/* ── Lit Era Cards ────────────────────────────────────────────────────── */
function eraCardDetailSheet(card) {
  const status = card.status === 'lit' ? 'CARD ACTIVATED — READY TO USE'
    : card.status === 'used' ? 'Used this week'
    : `${card.done}/${card.total} tracks toward activation`
  return inertSheet(card.name, `
    <div style="font-size:38px; text-align:center; margin:10px 0;">${card.icon}</div>
    <p class="muted" style="text-align:center;">${esc(status)}</p>
  `)
}

function eraCards(state) {
  const cards = state.agentCharge?.eraCards || []
  if (!cards.length) return null
  const section = el('div', 'pv-section pv-after-bag')
  const ready = cards.filter((c) => c.status === 'lit').length
  const head = el('div', 'pv-section-head')
  head.innerHTML = `<span class="pv-section-title">Lit Era Cards</span><span class="pv-section-count">${ready} ready</span>`
  section.appendChild(head)

  const rack = el('div', 'era-pack-rack')
  const newlyLit = new Set(state.agentCharge?.newlyLitEraIds || [])
  for (const card of cards) {
    const button = el('button', `era-pack-card pv-era-card era-${card.status}${newlyLit.has(card.id) ? ' just-lit' : ''}`)
    button.type = 'button'
    const statusText = card.status === 'lit' ? 'READY' : card.status === 'used' ? 'USED' : `${card.done}/${card.total}`
    button.innerHTML = `
      <span class="epc-album-tag">ALBUM</span>
      <span class="epc-icon">${card.icon}</span>
      <span class="epc-name">${esc(card.name)}</span>
      <span class="epc-status epc-status-line">${statusText}</span>
      ${card.status === 'lit' ? '<i>USE</i>' : ''}
    `
    button.onclick = () => showOverlay(eraCardDetailSheet(card))
    rack.appendChild(button)
  }
  section.appendChild(rack)
  if (ready) section.appendChild(el('div', 'pv-era-ready-banner', 'CARD ACTIVATED · READY TO USE'))
  return section
}

/* ── Collectibles ─────────────────────────────────────────────────────── */
function collectibleDetailSheet(item) {
  const r = RARITY[item.rarity] || RARITY.common
  const where = item.districtId ? `Kept at ${item.districtName}` : 'In your Pack'
  return inertSheet(item.name, `
    <div style="font-size:38px; text-align:center; margin:10px 0;">${itemArt(item)}</div>
    <p class="muted" style="text-align:center;">${esc(r.label)} · ${esc(where)}</p>
    <p class="muted">${esc(item.blurb || '')}</p>
  `)
}

function collectibles(state) {
  const items = (state.items || []).filter((i) => i.itemId !== 'backup-pass' && i.kind !== 'ticket')
  const section = el('div', 'pv-section')
  const head = el('div', 'pv-section-head')
  head.innerHTML = `<span class="pv-section-title">Recovered Objects</span><span class="pv-section-count">${items.length}</span>`
  section.appendChild(head)
  const grid = el('div', 'collection-shelf')
  for (const item of items) {
    const r = RARITY[item.rarity] || RARITY.common
    const button = el('button', `collection-object ${r.cls}`)
    button.innerHTML = `
      <span class="co-art">${itemArt(item)}</span>
      <span class="co-name">${esc(item.name)}</span>
      <span class="co-meta"><i></i>${esc(r.label)}</span>
      <span class="co-place">${esc(item.districtId ? `Kept at ${item.districtName}` : 'In Pack')}</span>
    `
    button.onclick = () => showOverlay(collectibleDetailSheet(item))
    grid.appendChild(button)
  }
  section.appendChild(grid)
  return section
}

/* ── Quick access ─────────────────────────────────────────────────────── */
function quickAccess() {
  const section = el('div', 'pv-section')
  section.appendChild(el('div', 'pv-section-head', '<span class="pv-section-title">Collections</span>'))
  const wrap = el('div', 'pv-quick')
  const shop = el('button', 'pv-quick-link')
  shop.innerHTML = `<span class="ql-icon">🏪</span><span><span class="ql-name">Magic Shop</span><span class="ql-sub">Spend Wings on Charge Cells &amp; more</span></span><span class="ql-go">›</span>`
  shop.onclick = () => showOverlay(inertSheet('Magic Shop', '<p class="muted">Preview only — the real Magic Shop opens here unchanged.</p>'))
  const badges = el('button', 'pv-quick-link')
  badges.innerHTML = `<span class="ql-icon">🎖️</span><span><span class="ql-name">Badge Collection</span><span class="ql-sub">Current district, ward set &amp; unlocks</span></span><span class="ql-go">›</span>`
  badges.onclick = () => showOverlay(inertSheet('Badge Collection', '<p class="muted">Preview only — the real Badge Drawer opens here unchanged.</p>'))
  wrap.append(shop, badges)
  section.appendChild(wrap)
  return section
}

export function renderPackPreview(container) {
  container.innerHTML = ''
  const wrap = el('div', 'pv-wrap')
  wrap.appendChild(el('div', 'pv-note', 'PREVIEW BUILD — mock data, no backend calls'))
  wrap.appendChild(agentIdCard(MOCK_STATE))
  wrap.appendChild(agentBag(MOCK_STATE))
  const era = eraCards(MOCK_STATE)
  if (era) wrap.appendChild(era)
  wrap.appendChild(collectibles(MOCK_STATE))
  wrap.appendChild(quickAccess())
  container.appendChild(wrap)
}
