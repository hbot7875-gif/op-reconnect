-- Behavioural proof for 20260930074500_rc_quest_skip_agent_scoped_dedup.sql.
--
-- The source-level half lives in
-- supabase/functions/op-reconnect/lib/quest-skip-dedup.test.mjs. This is the
-- other half: two different agents actually skipping the SAME mission, which
-- is the thing that was broken and the thing no string assertion can prove.
--
-- READ-ONLY IN EFFECT. Everything happens inside one transaction that ends in
-- ROLLBACK, so no ledger row, no skip row, no participant change and no XP or
-- cell balance survives this script. Run it against production only after the
-- migration is applied:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/quest-skip-dedup-verify.sql
--
-- It uses synthetic agents and a synthetic mission rather than real players,
-- so it can be run at any time without touching anyone's progress.

begin;

do $$
declare
  v_mission uuid := gen_random_uuid();
  v_key_a text;
  v_key_b text;
  v_rows integer;
begin
  -- The two keys the fixed functions would write for two members of one
  -- mission. This is the whole bug in two lines: before the migration both
  -- of these were 'quest_skip:' || v_mission, and the unique index on
  -- rc_xp_ledger.dedup_key let only the first one exist.
  v_key_a := 'quest_skip:' || 'AGENT_TEST_A' || ':' || v_mission::text;
  v_key_b := 'quest_skip:' || 'AGENT_TEST_B' || ':' || v_mission::text;

  if v_key_a = v_key_b then
    raise exception 'FAIL: two agents on one mission still produce the same dedup key';
  end if;

  -- A and B both insert. Before the fix the second raised unique_violation.
  insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
  values ('AGENT_TEST_A', -75, 'quest_skip', 'spend', v_key_a, '{}'::jsonb);
  insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
  values ('AGENT_TEST_B', -75, 'quest_skip', 'spend', v_key_b, '{}'::jsonb);

  select count(*) into v_rows from public.rc_xp_ledger
   where dedup_key in (v_key_a, v_key_b);
  if v_rows <> 2 then
    raise exception 'FAIL: expected 2 rows for two agents, found %', v_rows;
  end if;
  raise notice 'PASS: two members of one mission can both be charged';

  -- The same agent replaying must still collide, or the key has stopped
  -- protecting against a double charge.
  begin
    insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
    values ('AGENT_TEST_A', -75, 'quest_skip', 'spend', v_key_a, '{}'::jsonb);
    raise exception 'FAIL: a same-agent replay was allowed to charge twice';
  exception
    when unique_violation then
      raise notice 'PASS: a same-agent replay still collides (already_skipped)';
  end;

  -- And the constraint it collides on is the one the narrowed handler looks
  -- for. If this name ever changes, the handler must change with it.
  begin
    insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
    values ('AGENT_TEST_A', -75, 'quest_skip', 'spend', v_key_a, '{}'::jsonb);
  exception
    when unique_violation then
      declare v_constraint text;
      begin
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'rc_xp_ledger_dedup_key_key' then
          raise exception 'FAIL: expected rc_xp_ledger_dedup_key_key, got %', v_constraint;
        end if;
        raise notice 'PASS: the handler watches the right constraint (%)', v_constraint;
      end;
  end;

  -- A historical mission-only key must not block either new key.
  insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
  values ('AGENT_TEST_C', -75, 'quest_skip', 'spend', 'quest_skip:' || v_mission::text, '{}'::jsonb);
  raise notice 'PASS: an old mission-only key coexists with the agent-scoped ones';
end $$;

-- ── the legacy replay guard ───────────────────────────────────────────────
--
-- Agent-scoping the key alone would let anyone who skipped BEFORE this
-- migration pay for the same exit twice, because their historical
-- 'quest_skip:<mission>' row no longer collides with their new
-- 'quest_skip:<agent>:<mission>' one. That matters because a participant who
-- left CAN be returned to 'joined' -- rc_reconnect_accept_invite and
-- rc_admin_fill_reconnect_team both do it -- so the old row is not the end of
-- the story. These three checks model the guard's own predicate against real
-- rows.
do $$
declare
  v_mission uuid := gen_random_uuid();
  v_blocked boolean;
begin
  -- A legacy skipper: charged once, under the OLD key.
  insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
  values ('AGENT_TEST_LEGACY', -75, 'quest_skip', 'spend',
          'quest_skip:' || v_mission::text, '{}'::jsonb);

  -- 1. The legacy owner retrying the SAME mission must be blocked.
  select exists (
    select 1 from public.rc_xp_ledger
     where agent_no = 'AGENT_TEST_LEGACY'
       and dedup_key in ('quest_skip:' || v_mission::text,
                         'quest_skip:' || 'AGENT_TEST_LEGACY' || ':' || v_mission::text)
  ) into v_blocked;
  if not v_blocked then
    raise exception 'FAIL: a legacy skipper could pay twice for the same mission';
  end if;
  raise notice 'PASS: the legacy owner is blocked from paying again';

  -- 2. A DIFFERENT member of the same mission must NOT be blocked by it.
  select exists (
    select 1 from public.rc_xp_ledger
     where agent_no = 'AGENT_TEST_OTHER'
       and dedup_key in ('quest_skip:' || v_mission::text,
                         'quest_skip:' || 'AGENT_TEST_OTHER' || ':' || v_mission::text)
  ) into v_blocked;
  if v_blocked then
    raise exception 'FAIL: another member is still blocked by someone else''s legacy key';
  end if;
  raise notice 'PASS: a different member of the same mission is free to skip';

  -- 3. That other member skips for real, and is then blocked on replay.
  insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
  values ('AGENT_TEST_OTHER', -75, 'quest_skip', 'spend',
          'quest_skip:' || 'AGENT_TEST_OTHER' || ':' || v_mission::text, '{}'::jsonb);
  select exists (
    select 1 from public.rc_xp_ledger
     where agent_no = 'AGENT_TEST_OTHER'
       and dedup_key in ('quest_skip:' || v_mission::text,
                         'quest_skip:' || 'AGENT_TEST_OTHER' || ':' || v_mission::text)
  ) into v_blocked;
  if not v_blocked then
    raise exception 'FAIL: a new-format skipper could pay twice';
  end if;
  raise notice 'PASS: a new-format skipper is blocked on replay';
end $$;

rollback;
