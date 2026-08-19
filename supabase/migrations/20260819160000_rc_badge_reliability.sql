-- Badge reliability and collection cleanup.
--
-- Achievements now award inside the same database transaction that records
-- them, Supply Chest chooses its reward under its existing lock, and players
-- who qualified before the Badge Collection launched are backfilled.

update rc_badge_catalog set name = case id
  when 'district_frag_1' then '25% Restored'
  when 'district_frag_2' then '50% Restored'
  when 'district_frag_3' then '75% Restored'
  when 'district_restored' then 'District Restored'
  when 'ward' then 'Ward Restored'
  when 'mission_bond' then 'ReConnect Complete'
  when 'quiz_perfect' then 'Perfect Quiz'
  when 'event_vma_voter' then 'VMA Voter'
  when 'event_vma_power_hour' then 'Power Hour Voter'
  when 'event_vma_double_day' then 'Double Day Voter'
  when 'event_vma_supply_chest' then 'Supply Chest Badge'
  else name end
where id in (
  'district_frag_1', 'district_frag_2', 'district_frag_3', 'district_restored',
  'ward', 'mission_bond', 'quiz_perfect', 'event_vma_voter',
  'event_vma_power_hour', 'event_vma_double_day', 'event_vma_supply_chest'
);

-- The quiz does not exist yet. Keep its art and template ready, but do not
-- show players an impossible locked badge until the feature ships.
update rc_badge_catalog set active = false where id = 'quiz_perfect';

