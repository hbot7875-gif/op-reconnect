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
import { el, esc, getState, hideOverlay, setState, toast } from './state.js'
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
  const count = sheet.querySelector('.bdr-count')
  const grid = sheet.querySelector('.bdr-grid')
  count.textContent = 'Loading…'
  const res = await call('getBadgeCollection', { agentNo: getAgentNo() })
  if (!res.success) {
    count.textContent = "Couldn't load your collection"
    grid.innerHTML = ''
    grid.appendChild(el('p', 'muted bdr-error', esc(res.error || 'Check your connection and try again.')))
    const retry = el('button', 'btn btn-primary bdr-retry', 'Try again')
    retry.onclick = () => loadAndPaint(sheet, getState() || state, detail)
    grid.appendChild(retry)
    return
  }
  const collection = res
  const liveState = getState() || state

  // One locked tile per template the agent hasn't earned ANY instance of —
  // a template like 'district_frag_1' can be earned many times (once per
  // district), so it only reads as "locked" while the count is genuinely
  // zero.
  const earnedTemplateIds = new Set(collection.earned.map((e) => e.templateId))
  const lockedTemplates = collection.templates.filter((t) => !earnedTemplateIds.has(t.id))

  const legacyEarned = BADGE_CATALOG.filter((b) => b.earned(liveState))
  const totalEarned = legacyEarned.length + collection.earned.length
  count.textContent = `${totalEarned} badge${totalEarned === 1 ? '' : 's'} unlocked`

  grid.innerHTML = ''

  for (const b of BADGE_CATALOG) {
    const got = b.earned(liveState)
    const wearing = liveState.player?.equippedBadgeId === b.id
    grid.appendChild(legacyTile(b, got, wearing, liveState, sheet, detail))
  }
  for (const e of collection.earned) {
    const wearing = liveState.player?.equippedBadgeId === e.badgeId
    grid.appendChild(collectionTile(e, wearing, liveState, sheet, detail))
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
    got: true, collection: true, rarity: e.rarity, photo: e.artworkUrl,
    name: e.name, desc: scopeLine(e, state), badgeId: e.badgeId, wearing,
  }, state, sheet)
  return tile
}

function lockedTile(t) {
  const tile = el('button', 'bdr-tile locked' + (t.rarity === 'rare' ? ' rare' : ''), '<span class="bdr-icon">?</span>')
  tile.setAttribute('aria-label', `${t.name}, locked. ${t.unlockHint}`)
  tile.onclick = () => {
    const detail = tile.closest('.badge-drawer').querySelector('.bdr-detail')
    detail.hidden = false
    detail.classList.toggle('is-rare', t.rarity === 'rare')
    detail.classList.remove('pop'); void detail.offsetWidth; detail.classList.add('pop')
    detail.innerHTML = `
      <span class="bdr-detail-icon">🔒</span>
      <div class="bdr-detail-name">${esc(t.name)}</div>
      <div class="bdr-detail-desc">${esc(t.unlockHint)}</div>
    `
  }
  return tile
}

function scopeLine(e, state) {
  const district = state?.map?.districts?.find((d) => d.id === e.scopeId)
  const ward = state?.map?.wards?.find((w) => w.id === e.scopeId)
  const place = district?.name || e.scopeId || 'this district'
  if (e.templateId === 'district_frag_1') return `Reached 25% restoration progress in ${place}.`
  if (e.templateId === 'district_frag_2') return `Reached 50% restoration progress in ${place}.`
  if (e.templateId === 'district_frag_3') return `Reached 75% restoration progress in ${place}.`
  if (e.templateId === 'district_restored') return `Fully restored ${place}.`
  if (e.templateId === 'ward') return `Restored every district in ${ward?.name || e.scopeId || 'a ward'}.`
  if (e.templateId === 'mission_bond') return 'Completed a ReConnect mission with another agent.'
  if (e.templateId === 'event_vma_voter') return 'Voted for BTS in the 2026 MTV VMAs mission.'
  if (e.templateId === 'event_vma_power_hour') return 'Voted for BTS during a VMA Power Hour.'
  if (e.templateId === 'event_vma_double_day') return 'Voted for BTS on a VMA Double Day.'
  if (e.templateId === 'event_vma_supply_chest') return 'Found this rare badge inside a Supply Chest.'
  return e.unlockHint || 'Badge unlocked.'
}

function showDetail(detail, info, state, sheet) {
  detail.hidden = false
  detail.classList.toggle('is-rare', info.rarity === 'rare')
  detail.classList.remove('pop'); void detail.offsetWidth; detail.classList.add('pop')
  const iconHtml = info.photo ? `<img class="bdr-detail-photo" src="${esc(info.photo)}" alt="">`
    : `<span class="bdr-detail-icon">${info.got ? info.icon : '🔒'}</span>`
  detail.innerHTML = `
    ${iconHtml}
    <div class="bdr-detail-name">${esc(info.got ? info.name : 'Locked')}</div>
    <div class="bdr-detail-desc">${esc(info.got ? info.desc : "Keep going, agent — this one hasn't unlocked yet.")}</div>
  `
  if (info.got) {
    const wear = el('button', info.wearing ? 'btn btn-ghost bdr-wear' : 'btn btn-primary bdr-wear',
      info.wearing ? 'Use Default Agent Icon' : 'Wear as Agent Icon')
    wear.onclick = async () => {
      wear.disabled = true
      const badgeId = info.wearing ? '' : info.badgeId
      const res = await call('setEquippedBadge', { agentNo: getAgentNo(), badgeId })
      if (!res.success) { toast(res.error === 'badge_locked' ? 'That badge is still locked' : (res.error || "Couldn't equip badge")); wear.disabled = false; return }
      const current = getState() || state
      setState({
        ...current,
        player: {
          ...current.player,
          equippedBadgeId: badgeId || null,
          equippedBadgeArtwork: badgeId && info.collection
            ? { badgeId, name: info.name, rarity: info.rarity, artworkUrl: info.photo || null }
            : null,
        },
      })
      toast(info.wearing ? 'Default Agent Icon restored' : `${info.name} is now your Agent Icon`)
      hideOverlay()
    }
    detail.appendChild(wear)
  }
}
