// Badge Drawer — a trophy case, not a leaderboard. No ranks, no XP battle,
// no comparison to anyone else's collection: just a grid of what you've
// unlocked and what's still waiting, styled as a gamified reveal rather
// than a stats table.

import { el, esc, hideOverlay } from './state.js'
import { BADGE_CATALOG } from './badges.js'

export function badgeDrawerSheet(state) {
  const sheet = el('div', 'sheet badge-drawer')
  sheet.appendChild(el('div', 'eyebrow', '🎖️ BADGE DRAWER'))
  sheet.appendChild(el('div', 'pl-sub', 'Your collection'))

  const earned = BADGE_CATALOG.filter((b) => b.earned(state))
  sheet.appendChild(el('div', 'bdr-count', `${earned.length} of ${BADGE_CATALOG.length} unlocked`))

  const detail = el('div', 'bdr-detail')
  detail.hidden = true

  const grid = el('div', 'bdr-grid')
  for (const b of BADGE_CATALOG) {
    const got = b.earned(state)
    const tile = el('button', 'bdr-tile' + (got ? ' got' : ' locked'), `<span class="bdr-icon">${got ? b.icon : '?'}</span>`)
    tile.setAttribute('aria-label', got ? b.name : 'Locked badge')
    tile.onclick = () => {
      detail.hidden = false
      // Re-trigger the pop animation even if the same tile is tapped twice.
      detail.classList.remove('pop')
      void detail.offsetWidth
      detail.classList.add('pop')
      detail.innerHTML = got ? `
        <span class="bdr-detail-icon">${b.icon}</span>
        <div class="bdr-detail-name">${esc(b.name)}</div>
        <div class="bdr-detail-desc">${esc(b.desc)}</div>
      ` : `
        <span class="bdr-detail-icon">🔒</span>
        <div class="bdr-detail-name">Locked</div>
        <div class="bdr-detail-desc">Keep going, agent — this one hasn't unlocked yet.</div>
      `
    }
    grid.appendChild(tile)
  }
  sheet.appendChild(grid)
  sheet.appendChild(detail)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
