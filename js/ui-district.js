// District mission board + restoration cascade — shared by screen-district.js
// for the currently-active district. The scene/stage shell itself now lives
// in screen-district.js, since every district status (not just "active") gets
// its own full screen there.

import { el, esc, showOverlay, hideOverlay, getState } from './state.js'
import { openPlaylist, remaining, dailyPace } from './playlist.js'
import { missionBoardSheet } from './mission-board.js'

/** Overall restoration fraction (0..1) driving the scene's lights. */
export function districtFraction(d) {
  if (!d) return 0
  let got = 0, need = 0
  for (const g of d.trackGoals || []) { got += Math.min(g.progress, g.target); need += g.target }
  for (const a of d.albums || []) { got += Math.min(a.passesDone, a.target); need += a.target }
  return need === 0 ? 0 : Math.max(0, Math.min(1, got / need))
}

export const RECONNECT_LABELS = {
  sotd: '🎵 Song of the Day', cipher: '🔐 Cipher', memory: '📖 Memory Fragment',
  connect: '🤝 Connect', invite: '📡 Invite Backup',
}

/** Compact status tile for the district's reconnect goal, if it has one —
 *  display only. The interactive part (submitting a guess, opening/joining
 *  a mission, inviting someone) lives in screen-district.js's active-board
 *  panel; this is just "where do things stand" for the checklist glance. */
function reconnectRow(r) {
  const label = RECONNECT_LABELS[r.variant] || 'ReConnect'
  const row = el('div', 'goal-row reconnect-row' + (r.done ? ' done' : ''))
  const status = r.done ? '✓ done'
    : r.mission ? `${r.mission.participants.filter((p) => p.status === 'joined').length}<i>/${r.mission.requiredAgents}</i>`
    : typeof r.attemptsLeft === 'number' ? `${r.attemptsLeft} <i>${r.attemptsLeft === 1 ? 'try' : 'tries'} left</i>`
    : ''
  row.innerHTML = `
    <div class="gr-top">
      <span class="gr-name">${esc(label)}</span>
      <span class="gr-count">${status}</span>
    </div>
  `
  return row
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
  const albums = d.albums || []
  const reconnect = d.reconnect || null
  const doneCount = goals.filter((g) => g.done).length + albums.filter((a) => a.done).length + (reconnect?.done ? 1 : 0)
  const totalCount = goals.length + albums.length + (reconnect ? 1 : 0)

  const head = el('div', 'board-head')
  head.innerHTML = `
    <span class="board-title">Today's targets</span>
    <span class="board-count${doneCount === totalCount ? ' all' : ''}">${doneCount}/${totalCount} done</span>
  `
  board.appendChild(head)

  // One week from activation, per district — see districtDeadline in
  // districts.ts. daysLeft is already ceil'd server-side.
  if (typeof d.daysLeft === 'number') {
    const urgent = d.daysLeft <= 2
    const text = d.daysLeft <= 0 ? 'Last day to restore this district'
      : d.daysLeft === 1 ? '<b>1 day</b> left to restore this district'
      : `<b>${d.daysLeft} days</b> left to restore this district`
    board.appendChild(el('div', 'board-deadline' + (urgent ? ' is-urgent' : ''), `⏳ ${text}`))
  }

  // The queue belongs here too — this is the screen you're on when you're
  // about to go stream. Renamed from "Run the 148 Protocol": this is an
  // action for finishing goals, not a thing carried around in the Pack, so
  // it reads as one now.
  const left = remaining({ activeDistrict: d })
  if (left.length) {
    const totalNeed = left.reduce((a, x) => a + x.need, 0)
    const pace = dailyPace({ activeDistrict: d })
    const paceText = pace.perTrack.length ? ` &middot; ${pace.totalPerDay}/day to finish in time` : ''
    const urgent = typeof pace.daysLeft === 'number' && pace.daysLeft <= 2
    const q = el('button', 'queue-btn' + (urgent ? ' is-urgent' : ''),
      `🧠 Build today's stream queue <i>${totalNeed} plays left${paceText}</i>`)
    q.onclick = () => showOverlay(openPlaylist(getState() || { activeDistrict: d }))
    board.appendChild(q)
  }

  // Weekly Mission Board moved here too — players should see their missions
  // on the screen where they perform them, not behind a tap in the Pack.
  const mb = el('button', 'queue-btn is-quiet', '📋 Weekly Mission Board')
  mb.onclick = () => showOverlay(missionBoardSheet(getState() || { activeDistrict: d }))
  board.appendChild(mb)

  const card = el('div', 'card goal-card')
  for (const g of goals) {
    card.appendChild(goalRow(g.label, '', g.progress, g.target, g.done, 'plays'))
  }
  for (const a of albums) {
    const sub = a.done || !a.nextPassTracks?.length ? ''
      : `Still need ${a.nextPassTracks.slice(0, 3).map((t) => `${esc(t.label)} ×${t.need}`).join(' · ')}`
    const row = goalRow(`💿 ${a.label}`, sub, a.passesDone, a.target, a.done, 'passes')
    // Tap to see every track in the album, not just the couple flagged above.
    if (a.tracks?.length) {
      row.classList.add('clickable')
      row.onclick = () => showOverlay(albumDetailSheet(a))
    }
    card.appendChild(row)
  }
  if (albums.length && d.chargeCellProgress) {
    const c = d.chargeCellProgress
    const pct = Math.min(100, Math.round((c.streams / Math.max(1, c.required)) * 100))
    card.appendChild(el('div', 'cell-progress', `
      <div class="cell-progress-head">
        <span>⚡ Next Charge Cell</span>
        <b>${c.streams}/${c.required}</b>
      </div>
      <div class="cell-progress-bar"><i style="width:${pct}%"></i></div>
      <div class="cell-progress-left">${c.remaining} more Album Goal stream${c.remaining === 1 ? '' : 's'} · your goal total stays counted</div>
    `))
  }
  if (reconnect) card.appendChild(reconnectRow(reconnect))
  board.appendChild(card)

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

/** Every track in an album goal, tapped open from its "X passes" summary
 *  row — the summary alone can't show more than a couple of struggling
 *  tracks without turning into a wall of text, but a player who's stuck
 *  wants the whole checklist, not just a sample of it. */
function albumDetailSheet(a) {
  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', '💿 ALBUM MISSION'))
  sheet.appendChild(el('div', 'pl-title', esc(a.label)))
  sheet.appendChild(el('p', 'muted', `${a.passesDone}/${a.target} passes — every track needs ${a.target} plays each to count toward a pass.`))

  const list = el('div', 'card')
  for (const t of a.tracks || []) {
    const row = el('div', 'album-track-row' + (t.done ? ' done' : ''))
    row.innerHTML = `
      <span>${t.done ? '✓ ' : ''}${esc(t.label)}</span>
      <span class="atr-count">${t.have}<i>/${t.target}</i></span>
    `
    list.appendChild(row)
  }
  sheet.appendChild(list)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
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
