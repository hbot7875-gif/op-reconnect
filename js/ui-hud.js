// HUD header: codename + level (the frequent progression number), rank as
// smaller narrative status, streak, and — only when one's running — an
// active XP boost. Streaming mode used to live here as a pill; it's a
// once-in-a-while setting, not something that should compete for space with
// player progression, so it's Settings-only now (openModeSheet is still
// exported from here so that row can open the exact same sheet).
//
// The level ladder (frequent, escalating: level/xpIntoLevel/xpForNextLevel)
// and the rank ladder (rare, narrative titles) are two different systems the
// backend already computes — see leveling.ts / config.ts's rankFor. This
// used to show only rank progress, with XP-bar math approximated from a
// hardcoded rank-threshold guess (rankFloor, now gone) because the real
// per-rank floor wasn't in the payload. Showing level progress instead needs
// no guessing: xpIntoLevel/xpForNextLevel come straight from the server.

import { call } from './api.js'
import { el, esc, toast, setState, showOverlay, hideOverlay } from './state.js'
import { getScreen, goWorld, goResources, goSettings, goCandyStar, goRanking } from './router.js'
import { getAgentNo } from './session.js'
import { BADGE_CATALOG, equippedBadge } from './badges.js'

/** { multiplier, minsLeft } while state.player.boost is live, else null. */
function activeBoost(boost) {
  if (!boost?.expiresAt) return null
  const msLeft = new Date(boost.expiresAt).getTime() - Date.now()
  if (msLeft <= 0) return null
  return { multiplier: boost.multiplier, minsLeft: Math.max(1, Math.round(msLeft / 60000)) }
}

export function renderHud(container, state) {
  const p = state.player
  const lvl = p.level
  const pct = Math.max(0, Math.min(100, Math.round((lvl.xpIntoLevel / Math.max(1, lvl.xpForNextLevel)) * 100)))
  const xpLeft = Math.max(0, lvl.xpForNextLevel - lvl.xpIntoLevel)
  const boost = activeBoost(p.boost)
  const agentBadge = equippedBadge(state)
  const streakLabel = p.streak.current > 0 ? `🔥 ${p.streak.current}D` : '○ 0D'

  const invites = state.invites || []

  container.innerHTML = `
    <div class="hud-inner">
      <div class="hud-row">
        <button class="hud-identity" id="levelPill" type="button" title="Open Agent Dossier">
          <span class="hud-crest${agentBadge ? ' has-badge' : ''}" aria-hidden="true"><i></i><b>${agentBadge ? agentBadge.icon : '⟭⟬'}</b></span>
          <span class="hud-who">
            <span class="hud-code">${esc(p.codename)}</span>
            <span class="hud-meta"><em>${esc(p.rank.title)}</em><i>·</i><b>LV ${lvl.level}</b></span>
          </span>
        </button>
        <div class="hud-streak" title="${p.streak.current} days in a row">${streakLabel}</div>
        <button class="hud-bell" id="bellBtn" type="button" title="Invites"
          aria-label="${invites.length ? `${invites.length} pending invite${invites.length === 1 ? '' : 's'}` : 'No pending invites'}">
          🔔${invites.length ? `<span class="hud-bell-count">${invites.length}</span>` : ''}
        </button>
      </div>
    </div>
    <div class="hud-xp">
      <span class="hud-xp-note">${xpLeft} XP to LV ${lvl.level + 1}</span>
      <div class="xp-bar"><div class="xp-fill" style="width:${pct}%"></div></div>
      ${boost ? `<span class="hud-boost">${boost.multiplier}&times; BOOST &middot; ${boost.minsLeft}m</span>` : ''}
    </div>
  `
  container.querySelector('#levelPill').onclick = () => showOverlay(progressSheet(state))
  container.querySelector('#bellBtn').onclick = () => showOverlay(invitesSheet(state))
}

/** LEVEL {n}, XP progress, next-level rewards, active boost (if any), rank +
 *  next rank, badge count — everything the compact HUD strip leaves out. */
