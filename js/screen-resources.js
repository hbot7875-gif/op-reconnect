// Agent Pack — what you're carrying, and the one tool that lives here.
//
// Candy Star, BOTZ and Rankings used to be cards in this list too — one tap
// to get here, a second to actually reach the tool. They're bottom tabs now
// (ui-hud.js), reachable directly from every screen instead of nested behind
// Pack. The 148 Protocol (formerly "Today's Queue") stays: it's derived from
// state with no backend call, which makes it feel more like part of what's
// in the pack than a destination the way the other three are.
//
// Every tap here stays inside this deployment. Nothing links out to the old
// arirang site — that's a separate deployment with separate accounts, so a
// relative path to it resolves to nothing.

import { el, esc, showOverlay } from './state.js'
import { openPlaylist } from './playlist.js'
import { badgeDrawerSheet } from './badge-drawer.js'
import { missionBoardSheet } from './mission-board.js'
import { resourceRow, resourceSheet } from './resources.js'
import { itemTile, itemSheet, itemsInPack } from './items.js'

const TOOLS = [
  {
    icon: '🧠',
    name: 'The 148 Protocol',
    tag: 'Strategic briefing · what to stream today',
    body: 'Reads what this district still needs and lays out the play order, spaced so no track runs back to back. Copy it and queue it yourself.',
    action: (state) => showOverlay(openPlaylist(state)),
  },
  {
    icon: '🎖️',
    name: 'Badge Drawer',
    tag: 'Your collection',
    body: "Every badge you've earned, and the ones still waiting to unlock.",
    action: (state) => showOverlay(badgeDrawerSheet(state)),
  },
  {
    icon: '📋',
    name: 'Weekly Mission Board',
    tag: 'All three district missions, together',
    body: 'Track Goals, Album Goals, and this run\'s Reconnect Mission — one board instead of hunting for each inside the district itself.',
    action: (state) => showOverlay(missionBoardSheet(state)),
  },
]

export function renderResources(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'res-screen')

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">🎒 Agent Pack</span>
    <span class="pack-name">${esc(state?.player?.codename || 'Agent')}</span>
  `))

  wrap.appendChild(resourceRow(state, (r, v) => showOverlay(resourceSheet(r, v))))
  wrap.appendChild(el('div', 'pack-hint', 'Tap a resource to see what it does.'))

  // Everything you're carrying but haven't put anywhere yet.
  const spare = itemsInPack(state)
  const total = (state.items || []).length
  wrap.appendChild(el('div', 'pack-section', `
    <span class="ps-title">BTS Merch Earned</span>
    <span class="ps-count">${spare.length} of ${total} unplaced</span>
  `))
  if (spare.length) {
    const grid = el('div', 'shelf-grid')
    for (const it of spare) grid.appendChild(itemTile(it, (item) => showOverlay(itemSheet(item))))
    wrap.appendChild(grid)
    wrap.appendChild(el('div', 'dim pack-hint', 'Open a restored district to keep something there.'))
  } else {
    wrap.appendChild(el('div', 'dim pack-hint', total
      ? 'Everything you own is placed. Nice house.'
      : 'Restore a district to find your first thing worth keeping.'))
  }

  const list = el('div', 'res-list')
  for (const t of TOOLS) {
    const card = el(t.href ? 'a' : 'button', 'res-card' + (t.action ? ' is-action' : ''))
    if (t.href) card.href = t.href()
    card.innerHTML = `
      <span class="res-icon">${t.icon}</span>
      <span class="res-main">
        <span class="res-name">${esc(t.name)}</span>
        <span class="res-tag">${esc(t.tag)}</span>
        <span class="res-body">${esc(t.body)}</span>
      </span>
      <span class="res-go">${t.action ? '▸' : '→'}</span>
    `
    if (t.action) card.onclick = (e) => t.action(state, e)
    list.appendChild(card)
  }
  wrap.appendChild(list)

  container.appendChild(wrap)
}
