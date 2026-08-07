// Weekly Mission Board — the three missions every active district already
// carries (track goals, album goals, one reconnect goal), shown together as
// a named board rather than only visible piecemeal inside the district's
// own screen. No new data model: this reads exactly what ui-district.js
// already reads off state.activeDistrict.

import { el, esc, hideOverlay } from './state.js'
import { RECONNECT_LABELS } from './ui-district.js'
import { districtDisplayName } from './ward-tiles.js'

function missionRow(icon, title, sub, done, total, extra) {
  const row = el('div', 'mb-row' + (total > 0 && done >= total ? ' done' : ''))
  row.innerHTML = `
    <span class="mb-icon">${icon}</span>
    <span class="mb-main">
      <span class="mb-title">${esc(title)}</span>
      <span class="mb-sub">${esc(sub)}</span>
    </span>
    <span class="mb-count">${extra || `${done}/${total}`}</span>
  `
  return row
}

export function missionBoardSheet(state) {
  const sheet = el('div', 'sheet mission-board')
  sheet.appendChild(el('div', 'eyebrow', '📋 WEEKLY MISSION BOARD'))
  const d = state.activeDistrict

  if (!d) {
    sheet.appendChild(el('p', 'muted', 'Open a district to see its missions here.'))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return sheet
  }

  sheet.appendChild(el('div', 'pl-title', esc(districtDisplayName(d))))

  const board = el('div', 'mb-list')

  const tracks = d.trackGoals || []
  const tracksDone = tracks.filter((g) => g.done).length
  board.appendChild(missionRow('🎵', 'Mission 1 — Track Goals', 'Complete every track goal in this district',
    tracksDone, tracks.length, tracks.length ? null : 'None here'))

  const albums = d.albums || []
  const albumsDone = albums.filter((a) => a.done).length
  board.appendChild(missionRow('💿', 'Mission 2 — Album Goals', 'Complete every album pass in this district',
    albumsDone, albums.length, albums.length ? null : 'None here'))

  const r = d.reconnect
  if (r) {
    const label = RECONNECT_LABELS[r.variant] || 'ReConnect'
    board.appendChild(missionRow('🤝', 'Mission 3 — ReConnect Mission', label,
      r.done ? 1 : 0, 1, r.done ? 'Done' : 'In progress'))
  } else {
    board.appendChild(missionRow('🤝', 'Mission 3 — ReConnect Mission', 'No ReConnect goal assigned this run', 0, 0, 'None here'))
  }

  sheet.appendChild(board)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
