// The dashboard's read-only admin views (admin-readonly.ts), driven for real
// against an in-memory Supabase stand-in that THROWS on any write. If one of
// these actions ever inserts, updates, upserts or deletes — or settles a quest
// the way refreshMission does — these tests fail.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } }
const { adminListLeaves, adminCleanupPreview, adminListReconnectQuests, adminGetReconnectQuest } = await import('./admin-readonly.ts')
const { normKeyFull } = await import('./text.ts')
const { questStages, questDisplayStatus, questMode, contributionWindowEnd, memberContribution, inviteLapsed } = await import('./reconnect-admin-view.js')

const NOW = Date.now()
const H = 3600e3, D = 24 * H
const iso = (ms) => new Date(NOW + ms).toISOString()
const sec = (ms) => Math.floor((NOW + ms) / 1000)

/** In-memory read-only client. Supports the filters these functions use. */
function readOnlyDb(tables, { rpc = {} } = {}) {
  const calls = { rpc: [], reads: [] }
  const from = (table) => {
    const filters = []
    let range = null
    let limit = null
    const rows = () => {
      let out = (tables[table] || []).filter((r) => filters.every((f) => f(r)))
      if (range) out = out.slice(range[0], range[1] + 1)
      if (limit != null) out = out.slice(0, limit)
      return out
    }
    const deny = (op) => () => { throw new Error(`write attempted: ${op} ${table}`) }
    const chain = {
      select: () => chain,
      eq: (c, v) => (filters.push((r) => r[c] === v), chain),
      neq: (c, v) => (filters.push((r) => r[c] !== v), chain),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), chain),
      gte: (c, v) => (filters.push((r) => r[c] != null && r[c] >= v), chain),
      gt: (c, v) => (filters.push((r) => r[c] != null && r[c] > v), chain),
      lt: (c, v) => (filters.push((r) => r[c] != null && r[c] < v), chain),
      order: () => chain,
      limit: (n) => { limit = n; return chain },
      range: (a, b) => { range = [a, b]; return chain },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      insert: deny('insert'), update: deny('update'), upsert: deny('upsert'), delete: deny('delete'),
    }
    calls.reads.push(table)
    return chain
  }
  return {
    calls,
    from,
    rpc: async (name, args) => {
      calls.rpc.push([name, args])
      if (!(name in rpc)) throw new Error(`unexpected rpc ${name}`)
      return { data: rpc[name], error: null }
    },
  }
}

const BUTTER = normKeyFull('Butter')
const content = {
  config: {},
  districts: [{ id: 'bell', name: 'Bell Tower' }, { id: 'old', name: 'Old Station' }],
  goals: [
    { id: 'g-pool', kind: 'reconnect', label: 'Butter pool', variant: 'connect', config: { requiredAgents: 2, sharedTrack: { label: 'Butter', keys: [BUTTER], target: 30 }, ciphers: [{ prompt: 'secret', answerKeys: ['x'] }] } },
    { id: 'g-inv', kind: 'reconnect', label: 'Invite 3', variant: 'invite', config: { requiredAgents: 3 } },
  ],
}
const frozenPool = { reconnect: { id: 'g-pool', variant: 'connect', config: content.goals[0].config } }

