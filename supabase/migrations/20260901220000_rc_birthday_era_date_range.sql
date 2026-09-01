-- Extend the one-time GOLDEN keepsake through an extra KST day (site
-- owner's call, made 2026-09-01 evening with real participation still
-- climbing toward what was about to be a hard midnight cutoff).
--
-- rc_claim_birthday_era's own date check is the authoritative gate --
-- birthday-eras.ts's window is advisory only, read by the edge function
-- to decide what to SHOW; this RPC is what actually decides whether a
-- claim is allowed. Widening only the edge function's own logic and
-- leaving this check as an exact-date match would mean a stale or
-- rolled-back function deploy could still silently block every claim on
-- the extended day. Dropped and recreated (not overloaded) so only one
-- signature can ever be called, same pattern as the stream-target
-- migration before it.

drop function if exists rc_claim_birthday_era(text, text, date, text, text, integer);

create or replace function rc_claim_birthday_era(
  p_agent_no text,
  p_event_id text,
  p_event_date date,
  p_era_name text,
  p_badge_template_id text,
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

  if coalesce(trim(p_event_id), '') = ''
     or coalesce(trim(p_era_name), '') = ''
     or not exists (
       select 1 from rc_badge_catalog
       where id = p_badge_template_id and active = true and section = 'event'
     ) then
    return false;
  end if;

  -- Keyed by the canonical start date, not whichever day the claim
  -- actually lands on, so the "already claimed" dedupe stays stable
  -- across the whole window (matches the edge function's own lookup).
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

  perform public.rc_award_badge(p_agent_no, p_badge_template_id, null);

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

revoke all on function rc_claim_birthday_era(text, text, date, text, text, integer, date)
  from public, anon, authenticated;
grant execute on function rc_claim_birthday_era(text, text, date, text, text, integer, date)
  to service_role;
