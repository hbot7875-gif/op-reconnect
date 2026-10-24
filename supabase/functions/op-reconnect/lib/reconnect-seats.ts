// Seat rules for 'connect' ReConnect teams that must mix districts.
//
// A goal's config.crossDistrictEligible says WHO from other districts may be
// recruited as a helper (see reconnect-missions.ts's eligiblePoolForGoal).
// config.crossDistrictSeats goes one step further and says HOW MANY seats are
// reserved for those helpers: exactly that many, never more, never fewer. The
// rest of the team (requiredAgents - crossDistrictSeats) must be agents
// restoring the goal's own district.
//
// Urmi Terrace's quest is the first user: requiredAgents 3, crossDistrictSeats
// 1, crossDistrictEligible ['relay-zero-hq'] — two Urmi Terrace agents plus
// exactly one agent "kidnapped" from Home Base.
//
// Pure functions only, so the rule can be tested without a database. A member
// counts as a helper when they are NOT actively restoring the mission's own
// district; the caller does that lookup and passes the booleans in.

export interface SeatRule {
  /** Seats only an agent from another district (a helper) can fill. */
  helperSeats: number
  /** Seats only an agent restoring the mission's own district can fill. */
  localSeats: number
}

export interface SeatCounts {
  helpers: number
  locals: number
}

/** The rule a frozen reconnect config asks for, or null when it has none.
 *  Ignored unless it leaves at least one local seat and at least one helper
 *  seat: a team that is all helpers or all locals is just requiredAgents. */
export function seatRule(config: Record<string, any> | null | undefined): SeatRule | null {
  const required = Number(config?.requiredAgents)
  const helperSeats = Number(config?.crossDistrictSeats)
  if (!Number.isInteger(required) || !Number.isInteger(helperSeats)) return null
  if (helperSeats < 1 || helperSeats >= required) return null
  return { helperSeats, localSeats: required - helperSeats }
}

export function countSeats(isHelper: boolean[]): SeatCounts {
  let helpers = 0
  for (const h of isHelper) if (h) helpers++
  return { helpers, locals: isHelper.length - helpers }
}

/** Whether one more member of this kind still fits. */
export function hasSeatFor(rule: SeatRule, counts: SeatCounts, isHelper: boolean): boolean {
  return isHelper ? counts.helpers < rule.helperSeats : counts.locals < rule.localSeats
}

/** True when the team is over the rule in either direction — what an accept
 *  must undo if two agents raced for the same last seat. */
export function overSeats(rule: SeatRule, counts: SeatCounts): boolean {
  return counts.helpers > rule.helperSeats || counts.locals > rule.localSeats
}

/** The error a blocked invite or accept reports, named for the seat that is full. */
export function seatError(isHelper: boolean): 'helper_seat_taken' | 'district_seats_full' {
  return isHelper ? 'helper_seat_taken' : 'district_seats_full'
}

/** Full teams for admin auto-assign: each gets exactly localSeats locals and
 *  helperSeats helpers, in the order given (callers shuffle first). Whoever
 *  doesn't fit a complete team is left over. */
export function composeTeams(rule: SeatRule, locals: string[], helpers: string[]): { teams: string[][]; leftover: number } {
  const count = Math.min(Math.floor(locals.length / rule.localSeats), Math.floor(helpers.length / rule.helperSeats))
  const teams: string[][] = []
  for (let i = 0; i < count; i++) {
    teams.push([
      ...locals.slice(i * rule.localSeats, (i + 1) * rule.localSeats),
      ...helpers.slice(i * rule.helperSeats, (i + 1) * rule.helperSeats),
    ])
  }
  const used = count * (rule.localSeats + rule.helperSeats)
  return { teams, leftover: locals.length + helpers.length - used }
}
