// The Helping Zone — the Backup Pass feature as a small place on the city map.
//
// It exists because the helper's half of this feature was invisible. You
// could answer someone's call for backup, get a toast, and then never see
// the pairing again: no name, no song, no progress, no way out. The owner
// watched their goal move; the person doing the work saw nothing. The old
// join list never even named the goal ("a track goal"), so helping was
// something you agreed to without being told what to play.
//
// A place, not a screen: there is only ever one pairing at a time, so this
// is a sheet you walk into from the map marker (city-map.js) and back out
// of, the same way the Magic Shop works.
//
// Written tight on purpose. The first version explained itself in a
// paragraph per section and wrapped every number in its own card, which read
// as a settings page. A meeting spot should be readable in one glance:
// a line of state, the songs, the numbers, one action. Everything that needs
// explaining moved behind "View progress", where someone has actually asked.
//
// Order is by what you are in the middle of: the job you're on first, your
// own pass second, everyone else's calls last.

import { el, esc, toast, showOverlay, hideOverlay, getState } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goDistrict } from './router.js'
import { openBackupPassFlow, markBackupHelpSeen } from './backup-pass.js'

const JOIN_ERRORS = {
  not_found: 'That request is no longer available.',
  not_open: 'Someone else got there first.',
  expired: 'That request just expired.',
  cannot_help_self: "That's your own request.",
  already_helping_elsewhere: "You're already helping another agent — finish that one first.",
  already_paired_this_goal: "You've already helped this agent with that goal.",
}

/** How many open requests show before "See all" — enough to see there's a
 *  queue, few enough that the Zone never becomes a scrolling list. */
const REQUESTS_SHOWN = 3

/** "5d" / "9h" / "40m". Deliberately shorter than the rest of the app's
 *  countdowns: in a list row it's the third thing on a line. */
