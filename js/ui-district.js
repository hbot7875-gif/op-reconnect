// District mission board + restoration cascade — shared by screen-district.js
// for the currently-active district. The scene/stage shell itself now lives
// in screen-district.js, since every district status (not just "active") gets
// its own full screen there.

import { el, esc, showOverlay, hideOverlay, getState, setState, toast } from './state.js'
import { openPlaylist, remaining, dailyPace } from './playlist.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { openProgressSheet } from './ui-hud.js'
import { trackEngagement } from './engagement.js'

/** Overall restoration fraction (0..1) driving the scene's lights. */
export function districtFraction(d) {
  if (!d) return 0
  let got = 0, need = 0
  for (const g of d.trackGoals || []) { got += Math.min(g.progress, g.target); need += g.target }
  for (const a of d.albums || []) { got += Math.min(a.passesDone, a.target); need += a.target }
  return need === 0 ? 0 : Math.max(0, Math.min(1, got / need))
}

/** One "stream this, n of m times" row — the whole game's core loop in a
 *  single component. Flat and identical for tracks and album passes, because
 *  that's the one thing a player checks every day and it should never take
 *  more than a glance. A finished row drops its bar and sub-line entirely —
 *  a full 100% bar says nothing a checkmark doesn't already say, and it was
 *  most of what made completed rows as visually loud as unfinished ones. */
function goalRow(label, sub, progress, target, done, unit) {
  const pct = Math.min(100, Math.round((progress / Math.max(1, target)) * 100))
  const row = el('div', 'goal-row' + (done ? ' done' : ''))
  row.innerHTML = `
    <div class="gr-top">
      <span class="gr-name">${esc(label)}</span>
      <span class="gr-count">${done ? '✓ done' : `${progress}<i>/${target}</i>`}</span>
    </div>
    ${done ? '' : `<div class="gr-bar" role="progressbar" aria-label="${esc(label)} progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(target, progress)}"><div class="gr-fill" style="width:${pct}%"></div></div>`}
    ${sub ? `<div class="gr-sub">${sub}</div>` : ''}
  `
  if (unit && !done) row.querySelector('.gr-count').insertAdjacentHTML('beforeend', ` <i>${unit}</i>`)
  return row
}

/** A mission-group header inline in the checklist itself — "Track Mission",
 *  "Album Mission", "ReConnect Mission" — so the grouping that used to live
 *  behind a separate Weekly Mission Board tap (now removed: it only ever
 *  repeated the same three counts a scroll down already shows) is visible
 *  in the one place a player is actually looking. */
function missionSection(icon, label, done, total) {
  const head = el('div', 'board-head mission-section')
  head.innerHTML = `
    <span class="board-title">${icon} ${esc(label)}</span>
    <span class="board-count${total > 0 && done === total ? ' all' : ''}">${done}/${total} done</span>
  `
  return head
}

/** A track/album group, laid out so unfinished work is what you actually
 *  see: once every item in the group is done it collapses into one closed
 *  <details> line ("Album Mission — 4/4 complete ✓ — tap to expand")
 *  instead of four already-finished bars nobody needs to scroll past.
 *  Partially-done groups stay open with the header still showing the count,
 *  unfinished items first — done ones sink to the bottom, already quiet
 *  (goalRow drops their bar). rowFn builds each item's own row so this stays
 *  usable for both the plain track rows and the clickable album ones. */
function renderMissionGroup(card, icon, label, items, rowFn) {
  if (!items.length) return
  const done = items.filter((x) => x.done).length
  const total = items.length
  if (done === total) {
    const fold = el('details', 'mission-fold')
    const summary = el('summary', '', `
      <span class="board-title">${icon} ${esc(label)}</span>
      <span class="board-count all">${done}/${total} complete ✓</span>
    `)
    fold.appendChild(summary)
    for (const it of items) fold.appendChild(rowFn(it))
    card.appendChild(fold)
    return
  }
  card.appendChild(missionSection(icon, label, done, total))
  const ordered = [...items].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1))
  for (const it of ordered) card.appendChild(rowFn(it))
}

/** opts.reconnectBox — the interactive panel screen-district.js already
 *  built for this district's reconnect goal (open/invite/accept/decline),
 *  handed in so it can be slotted into the checklist's own Track → Album →
 *  ReConnect order instead of appended after the shelf, dead last on the
 *  whole page. It starts empty and paints itself in once its own
 *  getReconnectMission call resolves, so it's safe to insert synchronously. */
