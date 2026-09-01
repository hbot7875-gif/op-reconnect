// Badge Drawer — a trophy case, not a leaderboard. No ranks, no XP battle,
// no comparison to anyone else's collection: just a grid of what you've
// unlocked and what's still waiting, styled as a gamified reveal rather
// than a stats table.
//
// Only the photo-based Badge Collection is rendered here. The older
// fire/star/XP/district emoji achievements belong to the previous badge
// experience and are intentionally not mixed into this collection.

import { call } from './api.js'
import { el, esc, getState, hideOverlay, setState, showOverlay, toast } from './state.js'
import { getAgentNo } from './session.js'

const BADGE_SECTIONS = [
  { id: 'district', icon: '◇', title: 'Current District', note: 'Progress from the district you are restoring now' },
  { id: 'ward', icon: '⌂', title: 'Ward Collection', note: 'Earned by bringing a whole ward back online' },
  { id: 'achievement', icon: '✦', title: 'Achievements', note: 'Special moments from missions and challenges' },
  { id: 'event', icon: '◉', title: 'Special Events', note: 'Limited badges from live events' },
]

export function badgeDrawerSheet(state) {
  const sheet = el('div', 'sheet badge-drawer')
  sheet.appendChild(el('div', 'eyebrow', '✦ BADGE COLLECTION'))
  sheet.appendChild(el('div', 'pl-sub bdr-intro', 'A keepsake from every moment you unlock.'))
  const summary = el('div', 'bdr-summary')
  summary.appendChild(el('span', 'bdr-summary-mark', '🎖️'))
  summary.appendChild(el('div', '', '<div class="bdr-count">Loading…</div><div class="bdr-summary-note">Tap a badge to see its story</div>'))
  sheet.appendChild(summary)
  sheet.appendChild(el('div', 'bdr-grid'))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  loadAndPaint(sheet, state)
  return sheet
}

