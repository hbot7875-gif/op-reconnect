-- Quest Skip: one paid skip per AGENT per mission, not per mission.
--
-- rc_xp_ledger carries a UNIQUE index on dedup_key ALONE
-- (rc_xp_ledger_dedup_key_key). Skip wrote its key as:
--
--     quest_skip:<mission_uuid>
--
-- so the first member of a quest to pay for a skip claimed that key globally.
-- Every other member of the SAME quest then hit a unique violation on insert,
-- the whole transaction rolled back, and the broad handler reported it as
-- 'already_skipped' -- to players who had never skipped anything.
--
-- Measured on production before this migration: mission b9099cde (Tae Pier)
-- had one paid skip on 2026-09-29 and five still-joined members who could not
-- skip because of it, one of them with every track and album goal finished and
-- nothing else between her and the next district.
--
-- Every other per-agent dedup key in this schema already embeds the agent
-- number -- streams:AGENT000:<date>, district:AGENT000:<district>,
-- defuse:AGENT000:<uuid>, wings:AGENT000:<date>. quest_skip was the only one
-- that did not. This makes it match:
--
--     quest_skip:<agent_no>:<mission_uuid>
--
-- which is the idempotency the key was always reaching for: a replayed request
-- from the SAME agent still collides and still returns already_skipped, while a
-- different member of the same quest is no longer blocked by someone else's
-- exit.
--
-- The second change is the handler that hid this. A bare `when
-- unique_violation` caught everything and called it all already_skipped. It
-- now checks the constraint name: only the ledger's own dedup key means "you
-- already skipped this", and anything else is logged and returned as
-- skip_conflict. Both paths still roll back, so no player is charged for
-- either.
--
-- Function bodies only. No table, index, grant or row is touched: historical
-- keys stay exactly as written, AGENT120's and AGENT094's ledger entries are
-- left alone, and nothing is backfilled. Pricing, affordability, the waiting
-- period, the cooldown, free-reason logic, waives_requirement, expiry handling
-- and the advisory lock are all unchanged.

