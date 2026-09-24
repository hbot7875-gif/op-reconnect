// The Helping Zone — the Backup Pass feature as a place on the city map.
//
// It exists because the helper's half of this feature was invisible. You
// could answer someone's call for backup, get a toast, and then never see
// the pairing again: no name, no song, no progress, no way out. The owner
// watched their goal move; the person doing the work saw nothing. Worse, the
// old join list never even named the goal ("a track goal"), so helping was
// something you agreed to without being told what to play.
//
// A place, not a screen: there is only ever one pairing at a time, so this
// is a sheet you walk into from the map marker (city-map.js's Helping Zone)
// and walk back out of, the same way the Magic Shop works. The marker
// carries the state — lit while you're on a job, pulsing while someone is
// waiting — so the city itself says whether anything is happening.
//
// Three sections, in the order they matter to whoever opened it:
//   1. Backing up  — you are helping someone right now
//   2. Your pass   — you opened one; waiting, or being helped
//   3. Who needs backup — everyone still waiting
// An agent can legitimately be in 1 and 2 at once (the server allows owning
// one request while helping another), so these are sections, not tabs.

import { el, esc, toast, showOverlay, hideOverlay, getState } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goDistrict } from './router.js'
import { untilLabel } from './quest-exit-rules.js'
import { openBackupPassFlow, markBackupHelpSeen } from './backup-pass.js'

const JOIN_ERRORS = {
  not_found: 'That request is no longer available.',
  not_open: 'Someone else got there first.',
  expired: 'That request just expired.',
  cannot_help_self: "That's your own request.",
  already_helping_elsewhere: "You're already helping another agent — finish that one first.",
  already_paired_this_goal: "You've already helped this agent with that goal.",
}

/** A combined progress bar. `mine` is drawn on top of `theirs` so the split
 *  is visible at a glance — the helper can see their own contribution as a
 *  distinct band rather than a number they have to trust. */
function splitBar(theirs, mine, target) {
  const total = Math.max(1, target)
  const a = Math.min(100, (theirs / total) * 100)
  const b = Math.min(100 - a, (mine / total) * 100)
  return `<div class="bkp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${theirs + mine}">
    <span class="bkp-bar-theirs" style="width:${a}%"></span>
    <span class="bkp-bar-mine" style="width:${b}%"></span>
  </div>`
}

/** The songs that count. This is the single most important thing here for a
 *  helper, and the one thing the old join sheet never told them. */
function trackList(tracks) {
  if (!tracks?.length) return ''
  return `<div class="bkp-tracks">
    <span class="bkp-tracks-head">What to play</span>
    <ul>${tracks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
  </div>`
}

function helperCard(h, reload) {
  const card = el('div', 'bkp-card bkp-helping')
  const remaining = Math.max(0, h.boostedTarget - h.combined)
  card.innerHTML = `
    <div class="bkp-eyebrow">YOU'RE BACKING UP</div>
    <h3 class="bkp-who">${esc(h.ownerCodename)}</h3>
    <p class="bkp-goal">${h.goalKind === 'album' ? '💿' : '🎵'} ${esc(h.goalLabel || 'their goal')}${
      h.districtName ? ` · ${esc(h.districtName)}` : ''}</p>
    ${splitBar(h.ownerProgress, h.myContribution, h.boostedTarget)}
    <div class="bkp-split">
      <span><b>${h.ownerProgress}</b> theirs</span>
      <span class="bkp-mine"><b>${h.myContribution}</b> yours</span>
      <span class="bkp-target">of ${h.boostedTarget}</span>
    </div>
    <p class="bkp-remaining">${remaining > 0
      ? `${remaining} more play${remaining === 1 ? '' : 's'} to finish it together.`
      : 'Target reached — nice work.'}</p>
    ${trackList(h.tracks)}
    <p class="bkp-clock muted">Backup ends ${esc(untilLabel(h.expiresAt))}.</p>
  `
  const stop = el('button', 'btn btn-ghost', 'Stop helping')
  stop.type = 'button'
  stop.onclick = async () => {
    stop.disabled = true
    stop.textContent = 'Leaving…'
    const res = await call('leaveBackupHelper', { agentNo: getAgentNo(), requestId: h.requestId })
    if (!res?.success) {
      stop.disabled = false
      stop.textContent = 'Stop helping'
      toast("Couldn't leave that backup.")
      return
    }
    toast(res.bankedCredit > 0
      ? `You left. Your ${res.bankedCredit} play${res.bankedCredit === 1 ? '' : 's'} stay counted for them.`
      : 'You left that backup.')
    reload()
  }
  const actions = el('div', 'bkp-actions')
  actions.appendChild(stop)
  card.appendChild(actions)
  return card
}

function ownerCard(o) {
  const card = el('div', 'bkp-card bkp-owned')
  const helped = o.status === 'joined'
  card.innerHTML = `
    <div class="bkp-eyebrow">YOUR BACKUP PASS</div>
    <h3 class="bkp-who">${helped ? `${esc(o.helperCodename)} is helping you` : 'Waiting for a helper'}</h3>
    <p class="bkp-goal">${o.goalKind === 'album' ? '💿' : '🎵'} ${esc(o.goalLabel || 'your goal')}${
      o.districtName ? ` · ${esc(o.districtName)}` : ''}</p>
    ${helped
      ? splitBar(o.ownProgress, o.helperContribution, o.boostedTarget)
        + `<div class="bkp-split">
             <span><b>${o.ownProgress}</b> yours</span>
             <span class="bkp-mine"><b>${o.helperContribution}</b> theirs</span>
             <span class="bkp-target">of ${o.boostedTarget}</span>
           </div>
           <p class="bkp-remaining">Target rose from ${o.originalTarget} to ${o.boostedTarget} while they help.</p>`
      : `<p class="bkp-remaining">Any agent can answer this. Its target rises from ${o.originalTarget} to ${o.boostedTarget} the moment someone does — and if you finish it alone first, the pass simply comes back.</p>`}
    <p class="bkp-clock muted">${helped ? 'Backup ends' : 'This request expires'} ${esc(untilLabel(o.expiresAt))}.</p>
  `
  if (o.districtId) {
    const go = el('button', 'btn btn-ghost', 'View the goal')
    go.type = 'button'
    go.onclick = () => {
      const d = getState()?.activeDistrict
      if (d && d.id === o.districtId) { hideOverlay(); goDistrict(d.wardId, d.id) }
      else toast('That district is no longer your active one.')
    }
    const actions = el('div', 'bkp-actions')
    actions.appendChild(go)
    card.appendChild(actions)
  }
  return card
}

