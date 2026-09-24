import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260924160000_rc_quest_exit_hardening.sql', 'utf8')
const skipEdge = readFileSync('supabase/functions/op-reconnect/lib/quest-skip.ts', 'utf8')
const missions = readFileSync('supabase/functions/op-reconnect/lib/reconnect-missions.ts', 'utf8')
const overlay = readFileSync('js/state.js', 'utf8')
const sheet = readFileSync('js/quest-skip.js', 'utf8')
const districtUi = readFileSync('js/ui-district.js', 'utf8')
const preview = readFileSync('_quest_skip_preview.html', 'utf8')

test('free eligibility uses fresh evidence, never streamed_at', () => {
  const quote = migration.slice(
    migration.indexOf('create or replace function public.rc_quest_skip_quote_v2'),
    migration.indexOf('create or replace function public.rc_quest_skip_v2(', migration.indexOf('create or replace function public.rc_quest_skip_quote_v2')),
  )
  assert.doesNotMatch(quote, /streamed_at/)
  assert.match(quote, /p_evidence->>p_agent/)
  assert.match(quote, /contribution_unavailable/)
  assert.match(quote, /s\.id > p_scrobble_high_water/)
  assert.match(quote, /contribution_changed/)
  assert.match(skipEdge, /questExitContributionEvidence/)
  assert.match(skipEdge, /highWater/)
  assert.doesNotMatch(skipEdge, /contribution = 0\s*\n\s*}/)
})

test('payment and membership change are one row-locked transaction', () => {
  assert.match(migration, /rc_reconnect_participants[\s\S]*status = 'joined' for update/)
  assert.match(migration, /rc_players where agent_no = p_agent for update/)
  assert.match(migration, /if v_rows <> 1 then raise exception 'quest_exit_membership_changed'/)
  assert.match(migration, /set status = 'cancelled'[\s\S]*status = 'joined'/)
})

test('owner removal freezes contributions and refuses self-removal', () => {
  assert.match(migration, /if p_actor = p_target then[\s\S]*use_quest_exit/)
  assert.match(migration, /contribution_frozen = greatest\(0, coalesce\(p_contribution, 0\)\)/)
  assert.match(missions, /rc_reconnect_remove_participant/)
  assert.match(missions, /questExitContributionEvidence/)
})

test('every join path locks a valid joined mode without current-mode fallback at exit', () => {
  assert.match(migration, /status = 'joined', joined_at = now\(\), joined_mode = v_mode/)
  assert.match(migration, /values \(p_mission_id, p_agent_no, 'joined', now\(\), v_mode\)/)
  assert.match(migration, /v_mode := v_p\.joined_mode/)
  assert.doesNotMatch(migration, /coalesce\(v_p\.joined_mode, \(select mode/)
})

test('safe confirmation focus and real preview builder stay wired', () => {
  assert.match(sheet, /keep\.dataset\.autofocus = 'true'/)
  assert.match(overlay, /querySelector\('\[data-autofocus="true"\]'\)/)
  assert.doesNotMatch(sheet, /queueMicrotask\(\(\) => keep\.focus\(\)\)/)
  assert.match(preview, /questSkipSheetPreview/)
  assert.doesNotMatch(preview, /new Function/)
})

test('successful exit refreshes authoritative game state before confirmation', () => {
  assert.match(sheet, /call\('getGameState', \{ agentNo \}\)/)
  assert.match(sheet, /if \(fresh\?\.success\) setState\(fresh\)/)
})

test('paid and system-stuck exits waive only the current district ReConnect gate', () => {
  const handlers = readFileSync('supabase/functions/op-reconnect/lib/handlers.ts', 'utf8')
  assert.match(migration, /v_waives_requirement := v_free is null or v_free = 'system_stuck'/)
  assert.match(migration, /eligibility_evidence, waives_requirement/)
  assert.match(missions, /eq\('waives_requirement', true\)\.gte\('created_at', attempt\.activated_at\)/)
  assert.match(missions, /done: true, skipped: true/)
  assert.match(handlers, /reconnect\?\.done && !reconnect\?\.skipped/)
  assert.match(sheet, /res\.waivesRequirement/)
  assert.match(districtUi, /ReConnect Quest · Skipped/)
  assert.match(districtUi, /Not completed · finish Track and Album/)
  assert.match(missions, /error: 'requirement_skipped'/)
  assert.match(missions, /invitee_requirement_skipped/)
  assert.match(migration, /v_m\.status = 'complete'[\s\S]*already_completed/)
})

test('v2 RPC names permit a no-downtime migration-first rollout', () => {
  assert.doesNotMatch(migration, /drop function if exists public\.rc_quest_skip/)
  assert.match(skipEdge, /rc_quest_skip_quote_v2/)
  assert.match(skipEdge, /rc_quest_skip_v2/)
})