-- One atomic, idempotent badge-award primitive for Edge code and triggers.
-- Existing art is permanent; a previously blank award gets one backfilled.
create or replace function rc_award_badge(
  p_agent_no text, p_template_id text, p_scope_id text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_badge_id text;
  v_artwork_id bigint;
begin
  if not exists (
    select 1 from rc_badge_catalog where id = p_template_id and active = true
  ) then
    return null;
  end if;

  v_badge_id := p_template_id || case
    when nullif(p_scope_id, '') is null then '' else ':' || p_scope_id end;

  select id into v_artwork_id
    from rc_badge_art
   where template_id = p_template_id and active = true
   order by random()
   limit 1;

  insert into rc_badges (agent_no, badge_id, artwork_id)
  values (p_agent_no, v_badge_id, v_artwork_id)
  on conflict (agent_no, badge_id) do update
    set artwork_id = coalesce(rc_badges.artwork_id, excluded.artwork_id);

  return v_badge_id;
end;
$$;

revoke all on function rc_award_badge(text, text, text) from public, anon, authenticated;
grant execute on function rc_award_badge(text, text, text) to service_role;

-- Restoring a district permanently grants all three progress badges and the
-- restoration badge. The same transaction also grants the ward badge when
-- this was its final non-centerpiece district.
create or replace function rc_award_restoration_badges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ward_id text;
begin
  if new.status <> 'restored' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'restored' then return new; end if;

    perform rc_award_badge(new.agent_no, 'district_frag_1', new.district_id);
    perform rc_award_badge(new.agent_no, 'district_frag_2', new.district_id);
    perform rc_award_badge(new.agent_no, 'district_frag_3', new.district_id);
    perform rc_award_badge(new.agent_no, 'district_restored', new.district_id);

    select ward_id into v_ward_id from rc_districts where id = new.district_id;
    if v_ward_id is not null
       and exists (
         select 1 from rc_districts
          where ward_id = v_ward_id and not coalesce(is_centerpiece, false)
       )
       and not exists (
         select 1
           from rc_districts d
          where d.ward_id = v_ward_id
            and not coalesce(d.is_centerpiece, false)
            and not exists (
              select 1 from rc_player_districts pd
               where pd.agent_no = new.agent_no
                 and pd.district_id = d.id
                 and pd.status = 'restored'
            )
       ) then
      perform rc_award_badge(new.agent_no, 'ward', v_ward_id);
    end if;
  return new;
end;
$$;

drop trigger if exists rc_player_district_badges on rc_player_districts;
create trigger rc_player_district_badges
after insert or update on rc_player_districts
for each row execute function rc_award_restoration_badges();

-- Every joined participant receives the one-time ReConnect badge when their
-- mission completes, even if their next game-state refresh never arrives.
create or replace function rc_award_reconnect_badges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if new.status <> 'complete' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'complete' then return new; end if;

    for r in
      select agent_no from rc_reconnect_participants
       where mission_id = new.id and status = 'joined'
    loop
      perform rc_award_badge(r.agent_no, 'mission_bond');
    end loop;
  return new;
end;
$$;

drop trigger if exists rc_reconnect_mission_badges on rc_reconnect_missions;
create trigger rc_reconnect_mission_badges
after insert or update on rc_reconnect_missions
for each row execute function rc_award_reconnect_badges();

-- Badge award commits together with vote verification. This covers both
-- instant OCR approval and admin approval. Chest fill remains on the Edge
-- call during this rollout so old and new function versions cannot double it.
create or replace function rc_award_verified_vote_rewards()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.verify_status <> 'verified' or new.event_id <> 'vma_2026' then return new; end if;
  if tg_op = 'UPDATE' and old.verify_status = 'verified' then return new; end if;

    perform rc_award_badge(new.agent_no, 'event_vma_voter');
    if new.is_power_hour then
      perform rc_award_badge(new.agent_no, 'event_vma_power_hour');
    end if;
    if new.is_double_day then
      perform rc_award_badge(new.agent_no, 'event_vma_double_day');
    end if;
  return new;
end;
$$;

drop trigger if exists rc_vma_verified_rewards on rc_vma_votes;
create trigger rc_vma_verified_rewards
after insert or update on rc_vma_votes
for each row execute function rc_award_verified_vote_rewards();

-- Replace caller-selected chest rewards with selection under the same lock
-- that spends fill. This closes the double-open duplicate-badge race.
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
  v_reward_detail jsonb := '{}'::jsonb;
  v_rewards jsonb;
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

  select value->'rewards' into v_rewards from rc_config where key = 'supply_chest';

  with eligible as (
    select reward, ordinality as ord, greatest(0, (reward->>'weight')::numeric) as weight
      from jsonb_array_elements(coalesce(v_rewards, '[]'::jsonb))
           with ordinality as x(reward, ordinality)
     where reward->>'kind' <> 'badge'
        or (
          exists (
            select 1 from rc_badge_catalog c
             where c.id = reward->>'templateId' and c.active = true
          )
          and not exists (
            select 1 from rc_badges b
             where b.agent_no = p_agent_no
               and b.badge_id = reward->>'templateId'
          )
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

  if v_reward is null then
    return jsonb_build_object('success', false, 'error', 'no_rewards_available');
  end if;

  v_reward_kind := v_reward->>'kind';
  if v_reward_kind = 'xp' then
    v_reward_detail := jsonb_build_object('amount', coalesce((v_reward->>'amount')::integer, 10));
  elsif v_reward_kind = 'badge' then
    v_reward_detail := jsonb_build_object('templateId', v_reward->>'templateId');
  end if;

  update rc_supply_chest_progress
     set fill_count = fill_count - p_threshold, updated_at = now()
   where agent_no = p_agent_no and event_id = p_event_id;

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

  return jsonb_build_object(
    'success', true,
    'openId', v_open_id,
    'fillRemaining', v_fill - p_threshold,
    'rewardKind', v_reward_kind,
    'rewardDetail', v_reward_detail
  );
end;
$$;

revoke all on function rc_supply_chest_open(text, text, integer, integer) from public, anon, authenticated;
grant execute on function rc_supply_chest_open(text, text, integer, integer) to service_role;

-- Temporary compatibility overload: an Edge instance already in flight may
-- still send the old caller-selected reward arguments during deployment.
-- Ignore those arguments and route through the new locked selector.
create or replace function rc_supply_chest_open(
  p_agent_no text, p_event_id text, p_threshold integer, p_daily_cap integer,
  p_reward_kind text, p_reward_detail jsonb
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select rc_supply_chest_open(p_agent_no, p_event_id, p_threshold, p_daily_cap)
$$;

revoke all on function rc_supply_chest_open(text, text, integer, integer, text, jsonb) from public, anon, authenticated;
grant execute on function rc_supply_chest_open(text, text, integer, integer, text, jsonb) to service_role;

revoke all on function rc_award_restoration_badges() from public, anon, authenticated;
revoke all on function rc_award_reconnect_badges() from public, anon, authenticated;
revoke all on function rc_award_verified_vote_rewards() from public, anon, authenticated;

-- Retroactive awards for achievements completed before these triggers.
do $$
declare
  r record;
begin
  for r in
    select agent_no, district_id from rc_player_districts where status = 'restored'
  loop
    perform rc_award_badge(r.agent_no, 'district_frag_1', r.district_id);
    perform rc_award_badge(r.agent_no, 'district_frag_2', r.district_id);
    perform rc_award_badge(r.agent_no, 'district_frag_3', r.district_id);
    perform rc_award_badge(r.agent_no, 'district_restored', r.district_id);
  end loop;

  for r in
    select distinct pd.agent_no, d.ward_id
      from rc_player_districts pd
      join rc_districts d on d.id = pd.district_id
     where pd.status = 'restored' and d.ward_id is not null
       and exists (
         select 1 from rc_districts member
          where member.ward_id = d.ward_id
            and not coalesce(member.is_centerpiece, false)
       )
       and not exists (
         select 1 from rc_districts missing
          where missing.ward_id = d.ward_id
            and not coalesce(missing.is_centerpiece, false)
            and not exists (
              select 1 from rc_player_districts owned
               where owned.agent_no = pd.agent_no
                 and owned.district_id = missing.id
                 and owned.status = 'restored'
            )
       )
  loop
    perform rc_award_badge(r.agent_no, 'ward', r.ward_id);
  end loop;

  for r in
    select distinct p.agent_no
      from rc_reconnect_participants p
      join rc_reconnect_missions m on m.id = p.mission_id
     where p.status = 'joined' and m.status = 'complete'
  loop
    perform rc_award_badge(r.agent_no, 'mission_bond');
  end loop;

  for r in
    select distinct agent_no, is_power_hour, is_double_day
      from rc_vma_votes
     where event_id = 'vma_2026' and verify_status = 'verified'
  loop
    perform rc_award_badge(r.agent_no, 'event_vma_voter');
    if r.is_power_hour then perform rc_award_badge(r.agent_no, 'event_vma_power_hour'); end if;
    if r.is_double_day then perform rc_award_badge(r.agent_no, 'event_vma_double_day'); end if;
  end loop;
end;
$$;
