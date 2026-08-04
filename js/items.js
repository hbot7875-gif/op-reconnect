// Collectibles — the things you keep in a district.
//
// Every item is drawn, not photographed: stylised SVG in the game's own
// palette, same approach as the landmarks. That keeps the look consistent,
// needs no asset pipeline, and keeps these clearly as fan-made replicas
// rather than product shots. Nothing here is ever sold.
//
// Art is keyed by KIND, not by item id, so the catalogue can grow in the
// database (INSERT-only) without a code change — a new album is a new row,
// and it draws itself.

import { el, esc, hideOverlay, toast, getState, setState } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { itemArt } from './items-art.js'

export { itemArt }

export const RARITY = {
  common: { label: 'Common', cls: 'r-common' },
  rare: { label: 'Rare', cls: 'r-rare' },
  legendary: { label: 'Legendary', cls: 'r-legendary' },
}

/** One collectible, as a card.
 *
 *  Deliberately NOT a picture of the object. A crude vector rug looks like a
 *  crude vector rug; a card with a foil edge, an era line and a rarity strip
 *  looks like something worth owning — and it's the format ARMY already
 *  collects. Presentation carries the value, so the art can stay a small
 *  glyph and every future item costs nothing to make look good. */
export function itemTile(item, onPick) {
  const r = RARITY[item.rarity] || RARITY.common
  const t = el('button', `item-card ${r.cls}${item.usedAt ? ' is-used' : ''}`)
  t.setAttribute('aria-label', `${item.name}. ${r.label}${item.usedAt ? '. Used' : ''}.`)
  t.innerHTML = `
    <span class="ic-foil"></span>
    <span class="ic-top">
      <span class="ic-era">${esc(item.era || '')}</span>
      ${item.usedAt ? '<span class="ic-stub">stub</span>' : ''}
    </span>
    <span class="ic-glyph">${itemArt(item)}</span>
    <span class="ic-name">${esc(item.name)}</span>
    <span class="ic-rarity">${esc(r.label)}</span>
  `
  t.onclick = () => onPick(item)
  return t
}

/* ── moving things around ─────────────────────────────────────────────── */

async function moveItem(item, districtId, districtName = '') {
  const state = getState()
  // Optimistic: the shelf should respond instantly, it's a tiny action.
  const list = state.items || []
  const hit = list.find((x) => x.id === item.id)
  if (hit) { hit.districtId = districtId; hit.districtName = districtId ? districtName : null }
  setState({ ...state, items: [...list] })

  const res = await call('placeItem', {
    agentNo: getAgentNo(), playerItemId: item.id, districtId,
  })
  if (!res?.success) toast(res?.error || 'Could not move that — it may bounce back')
}

/** Detail sheet: what it is, where it lives, and what you can do with it. */
export function itemSheet(item, opts = {}) {
  const { districtId = null, districtName = '' } = opts
  const r = RARITY[item.rarity] || RARITY.common
  const sheet = el('div', `sheet item-sheet ${r.cls}`)

  sheet.appendChild(el('div', 'is-art', itemArt(item)))
  sheet.appendChild(el('div', 'is-rarity', esc(r.label)))
  sheet.appendChild(el('div', 'is-name', esc(item.name)))
  if (item.blurb) sheet.appendChild(el('p', 'muted is-blurb', esc(item.blurb)))

  const where = item.districtId
    ? `Kept at ${esc(item.districtName || 'a district')}`
    : 'In your Pack'
  sheet.appendChild(el('div', 'is-where', item.usedAt ? 'Used — the stub stays with you' : where))

  // A ticket is the reason the whole system exists.
  if (item.kind === 'ticket' && !item.usedAt) {
    const go = el('button', 'btn btn-primary', '🎫 Use the ticket')
    go.onclick = () => { hideOverlay(); useTicket(item) }
    sheet.appendChild(go)
  }

  if (districtId && item.districtId !== districtId) {
    const place = el('button', 'btn btn-primary', `Keep it at ${esc(districtName)}`)
    place.onclick = async () => { hideOverlay(); await moveItem(item, districtId, districtName); toast(`Placed at ${districtName}`) }
    sheet.appendChild(place)
  }
  if (item.districtId) {
    const back = el('button', 'btn btn-ghost', 'Back to Pack')
    back.onclick = async () => { hideOverlay(); await moveItem(item, null); toast('Moved to your Pack') }
    sheet.appendChild(back)
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/* ── the ticket ───────────────────────────────────────────────────────── */

export function useTicket(item) {
  const state = getState()
  const list = state.items || []
  const hit = list.find((x) => x.id === item.id)
  if (hit) hit.usedAt = new Date().toISOString()
  setState({ ...state, items: [...list] })

  // Fired, not awaited — the concert should feel instant, not wait on a round
  // trip. But a redemption the backend actually rejects still needs to be
  // seen: undo the optimistic mark and say so, rather than leaving a ticket
  // that looks spent when it wasn't.
  call('useItem', { agentNo: getAgentNo(), playerItemId: item.id }).then((res) => {
    if (res?.success) return
    const s = getState()
    const h = (s.items || []).find((x) => x.id === item.id)
    if (h) h.usedAt = null
    setState({ ...s, items: [...(s.items || [])] })
    toast(res?.error || "Couldn't confirm that ticket — check your Pack")
  })

  // concert_voyage.js is self-contained — it builds its own overlay, styles
  // and player, and needs nothing from app.js.
  if (typeof window.launchTheVoyage === 'function') {
    window.launchTheVoyage()
    return
  }
  const s = el('div', 'sheet')
  s.appendChild(el('div', 'eyebrow', 'DOORS OPEN'))
  s.appendChild(el('h3', '', 'The concert needs its script'))
  s.appendChild(el('p', 'muted', 'Add concert_voyage.js to this page and the ticket runs the show. The stub is yours either way.'))
  const c = el('button', 'btn btn-ghost', 'Close')
  c.onclick = hideOverlay
  s.appendChild(c)
  return s
}

/* ── helpers ──────────────────────────────────────────────────────────── */

export const itemsAt = (state, districtId) =>
  (state.items || []).filter((i) => i.districtId === districtId)

export const itemsInPack = (state) =>
  (state.items || []).filter((i) => !i.districtId)
