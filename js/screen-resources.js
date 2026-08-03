// Agent Pack — what you're carrying, and the tools that use it.
//
// The loop this screen closes:
//   BOTZ shows what you actually listened to → Candy Star builds the playlist
//   → the map shows where that effort went.
//
// Three tools, and they are NOT interchangeable:
//   · Today's Queue  in-game text list of what this district still needs.
//                    Derived from state, no backend. Good offline, good for
//                    people who queue by hand.
//   · Candy Star     the real generator — an actual Spotify playlist from the
//                    current goals, ported onto this project's own backend
//                    (lib/candy-star.ts, migration 030). Wired up, but the
//                    catalog + filler library it reads start EMPTY on this
//                    project until an admin runs the catalog-refresh/import
//                    actions from candy-star-admin.html — see screen-candystar.js.
//   · BOTZ           the listening page — now playing and what the network
//                    has heard from you. This is WHERE STREAMS ARE TRACKED,
//                    not a report about them. It lives in this project now
//                    (botz.html), reading getSignalLog off this backend.
//
// Every tap here stays inside this deployment. Nothing links out to the old
// arirang site — that's a separate deployment with separate accounts, so a
// relative path to it resolves to nothing.

import { el, esc, showOverlay } from './state.js'
import { getAgentNo } from './session.js'
import { goCandyStar } from './router.js'
import { openPlaylist } from './playlist.js'
import { resourceRow, resourceSheet } from './resources.js'
import { itemTile, itemSheet, itemsInPack } from './items.js'

const TOOLS = [
  {
    icon: '🎧',
    name: "Today's Queue",
    tag: 'In game · what to play',
    body: 'Reads what this district still needs and lists the play order, spaced so no track runs back to back. Copy it and queue it yourself.',
    action: (state) => showOverlay(openPlaylist(state)),
  },
  {
    icon: '🍬',
    name: 'Candy Star Generator',
    tag: 'Make an alpaca 🦙',
    body: 'Builds a real Spotify playlist around the current goals, woven with enough variety it plays like a real mix instead of one song on loop.',
    action: (_state, e) => goCandyStar(e ? { x: e.clientX, y: e.clientY } : null),
  },
  {
    icon: '📻',
    name: 'BOTZ',
    tag: 'In game · your listening page',
    body: 'Where your streams are tracked. Now playing and everything the network has heard from you recently.',
    href: () => {
      const no = getAgentNo()
      return 'botz.html' + (no ? `?agent=${encodeURIComponent(no)}` : '')
    },
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

  const foot = el('div', 'pack-foot')
  foot.innerHTML = 'BOTZ runs inside the game now. If Candy Star says the '
    + "catalog isn't ready yet, that's expected until an admin refreshes it "
    + '— not a bug.'
  wrap.appendChild(foot)

  container.appendChild(wrap)
}
