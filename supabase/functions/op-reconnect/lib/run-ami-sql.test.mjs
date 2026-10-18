// RUN AMI: what the migration, the Edge adapter and the route table must
// (and must never) contain. There is no local Postgres in this repo, so the
// database half of the guarantees is checked against the SQL text itself —
// same approach as charge-wallet.test.mjs and quest-skip-dedup.test.mjs.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '')

const migration = read('../../../migrations/20261018120000_rc_run_ami.sql')
const schedule = read('../../../migrations/20261018120500_rc_run_ami_sweep_schedule.sql')
const sql = stripComments(migration)
const adapter = read('./run-ami.ts')
const index = read('../index.ts')

const functions = [...sql.matchAll(/create or replace function public\.(rc_run_ami_\w+)\(/g)].map((m) => m[1])
const tables = [...sql.matchAll(/create table if not exists public\.(rc_run_ami_\w+)/g)].map((m) => m[1])

test('the schema is the approved set of rc_run_ami_* tables', () => {
  assert.deepEqual(tables.sort(), [
    'rc_run_ami_events', 'rc_run_ami_match_players', 'rc_run_ami_match_secrets',
    'rc_run_ami_matches', 'rc_run_ami_rooms', 'rc_run_ami_seats',
  ])
})

test('every table: RLS on, no anon/authenticated grants', () => {
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t)
    assert.match(sql, new RegExp(`revoke all on[^;]*public\\.${t}[^;]*from public, anon, authenticated`), t)
  }
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/)
})

test('every function: revoked from browser roles, executable by service_role only', () => {
  const revoke = sql.slice(sql.indexOf('revoke all on function'))
  for (const f of functions) {
    assert.match(revoke.slice(0, revoke.indexOf('from public, anon, authenticated')), new RegExp(`public\\.${f}\\(`), `${f} not revoked`)
    const grant = revoke.slice(revoke.indexOf('grant execute on function'))
    assert.match(grant.slice(0, grant.indexOf('to service_role')), new RegExp(`public\\.${f}\\(`), `${f} not granted to service_role`)
  }
  assert.match(schedule, /revoke all on function public\.rc_invoke_run_ami_sweep\(\) from public, anon, authenticated/)
})

test('RUN AMI never writes any ARMY Bomb charge, feed or wallet column', () => {
  for (const text of [stripComments(migration), stripComments(schedule), adapter]) {
    assert.doesNotMatch(text, /update\s+(public\.)?rc_agent_charge/i)
    assert.doesNotMatch(text, /insert\s+into\s+(public\.)?rc_agent_charge/i)
    assert.doesNotMatch(text, /update\s+(public\.)?rc_players/i)
    assert.doesNotMatch(text, /(charged_until|last_fed_at|auto_feed|blackout_started_at|charge_cells)\s*=/i)
    assert.doesNotMatch(text, /rc_(feed_charge|auto_feed_charge|credit_charge_cells|use_lit_era|red_zone_full_charge)/)
    assert.doesNotMatch(text, /\.from\('rc_agent_charge'\)\s*\.(update|insert|upsert|delete)/)
  }
  // The Bomb gate is a read: charged_until in the future.
  assert.match(sql, /select c\.charged_until > now\(\)\s+from rc_agent_charge c where c\.agent_no = p_agent_no/)
})

