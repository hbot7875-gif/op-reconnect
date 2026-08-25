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
import { tickCountdowns } from './countdown.js'

/** Browser-local activation/deadline moment. Agents are worldwide, so an
 *  absolute server time is clearer in their own phone timezone than a hard-
 *  coded KST/IST label. */
export function formatLocalDateTime(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date)
}

/** [{ label, need, today }] — everything still owed, biggest debt first.
 *  today is how many real plays of that track already landed today (server-
 *  computed, districts.ts), for the 148 Protocol's "already hit today's
 *  pace" checkbox — same idea as arirang mission's auto-ticked daily box. */
export function remaining(state) {
  const d = state.activeDistrict
  const out = []
  if (!d) return out

  for (const g of d.trackGoals || []) {
    const need = Math.max(0, (g.target || 0) - (g.progress || 0))
    const today = Math.max(0, g.today || 0)
    if (need > 0) out.push({ label: g.label, need, today, dayStartNeed: need + today, kind: 'track' })
  }

  // Each album only contributes the tracks its *next* pass is missing.
  for (const a of d.albums || []) {
    if (a.done) continue
    for (const t of a.nextPassTracks || []) {
      const need = Math.max(0, t.need || 0)
      if (!need) continue
      const today = Math.max(0, t.today || 0)
      const dayStartNeed = need + today
      const hit = out.find((x) => x.label === t.label)
      if (hit) {
        // One stream can satisfy both a track goal and the same song inside
        // an album goal, so take the larger debt rather than adding them.
        // Preserve the larger start-of-day debt independently: max(need) +
        // max(today) can combine two different obligations and overstate it.
        hit.need = Math.max(hit.need, need)
        hit.today = Math.max(hit.today, today)
        hit.dayStartNeed = Math.max(hit.dayStartNeed || 0, dayStartNeed)
        if (hit.kind !== 'album') hit.kind = 'both'
      } else out.push({ label: t.label, need, today, dayStartNeed, kind: 'album' })
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
  if (!debts.length || daysLeft === null) return { daysLeft, perTrack: [], totalPerDay: 0, totalMoreToday: 0 }
  const days = Math.max(1, daysLeft)
  // `need` already excludes today's credited plays. Comparing `today`
  // against ceil(need / days) therefore subtracts today twice and can tick
  // a row early. Reconstruct the debt at the start of today, set that day's
  // quota once, then show how much of the quota is still outstanding.
  const perTrack = debts.map((x) => {
    const perDay = Math.ceil(Math.max(x.need, x.dayStartNeed || (x.need + x.today)) / days)
    return { ...x, perDay, moreToday: Math.max(0, perDay - x.today) }
  }).sort((a, b) =>
    Number(a.moreToday <= 0) - Number(b.moreToday <= 0)
      || b.moreToday - a.moreToday
      || b.need - a.need)
  const totalPerDay = perTrack.reduce((s, x) => s + x.perDay, 0)
  const totalMoreToday = perTrack.reduce((s, x) => s + x.moreToday, 0)
  return { daysLeft, perTrack, totalPerDay, totalMoreToday }
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

  const activated = formatLocalDateTime(d.activatedAt)
  const expires = formatLocalDateTime(d.expiresAt)
  if (activated || expires) {
    sheet.appendChild(el('div', 'pl-window', `
      ${activated ? `<span><i>Activated</i>${esc(activated)}</span>` : ''}
      ${expires ? `<span><i>Deadline</i>${esc(expires)} <small>your time</small></span>` : ''}
    `))
  }

  const totalNeed = debts.reduce((s, x) => s + x.need, 0)
  sheet.appendChild(el('div', 'pl-sum',
    `${totalNeed} ${totalNeed === 1 ? 'play' : 'plays'} left &middot; ${debts.length} ${debts.length === 1 ? 'track' : 'tracks'}`))

  const pace = dailyPace(state)
  if (pace.daysLeft !== null) {
    const urgent = pace.daysLeft <= 2
    // While an attempt is alive, ceil(msLeft / day) is never 0. The old
    // `daysLeft <= 0` "Last day" branch was unreachable; the final 24 hours
    // are represented by daysLeft === 1.
    const finalDay = pace.daysLeft <= 1
    const left = finalDay ? 'Final day' : `${pace.daysLeft} days left`
    const today = pace.totalMoreToday > 0 ? `<b>${pace.totalMoreToday} more today</b>` : '<b>Today\'s pace complete</b>'
    const clock = finalDay && d.expiresAt
      ? ` &middot; <b class="pl-deadline-clock" data-deadline="${esc(d.expiresAt)}">--:--:--</b> left`
      : ''
    sheet.appendChild(el('div', 'pl-pace' + (urgent ? ' is-urgent' : ''),
      `<div class="pl-pace-head">⏳ ${left}${clock} &middot; ${today}</div>`))
  }

  // One row per remaining track, how many more plays it needs — no repeated
  // entries, no round-robin ordering, no single "priority" pick. Ticks
  // itself off once today's real plays reach that track's daily pace —
  // same auto-check idea as arirang mission's 148 Protocol.
  const perTrack = pace.perTrack.length ? pace.perTrack : debts
  const list = el('div', 'pl-list')
  for (const x of perTrack) {
    const hitToday = typeof x.moreToday === 'number' && x.moreToday <= 0
    const todayText = typeof x.moreToday === 'number'
      ? (hitToday ? 'today done' : `${x.moreToday} more today`)
      : ''
    const hasAlbum = x.kind === 'album' || x.kind === 'both'
    const row = el('div', 'pl-item' + (hasAlbum ? ' album' : '') + (hitToday ? ' is-done-today' : ''), `
      <span class="pl-check">${hitToday ? '✓' : ''}</span>
      <span class="pl-name">${esc(x.label)}</span>
      <span class="pl-need">${x.need} left${todayText ? ` &middot; ${todayText}` : ''}</span>
      ${hasAlbum ? `<span class="pl-tag">${x.kind === 'both' ? 'track + album' : 'album'}</span>` : ''}
    `)
    list.appendChild(row)
  }
  sheet.appendChild(list)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  // The caller appends this sheet to #overlay after openPlaylist returns.
  // Paint on the following microtask so the first frame never flashes the
  // --:--:-- placeholder before the shared 1-second interval catches up.
  queueMicrotask(tickCountdowns)
  return sheet
}
