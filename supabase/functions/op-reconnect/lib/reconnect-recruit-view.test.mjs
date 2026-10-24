// A recruit — an agent joined to a ReConnect team on a district they are not
// restoring (crossDistrictEligible; Urmi Terrace's Home Base seat) — must be
// able to see and talk to that team. Every read used to be gated on the
// caller's own rc_player_districts row for the district, so a recruit's plays
// counted toward the pool while they saw nothing at all.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getMyRecruitMissions } from './reconnect-missions.ts'
import { reconnectPlayerNext } from '../../../../js/reconnect-player-ui.js'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const missions = read('./reconnect-missions.ts')
const handlers = read('./handlers.ts')
const screen = read('../../../../js/screen-district.js')
const hud = read('../../../../js/ui-hud.js')

/** Just enough of supabase-js's query builder for getMyRecruitMissions. */
function fakeDb(tables) {
  return {
    from(name) {
      let rows = [...(tables[name] || [])]
      const q = {
        select: () => q,
        eq: (c, v) => { rows = rows.filter((r) => r[c] === v); return q },
        in: (c, vs) => { rows = rows.filter((r) => vs.includes(r[c])); return q },
        then: (ok, bad) => Promise.resolve({ data: rows, error: null }).then(ok, bad),
      }
      return q
    },
  }
}

const content = {
  districts: [
    { id: 'mono-urmi-terrace', name: 'Urmi Terrace', ward_id: 'mono' },
    { id: 'relay-zero-hq', name: 'Relay Zero', ward_id: 'relay' },
  ],
  goals: [{ id: 'urmi-reconnect-ill-be-there-50', label: "I'll Be There: 50 Together",
    config: { sharedTrack: { label: "I'll Be There" } } }],
}
const now = Date.now()
const db = (extra = {}) => fakeDb({
  rc_reconnect_participants: [
    { agent_no: 'AGENT455', mission_id: 'm-open', status: 'joined' },
    { agent_no: 'AGENT455', mission_id: 'm-old', status: 'joined' },
    { agent_no: 'AGENT455', mission_id: 'm-recent', status: 'joined' },
    { agent_no: 'AGENT455', mission_id: 'm-invited', status: 'invited' },
  ],
  rc_reconnect_missions: [
    { id: 'm-open', district_id: 'mono-urmi-terrace', goal_id: 'urmi-reconnect-ill-be-there-50', status: 'open', completed_at: null },
    { id: 'm-old', district_id: 'mono-urmi-terrace', goal_id: 'urmi-reconnect-ill-be-there-50', status: 'complete', completed_at: new Date(now - 9 * 86400000).toISOString() },
    { id: 'm-recent', district_id: 'mono-urmi-terrace', goal_id: 'urmi-reconnect-ill-be-there-50', status: 'complete', completed_at: new Date(now - 86400000).toISOString() },
    { id: 'm-invited', district_id: 'mono-urmi-terrace', goal_id: 'urmi-reconnect-ill-be-there-50', status: 'open', completed_at: null },
  ],
  rc_player_districts: [{ agent_no: 'AGENT455', district_id: 'relay-zero-hq', status: 'active' }],
  ...extra,
})

test('a recruit gets their open team and a recently completed one, never an old one or a pending invite', async () => {
  const list = await getMyRecruitMissions(db(), content, 'AGENT455')
  assert.deepEqual(list.map((h) => h.complete), [false, true])
  assert.equal(list[0].districtName, 'Urmi Terrace')
  assert.equal(list[0].wardId, 'mono')
  assert.equal(list[0].trackLabel, "I'll Be There")
})

test('a team on the district the agent is restoring is a local seat, not a recruit one', async () => {
  const list = await getMyRecruitMissions(db({
    rc_player_districts: [{ agent_no: 'AGENT455', district_id: 'mono-urmi-terrace', status: 'active' }],
  }), content, 'AGENT455')
  assert.deepEqual(list, [])
})

test('the panel never tells a recruit to invite or drop anyone', () => {
  const recruit = { districtName: 'Urmi Terrace' }
  const filling = reconnectPlayerNext({ variant: 'connect', myStatus: 'joined', need: 1, recruit })
  assert.equal(filling.title, 'Your team is filling its last seat')
  assert.match(filling.body, /Urmi Terrace agents send the invites/)
  const idle = reconnectPlayerNext({ variant: 'connect', myStatus: 'joined', need: 0, idleCount: 1, recruit })
  assert.match(idle.body, /Urmi Terrace agents can drop them/)
  // Local members are unchanged.
  assert.equal(reconnectPlayerNext({ variant: 'connect', myStatus: 'joined', need: 1 }).title, 'Invite one teammate')
})

test('server: mission view and chat fall back to the recruit path; getGameState lists the teams', () => {
  assert.match(missions, /if \(pd\?\.status !== 'active'\) return await recruitMissionView\(supabase, content, agentNo, districtId\)/)
  const send = missions.slice(missions.indexOf('export async function sendReconnectMessage'))
  assert.match(send.slice(0, 1200), /joinedRecruitMission\(supabase, agentNo, districtId\)/)
  assert.match(missions, /success: true, available: true, variant: found\.goal\.variant, recruit: true/)
  assert.match(missions, /teamBoost: null/)
  assert.match(handlers, /timed\('helping', getMyRecruitMissions\(supabase, content, player\.agent_no\)\)/)
  assert.match(handlers, /\n    reconnectHelping,\n/)
})

test('client: recruits get the quest card, a way back, and none of the local-only controls', () => {
  assert.match(screen, /state\.reconnectHelping \|\| \[\]\)\.find\(\(h\) => h\.districtId === districtId\)/)
  assert.match(screen, /const helpingCards = recruitLinks\(state, districtId\)/)
  assert.match(screen, /if \(!res\.recruit && \['open', 'complete'\]\.includes\(m\?\.status\)/)
  assert.match(screen, /\} else if \(myRow\?\.status === 'joined' && !res\.recruit\) \{/)
  assert.match(screen, /myRow\?\.status === 'joined' && !res\.recruit \? questExitRow/)
  assert.match(hud, /if \(district\) \{ setState\(fresh\); goDistrict\(district\.wardId, district\.id\); return \}/)
})
