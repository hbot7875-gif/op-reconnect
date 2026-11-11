// ReConnect quests with a War of Cards stage (config.warOfCards).
//
// Bangtan Seven Bridge runs its quest in two stages:
//   1. 'streaming' — the team of requiredAgents takes a pooled sharedTrack to
//      its target, exactly like any other pooled quest. Hitting the target
//      does NOT complete the quest: it moves the mission to phase 'cards'
//      and stamps cards_unlocked_at.
//   2. 'cards'     — every joined teammate finishes one War of Cards game
//      that ends after cards_unlocked_at. Winning isn't needed; one game
//      with the whole team counts for everyone in it. The quest completes
//      when requiredAgents joined teammates have all played.
//
// While the mission is in phase 'cards', its joined teammates hold a QUEST
// PASS for War of Cards. It is access only: nothing is written to their
// album, and covers and gifting are untouched. The pass lets a member play
// until they've finished their counted game; after that it only lets them
// look at the table they are still sitting at and leave it. It ends with the
// mission (complete, expired, cancelled) — a short grace after completion
// keeps the end-of-game screen readable.
//
// Pure functions only, shared by the server (reconnect-missions.ts,
// run-ami.ts) and the tests. No database, no clock of its own.

/** Results that count as a finished game: a played-out win, or playing a
 *  played-out game to the end. 'forfeited', 'last_standing' (everyone else
 *  left) and 'abandoned' never count — a teammate quitting on purpose can't
 *  hand out credit. */
export const WAR_COUNTED_RESULTS = Object.freeze(['won', 'played'])

/** How long after the quest completes a pass still lets a member SEE the
 *  table (never play): enough to read the result and leave. */
export const WAR_PASS_VIEW_GRACE_MS = 2 * 60 * 60 * 1000

/** War of Cards routes that only look or leave. Everything else plays. */
export const WAR_VIEW_ROUTES = Object.freeze(['getState', 'leaveRoom', 'watchRoom', 'sendChat'])

/** True when the quest's frozen config asks for a War of Cards stage. */
export function hasWarStage(config) {
  return !!(config && config.warOfCards && config.sharedTrack && (config.sharedTrack.keys || []).length)
}

/** Does this match-player row count for a member, given when the cards
 *  stage opened? `row`: { result, finished_at }. */
export function countsForWarStage(row, cardsUnlockedAt) {
  if (!row || !cardsUnlockedAt) return false
  if (!WAR_COUNTED_RESULTS.includes(row.result)) return false
  const finished = Date.parse(row.finished_at || '')
  const since = Date.parse(cardsUnlockedAt)
  return Number.isFinite(finished) && Number.isFinite(since) && finished >= since
}

/**
 * What refreshMission should do for a war-stage quest.
 *   phase         mission.phase ('streaming' | 'cards')
 *   status        mission.status
 *   joinedCount   joined participants right now
 *   requiredAgents
 *   pooled        the sharedTrack total, target its target
 *   playedCount   joined participants with a counted game (cards phase)
 * Returns 'unlock' (streaming → cards), 'complete', or null.
 */
export function warStageStep({ phase, status, joinedCount, requiredAgents, pooled, target, playedCount }) {
  if (status !== 'open') return null
  const teamFull = joinedCount >= requiredAgents
  if (phase === 'streaming') return teamFull && target > 0 && pooled >= target ? 'unlock' : null
  if (phase === 'cards') return teamFull && playedCount >= requiredAgents ? 'complete' : null
  return null
}

/** The stage-two view the panel draws: one row per joined teammate. */
export function warStageView({ phase, cardsUnlockedAt, joined, playedAgents, requiredAgents }) {
  const unlocked = phase === 'cards' || (!!cardsUnlockedAt && phase !== 'streaming')
  const played = new Set(playedAgents || [])
  const members = (joined || []).map((agentNo) => ({ agentNo, played: unlocked && played.has(agentNo) }))
  return {
    unlocked,
    unlockedAt: cardsUnlockedAt || null,
    done: members.filter((m) => m.played).length,
    total: requiredAgents,
    members,
  }
}

/**
 * The quest pass, for one agent and one of their missions.
 *   mission  { status, phase, expires_at, completed_at, cards_unlocked_at }
 *   played   whether this agent already has a counted game
 *   route    the War of Cards route being called
 * Returns 'play', 'view' or null (no pass).
 */
export function warPassLevel({ mission, played, route, nowMs }) {
  if (!mission || !mission.cards_unlocked_at) return null
  const viewOnly = WAR_VIEW_ROUTES.includes(route)
  if (mission.status === 'open') {
    if (mission.phase !== 'cards') return null
    if (Date.parse(mission.expires_at || '') <= nowMs) return null
    if (!played) return 'play'
    return viewOnly ? 'view' : null
  }
  if (mission.status === 'complete' && viewOnly) {
    const done = Date.parse(mission.completed_at || '')
    return Number.isFinite(done) && nowMs - done <= WAR_PASS_VIEW_GRACE_MS ? 'view' : null
  }
  return null
}

/** Does `level` allow `route`? 'play' allows everything; 'view' only looks. */
export function warPassAllows(level, route) {
  if (level === 'play') return true
  return level === 'view' && WAR_VIEW_ROUTES.includes(route)
}
