// The 148 Protocol — a strategic briefing built from what the district still
// needs, framed as intel rather than a bare playlist (name and framing
// borrowed from BTS Comeback Mission's "Namjoon's Brain").
//
// This is the Candy Star idea living inside the game instead of a link out:
// the state already knows every remaining play (track goals) and every track
// the next album pass is short of, so the debt list is derivable on the
// client with no extra request.
//
// Used to round-robin the debts into a long numbered play-by-play queue
// (repeated entries, one "priority" pick up top) — dropped per the site
// owner once real targets got big enough that the expanded queue ran into
// the hundreds of entries and stopped being something anyone could glance
// at. Now: one row per remaining track, how many more plays it needs.

import { el, esc, hideOverlay } from './state.js'
import { districtDisplayName } from './ward-tiles.js'

/** [{ label, need }] — everything still owed, biggest debt first. */
export function remaining(state) {
  const d = state.activeDistrict
  const out = []
  if (!d) return out

  for (const g of d.trackGoals || []) {
    const need = Math.max(0, (g.target || 0) - (g.progress || 0))
    if (need > 0) out.push({ label: g.label, need, kind: 'track' })
  }

  // Each album only contributes the tracks its *next* pass is missing.
  for (const a of d.albums || []) {
    if (a.done) continue
    for (const t of a.nextPassTracks || []) {
      const need = Math.max(0, t.need || 0)
      if (!need) continue
      const hit = out.find((x) => x.label === t.label)
      if (hit) hit.need = Math.max(hit.need, need)
      else out.push({ label: t.label, need, kind: 'album' })
    }
  }

  return out.sort((a2, b2) => b2.need - a2.need)
}

/** Today's per-track quota to finish this district by its deadline — the
 *  one thing the plain "what's owed" queue above doesn't tell you: how fast.
 *  daysLeft comes pre-ceil'd from the server (see districtDeadline in
 *  districts.ts), so day 0 ("last day") still spreads the remaining debt
 *  across one day rather than dividing by zero. */
export function dailyPace(state) {
  const d = state.activeDistrict
  const debts = remaining(state)
  const daysLeft = typeof d?.daysLeft === 'number' ? d.daysLeft : null
  if (!debts.length || daysLeft === null) return { daysLeft, perTrack: [], totalPerDay: 0 }
  const days = Math.max(1, daysLeft)
  const perTrack = debts.map((x) => ({ ...x, perDay: Math.ceil(x.need / days) }))
  const totalPerDay = perTrack.reduce((s, x) => s + x.perDay, 0)
  return { daysLeft, perTrack, totalPerDay }
}

export function openPlaylist(state) {
  const sheet = el('div', 'sheet playlist')
  const d = state.activeDistrict
  const debts = remaining(state)

  sheet.appendChild(el('div', 'eyebrow', '🧠 THE 148 PROTOCOL'))
  sheet.appendChild(el('div', 'pl-sub', 'Strategic briefing'))
  sheet.appendChild(el('div', 'pl-title', d ? esc(districtDisplayName(d)) : 'No active district'))

  if (!d) {
    sheet.appendChild(el('p', 'muted', 'Start restoring a district and this shows exactly what it still needs.'))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return sheet
  }

  if (!debts.length) {
    sheet.appendChild(el('div', 'pl-done', '✓'))
    sheet.appendChild(el('p', 'muted', 'Nothing left to play — every goal here is met. Open the district to finish the restoration.'))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return sheet
  }

  const totalNeed = debts.reduce((s, x) => s + x.need, 0)
  sheet.appendChild(el('div', 'pl-sum',
    `${totalNeed} ${totalNeed === 1 ? 'play' : 'plays'} left &middot; ${debts.length} ${debts.length === 1 ? 'track' : 'tracks'}`))

  const pace = dailyPace(state)
  if (pace.daysLeft !== null) {
    const urgent = pace.daysLeft <= 2
    const left = pace.daysLeft <= 0 ? 'Last day' : pace.daysLeft === 1 ? '1 day left' : `${pace.daysLeft} days left`
    sheet.appendChild(el('div', 'pl-pace' + (urgent ? ' is-urgent' : ''),
      `<div class="pl-pace-head">⏳ ${left} &middot; <b>${pace.totalPerDay}/day</b> to finish on time</div>`))
  }

  // One row per remaining track, how many more plays it needs — no repeated
  // entries, no round-robin ordering, no single "priority" pick.
  const perTrack = pace.perTrack.length ? pace.perTrack : debts
  const list = el('div', 'pl-list')
  for (const x of perTrack) {
    list.appendChild(el('div', 'pl-item' + (x.kind === 'album' ? ' album' : ''), `
      <span class="pl-name">${esc(x.label)}</span>
      <span class="pl-need">${x.need} left${x.perDay ? ` &middot; ${x.perDay}/day` : ''}</span>
      ${x.kind === 'album' ? '<span class="pl-tag">album</span>' : ''}
    `))
  }
  sheet.appendChild(list)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
