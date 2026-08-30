-- One-off support completion requested by the site owner after AGENT000's
-- previous Dazzledew Fountain attempt expired with its ReConnect streams
-- nearly complete. AGENT000 restarted the same district at
-- 2026-08-27 17:10 UTC; target that exact fresh active row and fail closed
-- rather than ever completing a different district by accident.
--
-- Because this bypasses handlers.ts's normal completion latch, reproduce its
-- durable completion side effects here: district XP, resource contribution,
-- one item drop, and the public progress feed. Badge awards remain owned by
-- the existing rc_player_district_badges trigger on the status update.

do $$
declare
  v_agent_no constant text := 'AGENT000';
  v_district_id constant text := 'mono-dazzledew-fountain';
  v_rows integer;
  v_signal integer := 0;
  v_fuel integer := 0;
  v_intel integer := 1;
  v_district_xp integer := 50;
  v_item_id text;
  v_item_rarity text;
  v_ward_id text;
  v_ward_name text;
  v_restored_count integer := 0;
  v_total_count integer := 0;
begin
  if (select count(*) from public.rc_player_districts
      where agent_no = v_agent_no and status = 'active') <> 1 then
    raise exception 'Expected exactly one active district for %, refusing support completion', v_agent_no;
  end if;

  if not exists (
    select 1 from public.rc_player_districts
    where agent_no = v_agent_no
      and district_id = v_district_id
      and status = 'active'
      and activated_at >= '2026-08-27 17:10:00+00'::timestamptz
  ) then
    raise exception 'The verified fresh Dazzledew Fountain attempt is no longer active; refusing support completion';
  end if;

  select coalesce(sum((goal ->> 'target')::integer), 0)
  into v_signal
  from public.rc_player_districts pd
  cross join lateral jsonb_array_elements(coalesce(pd.goals -> 'trackGoals', '[]'::jsonb)) goal
  where pd.agent_no = v_agent_no and pd.district_id = v_district_id;

  select coalesce(sum((goal ->> 'target')::integer), 0)
  into v_fuel
  from public.rc_player_districts pd
  cross join lateral jsonb_array_elements(coalesce(pd.goals -> 'albumGoals', '[]'::jsonb)) goal
  where pd.agent_no = v_agent_no and pd.district_id = v_district_id;

  select 1 + count(*) into v_intel
  from public.rc_files
  where district_id = v_district_id;

  select coalesce((value ->> 'districtXp')::integer, 50)
  into v_district_xp
  from public.rc_config
  where key = 'xp_rules';
  v_district_xp := coalesce(v_district_xp, 50);

  update public.rc_player_districts
  set status = 'restored', completed_at = now()
  where agent_no = v_agent_no
    and district_id = v_district_id
    and status = 'active';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'Support completion updated % rows instead of 1', v_rows;
  end if;

  insert into public.rc_xp_ledger (agent_no, amount, source, dedup_key, meta)
  values (
    v_agent_no, v_district_xp, 'district',
    'district:' || v_agent_no || ':' || v_district_id,
    jsonb_build_object('districtId', v_district_id, 'supportCompletion', true)
  )
  on conflict (dedup_key) do nothing;

  perform public.rc_add_resources(v_agent_no, v_signal, v_fuel, v_intel);

  select public.rc_drop_district_item(v_agent_no, v_district_id) into v_item_id;

  insert into public.rc_feed_events (agent_no, event_type, payload, dedup_key)
  values (
    v_agent_no, 'district_restored', '{}'::jsonb,
    'feed:district:' || v_agent_no || ':' || v_district_id
  )
  on conflict (dedup_key) do nothing;

  if v_item_id is not null then
    select rarity into v_item_rarity from public.rc_items where id = v_item_id;
    insert into public.rc_feed_events (agent_no, event_type, payload, dedup_key)
    values (
      v_agent_no, 'item_dropped', jsonb_build_object('rarity', v_item_rarity),
      'feed:item:' || v_agent_no || ':' || v_district_id
    )
    on conflict (dedup_key) do nothing;
  end if;

  select d.ward_id, w.name
  into v_ward_id, v_ward_name
  from public.rc_districts d
  join public.rc_wards w on w.id = d.ward_id
  where d.id = v_district_id;

  select count(*) into v_total_count
  from public.rc_districts
  where ward_id = v_ward_id and not is_centerpiece;

  select count(*) into v_restored_count
  from public.rc_districts d
  where d.ward_id = v_ward_id
    and not d.is_centerpiece
    and exists (
      select 1 from public.rc_player_districts pd
      where pd.agent_no = v_agent_no
        and pd.district_id = d.id
        and pd.status = 'restored'
    );

  insert into public.rc_feed_events (agent_no, event_type, payload, dedup_key)
  values (
    v_agent_no, 'ward_progress',
    jsonb_build_object('wardName', v_ward_name, 'restoredCount', v_restored_count, 'totalCount', v_total_count),
    'feed:ward:' || v_agent_no || ':' || v_district_id
  )
  on conflict (dedup_key) do nothing;

  if v_total_count > 0 and v_restored_count = v_total_count then
    insert into public.rc_feed_events (agent_no, event_type, payload, dedup_key)
    values (
      v_agent_no, 'ward_completed', jsonb_build_object('wardName', v_ward_name),
      'feed:ward-badge:' || v_agent_no || ':' || v_ward_id
    )
    on conflict (dedup_key) do nothing;
  end if;
end;
$$;
