// Boot: session → getGameState → onboarding or game. Refreshes on tab focus
// and a gentle 90s poll while visible. The game itself is one scene container
// routed World ↔ Ward ↔ District — see router.js.

import { call } from './api.js'
import { getAgentNo, clearSession } from './session.js'
import { renderAuth } from './ui-auth.js'
import { setState, getState, subscribe, toast } from './state.js'
import { getScreen, onScreenChange } from './router.js'
import { renderOnboarding } from './ui-onboarding.js'
import { renderHud, renderTabbar } from './ui-hud.js'
import { renderWorld } from './screen-world.js'
import { renderWard, teardownWard } from './screen-ward.js'
import { renderDistrictScreen, teardownDistrictScreen } from './screen-district.js'
import { renderResources } from './screen-resources.js'
import { renderSettings } from './screen-settings.js'
import { renderCandyStar } from './screen-candystar.js'
import { renderRanking } from './screen-ranking.js'
import { playLevelUp } from './celebrate.js'
import { districtDisplayName } from './ward-tiles.js'

const $ = (id) => document.getElementById(id)

function show(id) {
  for (const s of ['auth', 'loading', 'onboarding', 'game']) $(s).hidden = s !== id
}

function showAuth() {
  show('auth')
  renderAuth($('auth'), refresh)
}

let lastScreenName = null

function renderScreen(state) {
  const scr = getScreen()
  const scene = $('scene')

  // Red Zone is network-wide — a body-level class so every screen (not just
  // the World hub) reads it: buildings flicker, connections flash, everything
  // tints red while the attack is active.
  document.body.classList.toggle('red-zone', !!state.bomb?.defuse)

  if (scr.name !== 'ward') teardownWard()
  if (scr.name !== 'district') teardownDistrictScreen()

  // Only animate on an actual navigation (screen changed) — a plain data
  // refresh on the same screen (90s poll, tab-focus refresh) repaints in
  // place so it doesn't interrupt whatever the player's looking at.
  const isNav = lastScreenName !== null && scr.name !== lastScreenName
  lastScreenName = scr.name

  const paint = () => {
    if (scr.name === 'ward') renderWard(scene, state, scr.wardId)
    else if (scr.name === 'district') renderDistrictScreen(scene, state, scr.wardId, scr.districtId)
    else if (scr.name === 'resources') renderResources(scene, state)
    else if (scr.name === 'settings') renderSettings(scene, state)
    else if (scr.name === 'candystar') renderCandyStar(scene, state)
    else if (scr.name === 'ranking') renderRanking(scene, state)
    else renderWorld(scene, state)
    if (isNav) {
      scene.classList.remove('scene-out')
      scene.classList.add('scene-in')
      setTimeout(() => scene.classList.remove('scene-in'), 420)
    }
  }

  if (isNav) {
    // Zoom from wherever the player tapped (a ward, a building) rather than
    // always the screen center — makes the transition read as "diving into
    // that spot" instead of a generic fade.
    const r = scene.getBoundingClientRect()
    scene.style.transformOrigin = scr.origin
      ? `${scr.origin.x - r.left}px ${scr.origin.y - r.top}px`
      : '50% 50%'
    scene.classList.add('scene-out')
    setTimeout(paint, 150)
  } else {
    paint()
  }
}

// state.levelUp is only ever present on the one response that just crossed
// a level (see leveling.ts's applyLevelUpIfNeeded — a completion-latch
// against rc_players.last_level, so it goes back to null on the next real
// fetch). Guarded the same way screen-district.js guards a restoration
// replay: local optimistic setState() calls elsewhere in the app spread the
// current state, which could otherwise carry a stale levelUp along for the
// ride and replay the celebration on an unrelated action.
let celebratedLevel = null

subscribe((state) => {
  if (!state || !state.joined) return
  window.__rcState = state
  show('game')
  renderHud($('hud'), state)
  renderTabbar($('tabbar'), state)
  renderScreen(state)
  if (state.levelUp && state.levelUp.level !== celebratedLevel) {
    celebratedLevel = state.levelUp.level
    playLevelUp(state)
  }
  // Inherently one-shot, unlike levelUp — the backend deletes the lapsed
  // rc_player_districts row in the same request that reports it, so it
  // can never come back true on a later poll of the same district.
  if (state.expiredDistrict) {
    toast(`⏳ Time ran out on ${districtDisplayName(state.expiredDistrict)} — restoration reset. You can start it again.`, 4500)
  }
})

onScreenChange(() => {
  const state = getState()
  if (!state?.joined) return
  // The tab bar reflects which screen is current, so it repaints on
  // navigation too.
  renderHud($('hud'), state)
  renderTabbar($('tabbar'), state)
  renderScreen(state)
})

async function refresh() {
  const agentNo = getAgentNo()
  if (!agentNo) { showAuth(); return }
  const res = await call('getGameState', { agentNo })
  if (!res.success) {
    // A rejected or expired token means the stored session is no good — drop
    // it so the player gets the sign-in screen instead of a silent dead end.
    if (res.error === 'invalid_session' || res.error === 'agent_not_found') clearSession()
    showAuth()
    return
  }
  if (!res.joined) {
    show('onboarding')
    renderOnboarding($('onboarding'), res, agentNo, () => {
      const joined = getState()
      if (joined?.joined) setState(joined)
      else refresh()
    })
    return
  }
  setState(res)
}

refresh()

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && getState()?.joined) refresh()
})

setInterval(() => {
  if (!document.hidden && getState()?.joined) refresh()
}, 90_000)
