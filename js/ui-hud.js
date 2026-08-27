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
import { earnedBadgeCount, equippedBadge } from './badges.js'
import { openMoonStation } from './settings-streams.js'

/** { multiplier, minsLeft } while state.player.boost is live, else null. */
function activeBoost(boost) {
  if (!boost?.expiresAt) return null
  const msLeft = new Date(boost.expiresAt).getTime() - Date.now()
  if (msLeft <= 0) return null
  return { multiplier: boost.multiplier, minsLeft: Math.max(1, Math.round(msLeft / 60000)) }
}

/* ── Manual sync ────────────────────────────────────────────────────────
   getGameState already re-pulls ListenBrainz/stats.fm/etc. live on every
   call (see derive.ts's ensureDailyRollups — "today" is always in the
   refetch window), so a manual sync is just refresh() on demand instead of
   waiting for the 90s poll or a tab refocus. Module-level, not component
   state, because the button gets torn down and rebuilt by every renderHud
   call (each poll, each setState) and the in-flight/cooldown status has to
   survive that. The cooldown exists to stop someone mashing the button
   from hammering the upstream scrobble APIs — fetchListenBrainz already
   backs off on a 429, this just makes that rare in the first place. */
let syncInFlight = false
let lastSyncAt = 0
const SYNC_COOLDOWN_MS = 15_000

/* ── codename privacy toggle ──
   Streaming/screenshotting agents don't always want their codename visible
   on screen — the eye button swaps the HUD label for the generic "Agent"
   placeholder. Persisted in localStorage (not module state) so it survives
   a reload instead of quietly resetting mid-stream. */
const HUD_CODE_HIDDEN_KEY = 'rc_hud_codename_hidden'
function isCodenameHidden() {
  try { return localStorage.getItem(HUD_CODE_HIDDEN_KEY) === '1' } catch (_) { return false }
}
function setCodenameHidden(hidden) {
  try { localStorage.setItem(HUD_CODE_HIDDEN_KEY, hidden ? '1' : '0') } catch (_) {}
}

/** Sum of counted progress this agent can see change — good enough to tell
 *  "something new landed" from "nothing new yet" without pretending to be
 *  the server's own stream count. */
function countedTotal(state) {
  const d = state?.activeDistrict
  if (!d) return 0
  const t = (d.trackGoals || []).reduce((s, g) => s + Math.min(g.progress, g.target), 0)
  const a = (d.albums || []).reduce((s, x) => s + Math.min(x.passesDone, x.target), 0)
  return t + a
}

async function syncNow(state) {
  if (syncInFlight || Date.now() - lastSyncAt < SYNC_COOLDOWN_MS) return
  syncInFlight = true
  paintSyncButton()
  const before = countedTotal(state)
  const res = await call('getGameState', { agentNo: getAgentNo() })
  syncInFlight = false
  lastSyncAt = Date.now()
  if (!res.success) {
    toast("Couldn't reach the network — try again in a moment.")
    paintSyncButton()
    return
  }
  setState(res)
  const gained = countedTotal(res) - before
  toast(gained > 0 ? `🔄 Synced — ${gained} new play${gained === 1 ? '' : 's'} counted` : "🔄 Synced — you're all caught up")
}

/** Repaint just the sync button in place, without a full renderHud — used
 *  while a sync is in flight so the spin/disabled state shows up instantly
 *  instead of waiting on the request it's spinning for. */
function paintSyncButton() {
  const btn = document.getElementById('syncBtn')
  if (!btn) return
  const onCooldown = syncInFlight || Date.now() - lastSyncAt < SYNC_COOLDOWN_MS
  btn.disabled = onCooldown
  btn.classList.toggle('is-syncing', syncInFlight)
}

/* ── collapse-on-scroll ──
   The sticky header eats a real chunk of a phone screen at full height —
   fine at rest, wasteful once you're scrolled into the mission list and it's
   just sitting there unchanged at the top. Past a small scroll threshold it
   shrinks to a compact row (CSS only, via #hud.is-collapsed — see
   reconnect.css) that keeps exactly what the reviewer asked to keep: avatar,
   level progress, streak, sync. Installed once, lazily, from renderHud
   itself rather than a separate main.js wire-up — #hud's own node is stable
   across re-renders (only its innerHTML gets replaced each render), so one
   listener attached to it outlives every repaint. */
