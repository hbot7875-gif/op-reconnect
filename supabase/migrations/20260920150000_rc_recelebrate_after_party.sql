-- RE:CELEBRATE AFTER PARTY — permanent return gifts once the final result
-- freezes. One idempotent claim per eligible attendee. Eligibility uses
-- existing durable event data: a Party Pass plus either an accepted battle
-- stream or a Watch Party check-in. No separate attendance system.

insert into public.rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values ('event_rc26_after_party', 'event', 'common', 'AFTER PARTY ♡',
  'Join the RE:CELEBRATE battle or Watch Party on Sept 20, 2026.', 145, true)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, unlock_hint = excluded.unlock_hint,
  sort_order = excluded.sort_order, active = true;

create table if not exists public.rc_recelebrate_after_party_claims (
  event_id text not null,
  agent_no text not null,
  reward_kind text not null check (reward_kind in ('charge_cells', 'wings', 'deadline_extension')),
  reward_amount integer not null check (reward_amount > 0),
  badge_ids text[] not null default '{}',
  claimed_at timestamptz not null default now(),
  primary key (event_id, agent_no)
);

alter table public.rc_recelebrate_after_party_claims enable row level security;
revoke all on public.rc_recelebrate_after_party_claims from public, anon, authenticated;
grant select, insert on public.rc_recelebrate_after_party_claims to service_role;

create or replace function public.rc_recelebrate_after_party_claim(p_event text, p_agent text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_finalized timestamptz;
  v_love_song text;
  v_team text;
  v_streams integer := 0;
  v_distinct integer := 0;
  v_arirang_distinct integer := 0;
  v_watched boolean := false;
  v_kind text;
  v_amount integer;
  v_badges text[] := '{}';
  v_existing public.rc_recelebrate_after_party_claims%rowtype;
  v_roll integer;
begin
  select finalized_at into v_finalized
    from public.rc_recelebrate_battle_state where event_id = p_event;
  if v_finalized is null then
    return jsonb_build_object('available', false);
  end if;

  select love_song, team into v_love_song, v_team
    from public.rc_recelebrate_passes where event_id = p_event and agent_no = p_agent;
  if v_love_song is null then
    return jsonb_build_object('available', true, 'eligible', false, 'reason', 'party_pass_required');
  end if;

  select count(*)::integer, count(distinct s.track_id)::integer,
         count(distinct case when t.position between 1 and 14 then s.track_id end)::integer
    into v_streams, v_distinct, v_arirang_distinct
    from public.rc_recelebrate_battle_streams s
    join public.rc_recelebrate_battle_tracks t
      on t.event_id = s.event_id and t.track_id = s.track_id
   where s.event_id = p_event and s.agent_no = p_agent;

  select exists(select 1 from public.rc_recelebrate_presence
    where event_id = p_event and agent_no = p_agent and watched_at is not null)
    into v_watched;

  if v_streams = 0 and not v_watched then
    return jsonb_build_object('available', true, 'eligible', false,
      'reason', 'participation_required', 'loveSong', v_love_song, 'team', v_team);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recelebrate_after_party|' || p_event || '|' || p_agent, 0));
  select * into v_existing from public.rc_recelebrate_after_party_claims
    where event_id = p_event and agent_no = p_agent;
  if found then
    return jsonb_build_object('available', true, 'eligible', true, 'claimed', true,
      'loveSong', v_love_song, 'team', v_team, 'streams', v_streams,
      'reward', jsonb_build_object('kind', v_existing.reward_kind, 'amount', v_existing.reward_amount),
      'badgeIds', to_jsonb(v_existing.badge_ids));
  end if;

  -- Everyone who genuinely took part gets the AFTER PARTY keepsake. The
  -- existing achievement badges are awarded from their actual event data.
  v_badges := array_append(v_badges, 'event_rc26_after_party');
  perform public.rc_award_badge(p_agent, 'event_rc26_after_party');
  if v_streams > 0 then
    v_badges := array_append(v_badges, 'event_rc26_party_crasher');
    perform public.rc_award_badge(p_agent, 'event_rc26_party_crasher');
  end if;
  if v_arirang_distinct = 14 then
    v_badges := array_append(v_badges, 'event_rc26_arirang_cult');
    perform public.rc_award_badge(p_agent, 'event_rc26_arirang_cult');
  end if;
  if v_distinct = 17 and v_team in ('hooligans', 'aliens') then
    v_badges := array_append(v_badges, 'event_rc26_side_quest_' || v_team);
    perform public.rc_award_badge(p_agent, 'event_rc26_side_quest_' || v_team);
  end if;
  if v_distinct = 17 and v_watched then
    v_badges := array_append(v_badges, 'event_arirang_recelebrate_2026');
    perform public.rc_award_badge(p_agent, 'event_arirang_recelebrate_2026');
  end if;

  -- One-day return gifts: Charge Cells are the generous common result,
  -- the +3-day extension is valuable but less frequent, and Wings are rare.
  v_roll := floor(random() * 100)::integer;
  if v_roll < 70 then
    v_kind := 'charge_cells'; v_amount := 8;
    update public.rc_players set charge_cells = coalesce(charge_cells, 0) + v_amount where agent_no = p_agent;
  elsif v_roll < 92 then
    v_kind := 'deadline_extension'; v_amount := 1;
    update public.rc_players set deadline_extension_charges = coalesce(deadline_extension_charges, 0) + v_amount where agent_no = p_agent;
  else
    v_kind := 'wings'; v_amount := 3;
    update public.rc_players set wings = coalesce(wings, 0) + v_amount where agent_no = p_agent;
  end if;

  insert into public.rc_recelebrate_after_party_claims
    (event_id, agent_no, reward_kind, reward_amount, badge_ids)
  values (p_event, p_agent, v_kind, v_amount, v_badges);

  return jsonb_build_object('available', true, 'eligible', true, 'claimed', true,
    'loveSong', v_love_song, 'team', v_team, 'streams', v_streams,
    'reward', jsonb_build_object('kind', v_kind, 'amount', v_amount),
    'badgeIds', to_jsonb(v_badges));
end;
$$;

revoke all on function public.rc_recelebrate_after_party_claim(text, text) from public, anon, authenticated;
grant execute on function public.rc_recelebrate_after_party_claim(text, text) to service_role;
