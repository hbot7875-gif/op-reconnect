-- Group Supply Chest — a communal reward every agent can claim once the
-- WHOLE FANDOM's cumulative verified vote count (all agents, all days —
-- see communityChestThreshold() in lib/vma-community-chest.ts) crosses a
-- milestone, not something any one agent fills alone. Explicit spec: 150,
-- then 250, then 400 overall votes, with each next gap 50 bigger than the
-- last (100, 150, 200, 250, ...) so it stays achievable early — building
-- the habit of checking in and voting — and gets harder later once
-- there's real momentum. The whole point is to make players root for
-- EVERYONE's votes, not just their own.
-- baseline_votes: the cumulative verified vote count at the moment this
-- feature shipped (1,978 — checked live right before this migration was
-- written). Milestones count votes ABOVE this baseline, not the whole
-- campaign since Aug 18 — without it, every agent would see ~8 Group
-- Chests already claimable the instant this ships, which reads as a
-- reward-dump glitch rather than the intended "vote together, unlock
-- together" pacing. Every milestone after this one counts fresh votes only.
insert into rc_config (key, value) values (
  'vma_community_chest',
  '{
    "reward_count": 2,
    "baseline_votes": 1978,
    "rewards": [
      { "kind": "charge_cell", "weight": 30 },
      { "kind": "xp", "weight": 25, "amount": 15 },
      { "kind": "streak_freeze", "weight": 15 },
      { "kind": "extension", "weight": 10 },
      { "kind": "badge", "weight": 10, "templateId": "event_vma_community_chest" },
      { "kind": "backup_pass", "weight": 10 }
    ]
  }'::jsonb
) on conflict (key) do update set value = excluded.value;

insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order) values
  ('event_vma_community_chest', 'event', 'rare', 'United Voices', 'Claim a Group Supply Chest during the MTV VMAs 2026 voting mission.', 111)
on conflict (id) do nothing;

-- One row per agent per milestone actually claimed — the threshold itself
-- is derived live from rc_vma_votes (no separate "reached" flag to keep in
-- sync), but each agent's own claim of a given milestone's rewards is a
-- real one-time event that has to be tracked per agent, not globally.
create table if not exists rc_vma_community_chest_claims (
  agent_no text not null references rc_agents (agent_no),
  event_id text not null,
  milestone_index integer not null,
  claimed_at timestamptz not null default now(),
  primary key (agent_no, event_id, milestone_index)
);

comment on table rc_vma_community_chest_claims is
  'One row per agent per Group Supply Chest milestone claimed. The milestone threshold itself is computed from the live sum of rc_vma_votes (see communityChestThreshold in lib/vma-community-chest.ts) — this table only tracks which agents have already collected which milestone''s rewards, so the same milestone can be claimed once per agent even though it unlocks for everyone at once.';

-- Atomic claim: re-checks the threshold server-side (never trust the
-- client's math), the insert's primary key is what makes "claim once per
-- agent per milestone" airtight against a double-tap, and the reward
-- grant loop is the same weighted-pick-N-times shape as
-- rc_supply_chest_open (migration 20260820120000) — duplicated rather
-- than shared because the two chests have different eligibility gates
-- (global vote threshold vs. per-agent fill) and unifying them would cost
-- more clarity than the ~40 shared lines are worth.
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
  select coalesce((value->>'reward_count')::integer, 2) into v_reward_count
    from rc_config where key = 'vma_community_chest';
  v_reward_count := greatest(1, coalesce(v_reward_count, 2));

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

    if v_reward_kind = 'charge_cell' then
      update rc_players set charge_cells = coalesce(charge_cells, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'streak_freeze' then
      update rc_players set streak_freeze_charges = coalesce(streak_freeze_charges, 0) + 1 where agent_no = p_agent_no;
    elsif v_reward_kind = 'extension' then
      update rc_players set deadline_extension_charges = coalesce(deadline_extension_charges, 0) + 1 where agent_no = p_agent_no;
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
