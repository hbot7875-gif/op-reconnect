// The 148 Protocol — a strategic briefing built from what the district still
// needs, framed as intel rather than a bare playlist (name and framing
// borrowed from BTS Comeback Mission's "Namjoon's Brain").
//
// This is the Candy Star idea living inside the game instead of a link out:
// the state already knows every remaining play (track goals) and every track
// the next album pass is short of, so the queue is derivable on the client
// with no extra request.
//
// Order matters. Rather than "Haegeum ×4, then DSYLM ×7", it round-robins so
// no track runs back-to-back for long. That respects the daily per-track
// variety cap, and it's a better listen — which is the point of handing
// someone a queue instead of a checklist.

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

/** Round-robin the debts into a play order. */
export function buildQueue(state, cap = 60) {
  const pool = remaining(state).map((x) => ({ ...x }))
  const queue = []
  while (queue.length < cap) {
    let placed = false
    for (const t of pool) {
      if (t.need <= 0) continue
      // Don't put the same track twice in a row unless it's all that's left.
      if (queue.length && queue[queue.length - 1].label === t.label
        && pool.some((x) => x !== t && x.need > 0)) continue
      queue.push({ label: t.label, kind: t.kind })
      t.need--
      placed = true
      if (queue.length >= cap) break
    }
    if (!placed) break
  }
  return queue
}

export function openPlaylist(state) {
  const sheet = el('div', 'sheet playlist')
  const d = state.activeDistrict
  const queue = buildQueue(state)

  sheet.appendChild(el('div', 'eyebrow', '🧠 THE 148 PROTOCOL'))
  sheet.appendChild(el('div', 'pl-sub', 'Strategic briefing'))
  sheet.appendChild(el('div', 'pl-title', d ? esc(districtDisplayName(d)) : 'No active district'))

  if (!d) {
    sheet.appendChild(el('p', 'muted', 'Start restoring a district and this builds the exact play order to finish it.'))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return sheet
  }

  if (!queue.length) {
    sheet.appendChild(el('div', 'pl-done', '✓'))
    sheet.appendChild(el('p', 'muted', 'Nothing left to play — every goal here is met. Open the district to finish the restoration.'))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return sheet
  }

  const tracks = new Set(queue.map((q) => q.label))
  sheet.appendChild(el('div', 'pl-sum',
    `${queue.length} ${queue.length === 1 ? 'play' : 'plays'} &middot; ${tracks.size} ${tracks.size === 1 ? 'track' : 'tracks'} &middot; in this order`))

  const pace = dailyPace(state)
  if (pace.perTrack.length) {
    const urgent = pace.daysLeft <= 2
    const left = pace.daysLeft <= 0 ? 'Last day' : pace.daysLeft === 1 ? '1 day left' : `${pace.daysLeft} days left`
    sheet.appendChild(el('div', 'pl-pace' + (urgent ? ' is-urgent' : ''), `
      <div class="pl-pace-head">⏳ ${left} &middot; <b>${pace.totalPerDay}/day</b> to finish on time</div>
      <div class="pl-pace-rows">
        ${pace.perTrack.slice(0, 6).map((x) => `<span class="pl-pace-row"><span>${esc(x.label)}</span><b>${x.perDay}/day</b></span>`).join('')}
      </div>
    `))
  }

  const list = el('ol', 'pl-list')
  queue.forEach((q, i) => {
    list.appendChild(el('li', 'pl-item' + (q.kind === 'album' ? ' album' : ''), `
      <span class="pl-name">${esc(q.label)}</span>
      ${i === 0 ? '<span class="pl-tag priority">⚠ priority</span>'
        : q.kind === 'album' ? '<span class="pl-tag">album pass</span>' : ''}
    `))
  })
  sheet.appendChild(list)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
