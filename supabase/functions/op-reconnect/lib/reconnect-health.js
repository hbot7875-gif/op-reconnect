// Pure ReConnect health rules shared by the deployed Edge Function and the
// Node test suite. Keep database reads and UI wording outside this file: its
// only job is turning observed mission state into stable, testable flags.

export const RECONNECT_INVITE_WARNING_HOURS = 12
export const RECONNECT_DEADLINE_WARNING_HOURS = 24

export function reconnectHealthFlags(input = {}) {
  const flags = []
  const missingSeats = Math.max(0, Number(input.missingSeats) || 0)
  const pendingInvites = Math.max(0, Number(input.pendingInvites) || 0)
  const idleTeammates = Math.max(0, Number(input.idleTeammates) || 0)
  const deadlineHours = Number(input.deadlineHours)
  const oldestInviteHours = Number(input.oldestInviteHours)

  if (input.puzzleBlocked) flags.push('puzzle_blocked')
  if (input.missionExpired || input.districtExpired) flags.push('expired')
  if (Number.isFinite(deadlineHours) && deadlineHours >= 0 && deadlineHours <= RECONNECT_DEADLINE_WARNING_HOURS) {
    flags.push('deadline_soon')
  }
  if (idleTeammates > 0) flags.push('idle_teammate')
  if (pendingInvites > 0) {
    flags.push(Number.isFinite(oldestInviteHours) && oldestInviteHours >= RECONNECT_INVITE_WARNING_HOURS
      ? 'invite_overdue'
      : 'invite_pending')
  }
  if (missingSeats > pendingInvites) flags.push('needs_people')
  if (!flags.length) flags.push('active')
  return flags
}

export function reconnectPrimaryStatus(flags = []) {
  const priority = [
    'puzzle_blocked', 'expired', 'deadline_soon', 'idle_teammate',
    'invite_overdue', 'needs_people', 'invite_pending', 'active',
  ]
  return priority.find((key) => flags.includes(key)) || 'active'
}

export function reconnectRecommendedAction(input = {}) {
  const flags = input.flags || reconnectHealthFlags(input)
  const missingSeats = Math.max(0, Number(input.missingSeats) || 0)
  if (flags.includes('puzzle_blocked')) return 'Review the locked puzzle'
  if (flags.includes('expired')) return 'Check the expired attempt'
  if (flags.includes('deadline_soon') && missingSeats > 0) return `Fill ${missingSeats} open seat${missingSeats === 1 ? '' : 's'} now`
  if (flags.includes('idle_teammate')) return 'Check the inactive teammate'
  if (flags.includes('invite_overdue')) return 'Replace the unanswered invite'
  if (flags.includes('needs_people')) return `Fill ${Math.max(1, missingSeats)} open seat${missingSeats === 1 ? '' : 's'}`
  if (flags.includes('invite_pending')) return 'Give the invite time to be answered'
  return 'No action needed'
}

/** Complete a partial roster without ever displacing an existing member. */
export function suggestedReconnectRoster(existing = [], candidates = [], requiredAgents = 2) {
  const required = Math.max(2, Number(requiredAgents) || 2)
  const unique = []
  const seen = new Set()
  for (const agentNo of [...existing, ...candidates]) {
    const key = String(agentNo || '').trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(key)
    if (unique.length === required) break
  }
  return unique.length === required ? unique : []
}

