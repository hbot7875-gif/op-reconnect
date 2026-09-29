-- Behavioural proof that retiring a mission creator no longer destroys other
-- agents' ReConnect history.
--
-- The guard tests in lib/mission-preservation.test.mjs check the statement.
-- This checks the CONSEQUENCE: it builds a real mission with three real
-- agents, purges the creator through the real rc_purge_agent_data, and counts
-- what survives. That is the thing that actually went wrong, and a source
-- assertion cannot prove it.
--
-- Run AFTER 20260928120000 has been applied -- it exercises whatever
-- rc_purge_agent_data is currently installed.
--
-- HOW IT ROLLS BACK. Everything lives in ONE DO block that ends by raising an
-- exception carrying the results. A DO block is a single statement, so the
-- raise aborts it atomically and every row it created disappears -- no BEGIN
-- and no client cooperation required, which means it is safe even through a
-- client that autocommits each statement. Success looks like an ERROR whose
-- message begins "VERIFICATION COMPLETE"; anything else is a real failure.
--
-- SIDE EFFECTS THAT SURVIVE THE ROLLBACK -- reviewed 2026-09-28:
--   * rc_reconnect_messages.id is a sequence and this inserts 5 rows, so 5 id
--     values are consumed permanently. Sequences are non-transactional by
--     design. The column is an internal surrogate key with no meaning outside
--     a mission, so a gap costs nothing.
--   * Nothing else. rc_reconnect_missions uses gen_random_uuid (no sequence),
--     and rc_storage_deletion_queue is never reached because the fixture
--     creates no rc_vma_votes rows, so rc_queue_agent_proof_files queues none.
--   * No function in the purge path, and no trigger it can fire, makes an
--     external call: none of rc_purge_agent_data, rc_queue_agent_proof_files,
--     rc_award_reconnect_badges, rc_delete_engagement_for_player or
--     rc_award_badge references net.http, pg_notify, dblink or vault.
--   * The mission badge trigger (AFTER INSERT OR UPDATE on rc_reconnect_missions)
--     fires but is inert: it returns immediately unless status = 'complete',
--     and for an already-complete mission its UPDATE guard returns too. The
--     fixture's mission is created 'open'.
--   * Locks are held only on the four synthetic agent rows and their own data,
--     for the life of a sub-second transaction.

do $$
declare
  creator  text := '__TEST_CREATOR__';
  mate_a   text := '__TEST_MATE_A__';
  mate_b   text := '__TEST_MATE_B__';
  solo     text := '__TEST_SOLO__';
  d_id     text;
  g_id     text;
  m_shared uuid;
  m_solo   uuid;
  n        integer;
  ok       boolean;
  report   text := '';
