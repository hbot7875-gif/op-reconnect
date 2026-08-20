-- Supply Chest now grants several rewards per open instead of one — same
-- weighted-random pick, run rewardCount times under the same lock that
-- spends fill, so a chest still feels atomic (one open, one settle).
--
-- Duplicate protection extends across the whole open, not just against
-- already-owned badges: a badge picked on roll 1 of this same open is also
-- excluded from rolls 2+, so one chest can never hand back the same badge
-- twice. Every other reward kind (xp, charge_cell, streak_freeze,
-- extension, backup_pass) is a stacking resource, so repeats across rolls
-- within one open are fine and expected.
--
-- reward_count is configurable via rc_config's supply_chest.reward_count
-- (defaults to 3 if absent) rather than a new function parameter, so this
-- keeps the same 4-arg signature lib/supply-chest.ts already calls.
create or replace function rc_supply_chest_open(
  p_agent_no text, p_event_id text, p_threshold integer, p_daily_cap integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fill integer;
  v_opens_today integer;
  v_open_id bigint;
  v_reward jsonb;
  v_reward_kind text;
  v_reward_detail jsonb;
  v_rewards_cfg jsonb;
  v_reward_count integer;
  v_results jsonb := '[]'::jsonb;
  v_picked_badges text[] := '{}';
  i integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('supply_chest|' || p_agent_no || '|' || p_event_id, 0));

  select fill_count into v_fill
    from rc_supply_chest_progress
   where agent_no = p_agent_no and event_id = p_event_id
   for update;
  if v_fill is null or v_fill < p_threshold then
    return jsonb_build_object('success', false, 'error', 'not_ready');
  end if;

  select count(*) into v_opens_today
    from rc_supply_chest_opens
   where agent_no = p_agent_no and event_id = p_event_id
     and opened_at::date = (now() at time zone 'utc')::date;
  if v_opens_today >= p_daily_cap then
    return jsonb_build_object('success', false, 'error', 'daily_open_cap_reached');
  end if;

  select value->'rewards' into v_rewards_cfg from rc_config where key = 'supply_chest';
  select coalesce((value->>'reward_count')::integer, 3) into v_reward_count
    from rc_config where key = 'supply_chest';
  v_reward_count := greatest(1, coalesce(v_reward_count, 3));

  update rc_supply_chest_progress
     set fill_count = fill_count - p_threshold, updated_at = now()
   where agent_no = p_agent_no and event_id = p_event_id;

  for i in 1..v_reward_count loop
    with eligible as (
      select reward, ordinality as ord, greatest(0, (reward->>'weight')::numeric) as weight
        from jsonb_array_elements(coalesce(v_rewards_cfg, '[]'::jsonb))
             with ordinality as x(reward, ordinality)
       where reward->>'kind' <> 'badge'
          or (
            exists (
              select 1 from rc_badge_catalog c
               where c.id = reward->>'templateId' and c.active = true
            )
            and not exists (
              select 1 from rc_badges b
               where b.agent_no = p_agent_no and b.badge_id = reward->>'templateId'
            )
            and not (reward->>'templateId' = any(v_picked_badges))
          )
    ), weighted as (
      select reward, ord, weight,
             sum(weight) over (order by ord) as cumulative,
             sum(weight) over () as total
        from eligible
       where weight > 0
    ), picked as (
      select random() * max(total) as roll from weighted
    )
    select reward into v_reward
      from weighted, picked
     where cumulative >= roll
     order by ord
     limit 1;

    exit when v_reward is null; -- nothing left to award (e.g. every badge already owned)

    v_reward_kind := v_reward->>'kind';
    if v_reward_kind = 'xp' then
      v_reward_detail := jsonb_build_object('amount', coalesce((v_reward->>'amount')::integer, 10));
    elsif v_reward_kind = 'badge' then
      v_reward_detail := jsonb_build_object('templateId', v_reward->>'templateId');
      v_picked_badges := v_picked_badges || (v_reward->>'templateId');
    else
      v_reward_detail := '{}'::jsonb;
    end if;

    insert into rc_supply_chest_opens (agent_no, event_id, reward_kind, reward_detail)
    values (p_agent_no, p_event_id, v_reward_kind, v_reward_detail)
    returning id into v_open_id;

    if v_reward_kind = 'charge_cell' then
      update rc_players set charge_cells = coalesce(charge_cells, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'streak_freeze' then
      update rc_players set streak_freeze_charges = coalesce(streak_freeze_charges, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'extension' then
      update rc_players set deadline_extension_charges = coalesce(deadline_extension_charges, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'xp' then
      insert into rc_xp_ledger (agent_no, amount, source, dedup_key, meta)
      values (p_agent_no, (v_reward_detail->>'amount')::integer, 'supply_chest', 'chest:' || v_open_id, '{}'::jsonb)
      on conflict (dedup_key) do nothing;
    elsif v_reward_kind = 'backup_pass' then
      insert into rc_player_items (agent_no, item_id) values (p_agent_no, 'backup-pass');
    elsif v_reward_kind = 'badge' then
      perform rc_award_badge(p_agent_no, v_reward_detail->>'templateId');
    end if;

    v_results := v_results || jsonb_build_object('kind', v_reward_kind, 'detail', v_reward_detail);
  end loop;

  if jsonb_array_length(v_results) = 0 then
    -- Fill was already spent above (the open itself is real even if every
    -- roll came up empty, e.g. every badge already owned) — never silently
    -- refund fill for a "no reward" result the player never sees explained.
    return jsonb_build_object('success', true, 'rewards', '[]'::jsonb, 'fillRemaining', v_fill - p_threshold);
  end if;

  return jsonb_build_object('success', true, 'rewards', v_results, 'fillRemaining', v_fill - p_threshold);
end;
$$;

revoke all on function rc_supply_chest_open(text, text, integer, integer) from public, anon, authenticated;
grant execute on function rc_supply_chest_open(text, text, integer, integer) to service_role;

update rc_config set value = value || jsonb_build_object('reward_count', 3) where key = 'supply_chest';
