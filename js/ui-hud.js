// HUD header: codename, rank + XP progress, streak, mode pill.
// XP is the long-game hook, so it gets a real labelled bar rather than the
// 3px hairline it used to be — a player should be able to see "how close am
// I to the next rank" without opening anything.

import { call } from './api.js'
import { el, esc, toast, setState, showOverlay, hideOverlay } from './state.js'
import { getScreen, goWorld, goResources, goSettings, goCandyStar, goRanking } from './router.js'
import { getAgentNo } from './session.js'

export function renderHud(container, state) {
  const p = state.player
  const prevRankAt = rankFloor(state)
  const isMax = p.rank.nextAt === null
  const span = (p.rank.nextAt ?? p.xp) - prevRankAt
  const pct = isMax ? 100
    : Math.max(0, Math.min(100, Math.round(((p.xp - prevRankAt) / Math.max(1, span)) * 100)))

  container.innerHTML = `
    <div class="hud-inner">
      <div class="hud-id">
        <div class="hud-code">${esc(p.codename)}</div>
        <div class="hud-rank">${esc(p.rank.title)}</div>
      </div>
      <div class="hud-right">
        <span class="hud-streak" title="${p.streak.current} days in a row">🔥 ${p.streak.current}</span>
        <button class="hud-mode" id="modePill" title="Streaming mode">${esc(p.mode)}</button>
      </div>
    </div>
    <div class="hud-xp">
      <div class="xp-bar"><div class="xp-fill" style="width:${pct}%"></div></div>
      <span class="xp-label">${isMax ? `${p.xp} XP · max rank` : `${p.xp} / ${p.rank.nextAt} XP`}</span>
    </div>
  `
  container.querySelector('#modePill').onclick = () => openModeSheet(state)
}

// Candy Star, BOTZ and Rankings used to be cards inside the Pack screen —
// one tap to Pack, then a second to whichever tool you actually wanted. They
// get their own tabs now, directly reachable from every screen; Pack keeps
// Today's Queue plus the resource/merch view, which don't fit a tab (no icon
// alone says "what you're carrying"). BOTZ leaves the app entirely
// (botz.html is its own page), so it's the one tab that's a real `<a href>`
// rather than a router push — it can never show as "selected" the way the
// others do, same as any link out.
const TABS = [
  { key: 'network', icon: '🏙️', label: 'City', go: goWorld,
    sel: (here) => here !== 'resources' && here !== 'settings' && here !== 'candystar' && here !== 'ranking' },
  { key: 'resources', icon: '🎒', label: 'Pack', go: goResources,
    sel: (here) => here === 'resources' },
  { key: 'candystar', icon: '🍬', label: 'Candy Star', go: goCandyStar,
    sel: (here) => here === 'candystar' },
  { key: 'botz', icon: '📻', label: 'BOTZ',
    href: () => 'botz.html' + (getAgentNo() ? `?agent=${encodeURIComponent(getAgentNo())}` : '') },
  { key: 'ranking', icon: '🏆', label: 'Rankings', go: goRanking,
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
    return `<${tag} class="hud-tab${isSel ? ' sel' : ''}" data-tab="${t.key}"${attrs}>
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
  easy: { title: 'Easy', sub: '1 device · normal targets' },
  medium: { title: 'Medium', sub: '2–4 accounts · 2× targets' },
  hard: { title: 'Hard', sub: '5–6 accounts · 4× targets' },
}

function rankFloor(state) {
  // The rank ladder isn't in the payload; approximate the current floor from
  // known thresholds embedded in rank index — fall back to 0.
  const known = [0, 100, 300, 700, 1500, 3000]
  return known[Math.max(0, (state.player.rank.index || 1) - 1)] ?? 0
}

/** Exported so the Settings screen's "Streaming mode" row opens the same
 *  sheet the HUD pill does — one difficulty picker, not two that drift. */
export function openModeSheet(state) {
  const sheet = el('div', 'sheet')
  sheet.append(
    el('div', 'eyebrow', 'STREAMING MODE'),
    el('h3', '', 'How many accounts are you running?'),
    el('p', 'muted', 'More accounts means bigger targets, same XP per stream. Switching costs you nothing.'),
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
