// Badge Drawer — a trophy case, not a leaderboard. No ranks, no XP battle,
// no comparison to anyone else's collection: just a grid of what you've
// unlocked and what's still waiting, styled as a gamified reveal rather
// than a stats table.
//
// Two badge systems coexist here: the legacy client-computed set
// (BADGE_CATALOG — streak/level/xp/districts, derived from state with no
// server round trip) and the newer Badge Collection catalog
// (rc_badge_catalog/rc_badges, fetched via getBadgeCollection) that VMA and
// Supply Chest award into, with real photo artwork per earned instance.
// Both render in the same grid; setEquippedBadge already treats both id
// shapes the same way server-side, so equipping either kind works
// identically here.

import { call } from './api.js'
import { el, esc, hideOverlay, setState, toast } from './state.js'
import { BADGE_CATALOG } from './badges.js'
import { getAgentNo } from './session.js'

export function badgeDrawerSheet(state) {
  const sheet = el('div', 'sheet badge-drawer')
  sheet.appendChild(el('div', 'eyebrow', '🎖️ BADGE DRAWER'))
  sheet.appendChild(el('div', 'pl-sub', 'Your collection'))
  sheet.appendChild(el('div', 'bdr-count', 'Loading…'))
  sheet.appendChild(el('div', 'bdr-grid'))
  const detail = el('div', 'bdr-detail')
  detail.hidden = true
  sheet.appendChild(detail)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  loadAndPaint(sheet, state, detail)
  return sheet
}

async function loadAndPaint(sheet, state, detail) {
  const res = await call('getBadgeCollection', { agentNo: getAgentNo() })
  const collection = res.success ? res : { earned: [], templates: [] }

  // One locked tile per template the agent hasn't earned ANY instance of —
  // a template like 'district_frag_1' can be earned many times (once per
  // district), so it only reads as "locked" while the count is genuinely
  // zero.
  const earnedTemplateIds = new Set(collection.earned.map((e) => e.templateId))
  const lockedTemplates = collection.templates.filter((t) => !earnedTemplateIds.has(t.id))

  const legacyEarned = BADGE_CATALOG.filter((b) => b.earned(state))
  const totalEarned = legacyEarned.length + collection.earned.length
  const totalKnown = BADGE_CATALOG.length + collection.earned.length + lockedTemplates.length
  sheet.querySelector('.bdr-count').textContent = `${totalEarned} of ${totalKnown} unlocked`

  const grid = sheet.querySelector('.bdr-grid')
  grid.innerHTML = ''

  for (const b of BADGE_CATALOG) {
    const got = b.earned(state)
    const wearing = state.player?.equippedBadgeId === b.id
    grid.appendChild(legacyTile(b, got, wearing, state, sheet, detail))
  }
  for (const e of collection.earned) {
    const wearing = state.player?.equippedBadgeId === e.badgeId
    grid.appendChild(collectionTile(e, wearing, state, sheet, detail))
  }
  for (const t of lockedTemplates) {
    grid.appendChild(lockedTile(t))
  }
}

function legacyTile(b, got, wearing, state, sheet, detail) {
  const tile = el('button', 'bdr-tile' + (got ? ' got' : ' locked') + (wearing ? ' equipped' : ''),
    `<span class="bdr-icon">${got ? b.icon : '?'}</span>${wearing ? '<i>WORN</i>' : ''}`)
  tile.setAttribute('aria-label', got ? b.name : 'Locked badge')
  tile.onclick = () => showDetail(detail, {
    got, icon: b.icon, name: b.name, desc: b.desc, badgeId: b.id, wearing,
  }, state, sheet)
  return tile
}

function collectionTile(e, wearing, state, sheet, detail) {
  const art = e.artworkUrl ? `<img class="bdr-photo" src="${esc(e.artworkUrl)}" alt="">` : `<span class="bdr-icon">${e.rarity === 'rare' ? '🎖️' : '🔹'}</span>`
  const tile = el('button', 'bdr-tile got' + (wearing ? ' equipped' : '') + (e.rarity === 'rare' ? ' rare' : ''),
    `${art}${wearing ? '<i>WORN</i>' : ''}`)
  tile.setAttribute('aria-label', e.name)
  tile.onclick = () => showDetail(detail, {
    got: true, photo: e.artworkUrl, name: e.name, desc: scopeLine(e), badgeId: e.badgeId, wearing,
  }, state, sheet)
  return tile
}

function lockedTile(t) {
  const tile = el('button', 'bdr-tile locked', '<span class="bdr-icon">?</span>')
  tile.setAttribute('aria-label', 'Locked badge')
  tile.onclick = () => {
    const detail = tile.closest('.badge-drawer').querySelector('.bdr-detail')
    detail.hidden = false
    detail.classList.remove('pop'); void detail.offsetWidth; detail.classList.add('pop')
    detail.innerHTML = `
      <span class="bdr-detail-icon">🔒</span>
      <div class="bdr-detail-name">Locked</div>
      <div class="bdr-detail-desc">${esc(t.unlockHint)}</div>
    `
  }
  return tile
}

function scopeLine(e) {
  if (e.section === 'event') return 'MTV VMAs 2026 event badge.'
  if (e.section === 'ward') return `Earned by restoring ${esc(e.scopeId || 'a ward')}.`
  if (e.section === 'district') return e.scopeId ? `Earned in ${esc(e.scopeId)}.` : 'Earned from district progress.'
  return 'Earned from a ReConnect mission.'
}

function showDetail(detail, info, state, sheet) {
  detail.hidden = false
  detail.classList.remove('pop'); void detail.offsetWidth; detail.classList.add('pop')
  const iconHtml = info.photo ? `<img class="bdr-detail-photo" src="${esc(info.photo)}" alt="">`
    : `<span class="bdr-detail-icon">${info.got ? info.icon : '🔒'}</span>`
  detail.innerHTML = `
    ${iconHtml}
    <div class="bdr-detail-name">${esc(info.got ? info.name : 'Locked')}</div>
    <div class="bdr-detail-desc">${esc(info.got ? info.desc : "Keep going, agent — this one hasn't unlocked yet.")}</div>
  `
  if (info.got) {
    const wear = el('button', 'btn btn-primary bdr-wear', info.wearing ? 'Wearing as Agent Icon' : 'Wear as Agent Icon')
    wear.disabled = info.wearing
    wear.onclick = async () => {
      wear.disabled = true
      const res = await call('setEquippedBadge', { agentNo: getAgentNo(), badgeId: info.badgeId })
      if (!res.success) { toast(res.error === 'badge_locked' ? 'That badge is still locked' : (res.error || "Couldn't equip badge")); wear.disabled = false; return }
      setState({ ...state, player: { ...state.player, equippedBadgeId: info.badgeId, equippedBadgeArtwork: info.photo ? { badgeId: info.badgeId, artworkUrl: info.photo } : null } })
      toast(`${info.name} is now your Agent Icon`)
      hideOverlay()
    }
    detail.appendChild(wear)
  }
}