CREATE OR REPLACE FUNCTION public.rc_quest_skip_v2(p_agent text, p_mission uuid, p_evidence jsonb, p_scrobble_high_water bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_constraint text;
  q jsonb;
  v_xp integer; v_cells integer; v_free text; v_mode text;
  v_district text; v_contribution integer; v_rows integer;
  v_balance_xp integer; v_balance_cells integer;
  v_waives_requirement boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('rc_quest_skip|' || p_agent, 0));

  -- Serialize every state/payment decision against this mission membership
  -- and wallet. A concurrent owner removal must finish before we quote.
  perform 1 from public.rc_reconnect_missions where id = p_mission for update;
  if not found then return jsonb_build_object('success', false, 'error', 'mission_not_found'); end if;
  perform 1 from public.rc_reconnect_participants
    where mission_id = p_mission and agent_no = p_agent and status = 'joined' for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;
  perform 1 from public.rc_players where agent_no = p_agent for update;

  q := public.rc_quest_skip_quote_v2(p_agent, p_mission, p_evidence, p_scrobble_high_water);
  if not (q->>'success')::boolean then return q; end if;
  if (q->>'waitingPeriod')::boolean then
    return jsonb_build_object('success', false, 'error', 'too_soon', 'eligibleAt', q->>'eligibleAt');
  end if;
  if (q->>'onCooldown')::boolean then
    return jsonb_build_object('success', false, 'error', 'on_cooldown', 'cooldownUntil', q->>'cooldownUntil');
  end if;
  if not (q->>'canAfford')::boolean then
    return jsonb_build_object('success', false, 'error', 'insufficient',
      'shortXp', q->>'shortXp', 'shortCells', q->>'shortCells');
  end if;

  v_xp := (q->>'costXp')::integer;
  v_cells := (q->>'costCells')::integer;
  v_free := q->>'freeReason';
  v_mode := q->>'mode';
  -- A paid Skip is the actual progression escape: ReConnect becomes waived
  -- for this district attempt, but never completed and never rewarded.
  -- A verified system-stuck quest receives the same waiver at no cost.
  -- Cancel Join, Teammate Rescue and Expired Exit only leave the current team.
  v_waives_requirement := v_free is null or v_free = 'system_stuck';
  v_contribution := greatest(0, (p_evidence->>p_agent)::integer);
  select district_id into v_district from public.rc_reconnect_missions where id = p_mission;

  -- One paid exit per agent per mission, across BOTH key formats.
  --
  -- Until this migration the unique index on rc_xp_ledger.dedup_key was the
  -- entire idempotency: a replay collided and came back already_skipped.
  -- Agent-scoping the key fixes the cross-agent collision but would drop that
  -- protection for anyone who skipped BEFORE it, because their historical
  -- 'quest_skip:<mission>' row can no longer collide with their new
  -- 'quest_skip:<agent>:<mission>' one. Leaving it there would let a legacy
  -- skipper who rejoins the same quest -- rc_reconnect_accept_invite and
  -- rc_admin_fill_reconnect_team both set a participant back to 'joined' --
  -- pay for the same exit twice.
  --
  -- Scoped to agent_no, so a DIFFERENT member of the same quest is still free
  -- to skip, which is the whole point of the change. Free exits never wrote a
  -- ledger row (the insert below is guarded by v_xp > 0), so a cancel_join or
  -- an expired exit still does not block a later paid skip.
  if exists (
    select 1 from public.rc_xp_ledger
     where agent_no = p_agent
       and dedup_key in ('quest_skip:' || p_mission::text,
                         'quest_skip:' || p_agent || ':' || p_mission::text)
  ) then
    return jsonb_build_object('success', false, 'error', 'already_skipped');
  end if;

  if v_cells > 0 then
    update public.rc_players set charge_cells = charge_cells - v_cells
      where agent_no = p_agent and charge_cells >= v_cells;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'quest_exit_balance_changed'; end if;
  end if;
  if v_xp > 0 then
    insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
    values (p_agent, -v_xp, 'quest_skip', 'spend', 'quest_skip:' || p_agent || ':' || p_mission::text,
            jsonb_build_object('missionId', p_mission, 'mode', v_mode));
  end if;

  update public.rc_reconnect_participants
    set status = 'left', left_at = now(), contribution_frozen = v_contribution
    where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'quest_exit_membership_changed'; end if;

  insert into public.rc_quest_skips
    (agent_no, mission_id, district_id, mode, cost_xp, cost_cells, free_reason,
     eligibility_evidence, waives_requirement)
  values
    (p_agent, p_mission, v_district, v_mode, v_xp, v_cells, v_free,
     coalesce(q->'eligibilityEvidence', '{}'::jsonb) || jsonb_build_object(
       'contributionSnapshot', p_evidence,
       'scrobbleHighWater', p_scrobble_high_water
     ), v_waives_requirement);

  -- Keep history, but an empty quest must no longer be matchable or count as open.
  if not exists (
    select 1 from public.rc_reconnect_participants
    where mission_id = p_mission and status = 'joined'
  ) then
    update public.rc_reconnect_missions
      set status = 'cancelled'
      where id = p_mission and status = 'open';
  end if;

  select coalesce(sum(amount), 0) into v_balance_xp
    from public.rc_xp_ledger where agent_no = p_agent;
  select coalesce(charge_cells, 0) into v_balance_cells
    from public.rc_players where agent_no = p_agent;

  return jsonb_build_object(
    'success', true, 'free', v_free is not null, 'freeReason', v_free,
    'costXp', v_xp, 'costCells', v_cells, 'districtId', v_district,
    'balanceXp', v_balance_xp, 'balanceCells', v_balance_cells,
    'waivesRequirement', v_waives_requirement
  );
exception when unique_violation then
  -- Only the skip's OWN ledger key means "this agent already skipped this
  -- mission". Every other unique violation used to be relabelled the same
  -- way, which is how one member's key collision spent days looking like a
  -- duplicate tap to five people who had never skipped anything. Anything
  -- unexpected is now reported truthfully, and still rolls back, so nobody
  -- is charged for it.
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'rc_xp_ledger_dedup_key_key' then
    return jsonb_build_object('success', false, 'error', 'already_skipped');
  end if;
  raise warning 'rc_quest_skip unexpected unique violation on constraint %', v_constraint;
  return jsonb_build_object('success', false, 'error', 'skip_conflict');
end;
$function$;