async function loadAndPaint(sheet, state) {
  const count = sheet.querySelector('.bdr-count')
  const grid = sheet.querySelector('.bdr-grid')
  count.textContent = 'Loading…'
  const res = await call('getBadgeCollection', { agentNo: getAgentNo() })
  if (!res.success) {
    count.textContent = "Couldn't load your collection"
    grid.innerHTML = ''
    grid.appendChild(el('p', 'muted bdr-error', esc(res.error || 'Check your connection and try again.')))
    const retry = el('button', 'btn btn-primary bdr-retry', 'Try again')
    retry.onclick = () => loadAndPaint(sheet, getState() || state)
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

  const totalEarned = collection.earned.length
  count.textContent = `${totalEarned} badge${totalEarned === 1 ? '' : 's'} unlocked`

  grid.innerHTML = ''

  for (const sectionMeta of BADGE_SECTIONS) {
    const earned = collection.earned.filter((e) => e.section === sectionMeta.id)
    const locked = lockedTemplates.filter((t) => t.section === sectionMeta.id)
    if (earned.length === 0 && locked.length === 0) continue

    const section = el('section', 'bdr-section')
    section.appendChild(el('div', 'bdr-section-head', `
      <span class="bdr-section-icon">${sectionMeta.icon}</span>
      <span><b>${esc(sectionMeta.title)}</b><small>${esc(sectionMeta.note)}</small></span>
      <em>${earned.length} unlocked</em>
    `))
    const shelf = el('div', 'bdr-shelf')
    for (const e of earned) {
      const wearing = liveState.player?.equippedBadgeId === e.badgeId
      shelf.appendChild(badgeSlot(
        collectionTile(e, wearing, liveState), e.name, e.rarity, true,
      ))
    }
    for (const t of locked) {
      shelf.appendChild(badgeSlot(lockedTile(t, liveState), t.name, t.rarity, false))
    }
    section.appendChild(shelf)
    grid.appendChild(section)
  }
}

function badgeSlot(tile, name, rarity, earned) {
  const slot = el('div', 'bdr-slot ' + (earned ? 'earned' : 'locked') + (rarity === 'rare' ? ' rare' : ''))
  slot.appendChild(tile)
  slot.appendChild(el('span', 'bdr-label', esc(name)))
  slot.appendChild(el('small', 'bdr-state', earned ? (rarity === 'rare' ? 'RARE · UNLOCKED' : 'UNLOCKED') : 'LOCKED'))
  return slot
}

function collectionTile(e, wearing, state) {
  const art = e.artworkUrl ? `<img class="bdr-photo" src="${esc(e.artworkUrl)}" alt="" loading="lazy" decoding="async">` : `<span class="bdr-icon">${e.rarity === 'rare' ? '🎖️' : '🔹'}</span>`
  const tile = el('button', 'bdr-tile got' + (wearing ? ' equipped' : '') + (e.rarity === 'rare' ? ' rare' : ''),
    `${art}${e.rarity === 'rare' ? '<span class="bdr-rarity">RARE</span>' : ''}${wearing ? '<i>WORN</i>' : ''}`)
  tile.setAttribute('aria-label', e.name)
  tile.onclick = () => showOverlay(badgeStorySheet({
    got: true, collection: true, rarity: e.rarity, photo: e.artworkUrl,
    name: e.name, desc: badgeStory(e, state), badgeId: e.badgeId, wearing,
  }, state))
  return tile
}

function lockedTile(t, state) {
  const tile = el('button', 'bdr-tile locked' + (t.rarity === 'rare' ? ' rare' : ''), '<span class="bdr-lock-core">◇</span>')
  tile.setAttribute('aria-label', `${t.name}, locked. ${t.unlockHint}`)
  tile.onclick = () => showOverlay(badgeStorySheet({
    got: false, rarity: t.rarity, name: t.name, desc: t.unlockHint,
  }, state))
  return tile
}

export function badgeStory(e, state) {
  const district = state?.map?.districts?.find((d) => d.id === e.scopeId)
  const ward = state?.map?.wards?.find((w) => w.id === e.scopeId)
  const place = district?.name || e.scopeId || 'this district'
  if (e.templateId === 'district_frag_1') return `Reached 25% restoration progress in ${place}.`
  if (e.templateId === 'district_frag_2') return `Reached 50% restoration progress in ${place}.`
  if (e.templateId === 'district_frag_3') return `Reached 75% restoration progress in ${place}.`
  if (e.templateId === 'district_restored') return `Fully restored ${place}.`
  if (e.templateId === 'ward') return `Restored every district in ${ward?.name || e.scopeId || 'a ward'}.`
  if (e.templateId === 'mission_bond') return 'Completed a ReConnect quest with another agent.'
  if (e.templateId === 'event_vma_voter') return 'Voted for BTS in the 2026 MTV VMAs mission.'
  if (e.templateId === 'event_vma_power_hour') return 'Voted for BTS during a VMA Power Hour.'
  if (e.templateId === 'event_vma_double_day') return 'Voted for BTS on a VMA Double Day.'
  if (e.templateId === 'event_vma_supply_chest') return 'Found this rare badge inside a Supply Chest.'
  if (e.templateId === 'event_jk_birthday_2026') return "Lit every track on Jung Kook's GOLDEN Birthday Era Card."
  if (e.templateId === 'event_jk_golden_defender_2026') return 'Helped light Golden Corner before the whole City reached 100%.'
  if (e.templateId === 'event_jk_golden_encore_2026') return 'Streamed every track on the GOLDEN Birthday Era Card twice over.'
  return e.unlockHint || 'Badge unlocked.'
}

export function badgeStorySheet(info, state) {
  const detail = el('div', 'sheet bdr-story' + (info.rarity === 'rare' ? ' is-rare' : ''))
  const iconHtml = info.photo ? `<img class="bdr-detail-photo" src="${esc(info.photo)}" alt="">`
    : `<span class="bdr-detail-icon">${info.got ? (info.icon || (info.rarity === 'rare' ? '🎖️' : '◇')) : '🔒'}</span>`
  detail.innerHTML = `
    <div class="eyebrow">${info.got ? (info.rarity === 'rare' ? '✦ RARE BADGE' : '◇ BADGE STORY') : '◇ LOCKED BADGE'}</div>
    ${iconHtml}
    <div class="bdr-detail-name">${esc(info.name)}</div>
    <div class="bdr-detail-desc">${esc(info.desc)}</div>
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
  const back = el('button', 'btn btn-ghost bdr-back', 'Back to Collection')
  back.onclick = () => showOverlay(badgeDrawerSheet(getState() || state))
  detail.appendChild(back)
  return detail
}
