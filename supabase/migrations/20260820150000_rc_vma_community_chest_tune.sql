-- Group Supply Chest tuning, per direct feedback after the first live
-- test: the reveal felt too big/heavy for what's usually a small pull, and
-- the pool was missing Wings. Two changes:
--   1. Add "wings" as a possible reward kind (grant logic below).
--   2. Every open now grants 1 OR 2 rewards at random (was always exactly
--      reward_count from config) — a smaller, more varied-feeling pull,
--      not "always a fixed multi-item bundle."
-- reward_count is left in the config for reference/back-compat but the
-- function below no longer reads it — replaced by the random(1,2) roll.
update rc_config set value = value || jsonb_build_object(
  'rewards', '[
    { "kind": "charge_cell", "weight": 25 },
    { "kind": "xp", "weight": 20, "amount": 10 },
    { "kind": "streak_freeze", "weight": 15 },
    { "kind": "extension", "weight": 10 },
    { "kind": "wings", "weight": 15, "amount": 1 },
    { "kind": "badge", "weight": 8, "templateId": "event_vma_community_chest" },
    { "kind": "backup_pass", "weight": 7 }
  ]'::jsonb
) where key = 'vma_community_chest';

create or replace function rc_vma_community_chest_open(
  p_agent_no text, p_event_id text, p_milestone_index integer, p_threshold integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cumulative integer;
  v_inserted_agent text;
  v_reward jsonb;
  v_reward_kind text;
  v_reward_detail jsonb;
  v_rewards_cfg jsonb;
  v_reward_count integer;
  v_results jsonb := '[]'::jsonb;
  v_picked_badges text[] := '{}';
  i integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('vma_community_chest|' || p_agent_no || '|' || p_event_id || '|' || p_milestone_index::text, 0));

  select coalesce(sum(votes_logged), 0) into v_cumulative
    from rc_vma_votes where event_id = p_event_id and verify_status = 'verified';
  if v_cumulative < p_threshold then
    return jsonb_build_object('success', false, 'error', 'not_ready');
  end if;

  insert into rc_vma_community_chest_claims (agent_no, event_id, milestone_index)
    values (p_agent_no, p_event_id, p_milestone_index)
  on conflict (agent_no, event_id, milestone_index) do nothing
  returning agent_no into v_inserted_agent;

  if v_inserted_agent is null then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;

  select value->'rewards' into v_rewards_cfg from rc_config where key = 'vma_community_chest';
  -- 1 or 2 rewards, chosen fresh each open — a smaller, more varied pull
  -- than always handing back a fixed bundle.
  v_reward_count := 1 + floor(random() * 2)::integer;

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
    elsif v_reward_kind = 'wings' then
      v_reward_detail := jsonb_build_object('amount', coalesce((v_reward->>'amount')::integer, 1));
    elsif v_reward_kind = 'badge' then
      v_reward_detail := jsonb_build_object('templateId', v_reward->>'templateId');
      v_picked_badges := v_picked_badges || (v_reward->>'templateId');
    else
      v_reward_detail := '{}'::jsonb;
    end if;

    if v_reward_kind = 'charge_cell' then
      update rc_players set charge_cells = coalesce(charge_cells, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'streak_freeze' then
      update rc_players set streak_freeze_charges = coalesce(streak_freeze_charges, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'extension' then
      update rc_players set deadline_extension_charges = coalesce(deadline_extension_charges, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'wings' then
      update rc_players set wings = coalesce(wings, 0) + (v_reward_detail->>'amount')::integer where agent_no = p_agent_no;
    elsif v_reward_kind = 'xp' then
      insert into rc_xp_ledger (agent_no, amount, source, dedup_key, meta)
      values (p_agent_no, (v_reward_detail->>'amount')::integer, 'vma_community_chest',
              'communitychest:' || p_event_id || ':' || p_milestone_index || ':' || i, '{}'::jsonb)
      on conflict (dedup_key) do nothing;
    elsif v_reward_kind = 'backup_pass' then
      insert into rc_player_items (agent_no, item_id) values (p_agent_no, 'backup-pass');
    elsif v_reward_kind = 'badge' then
      perform rc_award_badge(p_agent_no, v_reward_detail->>'templateId');
    end if;

    v_results := v_results || jsonb_build_object('kind', v_reward_kind, 'detail', v_reward_detail);
  end loop;

  return jsonb_build_object('success', true, 'rewards', v_results);
end;
$$;

revoke all on function rc_vma_community_chest_open(text, text, integer, integer) from public, anon, authenticated;
grant execute on function rc_vma_community_chest_open(text, text, integer, integer) to service_role;
