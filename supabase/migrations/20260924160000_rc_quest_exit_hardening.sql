-- Harden ReConnect Quest exits after the first production audit.
-- Prices and eligibility windows are unchanged. The important difference is
-- that free eligibility is now decided from a fresh authoritative evidence
-- map built from rc_scrobbles/rc_daily_activity, never streamed_at's UI cache.
-- Paid skips (and system-stuck exits) waive only the ReConnect requirement for
-- the current district activation. They never count as Quest completion.

alter table public.rc_quest_skips
  add column if not exists eligibility_evidence jsonb not null default '{}'::jsonb,
  add column if not exists waives_requirement boolean not null default false;

-- A joined participant must always carry the immutable price tier captured
-- at join. Legacy gaps use the safest documented fallback (hard), never the
-- player's mutable current mode.
update public.rc_reconnect_participants
set joined_mode = 'hard'
where status = 'joined' and joined_mode is null;

alter table public.rc_reconnect_participants
  drop constraint if exists rc_reconnect_joined_mode_required;
alter table public.rc_reconnect_participants
  add constraint rc_reconnect_joined_mode_required
  check (status <> 'joined' or joined_mode in ('exam','easy','steady','medium','hard'));

-- Keep the original RPCs during rollout. Migration first + Edge function
-- second therefore has no interval where the live button calls a missing RPC.
create or replace function public.rc_quest_skip_quote_v2(
  p_agent text,
  p_mission uuid,
  p_evidence jsonb,
  p_scrobble_high_water bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.rc_reconnect_missions%rowtype;
  v_p public.rc_reconnect_participants%rowtype;
  v_mode text;
  v_xp integer; v_cells integer;
  v_level_xp integer; v_spendable integer; v_bal_cells integer;
  v_last_skip timestamptz;
  v_free_reason text := null;
  v_action text;
  v_eligible_at timestamptz;
  v_cooldown_until timestamptz;
  v_within_24h boolean;
  v_waiting boolean := false;
  v_my_contribution integer;
  v_rescue_agent text;
  v_rescue_kind text;
begin
  select * into v_m from public.rc_reconnect_missions where id = p_mission;
  if not found then return jsonb_build_object('success', false, 'error', 'mission_not_found'); end if;

  select * into v_p from public.rc_reconnect_participants
    where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  -- The service captured this cursor before counting. If ingestion landed a
  -- newer row for anyone on the roster during that calculation, retry rather
  -- than deciding from a snapshot already known to be stale.
  if p_scrobble_high_water is null or exists (
    select 1
    from public.rc_scrobbles s
    join public.rc_reconnect_participants ep
      on ep.agent_no = s.agent_no and ep.mission_id = p_mission and ep.status = 'joined'
    where s.id > p_scrobble_high_water
  ) then
    return jsonb_build_object('success', false, 'error', 'contribution_changed');
  end if;

  if jsonb_typeof(p_evidence) is distinct from 'object'
     or exists (
       select 1 from public.rc_reconnect_participants e
       where e.mission_id = p_mission and e.status = 'joined'
         and not (p_evidence ? e.agent_no)
     ) then
    return jsonb_build_object('success', false, 'error', 'contribution_unavailable');
  end if;

  begin
    v_my_contribution := greatest(0, (p_evidence->>p_agent)::integer);
  exception when others then
    return jsonb_build_object('success', false, 'error', 'contribution_unavailable');
  end;

  v_mode := v_p.joined_mode;
  if v_mode is null then
    return jsonb_build_object('success', false, 'error', 'joined_mode_unavailable');
  end if;
  select xp, cells into v_xp, v_cells from public.rc_quest_skip_price(v_mode);

  select coalesce(sum(amount) filter (where kind = 'earn'), 0), coalesce(sum(amount), 0)
    into v_level_xp, v_spendable
    from public.rc_xp_ledger where agent_no = p_agent;
  select coalesce(charge_cells, 0) into v_bal_cells
    from public.rc_players where agent_no = p_agent;

  v_eligible_at := v_p.joined_at + interval '24 hours';
  v_within_24h := now() < v_eligible_at;

  -- Timestamp first so lazily-updated rows still say Exit Expired Quest.
  if v_m.expires_at <= now() or v_m.status = 'expired' then
    v_free_reason := 'expired';
  elsif v_m.status = 'complete' then
    return jsonb_build_object('success', false, 'error', 'already_completed');
  elsif v_m.status <> 'open' then
    v_free_reason := 'system_stuck';
  else
    select o.agent_no,
           case when o.status = 'invited' then 'unanswered_invite' else 'zero_contribution' end
      into v_rescue_agent, v_rescue_kind
    from public.rc_reconnect_participants o
    where o.mission_id = p_mission and o.agent_no <> p_agent
      and o.joined_at <= now() - interval '48 hours'
      and (
        o.status = 'invited'
        or (o.status = 'joined' and greatest(0, coalesce((p_evidence->>o.agent_no)::integer, -1)) = 0)
      )
    order by o.joined_at asc
    limit 1;

    if v_rescue_agent is not null then
      v_free_reason := 'teammate_rescue';
    elsif v_within_24h and v_my_contribution = 0 then
      v_free_reason := 'cancel_join';
    elsif v_within_24h then
      v_waiting := true;
    end if;
  end if;

  v_action := coalesce(v_free_reason, 'skip');
  select max(created_at) into v_last_skip from public.rc_quest_skips
    where agent_no = p_agent and free_reason is null;
  v_cooldown_until := case when v_last_skip is null then null else v_last_skip + interval '7 days' end;

  return jsonb_build_object(
    'success', true, 'missionId', p_mission, 'action', v_action,
    'mode', v_mode, 'free', v_free_reason is not null, 'freeReason', v_free_reason,
    'costXp', case when v_free_reason is not null then 0 else v_xp end,
    'costCells', case when v_free_reason is not null then 0 else v_cells end,
    'balanceXp', v_spendable, 'balanceCells', v_bal_cells, 'levelXp', v_level_xp,
    'joinedAt', v_p.joined_at, 'hasContributed', v_my_contribution > 0,
    'eligibleAt', case when v_free_reason is not null then null else v_eligible_at end,
    'waitingPeriod', v_waiting,
    'cooldownUntil', case when v_free_reason is not null then null else v_cooldown_until end,
    'onCooldown', v_free_reason is null and v_cooldown_until is not null and now() < v_cooldown_until,
    'canAfford', v_free_reason is not null or (v_spendable >= v_xp and v_bal_cells >= v_cells),
    'shortXp', case when v_free_reason is not null then 0 else greatest(0, v_xp - v_spendable) end,
    'shortCells', case when v_free_reason is not null then 0 else greatest(0, v_cells - v_bal_cells) end,
    'eligibilityEvidence', jsonb_build_object(
      'ownContribution', v_my_contribution,
      'rescueAgent', v_rescue_agent,
      'rescueKind', v_rescue_kind,
      'verifiedAt', now()
    )
  );
end;
$$;

create or replace function public.rc_quest_skip_v2(
  p_agent text,
  p_mission uuid,
  p_evidence jsonb,
  p_scrobble_high_water bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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

  if v_cells > 0 then
    update public.rc_players set charge_cells = charge_cells - v_cells
      where agent_no = p_agent and charge_cells >= v_cells;
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'quest_exit_balance_changed'; end if;
  end if;
  if v_xp > 0 then
    insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
    values (p_agent, -v_xp, 'quest_skip', 'spend', 'quest_skip:' || p_mission::text,
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
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_skipped');
end;
$$;

-- Owner/moderator removal preserves a joined member's contribution and uses
-- the same mission-row lock as paid exit. Ordinary self-removal is rejected.
create or replace function public.rc_reconnect_remove_participant(
  p_actor text,
  p_mission uuid,
  p_target text,
  p_contribution integer default 0,
  p_scrobble_high_water bigint default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.rc_reconnect_missions%rowtype;
  v_p public.rc_reconnect_participants%rowtype;
  v_rows integer;
begin
  if p_actor = p_target then
    return jsonb_build_object('success', false, 'error', 'use_quest_exit');
  end if;
  select * into v_m from public.rc_reconnect_missions where id = p_mission for update;
  if not found then return jsonb_build_object('success', false, 'error', 'mission_not_found'); end if;
  if v_m.created_by <> p_actor and p_actor <> '__admin__' then
    return jsonb_build_object('success', false, 'error', 'not_mission_creator');
  end if;
  select * into v_p from public.rc_reconnect_participants
    where mission_id = p_mission and agent_no = p_target for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  if v_p.status = 'invited' then
    delete from public.rc_reconnect_participants
      where mission_id = p_mission and agent_no = p_target and status = 'invited';
  elsif v_p.status = 'joined' then
    if exists (
      select 1 from public.rc_scrobbles
      where agent_no = p_target and id > p_scrobble_high_water
    ) then
      return jsonb_build_object('success', false, 'error', 'contribution_changed');
    end if;
    update public.rc_reconnect_participants
      set status = 'left', left_at = now(), contribution_frozen = greatest(0, coalesce(p_contribution, 0))
      where mission_id = p_mission and agent_no = p_target and status = 'joined';
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then raise exception 'quest_remove_membership_changed'; end if;
  else
    return jsonb_build_object('success', false, 'error', 'not_in_mission');
  end if;

  if not exists (
    select 1 from public.rc_reconnect_participants
    where mission_id = p_mission and status = 'joined'
  ) then
    update public.rc_reconnect_missions set status = 'cancelled'
      where id = p_mission and status = 'open';
  end if;
  return jsonb_build_object('success', true, 'removedStatus', v_p.status,
    'contributionKept', case when v_p.status = 'joined' then greatest(0, coalesce(p_contribution, 0)) else 0 end);
end;
$$;

-- Price lock is part of accepting the invitation, not a fallible follow-up.
create or replace function public.rc_reconnect_accept_invite(
  p_mission_id uuid,
  p_agent_no text
) returns table(joined boolean, error text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_required integer; v_status text; v_joined_count integer;
  v_invite_status text; v_mode text; v_updated integer;
begin
  select required_agents, status into v_required, v_status
    from public.rc_reconnect_missions where id = p_mission_id for update;
  if v_status is null then return query select false, 'mission_not_found'; return; end if;
  if v_status <> 'open' then return query select false, ('mission_' || v_status); return; end if;

  select status into v_invite_status from public.rc_reconnect_participants
    where mission_id = p_mission_id and agent_no = p_agent_no for update;
  if v_invite_status is distinct from 'invited' then
    return query select false, 'no_pending_invite'; return;
  end if;
  select mode into v_mode from public.rc_players where agent_no = p_agent_no;
  if v_mode not in ('exam','easy','steady','medium','hard') then
    return query select false, 'mode_unavailable'; return;
  end if;
  select count(*) into v_joined_count from public.rc_reconnect_participants
    where mission_id = p_mission_id and status = 'joined';
  if v_joined_count >= v_required then return query select false, 'mission_full'; return; end if;

  update public.rc_reconnect_participants
    set status = 'joined', joined_at = now(), joined_mode = v_mode
    where mission_id = p_mission_id and agent_no = p_agent_no and status = 'invited';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then return query select false, 'no_pending_invite'; return; end if;
  return query select true, null::text;
end;
$$;

-- Retained for compatibility even though the current player UI uses invites.
-- If an older caller reaches this path, it receives the same atomic mode lock.
create or replace function public.rc_reconnect_join_open(
  p_mission_id uuid,
  p_agent_no text
) returns table(joined boolean, error text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_required integer; v_status text; v_joined_count integer;
  v_mode text; v_inserted integer;
begin
  select required_agents, status into v_required, v_status
    from public.rc_reconnect_missions where id = p_mission_id for update;
  if v_status is null then return query select false, 'mission_not_found'; return; end if;
  if v_status <> 'open' then return query select false, ('mission_' || v_status); return; end if;
  select mode into v_mode from public.rc_players where agent_no = p_agent_no;
  if v_mode not in ('exam','easy','steady','medium','hard') then
    return query select false, 'mode_unavailable'; return;
  end if;
  select count(*) into v_joined_count from public.rc_reconnect_participants
    where mission_id = p_mission_id and status = 'joined';
  if v_joined_count >= v_required then return query select false, 'mission_full'; return; end if;
  insert into public.rc_reconnect_participants
    (mission_id, agent_no, status, joined_at, joined_mode)
  values (p_mission_id, p_agent_no, 'joined', now(), v_mode)
  on conflict (mission_id, agent_no) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then return query select false, 'already_in_mission'; return; end if;
  return query select true, null::text;
end;
$$;

revoke all on function public.rc_quest_skip_quote_v2(text, uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.rc_quest_skip_v2(text, uuid, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.rc_reconnect_remove_participant(text, uuid, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.rc_quest_skip_quote_v2(text, uuid, jsonb, bigint) to service_role;
grant execute on function public.rc_quest_skip_v2(text, uuid, jsonb, bigint) to service_role;
grant execute on function public.rc_reconnect_remove_participant(text, uuid, text, integer, bigint) to service_role;
revoke all on function public.rc_reconnect_accept_invite(uuid, text) from public, anon, authenticated;
grant execute on function public.rc_reconnect_accept_invite(uuid, text) to service_role;
revoke all on function public.rc_reconnect_join_open(uuid, text) from public, anon, authenticated;
grant execute on function public.rc_reconnect_join_open(uuid, text) to service_role;