export function renderBoard(board, d, opts = {}) {
  board.innerHTML = ''

  const goals = [...(d.trackGoals || [])]
  const albums = d.albums || []
  const reconnect = d.reconnect || null
  const doneCount = goals.filter((g) => g.done).length + albums.filter((a) => a.done).length + (reconnect?.done ? 1 : 0)
  const totalCount = goals.length + albums.length + (reconnect ? 1 : 0)

  const head = el('div', 'board-head')
  head.innerHTML = `
    <span class="board-title">District missions</span>
    <span class="board-count${doneCount === totalCount ? ' all' : ''}">${doneCount}/${totalCount} done</span>
  `
  board.appendChild(head)

  // The queue belongs here too — this is the screen you're on when you're
  // about to go stream. Renamed from "Run the 148 Protocol": this is an
  // action for finishing goals, not a thing carried around in the Pack, so
  // it reads as one now. It's also the strongest thing on the screen: the
  // one card whose whole job is "what do I do right now", so it carries the
  // deadline/pace line itself instead of splitting that into a banner above
  // it — one status block, not two that have to be read together.
  const left = remaining({ activeDistrict: d })
  const pace = dailyPace({ activeDistrict: d })
  if (left.length) {
    const totalNeed = left.reduce((a, x) => a + x.need, 0)
    const bits = [`${totalNeed} play${totalNeed === 1 ? '' : 's'} remaining`]
    if (pace.perTrack.length) bits.push(`Aim for ${pace.totalPerDay}/day`)
    if (typeof d.daysLeft === 'number') {
      bits.push(d.daysLeft <= 0 ? 'District deadline: last day' : d.daysLeft === 1 ? 'District deadline: 1 day left' : `District deadline: ${d.daysLeft} days left`)
    }
    const urgent = typeof pace.daysLeft === 'number' && pace.daysLeft <= 2
    const q = el('button', 'queue-btn' + (urgent ? ' is-urgent' : ''), `
      <span class="qb-title">🧠 Build today's queue</span>
      <span class="qb-meta">${bits.join(' &middot; ')}</span>
    `)
    q.onclick = () => {
      trackEngagement('queue_built', { screen: 'district', districtId: d.id })
      showOverlay(openPlaylist(getState() || { activeDistrict: d }))
    }
    board.appendChild(q)
  } else if (typeof d.daysLeft === 'number') {
    // Nothing left to queue (goals met, waiting on something else, e.g. the
    // reconnect goal) — the deadline still matters, just with no CTA to ride
    // along with.
    const urgent = d.daysLeft <= 2
    const text = d.daysLeft <= 0 ? 'Last day to restore this district'
      : d.daysLeft === 1 ? '<b>1 day</b> left to restore this district'
      : `<b>${d.daysLeft} days</b> left to restore this district`
    board.appendChild(el('div', 'board-deadline' + (urgent ? ' is-urgent' : ''), `<span class="deadline-kind">District deadline</span><span>⏳ ${text}</span>`))
  }

  // A rescue when the clock is genuinely about to run out, spending one
  // earned Extension Charge (a rare level-up reward — see
  // migrations/057_rc_deadline_extension_charges.sql, which replaced Fuel
  // for this exact purpose since nothing ever read or spent Fuel). Same
  // urgent (≤2 days) window as the deadline text above, in both the "still
  // streaming" and "waiting on something else" cases — this is exactly the
  // moment an agent close to finishing (see AGENT077, 99/100 combined
  // ReConnect streams when her deadline hit) needs it most.
  const urgentDeadline = typeof d.daysLeft === 'number' && d.daysLeft <= 2
  const charges = getState()?.player?.deadlineExtensionCharges || 0
  if (urgentDeadline && !d.deadlineExtended) {
    const extendRow = el('div', 'board-extend')
    const extendBtn = el('button', 'btn btn-ghost',
      charges > 0 ? `⏳ Extend deadline +3 days (${charges} charge${charges === 1 ? '' : 's'})` : '⏳ Extend deadline +3 days (0 charges)')
    extendBtn.disabled = charges < 1
    const extendMsg = el('div', 'board-extend-msg')
    if (charges < 1) {
      extendMsg.append('Earn one by leveling up. ')
      const rewardLink = el('button', 'inline-action', 'See next Level reward')
      rewardLink.onclick = () => openProgressSheet(getState())
      extendMsg.appendChild(rewardLink)
    }
    extendBtn.onclick = async () => {
      extendBtn.disabled = true
      const res = await call('extendDistrictDeadline', { agentNo: getAgentNo(), districtId: d.id })
      if (res.success) {
        toast('Deadline extended — 3 more days')
        const fresh = await call('getGameState', { agentNo: getAgentNo() })
        if (fresh.success) setState(fresh)
      } else {
        extendMsg.textContent = res.error === 'already_extended' ? "You've already used this district's extension."
          : res.error === 'too_early' ? 'Only available in the final 2 days.'
          : res.error === 'no_extension_charges' ? 'Earn one by leveling up.'
          : "Couldn't extend — try again."
        extendBtn.disabled = false
      }
    }
    extendRow.append(extendBtn, extendMsg)
    if (reconnect && !reconnect.done) {
      extendRow.appendChild(el('div', 'board-extend-note', 'Extends this district only. An open ReConnect team mission keeps its own expiry.'))
    }
    board.appendChild(extendRow)
  }

  if (goals.length) {
    const trackCard = el('div', 'card goal-card')
    renderMissionGroup(trackCard, '🎵', 'Track Mission', goals,
      (g) => goalRow(g.label, '', g.progress, g.target, g.done, 'plays'))
    board.appendChild(trackCard)
  }

  if (albums.length) {
    const albumCard = el('div', 'card goal-card')
    renderMissionGroup(albumCard, '💿', 'Album Mission', albums, (a) => {
      const sub = a.done || !a.nextPassTracks?.length ? ''
        : `Still need ${a.nextPassTracks.slice(0, 3).map((t) => `${esc(t.label)} ×${t.need}`).join(' · ')}`
      const row = goalRow(`💿 ${a.label}`, sub, a.passesDone, a.target, a.done, 'passes')
      // Tap to see every track in the album, not just the couple flagged above.
      if (a.tracks?.length) {
        row.classList.add('clickable')
        row.onclick = () => showOverlay(albumDetailSheet(a))
      }
      return row
    })
    if (d.chargeCellProgress) {
      const c = d.chargeCellProgress
      const pct = Math.min(100, Math.round((c.streams / Math.max(1, c.required)) * 100))
      albumCard.appendChild(el('div', 'cell-progress', `
        <div class="cell-progress-head">
          <span>⚡ Next Charge Cell</span>
          <b>${c.streams}/${c.required}</b>
        </div>
        <div class="cell-progress-bar" role="progressbar" aria-label="Progress toward next Charge Cell" aria-valuemin="0" aria-valuemax="${c.required}" aria-valuenow="${c.streams}"><i style="width:${pct}%"></i></div>
        <div class="cell-progress-left">${c.remaining} more Album Goal stream${c.remaining === 1 ? '' : 's'} · your goal total stays counted</div>
      `))
    }
    board.appendChild(albumCard)
  }

  // Last, after both Track and Album Mission — not sandwiched between them.
  // It's still its own clearly-labeled section, just following the same
  // Track → Album → ReConnect reading order as the rest of the checklist.
  if (reconnect) {
    if (reconnect.done) {
      // Name who it was completed with. The interactive panel already says
      // this ("Done — you teamed up with X"), but that panel only exists
      // while reconnect.done is still false — the instant a poll reports it
      // complete, the checklist swaps straight to this static row and the
      // panel (and its message) never renders again. In the ordinary case
      // that's not a brief flash, it's the ENTIRE lifetime of the message:
      // resolveReconnectStatus reports done:true starting the very same poll
      // the mission's status flips to 'complete' server-side, so there is no
      // separate poll where reconnectBox gets built with a still-open
      // mission that then resolves to complete client-side. A player asking
      // "does it just show a tick mark?" was accurately describing what they
      // saw — the data (reconnect.mission.participants) was always in the
      // response, just never read here.
      const others = (reconnect.mission?.participants || []).filter((p) => !p.isMe && p.status === 'joined')
      const withWho = others.length ? `With ${others.map((p) => esc(p.codename)).join(' and ')}` : ''
      const doneCard = el('div', 'card goal-card')
      doneCard.appendChild(missionSection('🤝', 'ReConnect Mission', 1, 1))
      doneCard.appendChild(goalRow('🤝 ReConnect Mission', withWho, 1, 1, true))
      board.appendChild(doneCard)
    } else if (opts.reconnectBox) {
      board.appendChild(missionSection('🤝', 'ReConnect Mission', 0, 1))
      board.appendChild(opts.reconnectBox)
    }
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
