// The Moon tab's review dot: one read-only getMySelfCheck per signed-in agent
// per page load, started after the first paint and never awaited by anything.
//
// - Background only: it waits for an idle moment (or 1.5s at most), so it
//   can't compete with getGameState or the first render.
// - No polling. If Moon Station is opened later, that screen's own fresh
//   check updates the dot through noteMoonCheck — no second request.
// - Nothing is persisted. Every page load starts with no dot until this
//   load's check answers, so a remembered result is never shown as current.
// - Any failure leaves the dot off.

import { call } from './api.js'
import { getAgentNo } from './session.js'
import { moonReviewCount } from './moon-review-rules.js'

let count = 0
let checkedFor = null
let onChange = null

export function hasMoonReview() {
  return count > 0
}

function set(next) {
  const changed = (next > 0) !== (count > 0)
  count = next
  if (changed && onChange) {
    try { onChange() } catch (e) { /* a repaint failure must not surface here */ }
  }
}

function whenIdle(fn) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(fn, { timeout: 1500 })
  } else {
    setTimeout(fn, 1500)
  }
}

/** Start this page load's single check for the signed-in agent. Safe to call
 *  on every state update: it only fires once per agent number. */
export function startMoonReviewCheck(repaint) {
  onChange = repaint
  const agentNo = getAgentNo()
  if (!agentNo || agentNo === checkedFor) return
  checkedFor = agentNo
  set(0)
  whenIdle(() => {
    call('getMySelfCheck', { agentNo, days: 7 })
      .then((res) => { if (getAgentNo() === agentNo) set(moonReviewCount(res)) })
      .catch(() => {})
  })
}

/** Moon Station's own check is fresher than the startup one; reuse it. */
export function noteMoonCheck(res) {
  set(moonReviewCount(res))
}
