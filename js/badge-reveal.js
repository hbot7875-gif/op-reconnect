// One-time Badge Collection reveal. Existing badges establish the local
// baseline on first use; only IDs first seen afterward get a celebration.
// Multiple badges earned in one server update are grouped into one reveal so
// a district restoration never turns into several blocking popups.

import { call } from './api.js'
import { badgeDrawerSheet, badgeStory } from './badge-drawer.js'
import { collectionBadgeIds } from './badges.js'
import { getAgentNo } from './session.js'
import { el, esc, getState, hideOverlay, showOverlay } from './state.js'

const SEEN_KEY = 'rc_seen_collection_badges:'
const pending = new Set()
const queue = []
let showing = false
let pumpTimer = null

function readSeen(agentNo) {
  try {
    const raw = localStorage.getItem(SEEN_KEY + agentNo)
    return raw === null ? null : new Set(JSON.parse(raw))
  } catch (_) { return null }
}

function writeSeen(agentNo, ids) {
  try { localStorage.setItem(SEEN_KEY + agentNo, JSON.stringify([...ids])) } catch (_) {}
}

export async function checkForBadgeUnlocks(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  const currentIds = collectionBadgeIds(state)
  const seen = readSeen(agentNo)

  // Do not replay every existing badge the first time this version loads.
  if (seen === null) { writeSeen(agentNo, new Set(currentIds)); return }

  const fresh = currentIds.filter((id) => !seen.has(id) && !pending.has(id))
  if (!fresh.length) return
  fresh.forEach((id) => pending.add(id))

  const res = await call('getBadgeCollection', { agentNo })
  fresh.forEach((id) => pending.delete(id))
  if (!res.success) return // retry on the next state refresh

  const newBadges = (res.earned || []).filter((e) => fresh.includes(e.badgeId))
  const nextSeen = readSeen(agentNo) || seen
  fresh.forEach((id) => nextSeen.add(id))
  writeSeen(agentNo, nextSeen)
  if (!newBadges.length) return

  // Lead with the rarest/newest badge and acknowledge the rest in one card.
  newBadges.sort((a, b) => Number(b.rarity === 'rare') - Number(a.rarity === 'rare')
    || new Date(b.earnedAt || 0) - new Date(a.earnedAt || 0))
  queue.push({ badge: newBadges[0], additional: newBadges.length - 1, state })
  pumpRevealQueue()
}

function pumpRevealQueue() {
  if (showing || !queue.length) return
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) {
    clearTimeout(pumpTimer)
    pumpTimer = setTimeout(pumpRevealQueue, 650)
    return
  }
  showing = true
  const next = queue.shift()
  const sheet = unlockSheet(next.badge, next.additional, next.state)
  showOverlay(sheet)

  // Backdrop taps and Escape also dismiss shared overlays. Observe that path
  // so the reveal queue never gets stuck waiting for a button-only cleanup.
  const observer = new MutationObserver(() => {
    if (!overlay || overlay.hidden || !overlay.contains(sheet)) {
      showing = false
      observer.disconnect()
      setTimeout(pumpRevealQueue, 0)
    }
  })
  observer.observe(overlay, { childList: true, attributes: true, attributeFilter: ['hidden'] })
}

function unlockSheet(badge, additional, state) {
  const rare = badge.rarity === 'rare'
  const sheet = el('div', 'sheet badge-unlock' + (rare ? ' is-rare' : ''))
  const art = badge.artworkUrl
    ? `<img src="${esc(badge.artworkUrl)}" alt="" decoding="async">`
    : `<span>${rare ? '🎖️' : '◇'}</span>`
  sheet.innerHTML = `
    <div class="bgu-rays" aria-hidden="true"></div>
    <div class="bgu-eyebrow">${rare ? '✦ RARE BADGE FOUND' : '◇ BADGE UNLOCKED'}</div>
    <div class="bgu-art"><div class="bgu-scan" aria-hidden="true"></div>${art}</div>
    <div class="bgu-name">${esc(badge.name)}</div>
    <p class="bgu-story">${esc(badgeStory(badge, state))}</p>
    ${additional ? `<div class="bgu-more">+${additional} more badge${additional === 1 ? '' : 's'} added to your collection</div>` : ''}
    <div class="bgu-saved">Saved in your Badge Collection</div>
  `
  const actions = el('div', 'bgu-actions')
  const view = el('button', 'btn btn-primary', 'View Collection')
  view.onclick = () => {
    showing = false
    showOverlay(badgeDrawerSheet(getState() || state))
    setTimeout(pumpRevealQueue, 0)
  }
  const later = el('button', 'btn btn-ghost', 'Continue')
  later.onclick = () => {
    showing = false
    hideOverlay()
    setTimeout(pumpRevealQueue, 0)
  }
  actions.append(view, later)
  sheet.appendChild(actions)
  return sheet
}
