// One collectible, drawn the same way everywhere it appears: the Pack's
// Recovered Objects, a district's "Kept here" shelf, and the "Place
// something" picker. Art (items-art.js: real-cover sleeves for albums),
// name, rarity · era, where it is, and the weekly Collection XP chip.

import { el, esc } from './state.js'
import { itemArt, RARITY } from './items.js'
import { collectibleWeeklyXp } from '../supabase/functions/op-reconnect/lib/collectible-values.js'
import { collectionChip } from './collection-xp-ui.js'

/** Something you can keep on a shelf. Backup Passes (utility) are purely
 *  functional, so they never show on a shelf or in the picker. Concert and
 *  Tour tickets are keepsakes too: placeable whether used or not (using one
 *  leaves the stub), and still usable from their sheet or the Pack's front
 *  pocket. Tickets earn no Collection XP (collectible-values.js). */
export function isCollectible(item) {
  return !!item && item.kind !== 'utility' && item.itemId !== 'backup-pass'
}

/** Pack's Recovered Objects: collectibles minus tickets, which already have
 *  their own slot in the Pack's front pocket. */
export function isPackObject(item) {
  return isCollectible(item) && item.kind !== 'ticket'
}

/** What the chips need, worked out once per render: the copy of each
 *  collectible that counts (first one placed in a district this player
 *  restored; a second copy never adds), what's been paid this week. */
export function collectionContext(state) {
  const items = (state.items || []).filter(isCollectible)
  const restoredIds = new Set((state.map?.districts || []).filter((d) => d.status === 'restored').map((d) => d.id))
  const pick = new Map()
  for (const it of items) {
    if (!it.districtId || it.usedAt || !restoredIds.has(it.districtId) || pick.has(it.itemId)) continue
    if (collectibleWeeklyXp(it) > 0) pick.set(it.itemId, it.id)
  }
  const earning = new Set(pick.values())
  return {
    earning,
    countedIds: new Set(pick.keys()),
    earned: new Set(state.collection?.earnedItemIds || []),
    restoredIds,
    collection: state.collection || null,
  }
}

/**
 * @param item   the owned item
 * @param ctx    collectionContext(state)
 * @param opts.onPick     tap handler
 * @param opts.showPlace  show "Placed in …" (off on a district's own shelf)
 * @param opts.count      copies owned, for the picker ("×2")
 */
export function collectibleTile(item, ctx, opts = {}) {
  const rarity = RARITY[item.rarity] || RARITY.common
  const button = el('button', `collection-object ${rarity.cls}${item.usedAt ? ' is-used' : ''}`)
  button.type = 'button'
  // district_id is where the player placed it (the game doesn't record
  // where it was found), so the wording says placed, not found.
  const location = item.usedAt ? 'Used' : item.districtName ? `Placed in ${item.districtName}` : 'In your Pack'
  button.dataset.kind = item.kind || ''
  button.setAttribute('aria-label', `${item.name}. ${rarity.label}${item.era ? `, ${item.era}` : ''}${opts.showPlace === false ? '' : `. ${location}`}.`)
  // Weekly XP chip (collection-xp-ui.js): potential, locked, or earned —
  // never a number that reads as already paid unless it was.
  const weekly = collectibleWeeklyXp(item)
  const isEarning = !!ctx?.earning?.has(item.id)
  const where = !item.districtId ? 'pack' : ctx?.restoredIds?.has(item.districtId) ? 'restored' : 'unowned'
  const chipState = item.usedAt ? null : collectionChip(weekly, where, !isEarning && !!ctx?.countedIds?.has(item.itemId), isEarning && !!ctx?.earned?.has(item.itemId), ctx?.collection)
  const chip = chipState ? `<span class="co-xp is-${chipState.state}">${esc(chipState.text)}</span>` : ''
  const count = opts.count > 1 ? `<span class="co-count">×${opts.count}</span>` : ''
  button.innerHTML = `
    <span class="co-art">${itemArt(item)}${chip}${count}</span>
    <span class="co-name">${esc(item.name)}</span>
    <span class="co-meta"><span class="co-rarity">${esc(rarity.label)}</span>${item.era && item.era.toLowerCase() !== String(item.name || '').toLowerCase() ? `<span class="co-era">${esc(item.era)}</span>` : ''}</span>
    ${opts.showPlace === false ? '' : `<span class="co-place">${esc(location)}</span>`}
  `
  if (opts.onPick) button.onclick = () => opts.onPick(item)
  return button
}