function progressSheet(state) {
  const p = state.player
  const lvl = p.level
  const pct = Math.max(0, Math.min(100, Math.round((lvl.xpIntoLevel / Math.max(1, lvl.xpForNextLevel)) * 100)))
  const rewards = lvl.nextRewards || {}
  const boost = activeBoost(p.boost)

  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', `LEVEL ${lvl.level}`))
  if (lvl.name) sheet.appendChild(el('h3', '', esc(lvl.name)))
  sheet.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1"><div class="pfill" style="width:${pct}%"></div></div>
    <span class="count">${lvl.xpIntoLevel} / ${lvl.xpForNextLevel} XP</span>
  `))

  const rewardLines = []
  if (rewards.fuel) rewardLines.push(`<div class="bd-line"><span>Fuel</span><b>+${rewards.fuel}</b></div>`)
  if (rewards.streakFreeze) rewardLines.push(`<div class="bd-line"><span>Streak freeze</span><b>+${rewards.streakFreeze}</b></div>`)
  if (rewards.boostMultiplier > 1) rewardLines.push(`<div class="bd-line"><span>XP boost</span><b>${rewards.boostMultiplier}&times; for ${rewards.boostMinutes}m</b></div>`)
  if (rewardLines.length) {
    sheet.appendChild(el('div', 'bd-block', `<div class="bd-block-head">Next level rewards</div>${rewardLines.join('')}`))
  }

  if (boost) {
    sheet.appendChild(el('div', 'bd-block', `
      <div class="bd-block-head">Active boost</div>
      <div class="bd-line"><span>Multiplier</span><b>${boost.multiplier}&times;</b></div>
      <div class="bd-line"><span>Time left</span><b>${boost.minsLeft}m</b></div>
    `))
  }

  sheet.appendChild(el('div', 'bd-block', `
    <div class="bd-block-head">Rank</div>
    <div class="bd-line"><span>Current</span><b>${esc(p.rank.title)}</b></div>
    ${p.rank.nextTitle ? `<div class="bd-line"><span>Next rank</span><b>${esc(p.rank.nextTitle)}</b></div>` : ''}
    <div class="bd-line"><span>Badges earned</span><b>${BADGE_CATALOG.filter((b) => b.earned(state)).length} / ${BADGE_CATALOG.length}</b></div>
  `))

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/** Pending reconnect-mission invites — another agent already restoring a
 *  district asked you to join them there. Backend resolves invited_by to a
 *  codename before this ever reaches the client (reconnect-missions.ts's
 *  getMyInvites), so there's no agent number to leak here. A full reload on
 *  respond rather than a local state patch: accepting can change the
 *  invitee's own district goals (the reconnect goal gets frozen in), and
 *  that's exactly the kind of derived state not worth hand-patching. */
function invitesSheet(state) {
  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', '🔔 INVITES'))
  const invites = state.invites || []

  if (!invites.length) {
    sheet.appendChild(el('p', 'muted', "No pending invites. If another agent invites you to help restore their district, it shows up here."))
  }

  for (const inv of invites) {
    const row = el('div', 'bd-block')
    row.innerHTML = `
      <div class="bd-block-head">${esc(inv.districtName)}</div>
      <p class="muted invite-body">${esc(inv.fromCodename)} invited you to help restore this district.</p>
    `
    const actions = el('div', 'invite-actions')
    const accept = el('button', 'btn btn-primary', 'Accept')
    const decline = el('button', 'btn btn-ghost', 'Decline')
    const respond = async (accepted) => {
      accept.disabled = true
      decline.disabled = true
      const res = await call('respondReconnectInvite', { agentNo: getAgentNo(), districtId: inv.districtId, accept: accepted })
      if (!res.success) {
        toast(res.error || "Couldn't reach that invite")
        accept.disabled = false
        decline.disabled = false
        return
      }
      hideOverlay()
      toast(accepted ? 'Joined the mission' : 'Invite declined')
      location.reload()
    }
    accept.onclick = () => respond(true)
    decline.onclick = () => respond(false)
    actions.append(accept, decline)
    row.appendChild(actions)
    sheet.appendChild(row)
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

// Candy Star, BOTZ and Rankings used to be cards inside the Pack screen —
// one tap to Pack, then a second to whichever tool you actually wanted. They
// get their own tabs now, directly reachable from every screen; Pack keeps
// The 148 Protocol, the Badge Drawer, and the resource/merch view, which
// don't fit a tab (no icon
// alone says "what you're carrying"). BOTZ leaves the app entirely
// (botz.html is its own page), so it's the one tab that's a real `<a href>`
// rather than a router push — it can never show as "selected" the way the
// others do, same as any link out.
const TABS = [
  { key: 'network', icon: '🏙️', label: 'City', go: goWorld,
    sel: (here) => here !== 'resources' && here !== 'settings' && here !== 'candystar' && here !== 'ranking' },
  { key: 'resources', icon: '🎒', label: 'Pack', go: goResources,
    sel: (here) => here === 'resources' },
  { key: 'candystar', icon: '🍬', label: 'Candy', go: goCandyStar,
    sel: (here) => here === 'candystar' },
  { key: 'botz', icon: '📻', label: 'BOTZ',
    href: () => 'botz.html' + (getAgentNo() ? `?agent=${encodeURIComponent(getAgentNo())}` : '') },
  { key: 'ranking', icon: '🏆', label: 'Ranks', go: goRanking,
    sel: (here) => here === 'ranking' },
  { key: 'settings', icon: '⚙️', label: 'Settings', go: goSettings,
    sel: (here) => here === 'settings' },
]

/** The nav strip — a separate element from the status header above so it can
 *  sit fixed to the bottom of the screen (reconnect.css's #tabbar), in thumb
 *  reach on a phone. Reads state fresh each call (screen changes repaint the
 *  whole HUD anyway, see main.js), so there's no state to keep in sync
 *  between the two containers. */
export function renderTabbar(container, state) {
  const here = getScreen().name
  const tabsHtml = TABS.map((t) => {
    const isSel = t.sel ? t.sel(here) : false
    const tag = t.href ? 'a' : 'button'
    const attrs = t.href ? ` href="${esc(t.href())}"` : ' type="button"'
    return `<${tag} class="hud-tab${isSel ? ' sel' : ''}" data-tab="${t.key}" title="${esc(t.label)}"${attrs}>
      <span class="hud-tab-ico" aria-hidden="true">${t.icon}</span>
      <span class="hud-tab-lbl">${esc(t.label)}</span>
    </${tag}>`
  }).join('')
  container.innerHTML = `<div class="hud-tabs">${tabsHtml}</div>`

  for (const t of TABS) {
    if (!t.go) continue
    const node = container.querySelector(`[data-tab="${t.key}"]`)
    if (!node.classList.contains('sel')) node.onclick = (e) => t.go({ x: e.clientX, y: e.clientY })
  }
}

const MODES = {
  easy: { title: 'Easy', sub: '1 device · normal targets · 10 goal streams = 1 XP' },
  medium: { title: 'Medium', sub: '2–4 accounts · 2× targets · 20 goal streams = 1 XP' },
  hard: { title: 'Hard', sub: '5–6 accounts · 4× targets · 30 goal streams = 1 XP' },
}

/** Exported so the Settings screen's "Streaming mode" row opens the same
 *  sheet the HUD pill does — one difficulty picker, not two that drift. */
export function openModeSheet(state) {
  const sheet = el('div', 'sheet')
  sheet.append(
    el('div', 'eyebrow', 'STREAMING MODE'),
    el('h3', '', 'How many accounts are you running?'),
    el('p', 'muted', 'More accounts means bigger targets and slower XP from assigned goal streams — 10/20/30 for 1 XP on easy/medium/hard. Takes effect tomorrow (KST); today keeps whatever mode you started it on.'),
  )
  const grid = el('div', 'mode-grid')
  for (const key of ['easy', 'medium', 'hard']) {
    const m = MODES[key]
    const opt = el('button', 'mode-opt' + (state.player.mode === key ? ' sel' : ''),
      `<div class="t">${m.title}</div><div class="s">${m.sub}</div>`)
    opt.onclick = async () => {
      hideOverlay()
      const res = await call('setMode', { agentNo: getAgentNo(), mode: key })
      if (res.success) { setState(res); toast(`You're on ${key} now`) }
      else toast(res.error || "Couldn't change mode")
    }
    grid.appendChild(opt)
  }
  sheet.appendChild(grid)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  showOverlay(sheet)
}
