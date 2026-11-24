// Admin "Choose team manually" (rc_admin_fill_reconnect_team): every
// unqualified mission_id was ambiguous with the RETURNS TABLE column, and
// joined rows were inserted without the joined_mode the table requires.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../../migrations/20261125120000_rc_admin_fill_team_ambiguity.sql', import.meta.url), 'utf8')

test('columns win over the RETURNS TABLE names, and every reference is qualified', () => {
  assert.match(sql, /AS \$function\$\n#variable_conflict use_column\n/)
  assert.doesNotMatch(sql, /^\s*where mission_id = v_target/m)
  assert.match(sql, /on conflict on constraint rc_reconnect_participants_pkey do update/)
})

test('joined rows carry joined_mode, kept from an existing row first', () => {
  assert.match(sql, /mission_id, agent_no, status, invited_by, joined_at, joined_mode/)
  assert.match(sql, /joined_mode = coalesce\(rp\.joined_mode, excluded\.joined_mode\)/)
  assert.match(sql, /select pl\.mode into v_mode from public\.rc_players pl/)
})

test('the rules are the same checks as before', () => {
  for (const e of ['missing_params', 'goal_not_available', 'full_roster_required', 'agent_not_eligible',
    'agent_already_completed', 'target_not_open', 'target_has_other_agents', 'agent_busy_in_team', 'target_overfilled']) {
    assert.match(sql, new RegExp(`'${e}'`))
  }
})
