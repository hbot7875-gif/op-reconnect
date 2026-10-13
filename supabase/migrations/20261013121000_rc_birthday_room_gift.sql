-- Birthday room gift: a second, separate reward path for birthday events that
-- opt into it (birthday-eras.ts `roomGift`). Jimin Day 2026 is the first.
--
--   Era Card complete      -> rc_claim_birthday_charge: +hours only, no badge
--   shared room at target  -> rc_birthday_room_completions (recorded once)
--   contributor claims     -> rc_claim_birthday_room_gift: badges + 1 Wing
--                             + 1 Charge Cell, once, into rc_birthday_gift_claims
--
-- rc_claim_birthday_era (GOLDEN's path: +hours AND badge together) is not
-- touched; events without `roomGift` keep calling it exactly as before.

-- ── Era Card completion: charge only ───────────────────────────────────────
-- Same window check, same claim row, same charge write and feed line as
-- rc_claim_birthday_era (20260901220000), minus the badge award.
create or replace function rc_claim_birthday_charge(
  p_agent_no text,
  p_event_id text,
  p_event_date date,
  p_era_name text,
  p_reward_hours integer default 10,
  p_event_date_end date default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
  v_hours integer := greatest(1, least(coalesce(p_reward_hours, 10), 24));
  v_date_end date := coalesce(p_event_date_end, p_event_date);
begin
  if (now() at time zone 'Asia/Seoul')::date not between p_event_date and v_date_end then
    return false;
  end if;
  if coalesce(trim(p_event_id), '') = '' or coalesce(trim(p_era_name), '') = '' then
    return false;
  end if;

  insert into rc_agent_lit_eras (agent_no, era_id, week_key, lit_at, used_at)
  values (p_agent_no, p_event_id, 'event:' || p_event_date::text, now(), now())
  on conflict (agent_no, era_id, week_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then return false; end if;

  insert into rc_agent_charge as ac (
    agent_no, charged_until, auto_feed, blackout_started_at,
    soft_reset_at, full_reset_at, last_fed_at, updated_at
  ) values (
    p_agent_no, now() + make_interval(hours => v_hours), false,
    null, null, null, now(), now()
  )
  on conflict (agent_no) do update set
    charged_until = greatest(coalesce(ac.charged_until, now()), now()) + make_interval(hours => v_hours),
    blackout_started_at = null,
    soft_reset_at = null,
    full_reset_at = null,
    last_fed_at = greatest(coalesce(ac.last_fed_at, '-infinity'::timestamptz), now()),
    updated_at = now();

  insert into rc_feed_events (agent_no, event_type, payload, dedup_key)
  values (
    p_agent_no, 'era_lit',
    jsonb_build_object('eraName', p_era_name, 'birthday', true),
    'feed:birthday-era:' || p_event_id || ':' || p_agent_no
  )
  on conflict (dedup_key) do nothing;

  return true;
end;
$$;

revoke all on function rc_claim_birthday_charge(text, text, date, text, integer, date)
  from public, anon, authenticated;
grant execute on function rc_claim_birthday_charge(text, text, date, text, integer, date)
  to service_role;

-- ── Room completion: recorded once, never undone ───────────────────────────
create table if not exists public.rc_birthday_room_completions (
  event_id text primary key,
  community_lights integer not null check (community_lights >= 0),
  target integer not null check (target > 0),
  completed_at timestamptz not null default now()
);
alter table public.rc_birthday_room_completions enable row level security;
revoke all on public.rc_birthday_room_completions from public, anon, authenticated;
grant select, insert on public.rc_birthday_room_completions to service_role;

-- ── Gift claims: one row per agent per event ───────────────────────────────
create table if not exists public.rc_birthday_gift_claims (
  event_id text not null,
  agent_no text not null,
  lights integer not null check (lights > 0),
  card_complete boolean not null,
  badge_ids text[] not null default '{}',
  wings integer not null check (wings >= 0),
  charge_cells integer not null check (charge_cells >= 0),
  claimed_at timestamptz not null default now(),
  primary key (event_id, agent_no)
);
alter table public.rc_birthday_gift_claims enable row level security;
revoke all on public.rc_birthday_gift_claims from public, anon, authenticated;
grant select, insert on public.rc_birthday_gift_claims to service_role;

-- p_lights is the agent's own room contribution, computed by the service-role
-- edge function from the event window's rc_daily_activity (the same
-- computation that drives the room); the client never supplies it. Everything
-- this function can decide for itself it decides here: the room's recorded
-- completion, the claim window, the agent's own Era Card completion (its
-- rc_agent_lit_eras row), and whether a claim already exists.
create or replace function rc_claim_birthday_room_gift(
  p_agent_no text,
  p_event_id text,
  p_event_date date,
  p_event_date_end date,
  p_lights integer,
  p_room_badge_id text,
  p_card_badge_id text,
  p_wings integer default 1,
  p_charge_cells integer default 1
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_end date := coalesce(p_event_date_end, p_event_date);
  v_existing public.rc_birthday_gift_claims%rowtype;
  v_card boolean;
  v_badges text[] := '{}';
  v_wings integer := greatest(0, least(coalesce(p_wings, 1), 1));
  v_cells integer := greatest(0, least(coalesce(p_charge_cells, 1), 1));
begin
  if coalesce(trim(p_agent_no), '') = '' or coalesce(trim(p_event_id), '') = '' then
    return jsonb_build_object('state', 'unavailable');
  end if;

  -- An existing claim is always returned as-is, even after the window.
  select * into v_existing from public.rc_birthday_gift_claims
   where event_id = p_event_id and agent_no = p_agent_no;
  if found then
    return jsonb_build_object('state', 'claimed', 'badgeIds', to_jsonb(v_existing.badge_ids),
      'wings', v_existing.wings, 'chargeCells', v_existing.charge_cells,
      'cardComplete', v_existing.card_complete, 'claimedAt', v_existing.claimed_at);
  end if;

  if v_today < p_event_date or v_today > v_end + 7 then
    return jsonb_build_object('state', 'closed');
  end if;
  if not exists (select 1 from public.rc_birthday_room_completions where event_id = p_event_id) then
    return jsonb_build_object('state', 'locked');
  end if;
  if coalesce(p_lights, 0) <= 0 then
    return jsonb_build_object('state', 'ineligible');
  end if;
  if not exists (select 1 from public.rc_players where agent_no = p_agent_no) then
    return jsonb_build_object('state', 'unavailable');
  end if;
  if not exists (select 1 from rc_badge_catalog where id = p_room_badge_id and active and section = 'event')
     or not exists (select 1 from rc_badge_catalog where id = p_card_badge_id and active and section = 'event') then
    return jsonb_build_object('state', 'unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('birthday_room_gift|' || p_event_id || '|' || p_agent_no, 0));
  select * into v_existing from public.rc_birthday_gift_claims
   where event_id = p_event_id and agent_no = p_agent_no;
  if found then
    return jsonb_build_object('state', 'claimed', 'badgeIds', to_jsonb(v_existing.badge_ids),
      'wings', v_existing.wings, 'chargeCells', v_existing.charge_cells,
      'cardComplete', v_existing.card_complete, 'claimedAt', v_existing.claimed_at);
  end if;

  -- The Era Card claim row only exists if rc_claim_birthday_charge accepted
  -- it inside the event window, so this is frozen to the event, not the
  -- 7-day claim period.
  select exists (
    select 1 from rc_agent_lit_eras
     where agent_no = p_agent_no and era_id = p_event_id and week_key = 'event:' || p_event_date::text
  ) into v_card;

  v_badges := array_append(v_badges, p_room_badge_id);
  perform public.rc_award_badge(p_agent_no, p_room_badge_id, null);
  if v_card then
    v_badges := array_append(v_badges, p_card_badge_id);
    perform public.rc_award_badge(p_agent_no, p_card_badge_id, null);
  end if;

  update public.rc_players
     set wings = coalesce(wings, 0) + v_wings,
         charge_cells = coalesce(charge_cells, 0) + v_cells
   where agent_no = p_agent_no;

  insert into public.rc_birthday_gift_claims
    (event_id, agent_no, lights, card_complete, badge_ids, wings, charge_cells)
  values (p_event_id, p_agent_no, p_lights, v_card, v_badges, v_wings, v_cells);

  return jsonb_build_object('state', 'claimed', 'badgeIds', to_jsonb(v_badges),
    'wings', v_wings, 'chargeCells', v_cells, 'cardComplete', v_card, 'claimedAt', now());
end;
$$;

revoke all on function rc_claim_birthday_room_gift(text, text, date, date, integer, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function rc_claim_birthday_room_gift(text, text, date, date, integer, text, text, integer, integer)
  to service_role;
