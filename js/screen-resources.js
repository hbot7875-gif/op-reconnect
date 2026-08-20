// Agent Pack — currencies and things the agent owns. Nothing else.
//
// Used to read as a second navigation menu: six full-width cards (Agent
// Manual, The 148 Protocol, Badge Drawer, Weekly Mission Board, Magic Shop,
// Personal Charge) plus a top row of three passive lifetime counters. Every
// tool moved to the screen where it's actually used instead of sitting
// behind a second tap here:
//   - Agent Manual → Settings ("How to Play", screen-settings.js)
//   - Weekly Mission Board → the district screen (ui-district.js)
//   - The 148 Protocol → the district screen, as "Build today's stream
//     queue" (ui-district.js) — it's an action for finishing goals, not
//     inventory
//   - Personal Charge → tapping the ARMY Bomb itself on the World screen
//     (screen-world.js's coreBlock)
// Badge Drawer and Magic Shop are the two things that don't belong on any
// other screen, so they stay here as Quick Access.
//
// Signal/Fuel/Intel are gone too — three passive lifetime totals nobody
// ever spent, whose own descriptions had drifted false: Fuel claimed to
// power the ARMY Bomb (Charge Cells do that now), Signal claimed to
// reconnect districts (goal completion does that directly), Intel mentioned
// unlocking memories (removed from the game entirely). The underlying
// numbers still exist server-side as history, but no longer compete for
// space with an agent's actual inventory.
//
// What's left is exactly two things: a wallet of currencies that actually
// get spent (Charge Cells, Wings, Streak Freezes, Deadline Extensions), and
// the collectibles the agent owns. Tickets are deliberately NOT in the wallet row — a claimed
// ticket is a one-time unlock, not a currency earned repeatedly, so it
// shows up as a usable object on the collection shelf instead (see items.js).

import { el, esc, showOverlay } from './state.js'
import { badgeDrawerSheet } from './badge-drawer.js'
import { magicShopSheet } from './magic-shop.js'
import { itemArt, itemSheet, RARITY } from './items.js'
import { agentChargeSheet } from './agent-charge.js'

function walletTile(icon, value, label) {
  return el('div', 'wallet-tile', `
    <span class="wt-icon">${icon}</span>
    <span class="wt-val">${value.toLocaleString()}</span>
    <span class="wt-label">${esc(label)}</span>
  `)
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

export function renderResources(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'res-screen')

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">🎒 Agent Pack</span>
  `))

  // ── Wallet — balances that are actually spent ──
  const p = state?.player || {}
  const wallet = el('div', 'wallet-row')
  wallet.append(
    walletTile('⚡', p.chargeCells || 0, 'Charge Cells'),
    walletTile('🪽', p.wings || 0, 'Wings'),
    walletTile('🧊', p.streakFreezeCharges || 0, 'Streak Freezes'),
    walletTile('⏳', p.deadlineExtensionCharges || 0, 'Deadline Extensions'),
  )
  wrap.appendChild(wallet)
  // Backup Pass is a real Supply Chest drop, but it only ever showed up in
  // Pack once you already owned one — a player who'd never gotten one had
  // no way to even discover the mechanic exists. Shown here regardless of
  // count, same as the wallet tiles above, instead of purely inventory-
  // driven like the collectible grid below.
  const items0 = state.items || []
  const backupItem = items0.find((i) => i.itemId === 'backup-pass' && !i.usedAt)
  const backupTile = el('button', 'backup-pass-tile' + (backupItem ? '' : ' is-locked'))
  backupTile.type = 'button'
  backupTile.innerHTML = backupItem
    ? `<span class="bpt-icon">🤝</span><span class="bpt-name">Backup Pass</span><span class="bpt-status">Ready — tap to open</span>`
    : `<span class="bpt-icon">🤝</span><span class="bpt-name">Backup Pass</span><span class="bpt-status muted">0 — earned from a Supply Chest</span>`
  if (backupItem) backupTile.onclick = () => showOverlay(itemSheet(backupItem))
  else backupTile.disabled = true
  wrap.appendChild(backupTile)

  const cellProgress = state?.activeDistrict?.chargeCellProgress
  if (cellProgress) {
    wrap.appendChild(el('div', 'pack-cell-progress', `
      <span>Next Cell</span>
      <b>${cellProgress.streams}/${cellProgress.required}</b>
      <i>${cellProgress.remaining} more Album Goal stream${cellProgress.remaining === 1 ? '' : 's'}</i>
    `))
  }

  // Weekly emergency power is inventory, not a passive stat. Lit cards wait
  // here until deliberately used; dark cards show the shortest route to the
  // next activation, and spent cards stay visible until Monday's reset.
  const eraCards = state?.agentCharge?.eraCards || []
  if (eraCards.length) {
    const ready = eraCards.filter((e) => e.status === 'lit').length
    const newlyLit = new Set(state?.agentCharge?.newlyLitEraIds || [])
    wrap.appendChild(el('div', 'pack-section era-pack-head', `
      <span class="ps-title">Lit Era Cards</span>
      <span class="ps-count">${ready} ready · reset Monday</span>
    `))
    const rack = el('div', 'era-pack-rack')
    for (const card of eraCards) {
      const button = el('button', `era-pack-card era-${card.status}${newlyLit.has(card.id) ? ' just-lit' : ''}`)
      button.type = 'button'
      const status = card.status === 'lit' ? '+10H READY'
        : card.status === 'used' ? 'USED'
        : `${card.done}/${card.total}`
      button.setAttribute('aria-label', `${card.name}. ${status}.`)
      button.innerHTML = `
        <span class="epc-icon">${card.icon}</span>
        <span class="epc-name">${esc(card.name)}</span>
        <span class="epc-status">${status}</span>
        ${card.status === 'lit' ? '<i>USE</i>' : ''}
      `
      button.onclick = () => showOverlay(agentChargeSheet(card.id))
      rack.appendChild(button)
    }
    wrap.appendChild(rack)
    wrap.appendChild(el('p', 'era-pack-note', 'Complete every track in an era this week to activate its card. Use only when your ARMY Bomb needs emergency power.'))
  }

  // ── Merch and one-time unlocks ──
  const items = state.items || []
  const inPack = items.filter((i) => !i.districtId).length
  const placed = items.length - inPack

  wrap.appendChild(el('div', 'pack-section', `
    <span class="ps-title">Merch &amp; Tickets</span>
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

  // ── Quick access — the two things that don't live anywhere else ──
  const quick = el('div', 'quick-links')
  const shop = el('button', 'quick-link')
  shop.innerHTML = '<span class="ql-icon">🏪</span><span class="ql-name">Magic Shop</span><span class="ql-go">›</span>'
  shop.onclick = () => showOverlay(magicShopSheet())
  const badges = el('button', 'quick-link')
  badges.innerHTML = '<span class="ql-icon">🎖️</span><span class="ql-name">Badge Drawer</span><span class="ql-go">›</span>'
  badges.onclick = () => showOverlay(badgeDrawerSheet(state))
  quick.append(shop, badges)
  wrap.appendChild(quick)

  container.appendChild(wrap)
}