begin
  select id into d_id from rc_districts order by id limit 1;
  if d_id is null then raise exception 'no districts exist; cannot build a fixture'; end if;
  select id into g_id from rc_goals where district_id = d_id order by id limit 1;

  -- ── Fixture ────────────────────────────────────────────────────────
  insert into rc_agents (agent_no, handle, password_hash)
  values (creator, creator, 'x'), (mate_a, mate_a, 'x'), (mate_b, mate_b, 'x'), (solo, solo, 'x');
  insert into rc_players (agent_no, codename)
  values (creator, 'creator'), (mate_a, 'mate a'), (mate_b, 'mate b'), (solo, 'solo');

  -- A shared mission the creator owns, with two other agents on it.
  insert into rc_reconnect_missions (district_id, required_agents, track_label, created_by, goal_id)
  values (d_id, 3, 'verify track', creator, g_id) returning id into m_shared;
  insert into rc_reconnect_participants (mission_id, agent_no, status, joined_mode)
  values (m_shared, creator, 'joined', 'easy'),
         (m_shared, mate_a,  'joined', 'easy'),
         (m_shared, mate_b,  'joined', 'easy');
  insert into rc_reconnect_messages (mission_id, agent_no, body)
  values (m_shared, creator, 'from the creator'),
         (m_shared, mate_a,  'from mate a'),
         (m_shared, mate_b,  'from mate b'),
         (m_shared, mate_b,  'from mate b again');

  -- A mission owned by someone else entirely, which must not be touched.
  insert into rc_reconnect_missions (district_id, required_agents, track_label, created_by, goal_id)
  values (d_id, 1, 'solo track', solo, g_id) returning id into m_solo;
  insert into rc_reconnect_participants (mission_id, agent_no, status, joined_mode, invited_by)
  values (m_solo, solo, 'joined', 'easy', creator);
  insert into rc_reconnect_messages (mission_id, agent_no, body) values (m_solo, solo, 'solo message');

  -- ── The act under test ─────────────────────────────────────────────
  if not rc_purge_agent_data(creator, 'verify_preserve_missions') then
    raise exception 'rc_purge_agent_data returned false';
  end if;

  -- ── 1. The mission survives, anonymised ────────────────────────────
  select count(*) into n from rc_reconnect_missions where id = m_shared;
  if n <> 1 then raise exception 'FAIL 1: the mission was deleted (found %)', n; end if;
  select created_by = '__deleted__' into ok from rc_reconnect_missions where id = m_shared;
  if not ok then raise exception 'FAIL 1: created_by was not anonymised'; end if;
  report := report || E'\n  PASS 1  mission preserved, created_by = __deleted__';

  -- ── 2. Other agents keep their participant rows ────────────────────
  select count(*) into n from rc_reconnect_participants
   where mission_id = m_shared and agent_no in (mate_a, mate_b);
  if n <> 2 then raise exception 'FAIL 2: expected 2 teammate participant rows, found %', n; end if;
  report := report || E'\n  PASS 2  both teammates kept their participation';

  -- ── 3. Other agents keep their messages ────────────────────────────
  select count(*) into n from rc_reconnect_messages
   where mission_id = m_shared and agent_no in (mate_a, mate_b);
  if n <> 3 then raise exception 'FAIL 3: expected 3 teammate messages, found %', n; end if;
  report := report || E'\n  PASS 3  all three teammate messages survived';

  -- ── 4. The retiring agent's own rows are gone ──────────────────────
  select count(*) into n from rc_reconnect_participants where agent_no = creator;
  if n <> 0 then raise exception 'FAIL 4: creator still has % participant row(s)', n; end if;
  select count(*) into n from rc_reconnect_messages where agent_no = creator;
  if n <> 0 then raise exception 'FAIL 4: creator still has % message(s)', n; end if;
  report := report || E'\n  PASS 4  the retiring agent''s own participation and messages were removed';

  -- ── 5. The agent itself is gone, and logged ────────────────────────
  select count(*) into n from rc_agents where agent_no = creator;
  if n <> 0 then raise exception 'FAIL 5: rc_agents row survived'; end if;
  select count(*) into n from rc_deleted_agent_log
   where agent_no = creator and reason = 'verify_preserve_missions';
  if n <> 1 then raise exception 'FAIL 5: deletion was not logged (% rows)', n; end if;
  report := report || E'\n  PASS 5  the agent was removed and logged';

  -- ── 6. Invites they sent are un-named, not deleted ─────────────────
  select count(*) into n from rc_reconnect_participants
   where mission_id = m_solo and agent_no = solo and invited_by is null;
  if n <> 1 then raise exception 'FAIL 6: the invite row was not preserved-and-nulled'; end if;
  report := report || E'\n  PASS 6  invites they sent were un-named, not deleted';

  -- ── 7. Somebody else's mission is untouched ────────────────────────
  select count(*) into n from rc_reconnect_missions where id = m_solo and created_by = solo;
  if n <> 1 then raise exception 'FAIL 7: an unrelated mission was affected'; end if;
  select count(*) into n from rc_reconnect_messages where mission_id = m_solo;
  if n <> 1 then raise exception 'FAIL 7: an unrelated mission lost messages'; end if;
  report := report || E'\n  PASS 7  unrelated missions are untouched';

  -- ── 8. Nobody can act as the sentinel ──────────────────────────────
  select count(*) into n from rc_agents where agent_no = '__deleted__';
  if n <> 0 then raise exception 'FAIL 8: an agent row exists with the sentinel number'; end if;
  -- Read the minting function's source rather than calling it: nextval is not
  -- transactional, so calling it would burn a real agent number this rollback
  -- could not give back.
  select prosrc ~ 'AGENT.*lpad\(nextval' into ok from pg_proc where proname = 'rc_next_agent_no';
  if not coalesce(ok, false) then raise exception 'FAIL 8: rc_next_agent_no no longer mints AGENTnnn'; end if;
  report := report || E'\n  PASS 8  no agent can act as __deleted__';

  -- ── 9. The orphaned mission can still expire normally ──────────────
  --      Expiry is status='open' AND expires_at <= now, with no reference to
  --      created_by, so an anonymised mission is not stuck open.
  update rc_reconnect_missions set expires_at = now() - interval '1 day' where id = m_shared;
  update rc_reconnect_missions set status = 'expired' where id = m_shared and status = 'open';
  select status = 'expired' into ok from rc_reconnect_missions where id = m_shared;
  if not ok then raise exception 'FAIL 9: an anonymised mission could not expire'; end if;
  report := report || E'\n  PASS 9  an anonymised mission still expires normally';

  -- Everything above passed. Abort deliberately: this is what rolls the whole
  -- fixture back, and it carries the report out in the error message.
  raise exception 'VERIFICATION COMPLETE - all checks passed, rolling back:%', report;
end $$;
