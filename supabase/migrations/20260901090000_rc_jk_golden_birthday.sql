-- Jung Kook birthday keepsake — September 1, 2026 (KST) only.
-- Completion is claimed atomically: permanent Era row + permanent badge +
-- 10 hours of personal ARMY Bomb charge. Repeated polls cannot double-award.

insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values (
  'event_jk_birthday_2026', 'event', 'rare', 'Jung Kook Birthday Badge',
  'Complete the GOLDEN Birthday Era on September 1, 2026.', 130, true
)
on conflict (id) do update set
  name = excluded.name,
  unlock_hint = excluded.unlock_hint,
  active = true;

create or replace function public.rc_claim_jk_birthday_2026(p_agent_no text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if (now() at time zone 'Asia/Seoul')::date <> date '2026-09-01' then
    return false;
  end if;

  insert into rc_agent_lit_eras (agent_no, era_id, week_key, lit_at, used_at)
  values (p_agent_no, 'jk-golden-birthday-2026', 'event:2026-09-01', now(), now())
  on conflict (agent_no, era_id, week_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then return false; end if;

  insert into rc_agent_charge as ac (
    agent_no, charged_until, auto_feed, blackout_started_at,
    soft_reset_at, full_reset_at, last_fed_at, updated_at
  ) values (
    p_agent_no, now() + interval '10 hours', false,
    null, null, null, now(), now()
  )
  on conflict (agent_no) do update set
    charged_until = greatest(coalesce(ac.charged_until, now()), now()) + interval '10 hours',
    blackout_started_at = null,
    soft_reset_at = null,
    full_reset_at = null,
    last_fed_at = greatest(coalesce(ac.last_fed_at, '-infinity'::timestamptz), now()),
    updated_at = now();

  perform public.rc_award_badge(p_agent_no, 'event_jk_birthday_2026', null);

  insert into rc_feed_events (agent_no, event_type, payload, dedup_key)
  values (
    p_agent_no, 'era_lit',
    jsonb_build_object('eraName', 'GOLDEN Birthday', 'birthday', true),
    'feed:jk-birthday-2026:' || p_agent_no
  )
  on conflict (dedup_key) do nothing;

  return true;
end;
$$;

revoke all on function public.rc_claim_jk_birthday_2026(text) from public;
grant execute on function public.rc_claim_jk_birthday_2026(text) to service_role;
