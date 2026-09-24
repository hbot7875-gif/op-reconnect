-- One way out of a ReConnect Quest, priced by the server.
--
-- Until now an agent could leave free and unconditionally via
-- removeReconnectParticipant (targeting themselves), which sat beside the
-- paid Skip Quest and made it pointless — and worse, that path DELETED their
-- participant row, so the team lost the streams the leaver had already
-- pooled. Self-exit now always goes through rc_quest_skip, whatever it costs.
--
-- The quote decides which of four exits applies, in priority order:
--   system_stuck    the quest is no longer open        — free
--   expired         its 7 days ran out                 — free
--   teammate_rescue someone else stalled it for 48h+   — free
--   cancel_join     within 24h AND zero streams pooled — free
--   skip            anything else, after 24h           — paid, 7-day cooldown
-- An agent inside the first 24 hours who HAS already pooled streams can't
-- cancel and can't yet skip: they wait out the 24h. That gap is deliberate —
-- it is the window in which walking away hurts teammates most.
--
-- Free exits never consume the paid cooldown (rc_quest_skips.free_reason is
-- non-null for them, and the cooldown lookup ignores those rows).

create or replace function public.rc_quest_skip_quote(p_agent text, p_mission uuid)
returns jsonb
language plpgsql stable
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
begin
  select * into v_m from public.rc_reconnect_missions where id = p_mission;
  if not found then return jsonb_build_object('success', false, 'error', 'mission_not_found'); end if;
  select * into v_p from public.rc_reconnect_participants
    where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  v_mode := coalesce(v_p.joined_mode, (select mode from public.rc_players where agent_no = p_agent), 'easy');
  select xp, cells into v_xp, v_cells from public.rc_quest_skip_price(v_mode);

  select coalesce(sum(amount) filter (where kind = 'earn'), 0), coalesce(sum(amount), 0)
    into v_level_xp, v_spendable
    from public.rc_xp_ledger where agent_no = p_agent;
  select coalesce(charge_cells, 0) into v_bal_cells from public.rc_players where agent_no = p_agent;

  v_eligible_at := v_p.joined_at + interval '24 hours';
  v_within_24h := now() < v_eligible_at;

  if v_m.status <> 'open' then
    v_free_reason := 'system_stuck';
  elsif v_m.expires_at <= now() then
    v_free_reason := 'expired';
  elsif exists (
    select 1 from public.rc_reconnect_participants o
    where o.mission_id = p_mission and o.agent_no <> p_agent
      and ((o.status = 'invited' and o.joined_at <= now() - interval '48 hours')
        or (o.status = 'joined' and o.streamed_at is null and o.joined_at <= now() - interval '48 hours'))
  ) then
    v_free_reason := 'teammate_rescue';
  elsif v_within_24h and v_p.streamed_at is null then
    -- Joined by mistake and never played toward it: no cost, no cooldown.
    v_free_reason := 'cancel_join';
  elsif v_within_24h then
    -- Already pooled streams, still inside the first day: must wait.
    v_waiting := true;
  end if;

  v_action := coalesce(v_free_reason, 'skip');

  select max(created_at) into v_last_skip from public.rc_quest_skips
    where agent_no = p_agent and free_reason is null;
  v_cooldown_until := case when v_last_skip is null then null else v_last_skip + interval '7 days' end;

  return jsonb_build_object(
    'success', true,
    'missionId', p_mission,
    'action', v_action,
    'mode', v_mode,
    'free', v_free_reason is not null,
    'freeReason', v_free_reason,
    'costXp', case when v_free_reason is not null then 0 else v_xp end,
    'costCells', case when v_free_reason is not null then 0 else v_cells end,
    'balanceXp', v_spendable,
    'balanceCells', v_bal_cells,
    'levelXp', v_level_xp,
    'joinedAt', v_p.joined_at,
    'hasContributed', v_p.streamed_at is not null,
    'eligibleAt', case when v_free_reason is not null then null else v_eligible_at end,
    'waitingPeriod', v_waiting,
    'cooldownUntil', case when v_free_reason is not null then null else v_cooldown_until end,
    'onCooldown', v_free_reason is null and v_cooldown_until is not null and now() < v_cooldown_until,
    'canAfford', v_free_reason is not null or (v_spendable >= v_xp and v_bal_cells >= v_cells),
    'shortXp', case when v_free_reason is not null then 0 else greatest(0, v_xp - v_spendable) end,
    'shortCells', case when v_free_reason is not null then 0 else greatest(0, v_cells - v_bal_cells) end
  );
end;
$$;

revoke all on function public.rc_quest_skip_quote(text, uuid) from public, anon, authenticated;
grant execute on function public.rc_quest_skip_quote(text, uuid) to service_role;
