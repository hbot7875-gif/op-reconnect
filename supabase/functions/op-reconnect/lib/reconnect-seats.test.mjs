// Mixed-district ReConnect teams (config.crossDistrictSeats).
//
// Urmi Terrace's quest is a team of three: two agents restoring Urmi Terrace,
// plus exactly one recruited from Home Base. The seat rule itself is pure and
// tested directly; the places that must enforce it (freeze, invite list,
// invite, accept, admin tools) are asserted at the source level, in the same
// spirit as mission-preservation.test.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { seatRule, countSeats, hasSeatFor, overSeats, seatError, composeTeams } from './reconnect-seats.ts'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const missions = read('./reconnect-missions.ts')
const districts = read('./districts.ts')
const migration = read('../../../migrations/20261024190000_rc_urmi_terrace_goals.sql')

const URMI = { requiredAgents: 3, crossDistrictSeats: 1, crossDistrictEligible: ['relay-zero-hq'] }

test('seat rule: 3 agents with 1 cross-district seat = 2 local + 1 helper', () => {
  assert.deepEqual(seatRule(URMI), { helperSeats: 1, localSeats: 2 })
})

test('no rule for ordinary teams or settings that leave one side empty', () => {
  assert.equal(seatRule({ requiredAgents: 3 }), null)
  assert.equal(seatRule({ requiredAgents: 3, crossDistrictEligible: ['relay-zero-hq'] }), null, 'Hopesize-style: recruits allowed, not required')
  assert.equal(seatRule({ requiredAgents: 3, crossDistrictSeats: 0 }), null)
  assert.equal(seatRule({ requiredAgents: 3, crossDistrictSeats: 3 }), null, 'all helpers is not a mixed team')
  assert.equal(seatRule({ requiredAgents: 3, crossDistrictSeats: 1.5 }), null)
  assert.equal(seatRule(null), null)
})

test('a lone opener can recruit one Home Base agent and one more local, nothing else', () => {
  const rule = seatRule(URMI)
  const opener = countSeats([false])
  assert.equal(hasSeatFor(rule, opener, true), true, 'Home Base seat open')
  assert.equal(hasSeatFor(rule, opener, false), true, 'second Urmi seat open')

  const withRecruit = countSeats([false, true])
  assert.equal(hasSeatFor(rule, withRecruit, true), false, 'only one Home Base seat')
  assert.equal(seatError(true), 'helper_seat_taken')
  assert.equal(hasSeatFor(rule, withRecruit, false), true)

  const twoLocals = countSeats([false, false])
  assert.equal(hasSeatFor(rule, twoLocals, false), false, 'a third Urmi agent never fits')
  assert.equal(seatError(false), 'district_seats_full')
  assert.equal(hasSeatFor(rule, twoLocals, true), true, 'the last seat is the Home Base one')
})

test('only a 2 + 1 team is within the rule', () => {
  const rule = seatRule(URMI)
  assert.equal(overSeats(rule, countSeats([false, false, true])), false)
  assert.equal(overSeats(rule, countSeats([false, true, true])), true, 'two recruits')
  assert.equal(overSeats(rule, countSeats([false, false, false])), true, 'no recruit')
})

test('admin auto-assign builds whole 2 + 1 teams and leaves the rest over', () => {
  const rule = seatRule(URMI)
  const { teams, leftover } = composeTeams(rule, ['U1', 'U2', 'U3', 'U4', 'U5'], ['H1', 'H2', 'H3'])
  assert.deepEqual(teams, [['U1', 'U2', 'H1'], ['U3', 'U4', 'H2']])
  assert.equal(leftover, 2, 'U5 and H3: 8 agents, 6 placed')
  assert.deepEqual(composeTeams(rule, ['U1', 'U2'], []).teams, [], 'no recruit, no team')
})

test('freezeGoals keeps crossDistrictSeats, or the rule would vanish at activation', () => {
  assert.match(districts, /crossDistrictSeats: cfg\.crossDistrictSeats \|\| null,/)
})

test('every way onto a team checks the seat rule', () => {
  const fn = (name) => missions.slice(missions.indexOf(`export async function ${name}(`), missions.indexOf('\nexport async function', missions.indexOf(`export async function ${name}(`) + 10))
  // invite list: filtered to open seats, recruits tagged
  assert.match(fn('getInviteCandidates'), /free = free\.filter\(\(f\) => hasSeatFor\(rule, counts, !!helperOf\.get\(f\.agentNo\)\)\)/)
  assert.match(fn('getInviteCandidates'), /\{ helpers: 0, locals: 1 \}/, 'before opening, the caller is the first local')
  // invite
  assert.match(fn('inviteReconnectMission'), /return \{ success: false, error: seatError\(inviteeIsHelper\) \}/)
  // accept: before the row-locked RPC, and the race undo after it
  const accept = fn('respondReconnectInvite')
  assert.ok(accept.indexOf('hasSeatFor(rule, await joinedSeatCounts') < accept.indexOf("supabase.rpc('rc_reconnect_accept_invite'"))
  assert.ok(accept.indexOf('overSeats(rule, await joinedSeatCounts') > accept.indexOf("supabase.rpc('rc_reconnect_accept_invite'"))
  assert.ok(accept.indexOf('overSeats(rule') < accept.indexOf('foldAwayDanglingMissions('), 'undo before folding other missions away')
  // admin tools
  assert.match(fn('adminAutoAssignMissions'), /composeTeams\(rule,/)
  assert.match(fn('adminPairReconnect'), /error: 'seat_rule_violation'/)
  // the panel learns the team shape
  assert.match(fn('getReconnectMission'), /seats: seatPanelInfo\(reconnect\.config, content\)/)
})

test('Urmi Terrace quest: 3 agents, exactly 1 from Home Base, I\'ll Be There x50 pooled', () => {
  const row = migration.slice(migration.indexOf("('urmi-reconnect-ill-be-there-50'"))
  const config = JSON.parse(row.match(/'(\{"sharedTrack"[^']*(?:''[^']*)*)'::jsonb/)[1].replace(/''/g, "'"))
  assert.deepEqual(config, {
    sharedTrack: { keys: ['ill be there'], label: "I'll Be There", target: 50 },
    requiredAgents: 3, crossDistrictSeats: 1, crossDistrictEligible: ['relay-zero-hq'],
  })
  assert.deepEqual(seatRule(config), { helperSeats: 1, localSeats: 2 })
})
