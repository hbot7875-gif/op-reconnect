// The ReConnect quest "lobby": the team shown as seats (you, invited agents,
// empty spots) for an open mission, instead of a roster table. Pure, so
// every seat state is testable; screen-district.js wires the buttons.

import { rcIcon } from './reconnect-icons.js'

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/** One entry per seat, in order: you, teammates, invited agents, then empty
 *  spots up to the team size. Expired invites and teammates whose own
 *  district ran out don't hold a seat. For a mixed-district team (`seats`,
 *  from config.seats) each seat also says whether it is the recruit seat
 *  (helper) or a local one, and open spots say which kind they are. */
export function lobbySeats(participants = [], requiredAgents = 0, seats = null) {
  const mixed = !!seats && participants.some((p) => typeof p.helper === 'boolean')
  const live = participants.filter((p) => !(p.status === 'invited' && p.inviteExpired) && !p.leftDistrict)
  const rank = (p) => (p.isMe ? 0 : p.status === 'joined' ? 1 : 2)
  const out = [...live].sort((a, b) => rank(a) - rank(b)).map((p) => ({
    kind: p.status === 'invited' ? 'invited' : p.idle ? 'quiet' : 'ready',
    name: p.isMe ? 'You' : String(p.codename || 'Agent'),
    isMe: !!p.isMe,
    agentNo: p.agentNo || null,
    removable: !!p.removable,
    ...(mixed ? { helper: !!p.helper } : {}),
  }))
  const empties = Math.max(0, requiredAgents - out.length)
  // Open recruit seats = recruit seats not yet taken by anyone on the team.
  const helperOpen = mixed ? Math.min(empties, Math.max(0, seats.helper - out.filter((s) => s.helper).length)) : 0
  for (let i = 0; i < empties; i++) {
    out.push({ kind: 'empty', name: 'Empty', ...(mixed ? { helper: i >= empties - helperOpen } : {}) })
  }
  return out
}

/** Who a mixed-district team still needs, counting joined teammates only:
 *  { local, helper }, or null when the team has no seat rule or the server
 *  didn't say who sits where. */
export function seatNeeds(participants = [], seats = null) {
  if (!seats || !participants.some((p) => typeof p.helper === 'boolean')) return null
  const joined = participants.filter((p) => p.status === 'joined' && !p.leftDistrict)
  return {
    local: Math.max(0, seats.local - joined.filter((p) => !p.helper).length),
    helper: Math.max(0, seats.helper - joined.filter((p) => p.helper).length),
  }
}

/** "1 more ARMY from Urmi Terrace and 1 from Home Base" (or one side only). */
export function seatNeedsPhrase(needs, localName, helperFrom) {
  const parts = []
  if (needs.local) parts.push(`${needs.local} more ARMY${needs.local === 1 ? '' : 's'} from ${localName}`)
  if (needs.helper) parts.push(`${needs.helper}${parts.length ? '' : ` more ARMY${needs.helper === 1 ? '' : 's'}`} from ${helperFrom}`)
  return parts.join(' and ')
}

const SEAT_STATE = { ready: 'Ready', quiet: 'Quiet', invited: 'Invited', empty: '' }

/** The seats as buttons/tiles. `canInvite` turns empty seats into an Invite
 *  button; `canCancel` shows a cancel control on pending invites the viewer
 *  may withdraw. On a mixed-district team (`localName`/`helperFrom` given and
 *  seats carrying `helper`) each seat names where it comes from. Agent
 *  numbers ride along as data attributes only. */
export function lobbySeatsHtml(seats, { canInvite = false, canCancel = false, localName = '', helperFrom = '' } = {}) {
  const from = (s) => (typeof s.helper === 'boolean' && localName && helperFrom
    ? `<em class="rl-from${s.helper ? ' is-helper' : ''}">${escHtml(s.helper ? helperFrom : localName)}</em>` : '')
  return seats.map((s, i) => {
    if (s.kind === 'empty') {
      return canInvite
        ? `<button class="rl-seat is-empty" type="button" data-seat-invite="${i}"><span class="rl-avatar" aria-hidden="true">${rcIcon('userPlus')}</span><b>Invite</b><small>Open spot</small>${from(s)}</button>`
        : `<div class="rl-seat is-empty"><span class="rl-avatar" aria-hidden="true">${rcIcon('users')}</span><b>Open</b><small>spot</small>${from(s)}</div>`
    }
    const initial = escHtml(s.isMe ? 'You'.charAt(0) : [...s.name][0] || '?').toUpperCase()
    const cancel = canCancel && s.kind === 'invited' && s.removable && s.agentNo
      ? `<button class="rl-cancel" type="button" data-seat-cancel="${escHtml(s.agentNo)}" aria-label="Cancel invite to ${escHtml(s.name)}">×</button>`
      : ''
    return `<div class="rl-seat is-${s.kind}${s.isMe ? ' is-me' : ''}"><span class="rl-avatar" aria-hidden="true">${initial}</span><b>${escHtml(s.name)}</b><small>${SEAT_STATE[s.kind]}</small>${from(s)}${cancel}</div>`
  }).join('')
}

