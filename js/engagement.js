// Private, best-effort product analytics. Failures never interrupt play.
// A session id lives only for this browser tab and contains no account data.

import { call } from './api.js'
import { getAgentNo } from './session.js'

const SESSION_KEY = 'rc_engagement_session'
const sentOnce = new Set()
let sequence = 0

function sessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch (_) {
    return `tab-${Date.now().toString(36)}`
  }
}

export function trackEngagement(eventType, details = {}) {
  const agentNo = getAgentNo()
  if (!agentNo) return
  sequence += 1
  void call('trackEngagement', {
    agentNo,
    eventType,
    screen: details.screen,
    districtId: details.districtId,
    metadata: details.metadata || {},
    sessionId: sessionId(),
    eventId: `${Date.now().toString(36)}-${sequence}`,
  })
}

export function trackEngagementOnce(key, eventType, details = {}) {
  if (sentOnce.has(key)) return
  sentOnce.add(key)
  trackEngagement(eventType, details)
}
