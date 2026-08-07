// Badge Drawer — a trophy case, not a leaderboard. No ranks, no XP battle,
// no comparison to anyone else's collection: just a grid of what you've
// unlocked and what's still waiting, styled as a gamified reveal rather
// than a stats table.

import { call } from './api.js'
import { el, esc, hideOverlay, setState, toast } from './state.js'
import { BADGE_CATALOG } from './badges.js'
import { getAgentNo } from './session.js'

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
    const wearing = state.player?.equippedBadgeId === b.id
    const tile = el('button', 'bdr-tile' + (got ? ' got' : ' locked') + (wearing ? ' equipped' : ''), `<span class="bdr-icon">${got ? b.icon : '?'}</span>${wearing ? '<i>WORN</i>' : ''}`)
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
      if (got) {
        const wear = el('button', 'btn btn-primary bdr-wear', wearing ? 'Wearing as Agent Icon' : 'Wear as Agent Icon')
        wear.disabled = wearing
        wear.onclick = async () => {
          wear.disabled = true
          const res = await call('setEquippedBadge', { agentNo: getAgentNo(), badgeId: b.id })
          if (!res.success) { toast(res.error === 'badge_locked' ? 'That badge is still locked' : (res.error || "Couldn't equip badge")); wear.disabled = false; return }
          setState({ ...state, player: { ...state.player, equippedBadgeId: b.id } })
          toast(`${b.name} is now your Agent Icon`)
          hideOverlay()
        }
        detail.appendChild(wear)
      }
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