let hudScrollWired = false
function wireHudScrollCollapse() {
  if (hudScrollWired) return
  const hud = document.getElementById('hud')
  if (!hud) return
  hudScrollWired = true
  // Hysteresis gap between collapse/expand thresholds — a single shared
  // threshold flickers because collapsing shrinks the header's own height,
  // which shifts scrollY back across the line and immediately re-expands it.
  const COLLAPSE_AT = 80
  const EXPAND_AT = 20
  const onScroll = () => {
    const y = window.scrollY
    if (y > COLLAPSE_AT) hud.classList.add('is-collapsed')
    else if (y < EXPAND_AT) hud.classList.remove('is-collapsed')
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
}

export function renderHud(container, state) {
  const p = state.player
  const lvl = p.level
  const pct = Math.max(0, Math.min(100, Math.round((lvl.xpIntoLevel / Math.max(1, lvl.xpForNextLevel)) * 100)))
  const xpLeft = Math.max(0, lvl.xpForNextLevel - lvl.xpIntoLevel)
  const boost = activeBoost(p.boost)
  const agentBadge = equippedBadge(state)
  // Real Badge Collection artwork is resolved server-side. In the HUD it is
  // rendered as an inset medallion inside the normal agent crest rather than
  // an edge-to-edge social avatar; see .hud-crest.has-photo.
  const collectionBadge = p.equippedBadgeArtwork || null
  const badgeArt = collectionBadge?.artworkUrl || null
  const streakLabel = p.streak.current > 0 ? `🔥 ${p.streak.current}D` : '○ 0D'
  // Authored pass: gold is reserved for things actually earned, so a
  // streak of zero renders muted instead. rarity comes off the equipped
  // badge payload (badge-profile.ts's resolveEquippedBadges) — an
  // equipped RARE badge is the one thing the crest halo now reports.
  const streakCold = p.streak.current > 0 ? '' : ' is-cold'
  const crestRare = collectionBadge?.rarity === 'rare' ? ' is-rare' : ''

  const invites = state.invites || []
  const codenameHidden = isCodenameHidden()
  const displayCode = codenameHidden ? 'Agent' : esc(p.codename)

  container.innerHTML = `
    <div class="hud-inner">
      <div class="hud-row">
        <div class="hud-identity" id="levelPill" role="button" tabindex="0" title="Open Agent Dossier">
          <span class="hud-crest${agentBadge || collectionBadge ? ' has-badge' : ''}${badgeArt ? ' has-photo' : ''}${crestRare}" aria-hidden="true"><i></i>${
            badgeArt ? `<img class="hud-crest-photo" src="${esc(badgeArt)}" alt="">` : `<b>${collectionBadge ? '🎖️' : agentBadge ? agentBadge.icon : '⟭⟬'}</b>`
          }</span>
          <span class="hud-who">
            <span class="hud-code-row">
              <span class="hud-code">${displayCode}</span>
              <button class="hud-eye" id="hudEyeBtn" type="button" title="${codenameHidden ? 'Show codename' : 'Hide codename'}" aria-label="${codenameHidden ? 'Show codename' : 'Hide codename'}">${codenameHidden ? '🙈' : '👁'}</button>
            </span>
            <span class="hud-meta"><em>${esc(p.rank.title)}</em><i>·</i><b>LV ${lvl.level}</b></span>
          </span>
        </div>
        <div class="hud-streak${streakCold}" title="${p.streak.current} days in a row">${streakLabel}</div>
        <button class="hud-sync" id="syncBtn" type="button" title="Sync streams now" aria-label="Sync streams now">🔄</button>
        <button class="hud-bell" id="bellBtn" type="button" title="Invites"
          aria-label="${invites.length ? `${invites.length} pending invite${invites.length === 1 ? '' : 's'}` : 'No pending invites'}">
          🔔${invites.length ? `<span class="hud-bell-count">${invites.length}</span>` : ''}
        </button>
      </div>
    </div>
    <div class="hud-xp">
      <span class="hud-xp-note">${xpLeft} XP to LV ${lvl.level + 1}</span>
      <div class="xp-bar" role="progressbar" aria-label="Level ${lvl.level} XP progress" aria-valuemin="0" aria-valuemax="${lvl.xpForNextLevel}" aria-valuenow="${lvl.xpIntoLevel}"><div class="xp-fill" style="width:${pct}%"></div></div>
      ${boost ? `<span class="hud-boost">${boost.multiplier}&times; BOOST &middot; ${boost.minsLeft}m</span>` : ''}
    </div>
  `
  const levelPill = container.querySelector('#levelPill')
  levelPill.onclick = () => showOverlay(progressSheet(state))
  levelPill.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showOverlay(progressSheet(state)) }
  }
  container.querySelector('#hudEyeBtn').onclick = (e) => {
    e.stopPropagation()
    setCodenameHidden(!codenameHidden)
    renderHud(container, state)
  }
  container.querySelector('#bellBtn').onclick = () => showOverlay(invitesSheet(state))
  container.querySelector('#syncBtn').onclick = () => syncNow(state)
  paintSyncButton()
  wireHudScrollCollapse()
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
    <div class="pbar" style="flex:1" role="progressbar" aria-label="Level ${lvl.level} XP progress" aria-valuemin="0" aria-valuemax="${lvl.xpForNextLevel}" aria-valuenow="${lvl.xpIntoLevel}"><div class="pfill" style="width:${pct}%"></div></div>
    <span class="count">${lvl.xpIntoLevel} / ${lvl.xpForNextLevel} this level</span>
  `))
  // Same number, same "total XP" wording as the Ranking board (see
  // screen-ranking.js) — the in-level count above resets every level-up and
  // the lifetime total on Ranking never does, so showing only one of them
  // here (as this sheet used to, bare "XP" with no qualifier on either
  // screen) reads as a mismatch/bug the moment a player checks both. Both
  // numbers are real; they're just answering different questions.
  sheet.appendChild(el('div', 'dim', `${p.xp.toLocaleString()} total XP`))

  const rewardLines = []
  if (rewards.extensionCharge) rewardLines.push(`<div class="bd-line"><span>Deadline Extension</span><b>+${rewards.extensionCharge}</b></div>`)
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
    <div class="bd-line"><span>Badges earned</span><b>${earnedBadgeCount(state)}</b></div>
  `))

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

