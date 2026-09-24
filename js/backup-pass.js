// Backup Pass — spend a Pack item to open one of your own active track/album
// goals to a helper. Backend (lib/backup-pass.ts) already does everything
// atomically; this is the missing UI to actually reach it — the feature had
// no frontend at all before this, so the item sat in the Pack unusable.

import { el, esc, toast, showOverlay, hideOverlay, getState, setState } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'

function eligibleGoals(state) {
  const d = state?.activeDistrict
  if (!d) return []
  const tracks = (d.trackGoals || []).filter((g) => !g.done)
    .map((g) => ({ kind: 'track', ref: g.id, label: g.label, progress: g.progress, target: g.target }))
  const albums = (d.albums || []).filter((a) => !a.done)
    .map((a) => ({ kind: 'album', ref: a.id, label: a.label, progress: a.passesDone, target: a.target }))
  return [...tracks, ...albums]
}

async function confirmOpen(item, district, goal) {
  const res = await call('openBackupRequest', {
    agentNo: getAgentNo(), districtId: district.id, goalKind: goal.kind, goalRef: goal.ref,
  })
  if (!res?.success) {
    const messages = {
      already_has_active_backup: 'You already have an open Backup Pass.',
      goal_already_done: "You've already finished that goal — nothing to open.",
      no_backup_pass: "That Backup Pass isn't available anymore.",
    }
    toast(messages[res?.error] || "Couldn't open that right now.")
    return
  }
  const state = getState()
  const list = state.items || []
  const hit = list.find((x) => x.id === item.id)
  if (hit) hit.usedAt = new Date().toISOString()
  setState({ ...state, items: [...list] })
  hideOverlay()
  toast(`Backup Pass open on ${goal.label} — any agent can now help.`)
}

