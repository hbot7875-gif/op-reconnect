-- BTS's MAMA Fans' Choice ranks (Male, and the Daesang: Fans' Choice of the
-- Year with VISA), read from Mnet Plus every 15 minutes.
--
-- Informational only: nothing here touches votes, verification, team scores,
-- XP or rewards. The Edge Function's cronMamaRankCheck reads Mnet Plus's own
-- public vote endpoint (ranks only, no vote counts) and records the result
-- through rc_mama_rank_record; players read it back through the public
-- getMamaRanking route (service role). No table is granted to anon or
-- authenticated.

-- Which Mnet vote to read for which campaign. A new round is one new row
-- (its vote ID is the 24-hex ID in the round's Mnet vote link). Checks run
-- only while that campaign's voting is open (see the schedule migration).
create table if not exists public.rc_mama_rank_source (
  campaign_id text primary key,
  vote_id text not null check (vote_id ~ '^[0-9a-f]{24}$'),
  artist text not null default 'BTS',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.rc_mama_rank_source is
  'MAMA rank tracker: the Mnet Plus vote ID to read for each campaign.';

-- One row per check, successful or not: when it ran, what came back, and on
-- success BTS's ranks ({"male":{"rank":1,"of":20},"visa":{"rank":3,"of":40}})
-- and the full standings ({"male":[{"rank":1,"title":"BTS"}, ...], "visa":[...]}),
-- every artist's rank and name as Mnet listed them. The newest ok row is the
-- "last successful update" the card shows.
create table if not exists public.rc_mama_rank_checks (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  campaign_id text not null,
  vote_id text not null,
  ok boolean not null,
  http_status integer,
  error text,
  ranks jsonb,
  standings jsonb
);

create index if not exists rc_mama_rank_checks_recent on public.rc_mama_rank_checks (campaign_id, checked_at desc);

-- Hourly history: for each category and hour, the first and last rank read
-- that hour, the best and worst, and how many checks saw it.
create table if not exists public.rc_mama_rank_hourly (
  campaign_id text not null,
  category text not null check (category in ('male', 'visa')),
  hour timestamptz not null check (hour = date_trunc('hour', hour)),
  first_rank integer not null check (first_rank > 0),
  last_rank integer not null check (last_rank > 0),
  best_rank integer not null check (best_rank > 0),
  worst_rank integer not null check (worst_rank > 0),
  of_count integer not null check (of_count > 0),
  samples integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, category, hour)
);

alter table public.rc_mama_rank_source enable row level security;
alter table public.rc_mama_rank_checks enable row level security;
alter table public.rc_mama_rank_hourly enable row level security;
revoke all on public.rc_mama_rank_source, public.rc_mama_rank_checks, public.rc_mama_rank_hourly from public, anon, authenticated;
grant select, insert, update, delete on public.rc_mama_rank_source, public.rc_mama_rank_checks, public.rc_mama_rank_hourly to service_role;

-- Record one check. On success, folds each category's rank into its hour.
-- Check rows older than 30 days are pruned here; the hourly history is kept.
create or replace function public.rc_mama_rank_record(
  p_campaign text, p_vote text, p_ok boolean, p_status integer, p_error text, p_ranks jsonb,
  p_at timestamptz default now(), p_standings jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id bigint;
  v_hour timestamptz := date_trunc('hour', p_at);
  v_cat text;
  v_rank integer;
  v_of integer;
begin
  if p_ok and jsonb_typeof(p_ranks) <> 'object' then
    raise exception 'ranks must be an object';
  end if;

  if p_standings is not null and jsonb_typeof(p_standings) <> 'object' then
    raise exception 'standings must be an object';
  end if;

  insert into rc_mama_rank_checks (checked_at, campaign_id, vote_id, ok, http_status, error, ranks, standings)
  values (p_at, p_campaign, p_vote, p_ok, p_status, left(p_error, 200),
          case when p_ok then p_ranks end, case when p_ok then p_standings end)
  returning id into v_id;

  if p_ok then
    foreach v_cat in array array['male', 'visa'] loop
      v_rank := (p_ranks -> v_cat ->> 'rank')::integer;
      v_of := (p_ranks -> v_cat ->> 'of')::integer;
      if v_rank is null or v_of is null or v_rank < 1 or v_rank > v_of then
        raise exception 'bad rank for %', v_cat;
      end if;
      insert into rc_mama_rank_hourly as h (campaign_id, category, hour, first_rank, last_rank, best_rank, worst_rank, of_count)
      values (p_campaign, v_cat, v_hour, v_rank, v_rank, v_rank, v_rank, v_of)
      on conflict (campaign_id, category, hour) do update
        set last_rank = excluded.last_rank,
            best_rank = least(h.best_rank, excluded.best_rank),
            worst_rank = greatest(h.worst_rank, excluded.worst_rank),
            of_count = excluded.of_count,
            samples = h.samples + 1,
            updated_at = now();
    end loop;
  end if;

  delete from rc_mama_rank_checks where checked_at < now() - interval '30 days';
  return v_id;
end $$;

revoke all on function public.rc_mama_rank_record(text, text, boolean, integer, text, jsonb, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.rc_mama_rank_record(text, text, boolean, integer, text, jsonb, timestamptz, jsonb) to service_role;

-- Round 2 (Fans' Choice 2nd vote): the vote in the Round 2 Mnet link.
insert into public.rc_mama_rank_source (campaign_id, vote_id)
values ('mama_2026_r2', '6acecda6f3778e1b06f5170b')
on conflict (campaign_id) do nothing;
