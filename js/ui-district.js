// District mission board + restoration cascade — shared by screen-district.js
// for the currently-active district. The scene/stage shell itself now lives
// in screen-district.js, since every district status (not just "active") gets
// its own full screen there.

import { el, esc, showOverlay, hideOverlay, getState } from './state.js'
import { openPlaylist, remaining } from './playlist.js'

/** Overall restoration fraction (0..1) driving the scene's lights. */
export function districtFraction(d) {
  if (!d) return 0
  let got = 0, need = 0
  for (const g of d.trackGoals || []) { got += Math.min(g.progress, g.target); need += g.target }
  if (d.album) { got += Math.min(d.album.passesDone, d.album.target); need += d.album.target }
  return need === 0 ? 0 : Math.max(0, Math.min(1, got / need))
}

/** One "stream this, n of m times" row — the whole game's core loop in a
 *  single component. Flat and identical for tracks and album passes, because
 *  that's the one thing a player checks every day and it should never take
 *  more than a glance. */
function goalRow(label, sub, progress, target, done, unit) {
  const pct = Math.min(100, Math.round((progress / Math.max(1, target)) * 100))
  const row = el('div', 'goal-row' + (done ? ' done' : ''))
  row.innerHTML = `
    <div class="gr-top">
      <span class="gr-name">${esc(label)}</span>
      <span class="gr-count">${done ? '✓ done' : `${progress}<i>/${target}</i>`}</span>
    </div>
    <div class="gr-bar"><div class="gr-fill${done ? ' done' : ''}" style="width:${pct}%"></div></div>
    ${sub ? `<div class="gr-sub">${sub}</div>` : ''}
  `
  if (unit && !done) row.querySelector('.gr-count').insertAdjacentHTML('beforeend', ` <i>${unit}</i>`)
  return row
}

export function renderBoard(board, d) {
  board.innerHTML = ''

  const goals = [...(d.trackGoals || [])]
  const doneCount = goals.filter((g) => g.done).length + (d.album?.done ? 1 : 0)
  const totalCount = goals.length + (d.album ? 1 : 0)

  const head = el('div', 'board-head')
  head.innerHTML = `
    <span class="board-title">Today's targets</span>
    <span class="board-count${doneCount === totalCount ? ' all' : ''}">${doneCount}/${totalCount} done</span>
  `
  board.appendChild(head)

  // The queue belongs here too — this is the screen you're on when you're
  // about to go stream.
  const left = remaining({ activeDistrict: d })
  if (left.length) {
    const q = el('button', 'queue-btn', `🎧 Build today's queue <i>${left.reduce((a, x) => a + x.need, 0)} plays left</i>`)
    q.onclick = () => showOverlay(openPlaylist(getState() || { activeDistrict: d }))
    board.appendChild(q)
  }

  const card = el('div', 'card goal-card')
  for (const g of goals) {
    card.appendChild(goalRow(g.label, '', g.progress, g.target, g.done, 'plays'))
  }
  if (d.album) {
    const a = d.album
    const sub = a.done || !a.nextPassTracks?.length ? ''
      : `Still need ${a.nextPassTracks.slice(0, 3).map((t) => `${esc(t.label)} ×${t.need}`).join(' · ')}`
    card.appendChild(goalRow(`💿 ${a.label}`, sub, a.passesDone, a.target, a.done, 'passes'))
  }
  board.appendChild(card)

  // Secondary missions — real, but not what the player came here to read.
  const extras = (d.missions || []).filter((m) => m.id === 'signal' || m.id === 'intel')
  if (extras.length) {
    const row = el('div', 'sub-missions')
    for (const m of extras) {
      const locked = m.status === 'locked'
      const val = m.id === 'signal' ? `${Math.min(100, m.progress)}%` : `${m.progress}/${m.required}`
      row.appendChild(el('div', 'sub-mission' + (locked ? ' locked' : '') + (m.status === 'done' ? ' done' : ''), `
        <span class="sm-icon">${locked ? '🔒' : m.icon}</span>
        <span class="sm-label">${esc(m.label)}</span>
        <span class="sm-val">${val}</span>`))
    }
    board.appendChild(row)
  }

  if (d.files?.length) {
    const filesRow = el('div', 'files-row')
    for (const f of d.files) {
      const chip = el('button', 'file-chip' + (f.revealed ? ' revealed' : ''),
        f.revealed ? `📂 ${esc(f.title)}` : '🔒 Encrypted')
      if (f.revealed) chip.onclick = () => openFile(f)
      else chip.disabled = true
      filesRow.appendChild(chip)
    }
    board.appendChild(filesRow)
  }
}

function openFile(f) {
  const sheet = el('div', 'sheet')
  sheet.append(
    el('div', 'eyebrow', 'CLASSIFIED FILE'),
    el('h3', '', esc(f.title)),
    el('div', 'file-body', esc(f.body || '')),
  )
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  showOverlay(sheet)
}

// The restoration moment now lives in celebrate.js — it needs the district's
// own scene to relight, which a plain sheet couldn't do.