/** The team's open places, counting invites already out: "2 spots open",
 *  "1 invited · 1 spot open", "1 invited", or "Team full". `need` is seats
 *  still to fill, `invited` the live invites among them. */
export function spotsLeftLabel(need, invited = 0) {
  if (need <= 0) return 'Team full'
  const sent = Math.min(invited, need)
  const open = need - sent
  const openText = open ? `${open} spot${open === 1 ? '' : 's'} open` : ''
  return sent ? `${sent} invited${openText ? ` · ${openText}` : ''}` : openText
}

// ── Small "once" moments, remembered per device ─────────────────────────
// Each effect plays once per change, never on every repaint or poll, and a
// first look at a mission records the state silently instead of
// celebrating everything already there.
const safeStore = () => { try { return globalThis.localStorage || null } catch (_) { return null } }
const readJson = (store, key) => { try { return JSON.parse(store?.getItem(key) ?? 'null') } catch (_) { return null } }
const writeJson = (store, key, v) => { try { store?.setItem(key, JSON.stringify(v)) } catch (_) {} }

/** Teammates who joined since this device last looked at the mission. */
export function newlyJoined(missionId, agentNos, store = safeStore()) {
  const key = `rc_lobby_joined:${missionId}`
  const seen = readJson(store, key)
  writeJson(store, key, agentNos)
  return Array.isArray(seen) ? agentNos.filter((a) => !seen.includes(a)) : []
}

export const MILESTONES = Object.freeze([25, 50, 75])

/** Which progress milestones are reached, and which were crossed since the
 *  last look (those get a single pulse). */
export function milestoneState(missionId, pct, store = safeStore()) {
  const key = `rc_lobby_ms:${missionId}`
  const before = readJson(store, key)
  const hit = MILESTONES.filter((t) => pct >= t)
  const top = hit.length ? hit[hit.length - 1] : 0
  if (before == null || top > before) writeJson(store, key, top)
  return { hit, fresh: before == null ? [] : hit.filter((t) => t > before) }
}

/** Remember that this device saw the mission while it was still open. */
export function noteMissionOpen(missionId, store = safeStore()) {
  writeJson(store, `rc_lobby_open:${missionId}`, 1)
}

/** True once: the first time this device sees a mission it watched while
 *  open come back complete. Old completions never celebrate. */
export function celebrateOnce(missionId, store = safeStore()) {
  if (!missionId || readJson(store, `rc_lobby_open:${missionId}`) !== 1) return false
  if (readJson(store, `rc_lobby_won:${missionId}`) === 1) return false
  writeJson(store, `rc_lobby_won:${missionId}`, 1)
  return true
}

// Each sends its text; the icon is decoration beside it.
export const QUICK_REPLIES = Object.freeze([
  { text: 'Streaming now', icon: rcIcon('headphones') },
  { text: 'Done for today', icon: rcIcon('checkCircle') },
  { text: "Let's go", icon: rcIcon('heart') },
])

/** A ReConnect sheet that rises from the bottom on phones, with a grab
 *  handle you can swipe down to close. Desktop keeps the centred dialog
 *  (CSS). Only a drag that starts on the top strip closes, so scrolling a
 *  list inside the sheet never does. */
export function asBottomSheet(sheet, onClose) {
  sheet.classList.add('rl-bottom')
  const grab = document.createElement('div')
  grab.className = 'rl-grab'
  grab.setAttribute('aria-hidden', 'true')
  sheet.prepend(grab)
  let startY = null
  let dy = 0
  sheet.addEventListener('touchstart', (e) => {
    const top = sheet.getBoundingClientRect().top
    if (sheet.scrollTop > 0 || e.touches[0].clientY - top > 56) { startY = null; return }
    startY = e.touches[0].clientY
    dy = 0
  }, { passive: true })
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return
    dy = Math.max(0, e.touches[0].clientY - startY)
    sheet.style.transform = dy ? `translateY(${dy}px)` : ''
  }, { passive: true })
  sheet.addEventListener('touchend', () => {
    if (startY == null) return
    startY = null
    if (dy > 90) onClose()
    else sheet.style.transform = ''
  })
  return sheet
}