function requestRow(r, reload) {
  const row = el('div', 'bkp-req')
  row.innerHTML = `
    <div class="bkp-req-copy">
      <span class="bkp-req-who">${esc(r.ownerCodename)}</span>
      <span class="bkp-req-goal">${r.goalKind === 'album' ? '💿' : '🎵'} ${
        esc(r.goalLabel || (r.goalKind === 'album' ? 'an album goal' : 'a track goal'))}</span>
      <span class="bkp-req-meta">${r.originalTarget} → ${r.boostedTarget} while you help · ends ${esc(untilLabel(r.expiresAt))}</span>
    </div>
  `
  const join = el('button', 'btn btn-primary bkp-req-join', 'Help')
  join.type = 'button'
  join.onclick = async () => {
    join.disabled = true
    join.textContent = 'Joining…'
    const res = await call('joinBackupRequest', { agentNo: getAgentNo(), requestId: r.id })
    if (!res?.success) {
      join.disabled = false
      join.textContent = 'Help'
      toast(JOIN_ERRORS[res?.error] || "Couldn't join that one.")
      return
    }
    toast(`You're backing up ${r.ownerCodename}.`)
    reload()
  }
  row.appendChild(join)
  return row
}

/** Walk into the Zone. Called by the city map's own marker. */
export async function openHelpingZone() {
  const sheet = el('div', 'sheet bkp-sheet')
  sheet.append(
    el('div', 'eyebrow', 'CITY MAP · WEST SEAM'),
    el('h3', 'bkp-post-title', '🤝 Helping Zone'),
    el('p', 'bkp-sub', 'Open one of your goals to another agent, or answer someone else’s. A helper’s streams count toward the goal alongside the owner’s — helping costs nothing and you keep every stream for your own goals too.'),
  )
  const body = el('div', 'bkp-body')
  body.appendChild(el('p', 'muted bkp-loading', 'Loading…'))
  sheet.appendChild(body)
  const close = el('button', 'btn btn-ghost', 'Leave the Zone')
  close.type = 'button'
  close.onclick = hideOverlay
  sheet.appendChild(close)
  showOverlay(sheet)

  const data = await call('getHelpingZone', { agentNo: getAgentNo() })
  if (!body.isConnected) return
  body.innerHTML = ''
  if (!data?.success) {
    body.appendChild(el('p', 'muted', "Couldn't load the Helping Zone. Close this and try again."))
    return
  }

  // Walking in IS looking at the list, so it clears the Pack tab's "someone
  // needs backup" dot — the same thing the old join sheet did on open.
  const newest = data.openRequests.map((r) => r.expiresAt).sort().slice(-1)[0]
  markBackupHelpSeen(getState()?.player?.backupHelp?.latestAt || newest || new Date().toISOString())

  if (data.asHelper) body.appendChild(helperCard(data.asHelper, openHelpingZone))
  if (data.asOwner) body.appendChild(ownerCard(data.asOwner))

  if (!data.asOwner) {
    const own = el('div', 'bkp-card bkp-open')
    own.innerHTML = `
      <div class="bkp-eyebrow">YOUR BACKUP PASS</div>
      <p class="bkp-remaining">${data.backupPasses > 0
        ? `You have ${data.backupPasses} pass${data.backupPasses === 1 ? '' : 'es'}. Open one on a goal you're stuck on and any agent can pitch in.`
        : 'No passes yet. They come from Supply Chests, level-ups and the occasional district restoration.'}</p>
    `
    if (data.backupPasses > 0) {
      const openBtn = el('button', 'btn btn-primary', 'Open a pass on a goal')
      openBtn.type = 'button'
      openBtn.onclick = async () => {
        const items = (getState()?.items || []).filter((i) => i.itemId === 'backup-pass' && !i.usedAt)
        if (!items.length) { toast('No Backup Pass available right now.'); return }
        await openBackupPassFlow(items[0])
      }
      const actions = el('div', 'bkp-actions')
      actions.appendChild(openBtn)
      own.appendChild(actions)
    }
    body.appendChild(own)
  }

  const list = el('div', 'bkp-card bkp-list')
  list.appendChild(el('div', 'bkp-eyebrow', 'WHO NEEDS BACKUP'))
  if (!data.openRequests.length) {
    list.appendChild(el('p', 'bkp-remaining', 'Nobody has an open Backup Pass right now. They only last a few days, so check back.'))
  } else if (data.asHelper) {
    list.appendChild(el('p', 'bkp-remaining',
      `${data.openRequests.length} agent${data.openRequests.length === 1 ? '' : 's'} waiting — you can join another once you finish backing up ${esc(data.asHelper.ownerCodename)}.`))
  } else {
    for (const r of data.openRequests) list.appendChild(requestRow(r, openHelpingZone))
  }
  body.appendChild(list)
}
