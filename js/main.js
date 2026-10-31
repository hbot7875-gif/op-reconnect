// Boot: session → getGameState → onboarding or game. Refreshes on tab focus
// and a gentle 90s poll while visible. The game itself is one scene container
// routed World ↔ Ward ↔ District — see router.js.

import { call } from './api.js'
import { getAgentNo, clearSession } from './session.js'
import { renderAuth } from './ui-auth.js'
import { sessionDecision, SESSION_RECHECK_MS, SIGNED_OUT_ELSEWHERE } from './session-guard.js'
import { setState, getState, subscribe, toast, el, esc, showOverlay, hideOverlay } from './state.js'
import { getScreen, onScreenChange } from './router.js'
import { renderOnboarding } from './ui-onboarding.js'
import { renderHud, renderTabbar } from './ui-hud.js'
import { startMoonReviewCheck } from './moon-review-dot.js'
import { renderWorld, renderGoldenCorner, renderSerendipityRoom, checkForBirthdayEraPopup } from './screen-world.js'
import { checkForRunAmiLaunch } from './run-army.js'
import { birthdayCompleteMessage } from './birthday-era-popup.js'
import { renderRecelebrateParty } from './screen-recelebrate.js'
import { renderWard, teardownWard } from './screen-ward.js'
import { renderDistrictScreen, teardownDistrictScreen } from './screen-district.js'
import { renderResources } from './screen-resources.js'
import { renderDearDiary } from './screen-diary.js'
import { renderSettings } from './screen-settings.js'
import { renderCandyStar } from './screen-candystar.js'
import { renderRanking } from './screen-ranking.js'
import { renderMoonStation, teardownMoonStation } from './screen-moon.js'
import { renderVoting } from './voting.js'
import { renderRunAmi, teardownRunAmi } from './screen-run-ami.js'
import { playLevelUp } from './celebrate.js'
import { checkForBadgeUnlocks } from './badge-reveal.js'
import { checkForExamModeAnnounce } from './exam-mode-announce.js'
import { checkForMamaTeamPopup } from './mama-team-popup.js'
import { checkForBombNudge } from './bomb-nudge-popup.js'
import { checkForVotingAlerts } from './voting-alerts.js'
import { playModeReview } from './mode-upgrade-announce.js'
import { districtDisplayName } from './ward-tiles.js'
import { lapseChoice } from './ui-district.js'
import { trackEngagement } from './engagement.js'
import { rememberInvite } from './battle-invite.js'
import { teardownCompactHud, refreshCompactHud } from './compact-hud.js'

const $ = (id) => document.getElementById(id)

// A MAMA Battle recruit link (?team=) is kept through sign-in and onboarding.
try { rememberInvite(location.search, localStorage) } catch { /* no storage: no invite mark */ }

function show(id) {
  for (const s of ['auth', 'loading', 'onboarding', 'game']) $(s).hidden = s !== id
  // Once past sign-in, drop the form: typed credentials don't sit in the
  // page, and there's nothing left for a phone's compositor to paint back
  // from stale tiles over the game (seen on Android, 2026-10-15).
  if (id !== 'auth') $('auth').replaceChildren()
}

function showAuth(opts = {}) {
  show('auth')
  renderAuth($('auth'), refresh, opts)
}

let lastScreenName = null
let refreshRetry = null
let engagementStarted = false

function trackScreen(scr) {
  trackEngagement('screen_viewed', { screen: scr.name, districtId: scr.districtId || undefined })
  if (scr.name === 'district') trackEngagement('district_opened', { screen: 'district', districtId: scr.districtId })
}

function retryRefresh() {
  if (refreshRetry) return
  refreshRetry = setTimeout(() => {
    refreshRetry = null
    refresh()
  }, 3000)
}

