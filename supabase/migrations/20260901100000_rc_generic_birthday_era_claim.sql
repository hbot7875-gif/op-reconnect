-- Reusable birthday Era claim. The Edge Function supplies values only from
-- its trusted birthday-eras.ts configuration; clients cannot call this RPC.
-- This keeps every future birthday on the same atomic award path instead of
-- adding another member-specific function.

create or replace function public.rc_claim_birthday_era(
  p_agent_no text,
  p_event_id text,
  p_event_date date,
  p_era_name text,
  p_badge_template_id text,
  p_reward_hours integer default 10
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
  v_hours integer := greatest(1, least(coalesce(p_reward_hours, 10), 24));
begin
  if (now() at time zone 'Asia/Seoul')::date <> p_event_date then
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

revoke all on function public.rc_claim_birthday_era(text, text, date, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.rc_claim_birthday_era(text, text, date, text, text, integer)
  to service_role;