test('the Bomb gate runs inside create, join and start', () => {
  for (const f of ['rc_run_ami_create_room', 'rc_run_ami_join_room', 'rc_run_ami_start_match']) {
    const body = sql.slice(sql.indexOf(`function public.${f}(`))
    const end = body.indexOf('$$;', body.indexOf('$$') + 2)
    assert.match(body.slice(0, end), /rc_run_ami_bomb_active\(/, f)
  }
})

test('commit is a compare-and-set on version, and idempotent on action_id', () => {
  const body = sql.slice(sql.indexOf('function public.rc_run_ami_commit('))
  assert.match(body, /where id = p_match_id and version = p_expected_version and status = 'active'/)
  assert.match(body, /'reason', 'stale'/)
  assert.match(body, /'reason', 'duplicate'/)
  assert.match(sql, /create unique index if not exists rc_run_ami_events_action_uq\s+on public\.rc_run_ami_events \(match_id, agent_no, action_id\) where action_id is not null/)
})

test('a round end releases only disconnect seats still quiet, not agents who came back', () => {
  const body = sql.slice(sql.indexOf('function public.rc_run_ami_commit('))
  const release = body.slice(body.indexOf("perform rc_run_ami_release_seat(v_room_id, mp.agent_no, 'PLAYER_LEFT')"))
  assert.match(release, /mp\.forfeit_reason = 'disconnect'/)
  assert.match(release, /join rc_run_ami_seats s\s+on s\.room_id = v_room_id and s\.agent_no = mp\.agent_no and s\.left_at is null/)
  assert.match(release, /s\.last_seen_at < now\(\) - make_interval\(secs =>\s+greatest\(coalesce\(\(p_state->'cfg'->>'heartbeatStaleSeconds'\)::int, 15\), 5\)\)/)
})

test('one room per agent, one agent per seat, one active match per room', () => {
  assert.match(sql, /rc_run_ami_seats_one_room_per_agent\s+on public\.rc_run_ami_seats \(agent_no\) where left_at is null/)
  assert.match(sql, /rc_run_ami_seats_one_agent_per_seat\s+on public\.rc_run_ami_seats \(room_id, seat\) where left_at is null/)
  assert.match(sql, /rc_run_ami_matches_one_active_per_room\s+on public\.rc_run_ami_matches \(room_id\) where status = 'active'/)
})

test('start refuses a lobby that changed since the state was dealt', () => {
  const body = sql.slice(sql.indexOf('function public.rc_run_ami_start_match('))
  assert.match(body, /v_room\.version <> p_room_version or v_seated is distinct from p_agents/)
  assert.match(body, /not between 2 and 4/)
  assert.match(body, /host_agent_no <> p_agent_no/)
})

test('Realtime broadcasts carry version numbers only', () => {
  const sends = [...sql.matchAll(/realtime\.send\(([\s\S]*?)\);/g)].map((m) => m[1])
  assert.equal(sends.length, 1)
  assert.match(sends[0], /jsonb_build_object\('r', v_room_version, 'v', v_match_version\)/)
  assert.match(sends[0], /false\)?$/m) // public channel; topic is the unguessable room secret
  // and a broadcast failure can never fail the commit
  assert.match(migration, /exception when others then\s+null;\s+-- Realtime is a nudge/)
})

test('player routes never read the private event payload or the secrets raw', () => {
  const recent = adapter.slice(adapter.indexOf('async recentEvents'))
  assert.match(recent.slice(0, recent.indexOf('},')), /select\('id, type, seat, public'\)/)
  assert.doesNotMatch(adapter, /select\([^)]*\bprivate\b/)
  // secrets are read in exactly one place — embedded in loadMatch, whose
  // result only ever reaches a browser through run-ami-view.js — and never
  // queried directly.
  assert.doesNotMatch(adapter, /from\('rc_run_ami_match_secrets'\)/)
  assert.equal((adapter.match(/rc_run_ami_match_secrets\(state\)/g) || []).length, 1)
})

test('routes: every player route requires an agent session; the sweep is cron-only', () => {
  for (const r of ['runAmiState', 'runAmiCreateRoom', 'runAmiJoinRoom', 'runAmiLeaveRoom', 'runAmiStart', 'runAmiAct']) {
    assert.match(index, new RegExp(`\\b${r}: \\{ auth: 'agent'`), r)
  }
  assert.match(index, /cronRunAmiSweep: \{ auth: 'cron'/)
})

test('match history distinguishes a played-out win from a walkover', () => {
  assert.match(sql, /result text check \(result in \('won', 'played', 'forfeited', 'last_standing', 'abandoned'\)\)/)
  assert.match(sql, /end_reason text check \(end_reason in \('played_out', 'last_standing', 'abandoned'\)\)/)
})

test('V1 has no paid entry: the only entry mode is an active Bomb', () => {
  assert.match(sql, /entry_mode text not null default 'bomb_active' check \(entry_mode in \('bomb_active'\)\)/)
})

test('cron schedule: one job, every minute, skips the HTTP call when idle', () => {
  assert.match(schedule, /cron\.schedule\('rc-run-ami-sweep', '\* \* \* \* \*'/)
  assert.match(schedule, /'action', 'cronRunAmiSweep'/)
  assert.match(schedule, /if not exists \(select 1 from rc_run_ami_matches where status = 'active'\)/)
})