function goalPicker(item, district) {
  const sheet = el('div', 'sheet backup-sheet')
  sheet.append(el('div', 'eyebrow', 'BACKUP PASS'), el('h3', '', 'Open a goal to a helper'))

  const goals = eligibleGoals(getState())
  if (!goals.length) {
    sheet.appendChild(el('p', 'muted', `Every goal in ${esc(district.name || 'your district')} is already done — nothing left to open.`))
  } else {
    sheet.appendChild(el('p', 'muted',
      `Pick one unfinished goal in ${esc(district.name || 'your district')}. A helper's own streams count toward it (target raised ~20% while they're helping) — finish it solo first and the Backup Pass just cancels, no loss.`))
    const list = el('div', 'backup-goal-list')
    for (const g of goals) {
      const row = el('button', 'backup-goal-row')
      row.type = 'button'
      row.innerHTML = `
        <span class="bg-label">${g.kind === 'album' ? '💿' : '🎵'} ${esc(g.label)}</span>
        <span class="bg-progress muted">${g.progress}/${g.target}</span>
      `
      row.onclick = () => confirmOpen(item, district, g)
      list.appendChild(row)
    }
    sheet.appendChild(list)
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function statusSheet(status) {
  const sheet = el('div', 'sheet backup-sheet')
  sheet.append(el('div', 'eyebrow', 'BACKUP PASS'), el('h3', '', 'Already active'))
  const req = status.asOwner
  sheet.appendChild(el('p', 'muted',
    req.status === 'joined'
      ? `A helper joined your ${esc(req.goalKind)} goal — their streams are counting toward it now.`
      : "Open, waiting for a helper to join. It'll auto-cancel with no loss if you finish the goal solo first."))
  sheet.appendChild(el('p', 'muted', `Expires ${new Date(req.expiresAt).toLocaleDateString()}.`))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/** Opened from items.js's itemSheet when the tapped item is an unused
 *  Backup Pass. Checks live status first — an agent can only ever have one
 *  open/joined request at a time (see rc_backup_open), so if one's already
 *  running this shows its status instead of a picker that would just fail. */
export async function openBackupPassFlow(item) {
  const state = getState()
  const district = state?.activeDistrict
  if (!district) {
    showOverlay((() => {
      const sheet = el('div', 'sheet backup-sheet')
      sheet.append(el('div', 'eyebrow', 'BACKUP PASS'),
        el('p', 'muted', 'You need an active district to open a Backup Pass on. Start restoring one first.'))
      const close = el('button', 'btn btn-ghost', 'Close')
      close.onclick = hideOverlay
      sheet.appendChild(close)
      return sheet
    })())
    return
  }

  const status = await call('getBackupStatus', { agentNo: getAgentNo() })
  if (status?.success && status.asOwner) {
    showOverlay(statusSheet(status))
    return
  }
  showOverlay(goalPicker(item, district))
}

/* ── The helper side ──────────────────────────────────────────────────────
   The audit found the reason no Backup Pass had EVER been joined in five
   weeks of production: listOpenBackupRequests and joinBackupRequest were
   routed and working on the server, but nothing in the client ever called
   them. Owners could open a request; nobody could ever answer it, so all 41
   requests expired unhelped. This is that missing half.

   Helping costs nothing and needs no pass of your own — only the owner
   spends one (see rc_backup_open) — so this is reachable whether or not the
   agent is holding a Backup Pass. */

const JOIN_ERRORS = {
  not_found: 'That request is no longer available.',
  not_open: 'Someone else got there first.',
  expired: 'That request just expired.',
  cannot_help_self: "That's your own request.",
  already_helping_elsewhere: "You're already helping another agent — finish that one first.",
  already_paired_this_goal: "You've already helped this agent with that goal.",
}

function helpRow(req, onJoined) {
  const row = el('div', 'backup-help-row')
  const label = req.goalKind === 'album' ? '💿 an album goal' : '🎵 a track goal'
  row.innerHTML = `
    <span class="bh-copy">
      <span class="bh-name">${esc(req.ownerCodename)}</span>
      <span class="bh-goal">${label} · ${req.originalTarget} → ${req.boostedTarget} while you help</span>
    </span>
  `
  const join = el('button', 'btn btn-primary bh-join', 'Help')
  join.type = 'button'
  join.onclick = async () => {
    join.disabled = true
    join.textContent = 'Joining…'
    const res = await call('joinBackupRequest', { agentNo: getAgentNo(), requestId: req.id })
    if (!res?.success) {
      join.disabled = false
      join.textContent = 'Help'
      toast(JOIN_ERRORS[res?.error] || "Couldn't join that one.")
      return
    }
    hideOverlay()
    toast(`You're backing up ${req.ownerCodename} — your streams on that goal now count for them.`)
    onJoined?.()
  }
  row.appendChild(join)
  return row
}

function helpSheet(requests, onJoined) {
  const sheet = el('div', 'sheet backup-sheet')
  sheet.append(el('div', 'eyebrow', 'BACKUP PASS'), el('h3', '', 'Agents needing backup'))
  if (!requests.length) {
    sheet.appendChild(el('p', 'muted', 'Nobody has an open Backup Pass right now. Check back later — they only last a few days.'))
  } else {
    sheet.appendChild(el('p', 'muted',
      "Your own streams on their goal count toward it while you help. It costs you nothing, and you keep every stream for your own goals too."))
    const list = el('div', 'backup-help-list')
    for (const r of requests) list.appendChild(helpRow(r, onJoined))
    sheet.appendChild(list)
  }
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/* Which open requests this agent has already looked at. The Pack tab's dot
   means "someone opened one since you last checked", not merely "requests
   exist" — otherwise it would be permanently lit and stop meaning anything. */
const SEEN_KEY = 'rc_backup_help_seen'

export function backupHelpSeenAt() {
  try { return localStorage.getItem(SEEN_KEY) || null } catch { return null }
}

export function markBackupHelpSeen(latestAt) {
  try { if (latestAt) localStorage.setItem(SEEN_KEY, latestAt) } catch { /* private mode */ }
}

/** True when there is at least one open request newer than the last one this
 *  agent looked at. */
export function hasNewBackupRequests(backupHelp) {
  if (!backupHelp?.open || !backupHelp.latestAt) return false
  const seen = backupHelpSeenAt()
  return !seen || new Date(backupHelp.latestAt).getTime() > new Date(seen).getTime()
}

/** The Pack's "Help an agent" slot. Helping needs no pass, so this is always
 *  available — it just may have nobody to show. */
export async function openBackupHelpFlow(onJoined) {
  const res = await call('listOpenBackupRequests', { agentNo: getAgentNo() })
  if (!res?.success) { toast("Couldn't load who needs backup."); return }
  // Looking at the list is what clears the dot.
  const newest = (res.requests || []).map((r) => r.expiresAt).sort().slice(-1)[0]
  const state = getState()
  markBackupHelpSeen(state?.player?.backupHelp?.latestAt || newest || new Date().toISOString())
  showOverlay(helpSheet(res.requests || [], onJoined))
}

/** How many agents are currently waiting for a helper — for the Pack slot's
 *  subtitle, so the count is visible without opening anything. */
export async function countOpenBackupRequests() {
  const res = await call('listOpenBackupRequests', { agentNo: getAgentNo() })
  return res?.success ? (res.requests || []).length : null
}