CREATE OR REPLACE FUNCTION public.rc_quest_skip(p_agent text, p_mission uuid, p_contribution integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_constraint text;
  q jsonb;
  v_xp integer; v_cells integer; v_free text; v_mode text;
  v_district text;
begin
  -- One skip at a time per agent: a double tap or two devices racing each
  -- other both land here, and the second sees the first one's writes.
  perform pg_advisory_xact_lock(hashtextextended('rc_quest_skip|' || p_agent, 0));

  q := public.rc_quest_skip_quote(p_agent, p_mission);
  if not (q->>'success')::boolean then return q; end if;
  if (q->>'waitingPeriod')::boolean then
    return jsonb_build_object('success', false, 'error', 'too_soon', 'eligibleAt', q->>'eligibleAt');
  end if;
  if (q->>'onCooldown')::boolean then
    return jsonb_build_object('success', false, 'error', 'on_cooldown', 'cooldownUntil', q->>'cooldownUntil');
  end if;
  if not (q->>'canAfford')::boolean then
    return jsonb_build_object('success', false, 'error', 'insufficient',
      'shortXp', q->>'shortXp', 'shortCells', q->>'shortCells');
  end if;

  v_xp := (q->>'costXp')::integer;
  v_cells := (q->>'costCells')::integer;
  v_free := q->>'freeReason';
  v_mode := q->>'mode';
  select district_id into v_district from public.rc_reconnect_missions where id = p_mission;

  -- Both resources move together or neither does (one transaction).
  -- One paid exit per agent per mission, across BOTH key formats.
  --
  -- Until this migration the unique index on rc_xp_ledger.dedup_key was the
  -- entire idempotency: a replay collided and came back already_skipped.
  -- Agent-scoping the key fixes the cross-agent collision but would drop that
  -- protection for anyone who skipped BEFORE it, because their historical
  -- 'quest_skip:<mission>' row can no longer collide with their new
  -- 'quest_skip:<agent>:<mission>' one. Leaving it there would let a legacy
  -- skipper who rejoins the same quest -- rc_reconnect_accept_invite and
  -- rc_admin_fill_reconnect_team both set a participant back to 'joined' --
  -- pay for the same exit twice.
  --
  -- Scoped to agent_no, so a DIFFERENT member of the same quest is still free
  -- to skip, which is the whole point of the change. Free exits never wrote a
  -- ledger row (the insert below is guarded by v_xp > 0), so a cancel_join or
  -- an expired exit still does not block a later paid skip.
  if exists (
    select 1 from public.rc_xp_ledger
     where agent_no = p_agent
       and dedup_key in ('quest_skip:' || p_mission::text,
                         'quest_skip:' || p_agent || ':' || p_mission::text)
  ) then
    return jsonb_build_object('success', false, 'error', 'already_skipped');
  end if;

  if v_cells > 0 then
    update public.rc_players set charge_cells = charge_cells - v_cells
      where agent_no = p_agent and charge_cells >= v_cells;
    if not found then return jsonb_build_object('success', false, 'error', 'insufficient'); end if;
  end if;
  if v_xp > 0 then
    -- kind='spend' => spendable wallet drops, level XP untouched.
    insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
    values (p_agent, -v_xp, 'quest_skip', 'spend', 'quest_skip:' || p_agent || ':' || p_mission::text,
            jsonb_build_object('missionId', p_mission, 'mode', v_mode));
  end if;

  -- Seat released; their streams stay in the pool, frozen at this moment.
  update public.rc_reconnect_participants
    set status = 'left', left_at = now(), contribution_frozen = greatest(0, coalesce(p_contribution, 0))
    where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  insert into public.rc_quest_skips (agent_no, mission_id, district_id, mode, cost_xp, cost_cells, free_reason)
  values (p_agent, p_mission, v_district, v_mode, v_xp, v_cells, v_free);

  return jsonb_build_object('success', true, 'free', v_free is not null, 'freeReason', v_free,
    'costXp', v_xp, 'costCells', v_cells, 'districtId', v_district);
exception when unique_violation then
  -- Only the skip's OWN ledger key means "this agent already skipped this
  -- mission". Every other unique violation used to be relabelled the same
  -- way, which is how one member's key collision spent days looking like a
  -- duplicate tap to five people who had never skipped anything. Anything
  -- unexpected is now reported truthfully, and still rolls back, so nobody
  -- is charged for it.
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'rc_xp_ledger_dedup_key_key' then
    return jsonb_build_object('success', false, 'error', 'already_skipped');
  end if;
  raise warning 'rc_quest_skip unexpected unique violation on constraint %', v_constraint;
  return jsonb_build_object('success', false, 'error', 'skip_conflict');
end;
$function$;