function questTables() {
  return {
    rc_reconnect_missions: [
      // completed 2 days ago, two members, one later streamed after completion
      { id: 'm-done', district_id: 'bell', goal_id: 'g-pool', required_agents: 2, status: 'complete', phase: 'cipher', cipher_index: 0, cipher_attempts_left: 2,
        created_at: iso(-6 * D), completed_at: iso(-2 * D), expires_at: iso(1 * D), cards_unlocked_at: null, created_by: 'A1' },
      // open, waiting for a teammate
      { id: 'm-open', district_id: 'bell', goal_id: 'g-pool', required_agents: 2, status: 'open', phase: 'streaming', cipher_index: null, cipher_attempts_left: null,
        created_at: iso(-1 * D), completed_at: null, expires_at: iso(6 * D), cards_unlocked_at: null, created_by: 'A3' },
      // open in the table but past its expiry (refreshMission hasn't run yet)
      { id: 'm-late', district_id: 'old', goal_id: 'g-inv', required_agents: 3, status: 'open', phase: 'streaming', cipher_index: null, cipher_attempts_left: null,
        created_at: iso(-9 * D), completed_at: null, expires_at: iso(-2 * H), cards_unlocked_at: null, created_by: 'A5' },
      // cancelled (folded duplicate)
      { id: 'm-cancel', district_id: 'bell', goal_id: 'g-pool', required_agents: 2, status: 'cancelled', phase: 'streaming', cipher_index: null, cipher_attempts_left: null,
        created_at: iso(-3 * D), completed_at: null, expires_at: iso(4 * D), cards_unlocked_at: null, created_by: 'A3' },
      // open leftover with nobody in it
      { id: 'm-empty', district_id: 'bell', goal_id: 'g-pool', required_agents: 2, status: 'open', phase: 'streaming', cipher_index: null, cipher_attempts_left: null,
        created_at: iso(-4 * D), completed_at: null, expires_at: iso(3 * D), cards_unlocked_at: null, created_by: 'A9' },
    ],
    rc_reconnect_participants: [
      { mission_id: 'm-done', agent_no: 'A1', status: 'joined', joined_at: iso(-5 * D), streamed_at: iso(-4 * D), left_at: null, contribution_frozen: 0 },
      { mission_id: 'm-done', agent_no: 'A2', status: 'joined', joined_at: iso(-5 * D), streamed_at: iso(-4 * D), left_at: null, contribution_frozen: 0 },
      { mission_id: 'm-done', agent_no: 'A4', status: 'left', joined_at: iso(-5 * D), streamed_at: null, left_at: iso(-4 * D), contribution_frozen: 7 },
      { mission_id: 'm-open', agent_no: 'A3', status: 'joined', joined_at: iso(-1 * D), streamed_at: null, left_at: null, contribution_frozen: 0 },
      { mission_id: 'm-open', agent_no: 'A6', status: 'invited', joined_at: iso(-30 * H), streamed_at: null, left_at: null, contribution_frozen: 0 },
      { mission_id: 'm-late', agent_no: 'A5', status: 'joined', joined_at: iso(-9 * D), streamed_at: null, left_at: null, contribution_frozen: 0 },
      { mission_id: 'm-cancel', agent_no: 'A3', status: 'joined', joined_at: iso(-3 * D), streamed_at: null, left_at: null, contribution_frozen: 0 },
    ],
    rc_players: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((a) => ({ agent_no: a, codename: `Code ${a}` })),
    rc_player_districts: [
      { agent_no: 'A1', district_id: 'bell', status: 'restored', goals: frozenPool },
      { agent_no: 'A3', district_id: 'bell', status: 'active', goals: frozenPool },
    ],
    // A1: 4 Butter plays on its join day, 10 the day after, 5 after completion (must not count)
    rc_scrobbles: [
      ...Array.from({ length: 4 }, (_, i) => ({ agent_no: 'A1', track_name: 'Butter', listened_at: sec(-5 * D + (i + 1) * 60e3) })),
    ],
    rc_daily_activity: [
      { agent_no: 'A1', kst_date: dayKey(-4 * D), track_counts: { [BUTTER]: { n: 10 } } },
      { agent_no: 'A1', kst_date: dayKey(-1 * D), track_counts: { [BUTTER]: { n: 5 } } },
      { agent_no: 'A2', kst_date: dayKey(-3 * D), track_counts: { [BUTTER]: { n: 6 } } },
    ],
    rc_run_ami_match_players: [],
  }
}
function dayKey(ms) { return new Date(NOW + ms + 9 * H).toISOString().slice(0, 10) }

test('leaves: every record, newest first, with codenames — and nothing written', async () => {
  const db = readOnlyDb({
    rc_player_leaves: [{ id: 1, agent_no: 'A1', starts_at: iso(-3 * D), ends_at: iso(4 * D), ended_at: null, district_id: 'bell', district_hours_granted: 168, bomb_shift_hours: 168, blackout_shift_hours: 0, created_at: iso(-3 * D) }],
    rc_players: [{ agent_no: 'A1', codename: 'Code A1' }],
  })
  const res = await adminListLeaves(db, {})
  assert.equal(res.success, true)
  assert.deepEqual(res.leaves[0], { id: 1, agentNo: 'A1', codename: 'Code A1', startsAt: iso(-3 * D), endsAt: iso(4 * D), endedAt: null,
    districtId: 'bell', districtHoursGranted: 168, bombShiftHours: 168, blackoutShiftHours: 0, createdAt: iso(-3 * D) })
})

test('cleanup preview: asks the read-only SQL preview for 9 and 14 days, nothing else', async () => {
  const db = readOnlyDb({}, { rpc: { rc_inactive_agent_deletion_preview: [
    { agent_no: 'A1', codename: 'X', days_inactive: '16.2', has_email: false, first_warned_at: null, last_warned_at: null, last_attempt_at: null, warn_count: 0, last_delivery_ok: null, eligible_from: null, eligible: true },
  ] } })
  const res = await adminCleanupPreview(db, {})
  assert.deepEqual(db.calls.rpc, [['rc_inactive_agent_deletion_preview', { p_min_days: 9, p_inactive_days: 14 }]])
  assert.equal(res.agents[0].eligible, true)
  assert.equal(res.agents[0].daysInactive, 16.2)
  assert.equal(res.noticeDays, 2)
})