function renderScreen(state) {
  const scr = getScreen()
  const scene = $('scene')

  // Red Zone is network-wide — a body-level class so every screen (not just
  // the World hub) reads it: buildings flicker, connections flash, everything
  // tints red while the attack is active.
  document.body.classList.toggle('red-zone', !!state.bomb?.defuse)

  if (scr.name !== 'ward') teardownWard()
  if (scr.name !== 'district') teardownDistrictScreen()
  // Moon Station condenses the shared header while it is open; this
  // puts it back for every other screen.
  if (scr.name !== 'moon') teardownMoonStation()
  // The MAMA hub compacts the shared header the same way (compact-hud.js).
  if (scr.name !== 'voting') teardownCompactHud()
  // RUN AMI owns a socket, a poll and a turn timer; stop them on the way out.
  if (scr.name !== 'runami') teardownRunAmi()

  // Only animate on an actual navigation (screen changed) — a plain data
  // refresh on the same screen (90s poll, tab-focus refresh) repaints in
  // place so it doesn't interrupt whatever the player's looking at.
  const isNav = lastScreenName !== null && scr.name !== lastScreenName
  lastScreenName = scr.name

  const paint = () => {
    if (scr.name === 'ward') renderWard(scene, state, scr.wardId)
    else if (scr.name === 'district') renderDistrictScreen(scene, state, scr.wardId, scr.districtId)
    else if (scr.name === 'resources') renderResources(scene, state)
    else if (scr.name === 'diary') renderDearDiary(scene, state)
    else if (scr.name === 'settings') renderSettings(scene, state)
    else if (scr.name === 'candystar') renderCandyStar(scene, state)
    else if (scr.name === 'ranking') renderRanking(scene, state)
    else if (scr.name === 'golden-corner') renderGoldenCorner(scene, state)
    else if (scr.name === 'serendipity-room') renderSerendipityRoom(scene, state)
    else if (scr.name === 'recelebrate') renderRecelebrateParty(scene, state)
    else if (scr.name === 'moon') renderMoonStation(scene, state)
    else if (scr.name === 'voting') renderVoting(scene, state)
    else if (scr.name === 'runami') renderRunAmi(scene, state)
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
let shownModeReview = null
const celebratedEraCards = new Set()
let promptedLapse = null

subscribe((state) => {
  if (!state || !state.joined) return
  if (!engagementStarted) {
    engagementStarted = true
    const scr = getScreen()
    trackEngagement('app_opened', { screen: scr.name, districtId: scr.districtId || undefined })
    trackScreen(scr)
  }
  window.__rcState = state
  show('game')
  renderHud($('hud'), state)
  refreshCompactHud()
  renderTabbar($('tabbar'), state)
  renderScreen(state)
  // After the first paint, never before it: the Moon dot's one background
  // check (moon-review-dot.js). Repeat calls are no-ops for the same agent.
  startMoonReviewCheck(() => {
    const now = getState()
    if (now?.joined) renderTabbar($('tabbar'), now)
  })
  if (state.levelUp && state.levelUp.level !== celebratedLevel) {
    celebratedLevel = state.levelUp.level
    playLevelUp(state)
  }
  if (state.modeReview) {
    const reviewKey = `${state.modeReview.mode}:${state.modeReview.highVolumeDays}`
    if (reviewKey !== shownModeReview) {
      shownModeReview = reviewKey
      playModeReview(state)
    }
  }
  checkForBadgeUnlocks(state)
  checkForExamModeAnnounce(state)
  checkForBirthdayEraPopup(state)
  checkForRunAmiLaunch(state)
  // The Bomb warning goes first: missing it can cost the whole agent file.
  checkForBombNudge(state)
  checkForMamaTeamPopup(state)
  checkForVotingAlerts(state.voting?.alerts)
  for (const eraId of state.agentCharge?.newlyLitEraIds || []) {
    if (celebratedEraCards.has(eraId)) continue
    celebratedEraCards.add(eraId)
    const era = (state.agentCharge?.eraCards || []).find((e) => e.id === eraId)
    toast(era?.isSpecial
      ? birthdayCompleteMessage(era)
      : `${era?.icon || '✨'} ${era?.name || 'Era'} Card activated — ready in City`, era?.isSpecial ? 6000 : 4800)
  }
  // Inherently one-shot, unlike levelUp — the backend deletes the lapsed
  // rc_player_districts row in the same request that reports it, so it
  // can never come back true on a later poll of the same district.
  if (state.expiredDistrict) {
    toast(`⏳ Time ran out on ${districtDisplayName(state.expiredDistrict)} — open it to see what was missing. You can start it again.`, 6000)
  }
  // A lapsed attempt waiting on "extend or reset" — ask once per session
  // wherever the agent happens to be. The same choice stays on the
  // district's own board, so dismissing this loses nothing.
  const lapsedDistrict = state.activeDistrict?.lapsed ? state.activeDistrict : null
  if (lapsedDistrict && promptedLapse !== lapsedDistrict.id) {
    promptedLapse = lapsedDistrict.id
    const sheet = el('div', 'sheet lapse-sheet')
    sheet.appendChild(el('div', 'eyebrow', esc(districtDisplayName(lapsedDistrict))))
    sheet.appendChild(lapseChoice(lapsedDistrict, { onDone: hideOverlay }))
    showOverlay(sheet)
  }
})

onScreenChange((scr) => {
  const state = getState()
  if (!state?.joined) return
  trackScreen(scr)
  // The tab bar reflects which screen is current, so it repaints on
  // navigation too.
  renderHud($('hud'), state)
  refreshCompactHud()
  renderTabbar($('tabbar'), state)
  renderScreen(state)
})

// One invalid_session while the game is open gets a second look before the
// player is signed out (session-guard.js).
let sessionRechecked = false
let sessionRecheck = null

async function refresh() {
  const agentNo = getAgentNo()
  // Already on the sign-in screen (the 90 s poll or a resume can land here):
  // leave it alone, so a half-typed sign-in and its notice aren't wiped.
  if (!agentNo) { if ($('auth').hidden) showAuth(); return }
  const res = await call('getGameState', { agentNo })
  const decision = sessionDecision(res, { gameOpen: !!getState()?.joined, rechecked: sessionRechecked })
  if (decision === 'retry') {
    // A deployment, a short network interruption or a database blip on the
    // session check must not look like logout. Keep a rendered game in place
    // (or its loader on first boot) and retry.
    if (!getState()?.joined) show('loading')
    retryRefresh()
    return
  }
  if (decision === 'recheck') {
    sessionRechecked = true
    clearTimeout(sessionRecheck)
    sessionRecheck = setTimeout(() => { sessionRecheck = null; refresh() }, SESSION_RECHECK_MS)
    return
  }
  if (decision === 'signout') {
    // The stored session really is no good (this account signed in somewhere
    // else, it expired, or the agent is gone) — drop it so the player gets
    // the sign-in screen instead of a silent dead end, and say why.
    sessionRechecked = false
    clearTimeout(sessionRecheck)
    sessionRecheck = null
    clearSession()
    showAuth(res?.error === 'invalid_session' ? { notice: SIGNED_OUT_ELSEWHERE } : {})
    return
  }
  sessionRechecked = false
  if (refreshRetry) {
    clearTimeout(refreshRetry)
    refreshRetry = null
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
