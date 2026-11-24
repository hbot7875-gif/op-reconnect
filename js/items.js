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
import { openBackupPassFlow } from './backup-pass.js'

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

/** Put an owned item on a district's shelf (or back in the Pack with
 *  districtId null). Exported for the "Place something" picker. */
export const CORNER_FULL_MSG = "Your ARMY's Corner is full! Try another district or move an item to your Pack."

export async function moveItem(item, districtId, districtName = '') {
  const state = getState()
  // Optimistic: the shelf should respond instantly, it's a tiny action.
  const list = state.items || []
  const hit = list.find((x) => x.id === item.id)
  const before = hit ? { districtId: hit.districtId, districtName: hit.districtName } : null
  if (hit) { hit.districtId = districtId; hit.districtName = districtId ? districtName : null }
  setState({ ...state, items: [...list] })

  const res = await call('placeItem', {
    agentNo: getAgentNo(), playerItemId: item.id, districtId,
  })
  if (!res?.success) {
    // Put it back where it was: the server said no.
    if (hit && before) { Object.assign(hit, before); const now = getState(); setState({ ...now, items: [...(now.items || [])] }) }
    toast(res?.error === 'district_full' ? CORNER_FULL_MSG
      : res?.error === 'not_placeable' ? 'Backup Passes stay in your Pack — use them from there.'
      : (res?.error || 'Could not move that — it may bounce back'))
    return false
  }
  // Placing can earn this week's collection XP (collectible-rewards.ts runs
  // on the next game state), so fetch it now instead of waiting for a poll.
  const fresh = await call('getGameState', { agentNo: getAgentNo() })
  if (fresh?.success) setState(fresh)
  return true
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
    ? `Placed in ${esc(item.districtName || 'a district')}`
    : 'In your Pack'
  sheet.appendChild(el('div', 'is-where', item.usedAt ? 'Used — the stub stays with you' : where))

  // A ticket is the reason the whole system exists.
  if (item.kind === 'ticket' && !item.usedAt) {
    const go = el('button', 'btn btn-primary', '🎫 Use the ticket')
    go.onclick = () => { hideOverlay(); useTicket(item) }
    sheet.appendChild(go)
  }

  // Backup Pass had a backend all along (open/join/close/complete) with no
  // way to ever reach it — this is that missing door.
  if (item.itemId === 'backup-pass' && !item.usedAt) {
    const go = el('button', 'btn btn-primary', '🤝 Open to a helper')
    go.onclick = () => { hideOverlay(); openBackupPassFlow(item) }
    sheet.appendChild(go)
  }

  if (districtId && item.districtId !== districtId) {
    const place = el('button', 'btn btn-primary', `Keep it at ${esc(districtName)}`)
    place.onclick = async () => { hideOverlay(); if (await moveItem(item, districtId, districtName)) toast(`Placed at ${districtName}`) }
    sheet.appendChild(place)
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  // Taking it off the shelf sits last, as a small action, and asks twice:
  // it used to be the first full-width button, right where Close is
  // expected, so a quick tap moved the item without meaning to.
  if (item.districtId) {
    const back = el('button', 'is-move-pack', 'Move to Pack')
    back.type = 'button'
    let armed = null
    back.onclick = async () => {
      if (!armed) {
        back.textContent = 'Tap again to move it to your Pack'
        back.classList.add('is-armed')
        armed = setTimeout(() => { armed = null; back.textContent = 'Move to Pack'; back.classList.remove('is-armed') }, 3500)
        return
      }
      clearTimeout(armed)
      hideOverlay()
      await moveItem(item, null)
      toast('Moved to your Pack')
    }
    sheet.appendChild(back)
  }
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
