// HUD header: codename, rank + XP progress, streak, mode pill.
// XP is the long-game hook, so it gets a real labelled bar rather than the
// 3px hairline it used to be — a player should be able to see "how close am
// I to the next rank" without opening anything.

import { call } from './api.js'
import { el, esc, toast, setState, showOverlay, hideOverlay } from './state.js'
import { getScreen, goWorld, goResources, goSettings } from './router.js'
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
    <nav class="hud-tabs">
      <button class="hud-tab" data-tab="network">Network</button>
      <button class="hud-tab" data-tab="resources">Pack</button>
      <button class="hud-tab hud-tab-set" data-tab="settings" title="Settings">⚙</button>
    </nav>
  `
  container.querySelector('#modePill').onclick = () => openModeSheet(state)

  // "Network" covers the whole game (world / ward / district); the Pack and
  // Settings screens sit outside it.
  const here = getScreen().name
  const tabs = container.querySelectorAll('.hud-tab')
  const sel = { network: here !== 'resources' && here !== 'settings', resources: here === 'resources', settings: here === 'settings' }
  tabs[0].classList.toggle('sel', sel.network)
  tabs[1].classList.toggle('sel', sel.resources)
  tabs[2].classList.toggle('sel', sel.settings)
  tabs[0].onclick = (e) => { if (!sel.network) goWorld({ x: e.clientX, y: e.clientY }) }
  tabs[1].onclick = (e) => { if (!sel.resources) goResources({ x: e.clientX, y: e.clientY }) }
  tabs[2].onclick = (e) => { if (!sel.settings) goSettings({ x: e.clientX, y: e.clientY }) }
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
