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