export function openProgressSheet(state) {
  showOverlay(progressSheet(state))
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
    decline.onclick = () => {
      if (window.confirm('Decline this ReConnect invitation?\n\nThe sender will be able to invite someone else.')) respond(false)
    }
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
  // A sheet, not a screen — nothing to navigate to, so onClick opens it
  // straight over whichever screen is already up rather than pushing a
  // router state that has nowhere real to point. Never shows as .sel for
  // the same reason BOTZ's <a> never does: there's no "here" for it to be.
  { key: 'moonstation', icon: '🚨', label: 'Moon', title: 'Moon Station (under test)', onClick: () => openMoonStation() },
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
    // The police beacon spins regardless of whether anything's actually
    // flagged (see moonStationSheet's own comment) — it's what tells you
    // this tab is different from the rest, not a live status readout.
    const icoClass = t.key === 'moonstation' ? 'hud-tab-ico hud-tab-beacon' : 'hud-tab-ico'
    return `<${tag} class="hud-tab${isSel ? ' sel' : ''}" data-tab="${t.key}" title="${esc(t.title || t.label)}"${attrs}>
      <span class="${icoClass}" aria-hidden="true">${t.icon}</span>
      <span class="hud-tab-lbl">${esc(t.label)}</span>
    </${tag}>`
  }).join('')
  container.innerHTML = `<div class="hud-tabs">${tabsHtml}</div>`

  for (const t of TABS) {
    if (!t.go && !t.onClick) continue
    const node = container.querySelector(`[data-tab="${t.key}"]`)
    if (node.classList.contains('sel')) continue
    node.onclick = t.go ? (e) => t.go({ x: e.clientX, y: e.clientY }) : () => t.onClick()
  }
}

const MODES = {
  exam: { title: 'School/Exam', sub: 'Lighter goals for busy weeks · 5 goal streams = 1 XP' },
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
    el('p', 'muted', 'Pick what fits you. School/Exam gives lighter goals for busy weeks. Changes start with your next district; your current targets stay the same.'),
  )
  const grid = el('div', 'mode-grid')
  for (const key of ['exam', 'easy', 'medium', 'hard']) {
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
