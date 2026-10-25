-- The Album: 15 BTS album covers per agent (lib/album-rules.js).
--
-- The Edge Function (lib/album.ts → album-service.js) is the only caller.
-- Both tables have RLS on with no policies and no anon or authenticated
-- grants, and both functions are service_role-only — the posture every rc_*
-- object has had since 20260927090000_rc_lock_down_anon_access.sql. The
-- browser ships the publishable key (see 20261025000000), so nothing here
-- may be reachable without the service role.
--
-- Exactly-once rules live in this file, not in JS:
--   * one goal cover per agent per KST day — a partial unique index, and the
--     award function re-checks under a per-agent advisory lock;
--   * a goal cover is always one the agent doesn't have yet;
--   * one gift sent and one gift received per agent per KST day — two
--     unique indexes, checked first under both agents' locks.
--
-- The era ids repeat lib/album-rules.js ALBUM_ERAS in release order;
-- album-sql.test.mjs fails if the two lists ever differ.

create table if not exists public.rc_album_covers (
  agent_no text not null references public.rc_agents (agent_no) on delete cascade,
  era text not null check (era in (
    'dw', 'hyyh', 'yf', 'wings', 'ynwa', 'her', 'tear', 'answer',
    'persona', 'mots7', 'be', 'ptd', 'proof', 'arirang', 'swim')),
  source text not null check (source in ('goal', 'gift')),
  from_agent_no text references public.rc_agents (agent_no) on delete set null,
  earned_on date not null,
  created_at timestamptz not null default now(),
  primary key (agent_no, era),
  -- A goal cover never has a giver; a gift's giver goes null if their account is deleted.
  check (source = 'gift' or from_agent_no is null)
);

create unique index if not exists rc_album_covers_one_goal_per_day
  on public.rc_album_covers (agent_no, earned_on) where source = 'goal';

create table if not exists public.rc_album_gifts (
  id bigint generated always as identity primary key,
  from_agent_no text not null references public.rc_agents (agent_no) on delete cascade,
  to_agent_no text not null references public.rc_agents (agent_no) on delete cascade,
  era text not null,
  sent_on date not null,
  created_at timestamptz not null default now(),
  check (from_agent_no <> to_agent_no)
);

create unique index if not exists rc_album_gifts_one_sent_per_day
  on public.rc_album_gifts (from_agent_no, sent_on);
create unique index if not exists rc_album_gifts_one_received_per_day
  on public.rc_album_gifts (to_agent_no, sent_on);

alter table public.rc_album_covers enable row level security;
alter table public.rc_album_gifts enable row level security;
revoke all on public.rc_album_covers, public.rc_album_gifts from public, anon, authenticated;
grant select, insert on public.rc_album_covers, public.rc_album_gifts to service_role;

-- Today's goal cover: one per agent per KST day, always one they're missing.
-- p_pick in [0, 1) chooses among the missing covers (the caller's rng), so
-- the order is unpredictable but the function stays deterministic to test.
create or replace function public.rc_album_award_daily(p_agent_no text, p_kst_date date, p_pick double precision)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing text;
  v_missing text[];
  v_era text;
begin
  perform pg_advisory_xact_lock(hashtext('rc_album:' || p_agent_no));

  select era into v_existing from public.rc_album_covers
   where agent_no = p_agent_no and source = 'goal' and earned_on = p_kst_date;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'era', v_existing, 'new', false);
  end if;

  select array_agg(t.e order by t.ord) into v_missing
    from unnest(array[
      'dw', 'hyyh', 'yf', 'wings', 'ynwa', 'her', 'tear', 'answer',
      'persona', 'mots7', 'be', 'ptd', 'proof', 'arirang', 'swim']) with ordinality as t(e, ord)
   where not exists (select 1 from public.rc_album_covers c where c.agent_no = p_agent_no and c.era = t.e);

  if v_missing is null then
    return jsonb_build_object('ok', true, 'era', null, 'new', false, 'complete', true);
  end if;

  v_era := v_missing[1 + least(cardinality(v_missing) - 1,
                               floor(greatest(0, coalesce(p_pick, 0)) * cardinality(v_missing))::int)];
  insert into public.rc_album_covers (agent_no, era, source, earned_on)
  values (p_agent_no, v_era, 'goal', p_kst_date);
  return jsonb_build_object('ok', true, 'era', v_era, 'new', true);
end
$$;

-- Share a copy of a cover. The giver keeps theirs. Errors are codes the
-- browser turns into words (album-rules.js ALBUM_ERRORS).
create or replace function public.rc_album_gift(
  p_from text, p_to text, p_era text, p_kst_date date, p_min_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from_created timestamptz;
  v_to_name text;
begin
  if p_from = p_to then
    return jsonb_build_object('ok', false, 'error', 'gift_self');
  end if;

  -- Both agents, always in the same order, so two crossing gifts can't deadlock.
  perform pg_advisory_xact_lock(hashtext('rc_album:' || least(p_from, p_to)));
  perform pg_advisory_xact_lock(hashtext('rc_album:' || greatest(p_from, p_to)));

  select created_at into v_from_created from public.rc_agents
   where agent_no = p_from and retired_at is null;
  if v_from_created is null or v_from_created > now() - make_interval(days => greatest(0, p_min_days)) then
    return jsonb_build_object('ok', false, 'error', 'gift_too_new');
  end if;

  select coalesce(p.codename, 'AGENT') into v_to_name
    from public.rc_agents a left join public.rc_players p on p.agent_no = a.agent_no
   where a.agent_no = p_to and a.retired_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'gift_no_agent');
  end if;

  if not exists (select 1 from public.rc_album_covers where agent_no = p_from and era = p_era) then
    return jsonb_build_object('ok', false, 'error', 'gift_not_owned');
  end if;
  if exists (select 1 from public.rc_album_covers where agent_no = p_to and era = p_era) then
    return jsonb_build_object('ok', false, 'error', 'gift_has_it');
  end if;
  if exists (select 1 from public.rc_album_gifts where from_agent_no = p_from and sent_on = p_kst_date) then
    return jsonb_build_object('ok', false, 'error', 'gift_sent_today');
  end if;
  if exists (select 1 from public.rc_album_gifts where to_agent_no = p_to and sent_on = p_kst_date) then
    return jsonb_build_object('ok', false, 'error', 'gift_received_today');
  end if;

  insert into public.rc_album_gifts (from_agent_no, to_agent_no, era, sent_on)
  values (p_from, p_to, p_era, p_kst_date);
  insert into public.rc_album_covers (agent_no, era, source, from_agent_no, earned_on)
  values (p_to, p_era, 'gift', p_from, p_kst_date);
  return jsonb_build_object('ok', true, 'era', p_era, 'to_name', v_to_name);
end
$$;

revoke all on function
  public.rc_album_award_daily(text, date, double precision),
  public.rc_album_gift(text, text, text, date, integer)
  from public, anon, authenticated;
grant execute on function
  public.rc_album_award_daily(text, date, double precision),
  public.rc_album_gift(text, text, text, date, integer)
  to service_role;