test('quest list: completed, cancelled and expired kept; empty leftovers dropped; stages from stored phase', async () => {
  const db = readOnlyDb(questTables())
  const res = await adminListReconnectQuests(db, content, { days: 30 })
  assert.equal(res.success, true)
  const byId = Object.fromEntries(res.quests.map((q) => [q.missionId, q]))
  assert.deepEqual(Object.keys(byId).sort(), ['m-cancel', 'm-done', 'm-late', 'm-open'])
  assert.equal(byId['m-done'].status, 'completed')
  assert.equal(byId['m-cancel'].status, 'cancelled')
  assert.equal(byId['m-late'].status, 'expired', 'past expiry reads as expired')
  assert.equal(byId['m-late'].storedStatus, 'open', 'and is not written back')
  assert.equal(byId['m-open'].members.find((m) => m.agentNo === 'A6').inviteLapsed, true)
  assert.deepEqual(byId['m-done'].stages.map((s) => s.state), ['done', 'done', 'done', 'done'])
  assert.deepEqual(byId['m-open'].stages.map((s) => [s.key, s.state]), [['team', 'current'], ['streaming', 'todo'], ['cipher', 'todo'], ['complete', 'todo']])
  assert.deepEqual(byId['m-late'].stages.map((s) => s.state), ['stopped', 'todo'])
  assert.equal(byId['m-done'].configFrozen, true)
  assert.equal(JSON.stringify(res).includes('secret'), false, 'cipher prompts and answers never leave the server')
})

test('quest detail: contributions in the quest unit, counted from joining to completion', async () => {
  const db = readOnlyDb(questTables())
  const res = await adminGetReconnectQuest(db, content, { missionId: 'm-done' })
  assert.equal(res.success, true)
  const m = Object.fromEntries(res.quest.members.map((x) => [x.agentNo, x]))
  assert.equal(res.quest.mode, 'sharedTrack')
  assert.deepEqual(m.A1.contribution, { value: 14, of: null, unit: 'plays' }, '4 on the join day + 10 after; the 5 after completion do not count')
  assert.equal(m.A1.counted, 'until_close')
  assert.equal(m.A2.contribution.value, 6)
  assert.deepEqual(m.A4.contribution, { value: 7, of: null, unit: 'plays' })
  assert.equal(m.A4.counted, 'frozen_at_exit')
  assert.deepEqual(res.quest.pooled, { total: 27, target: 30, unit: 'plays', capped: false })
  const cancelled = await adminGetReconnectQuest(db, content, { missionId: 'm-cancel' })
  assert.equal(cancelled.quest.members[0].counted, 'cancelled')
  const invite = await adminGetReconnectQuest(db, content, { missionId: 'm-late' })
  assert.equal(invite.quest.members[0].contribution, null, 'invite quests need no streams')
})

test('the read-only module never writes and never settles a quest', () => {
  const src = readFileSync(new URL('./admin-readonly.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/)
  assert.doesNotMatch(src, /refreshMission|foldAwayDanglingMissions/)
  const rpcs = [...src.matchAll(/\.rpc\('([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(rpcs, ['rc_inactive_agent_deletion_preview'])
  const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  for (const action of ['adminListLeaves', 'adminCleanupPreview', 'adminListReconnectQuests', 'adminGetReconnectQuest']) {
    assert.match(index, new RegExp(`  ${action}: \\{ auth: 'admin',`), `${action} is admin-only`)
  }
})

test('stage and contribution rules', () => {
  const cfg = content.goals[0].config
  const base = { required_agents: 2, status: 'open', phase: 'streaming', expires_at: iso(D) }
  assert.equal(questMode('connect', cfg), 'sharedTrack')
  assert.equal(questMode('invite', {}), 'invite')
  assert.equal(questMode('connect', {}), 'ownGoals')
  assert.deepEqual(questStages(base, { variant: 'connect', config: cfg, joinedCount: 2, now: NOW }).map((s) => s.state), ['done', 'current', 'todo', 'todo'])
  assert.deepEqual(questStages({ ...base, phase: 'cipher', cipher_index: 0, cipher_attempts_left: 1 }, { variant: 'connect', config: cfg, joinedCount: 2, now: NOW })
    .map((s) => s.state), ['done', 'done', 'current', 'todo'])
  assert.equal(questStages({ ...base, phase: 'cipher', cipher_index: 0, cipher_attempts_left: 1 }, { variant: 'connect', config: cfg, joinedCount: 2, now: NOW })[2].detail, '1 of 1 · 1 guesses left')
  assert.deepEqual(questStages({ ...base, status: 'cancelled' }, { variant: 'connect', config: cfg, joinedCount: 1, now: NOW }).map((s) => s.state), ['stopped', 'todo', 'todo', 'todo'])
  assert.equal(questDisplayStatus({ ...base, expires_at: iso(-1) }, NOW), 'expired')
  assert.equal(contributionWindowEnd({ ...base, status: 'complete', completed_at: 'C' }, { status: 'joined' }, NOW), 'C')
  assert.equal(contributionWindowEnd(base, { status: 'joined' }, NOW), null)
  const totals = new Map([['a', 2], ['b', 0]])
  assert.deepEqual(memberContribution('checklist', { checklist: { tracks: [{ keys: ['a'] }, { keys: ['b'] }] } }, totals),
    { value: 1, of: 2, unit: 'tracks', perTrack: [true, false] })
  assert.equal(inviteLapsed({ status: 'invited', joined_at: iso(-25 * H) }, NOW), true)
})