function leftShort(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/** For a list row: "5d left", or "ending" once it's on the clock. */
function leftLabel(iso, now = Date.now()) {
  const short = leftShort(iso, now)
  return short ? `${short} left` : 'ending'
}

/** For a sentence: "Backup ends in 5d." / "Backup is ending." */
function endsSentence(iso, now = Date.now()) {
  const short = leftShort(iso, now)
  return short ? `Backup ends in ${short}.` : 'Backup is ending.'
}

const songLine = (goalKind, label) => `${goalKind === 'album' ? '💿' : '♪'} ${esc(label || 'their goal')}`

/** Section rule: a small caps label, optional value hard right. This is the
 *  only heading style in the Zone — no nested card headers. */
function sectionRow(label, value) {
  return el('div', 'hz-sec', `<span>${esc(label)}</span>${value ? `<b>${esc(value)}</b>` : ''}`)
}

/** The one progress bar in the Zone, and only for a live pairing: their
 *  streams, then yours on top, against the boosted target. */
function slimBar(theirs, mine, target) {
  const total = Math.max(1, target)
  const a = Math.min(100, (theirs / total) * 100)
  const b = Math.min(100 - a, (mine / total) * 100)
  return `<div class="hz-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${theirs + mine}">
    <span class="hz-bar-them" style="width:${a}%"></span>
    <span class="hz-bar-you" style="width:${b}%"></span>
  </div>`
}

/* ── the job you're on ─────────────────────────────────────────────────── */

function helpingBlock(h, api) {
  const box = el('div', 'hz-block hz-live')
  const togo = Math.max(0, h.boostedTarget - h.combined)
  box.appendChild(sectionRow(`You're helping ${h.ownerCodename}`))
  box.appendChild(el('div', 'hz-song', songLine(h.goalKind, h.goalLabel)))
  box.insertAdjacentHTML('beforeend', slimBar(h.ownerProgress, h.myContribution, h.boostedTarget))
  box.appendChild(el('div', 'hz-nums', `
    <b>${h.combined} / ${h.boostedTarget}</b>
    <span>You ${h.myContribution} · Them ${h.ownerProgress}</span>
  `))
  box.appendChild(el('div', 'hz-togo', togo > 0 ? `${togo} more to go` : 'Target reached'))
  const view = el('button', 'hz-link', 'View progress ↗')
  view.type = 'button'
  view.onclick = () => api.show(progressSheet(h, api))
  box.appendChild(view)
  return box
}

/** Everything that would otherwise pad the Zone out: what to play, why the
 *  target moved, when it ends, and the way out. Behind a tap, because only
 *  someone who asked for detail needs it. */
function progressSheet(h, api) {
  const sheet = el('div', 'sheet hz-detail')
  const togo = Math.max(0, h.boostedTarget - h.combined)
  sheet.append(
    el('div', 'eyebrow', 'BACKING UP'),
    el('h3', 'hz-detail-who', esc(h.ownerCodename)),
    el('div', 'hz-song', songLine(h.goalKind, h.goalLabel) + (h.districtName ? ` · ${esc(h.districtName)}` : '')),
  )
  sheet.insertAdjacentHTML('beforeend', slimBar(h.ownerProgress, h.myContribution, h.boostedTarget))
  sheet.appendChild(el('div', 'hz-nums', `
    <b>${h.combined} / ${h.boostedTarget}</b>
    <span>You ${h.myContribution} · Them ${h.ownerProgress}</span>
  `))
  sheet.appendChild(el('div', 'hz-togo', togo > 0 ? `${togo} more to go` : 'Target reached'))

  if (h.tracks?.length) {
    sheet.appendChild(el('div', 'hz-play', `
      <span class="hz-play-head">What to play</span>
      <ul>${h.tracks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    `))
  }
  sheet.appendChild(el('p', 'hz-note',
    `Their target rose from ${h.originalTarget} to ${h.boostedTarget} while you help. ${esc(endsSentence(h.expiresAt))}`))

  const stop = el('button', 'btn btn-ghost hz-stop', 'Stop helping')
  stop.type = 'button'
  stop.onclick = async () => {
    stop.disabled = true
    stop.textContent = 'Leaving…'
    const res = await api.call('leaveBackupHelper', { agentNo: api.agentNo(), requestId: h.requestId })
    if (!res?.success) {
      stop.disabled = false
      stop.textContent = 'Stop helping'
      api.toast("Couldn't leave that backup.")
      return
    }
    api.toast(res.bankedCredit > 0
      ? `You left. Your ${res.bankedCredit} play${res.bankedCredit === 1 ? '' : 's'} stay counted for them.`
      : 'You left that backup.')
    api.reload()
  }
  const back = el('button', 'btn btn-ghost hz-back', 'Back')
  back.type = 'button'
  back.onclick = () => api.reload()
  const row = el('div', 'hz-actions')
  row.append(stop, back)
  sheet.appendChild(row)
  return sheet
}

/* ── your own pass ─────────────────────────────────────────────────────── */

function ownPassBlock(o, api) {
  const box = el('div', 'hz-block')
  const helped = o.status === 'joined'
  box.appendChild(sectionRow('Your backup pass', helped ? `${o.helperCodename} is in` : 'waiting'))
  box.appendChild(el('div', 'hz-song', songLine(o.goalKind, o.goalLabel)))
  if (helped) {
    box.insertAdjacentHTML('beforeend', slimBar(o.ownProgress, o.helperContribution, o.boostedTarget))
    box.appendChild(el('div', 'hz-nums', `
      <b>${o.ownProgress + o.helperContribution} / ${o.boostedTarget}</b>
      <span>You ${o.ownProgress} · Them ${o.helperContribution}</span>
    `))
    // The raised target is an extra route, not a replacement — the goal also
    // completes at the original number on the owner's own streams. Without
    // saying so, a helper who joins and contributes little looks like a
    // penalty (see backupLine in ui-district.js).
    box.appendChild(el('div', 'hz-togo', `or ${o.originalTarget} on your own`))
  } else {
    box.appendChild(el('div', 'hz-meta', `${o.originalTarget} → ${o.boostedTarget} · ${esc(leftLabel(o.expiresAt))}`))
  }

  const row = el('div', 'hz-links')
  const go = el('button', 'hz-link', 'View the goal ↗')
  go.type = 'button'
  go.onclick = () => {
    const d = api.state()?.activeDistrict
    if (d && d.id === o.districtId) { api.hide(); api.goDistrict(d.wardId, d.id) }
    else api.toast('That district is no longer your active one.')
  }
  // The owner's own way out. Until this existed only the helper could end a
  // pairing, so an owner whose helper went quiet was stuck for the full TTL
  // with no pass and no way to open another.
  const end = el('button', 'hz-link hz-end', 'End my pass ↗')
  end.type = 'button'
  end.onclick = () => api.show(endPassSheet(o, api))
  row.append(go, end)
  box.appendChild(row)
  return box
}

/** Ending early settles exactly like every other close path, so this says
 *  which of the two outcomes applies before anything happens: nothing
 *  contributed means the pass returns, anything contributed stays banked and
 *  the pass is spent. */
function endPassSheet(o, api) {
  const sheet = el('div', 'sheet hz-detail')
  const given = o.status === 'joined' ? (o.helperContribution || 0) : 0
  sheet.append(
    el('div', 'eyebrow', 'END YOUR BACKUP PASS'),
    el('h3', 'hz-detail-who', esc(o.goalLabel || 'your goal')),
    el('p', 'hz-note', given > 0
      ? `${esc(o.helperCodename)} has already played ${given} toward this. Those ${given} stay counted for you and the target drops back to ${o.originalTarget} — but the pass itself is spent.`
      : 'Nobody has streamed toward this yet, so the Backup Pass comes straight back to your Pack and you can open a new one.'),
  )
  const end = el('button', 'btn btn-primary hz-stop', given > 0 ? 'End it anyway' : 'End and get my pass back')
  end.type = 'button'
  end.onclick = async () => {
    end.disabled = true
    end.textContent = 'Ending…'
    const res = await api.call('closeMyBackupRequest', { agentNo: api.agentNo() })
    if (!res?.success) {
      end.disabled = false
      end.textContent = given > 0 ? 'End it anyway' : 'End and get my pass back'
      api.toast(res?.error === 'no_open_request' ? 'That pass has already ended.' : "Couldn't end that pass.")
      return
    }
    api.toast(res.refunded
      ? 'Pass ended — it’s back in your Pack.'
      : `Pass ended. ${res.bankedCredit} play${res.bankedCredit === 1 ? '' : 's'} stay counted for you.`)
    api.reload()
  }
  const back = el('button', 'btn btn-ghost hz-back', 'Keep it')
  back.type = 'button'
  back.onclick = () => api.reload()
  const row = el('div', 'hz-actions')
  row.append(end, back)
  sheet.appendChild(row)
  return sheet
}

function passesBlock(count, api) {
  const box = el('div', 'hz-block hz-passes')
  box.appendChild(sectionRow('Your backup passes', count > 0 ? `${count} available` : 'none'))
  const open = el('button', `btn ${count > 0 ? 'btn-primary' : 'btn-ghost'} hz-open`, 'Open a pass ↗')
  open.type = 'button'
  if (count > 0) {
    open.onclick = async () => {
      const items = (api.state()?.items || []).filter((i) => i.itemId === 'backup-pass' && !i.usedAt)
      if (!items.length) { api.toast('No Backup Pass available right now.'); return }
      await api.openPass(items[0])
    }
  } else {
    open.disabled = true
    open.setAttribute('aria-disabled', 'true')
  }
  box.appendChild(open)
  if (count === 0) box.appendChild(el('div', 'hz-hint', 'Supply Chests, level-ups and restorations drop them.'))
  return box
}

/* ── everyone else's calls ─────────────────────────────────────────────── */

function requestRow(r, api) {
  const row = el('div', 'hz-req')
  row.innerHTML = `
    <div class="hz-req-main">
      <span class="hz-req-who">${esc(r.ownerCodename)}</span>
      <span class="hz-req-song">${songLine(r.goalKind, r.goalLabel)}</span>
      <span class="hz-req-meta">${r.originalTarget} → ${r.boostedTarget} · ${esc(leftLabel(r.expiresAt))}</span>
    </div>
  `
  const join = el('button', 'btn-mini hz-help', 'Help ↗')
  join.type = 'button'
  join.onclick = async () => {
    join.disabled = true
    join.textContent = '…'
    const res = await api.call('joinBackupRequest', { agentNo: api.agentNo(), requestId: r.id })
    if (!res?.success) {
      join.disabled = false
      join.textContent = 'Help ↗'
      api.toast(JOIN_ERRORS[res?.error] || "Couldn't join that one.")
      return
    }
    api.toast(`You're backing up ${r.ownerCodename}.`)
    api.reload()
  }
  row.appendChild(join)
  return row
}

function requestsBlock(requests, busy, api) {
  const box = el('div', 'hz-block hz-list')
  box.appendChild(sectionRow('Agents needing backup', requests.length ? String(requests.length) : ''))
  if (!requests.length) {
    box.appendChild(el('div', 'hz-quiet', 'No one needs backup right now.'))
    return box
  }
  // While you're already on a job the server will refuse a second one, so
  // the rows stay readable but the buttons don't lie about being available.
  const rows = el('div', 'hz-reqs')
  const shown = requests.slice(0, REQUESTS_SHOWN)
  const paint = (list) => {
    rows.innerHTML = ''
    for (const r of list) {
      const row = requestRow(r, api)
      if (busy) {
        const b = row.querySelector('.hz-help')
        b.disabled = true
        b.setAttribute('aria-disabled', 'true')
      }
      rows.appendChild(row)
    }
  }
  paint(shown)
  box.appendChild(rows)
  if (requests.length > REQUESTS_SHOWN) {
    const more = el('button', 'hz-link hz-more', `See all ${requests.length} ↗`)
    more.type = 'button'
    more.onclick = () => { paint(requests); more.remove() }
    box.appendChild(more)
  }
  return box
}

/* ── the Zone ──────────────────────────────────────────────────────────── */

/** Builds the whole sheet from one payload. Pure apart from `api`, so the
 *  visual harness below renders the real thing rather than a copy that can
 *  drift — same reasoning as quest-skip.js's sheet preview. */
export function helpingZoneSheet(data, api) {
  const sheet = el('div', 'sheet hz-sheet')
  sheet.append(
    el('div', 'eyebrow', 'CITY MAP · WEST SEAM'),
    el('h3', 'hz-title', '🤝 Helping Zone'),
    el('p', 'hz-line', "Need backup? Or be someone's backup."),
  )

  const body = el('div', 'hz-body')
  if (data.asHelper) body.appendChild(helpingBlock(data.asHelper, api))
  body.appendChild(data.asOwner ? ownPassBlock(data.asOwner, api) : passesBlock(data.backupPasses || 0, api))
  body.appendChild(requestsBlock(data.openRequests || [], !!data.asHelper, api))
  sheet.appendChild(body)

  sheet.appendChild(el('p', 'hz-foot', 'Helping is free. Your streams count for both.'))
  const leave = el('button', 'btn btn-ghost hz-leave', 'Leave the Zone')
  leave.type = 'button'
  leave.onclick = api.hide
  sheet.appendChild(leave)
  return sheet
}

/** Walk into the Zone. Called by the city map's own marker. */
export async function openHelpingZone() {
  const api = {
    call, toast, hide: hideOverlay, show: showOverlay, state: getState, goDistrict,
    agentNo: getAgentNo, openPass: openBackupPassFlow, reload: openHelpingZone,
  }

  const loading = el('div', 'sheet hz-sheet')
  loading.append(
    el('div', 'eyebrow', 'CITY MAP · WEST SEAM'),
    el('h3', 'hz-title', '🤝 Helping Zone'),
    el('p', 'hz-line', "Need backup? Or be someone's backup."),
    el('div', 'hz-quiet hz-loading', 'Looking around…'),
  )
  showOverlay(loading)

  const data = await call('getHelpingZone', { agentNo: getAgentNo() })
  if (!data?.success) {
    toast("Couldn't load the Helping Zone.")
    return
  }

  // Walking in IS looking at the list, so it clears the Pack tab's "someone
  // needs backup" dot — the same thing the old join sheet did on open.
  const newest = (data.openRequests || []).map((r) => r.expiresAt).sort().slice(-1)[0]
  markBackupHelpSeen(getState()?.player?.backupHelp?.latestAt || newest || new Date().toISOString())

  showOverlay(helpingZoneSheet(data, api))
}

/** Deterministic visual harness hook — builds the real sheet from a payload
 *  so the state review can't drift from what players see. */
export function helpingZonePreview(data, api = {}) {
  const noop = () => {}
  return helpingZoneSheet(data, {
    call: async () => ({ success: false }), toast: noop, hide: noop, show: noop,
    state: () => ({}), goDistrict: noop, agentNo: () => 'AGENT000',
    openPass: noop, reload: noop, ...api,
  })
}
