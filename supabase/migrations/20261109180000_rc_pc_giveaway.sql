-- PC Giveaway: an admin-only, one-time winner draw among the eligible members
-- of a MAMA battle's winning team.
--
-- Lifecycle of a giveaway row:  draft  →  frozen  →  drawn
--   draft   rc_giveaway_prepare() (re)computes the review list from existing
--           records. Nothing about votes, streams, teams or XP is written.
--   frozen  rc_giveaway_freeze() copies the eligible members into `entries`
--           (one entry each, fixed order) and fingerprints them. From here the
--           list can't change: a trigger refuses any edit.
--   drawn   rc_giveaway_draw() stores the ONE official draw. The draws table
--           is keyed by giveaway, so a second official winner is impossible,
--           and a trigger refuses any update or delete of a stored draw.
--
-- Test spins never touch the database.

create table if not exists public.rc_giveaways (
  id           text primary key check (id ~ '^[a-z0-9_]{1,40}$'),
  campaign_id  text not null references public.rc_vote_campaigns (id),
  team         text not null check (team ~ '^[a-z0-9_]{1,24}$'),
  team_label   text not null,
  status       text not null default 'draft' check (status in ('draft', 'frozen', 'drawn')),
  rules        jsonb not null,
  window_start date not null,
  window_end   date not null,
  -- The full review list, eligible or not, each with its reason.
  candidates   jsonb not null default '[]'::jsonb,
  prepared_at  timestamptz,
  -- Frozen wheel entries: [{agent_no, display}], ordered by agent number.
  entries      jsonb,
  entries_hash text check (entries_hash ~ '^[0-9a-f]{64}$'),
  frozen_at    timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.rc_giveaway_draws (
  giveaway_id     text primary key references public.rc_giveaways (id),
  winner_index    integer not null check (winner_index >= 0),
  winner_agent_no text not null,
  winner_display  text not null,
  entry_count     integer not null check (entry_count > 0),
  entries         jsonb not null,
  entries_hash    text not null,
  random_value    bigint not null,           -- the raw 32-bit draw, for the record
  drawn_at        timestamptz not null default now()
);

alter table public.rc_giveaways enable row level security;
alter table public.rc_giveaway_draws enable row level security;
revoke all on public.rc_giveaways from public, anon, authenticated;
revoke all on public.rc_giveaway_draws from public, anon, authenticated;
-- No delete grant: a stored draw or frozen list is never removed.
grant select, insert, update on public.rc_giveaways to service_role;
grant select, insert on public.rc_giveaway_draws to service_role;

-- ── guards ─────────────────────────────────────────────────────────────────
create or replace function public.rc_giveaway_guard()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'giveaway_locked'; end if;
    return old;
  end if;
  if old.status = 'draft' then
    if new.status not in ('draft', 'frozen') then raise exception 'giveaway_bad_transition'; end if;
    return new;
  end if;
  -- Frozen or drawn: only frozen → drawn may happen, and nothing else moves.
  if not (old.status = 'frozen' and new.status = 'drawn') then raise exception 'giveaway_locked'; end if;
  if new.entries is distinct from old.entries or new.entries_hash is distinct from old.entries_hash
     or new.candidates is distinct from old.candidates or new.rules is distinct from old.rules
     or new.team is distinct from old.team or new.campaign_id is distinct from old.campaign_id
     or new.frozen_at is distinct from old.frozen_at then
    raise exception 'giveaway_locked';
  end if;
  return new;
end $$;

drop trigger if exists rc_giveaways_guard on public.rc_giveaways;
create trigger rc_giveaways_guard before update or delete on public.rc_giveaways
  for each row execute function public.rc_giveaway_guard();

create or replace function public.rc_giveaway_draw_guard()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$ begin raise exception 'giveaway_draw_is_final'; end $$;

drop trigger if exists rc_giveaway_draws_guard on public.rc_giveaway_draws;
create trigger rc_giveaway_draws_guard before update or delete on public.rc_giveaway_draws
  for each row execute function public.rc_giveaway_draw_guard();

-- ── the review list ────────────────────────────────────────────────────────
-- Read-only. For every member of the team:
--   window   the battle's KST days, starting on the day they joined the team
--            (members carried over from an earlier round start on day one).
--   voting   distinct KST days with a VERIFIED proof for the vote mission.
--   streams  distinct KST days with at least one recorded play. A play that
--            repeats the same song from a different source within the
--            duplicate window is a copy and is ignored; days whose total came
--            only from a live source (no stored plays) count by raw_streams.
--   eligible voting ≥ ceil(window × vote_num/vote_den) and
--            streams ≥ ceil(window × stream_num/stream_den), not retired, not
--            an admin account.
create or replace function public.rc_giveaway_candidates(
  p_campaign_id text, p_team text, p_rules jsonb
) returns jsonb language sql stable
set search_path = public, pg_temp
as $$
  with r as (
    select coalesce(p_rules->>'vote_mission', 'mnet') as mission,
           (p_rules->>'vote_num')::int as vn, (p_rules->>'vote_den')::int as vd,
           (p_rules->>'stream_num')::int as sn_, (p_rules->>'stream_den')::int as sd_,
           coalesce((p_rules->>'dup_window_s')::int, 600) as dup_s,
           coalesce(array(select jsonb_array_elements_text(p_rules->'exclude_agents')), '{}'::text[]) as excluded
  ), c as (
    select rc_kst_day(opens_at) as d0, rc_kst_day(closes_at) as d1
    from rc_vote_campaigns where id = p_campaign_id
  ), m as (
    select t.agent_no, t.assigned_via, a.handle, a.retired_at, t.show_ig, t.show_ig_at, c.d1,
           least(c.d1, greatest(c.d0, case when t.assigned_via = 'carried' then c.d0
                                     else rc_kst_day(coalesce(t.assigned_at, t.started_at)) end)) as d_start
    from rc_campaign_teams t join rc_agents a using (agent_no) cross join c
    where t.campaign_id = p_campaign_id and t.team = p_team
  ), v as (
    select p.agent_no, count(distinct p.vote_day) as n
    from rc_campaign_proofs p join m using (agent_no) cross join r
    where p.campaign_id = p_campaign_id and p.status = 'verified' and p.mission_id = r.mission
      and p.vote_day between m.d_start and m.d1
    group by p.agent_no
  ), s as (
    select sc.id, sc.agent_no, sc.source, lower(sc.track_name) as tr, sc.listened_at
    from rc_scrobbles sc join m using (agent_no) cross join r
    where sc.listened_at >= extract(epoch from (m.d_start::timestamp at time zone 'Asia/Seoul')) - r.dup_s
      and sc.listened_at <  extract(epoch from ((m.d1 + 1)::timestamp at time zone 'Asia/Seoul')) + r.dup_s
  ), u as (
    select s.agent_no, rc_kst_day(to_timestamp(s.listened_at)) as d
    from s cross join r
    where not exists (
      select 1 from s o
      where o.agent_no = s.agent_no and o.source <> s.source and o.tr = s.tr
        and o.listened_at between s.listened_at - r.dup_s and s.listened_at
        and (o.listened_at < s.listened_at or o.id < s.id))
  ), sd as (
    select agent_no, d from u
    union
    select a.agent_no, a.kst_date from rc_daily_activity a join m using (agent_no)
    where a.raw_streams > 0 and a.kst_date between m.d_start and m.d1
      and not exists (select 1 from u where u.agent_no = a.agent_no and u.d = a.kst_date)
  ), sn as (
    select sd.agent_no, count(distinct sd.d) as n
    from sd join m using (agent_no) where sd.d between m.d_start and m.d1
    group by sd.agent_no
  ), x as (
    select m.agent_no,
           case when (m.show_ig or m.show_ig_at is null) and m.handle ~ '^@?[A-Za-z0-9._]{1,30}$'
                then '@' || ltrim(m.handle, '@') else m.agent_no end as display,
           m.d_start, (m.d1 - m.d_start + 1) as days,
           coalesce(v.n, 0) as vote_days, coalesce(sn.n, 0) as stream_days,
           -- ceil(days × num / den) in whole numbers, so 12 × 8/12 is exactly 8
           ((m.d1 - m.d_start + 1) * r.vn + r.vd - 1) / r.vd as vote_need,
           ((m.d1 - m.d_start + 1) * r.sn_ + r.sd_ - 1) / r.sd_ as stream_need,
           m.retired_at is not null as retired,
           m.agent_no = any (r.excluded) as admin
    from m cross join r left join v using (agent_no) left join sn using (agent_no)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_no', agent_no, 'display', display, 'joined', d_start, 'days', days,
           'vote_days', vote_days, 'vote_need', vote_need,
           'stream_days', stream_days, 'stream_need', stream_need,
           'eligible', not retired and not admin and vote_days >= vote_need and stream_days >= stream_need,
           'reason', case
             when admin then 'Admin account'
             when retired then 'Account retired'
             when vote_days >= vote_need and stream_days >= stream_need then 'Meets both requirements'
             else concat_ws('; ',
               case when vote_days < vote_need then format('Voting %s of %s days (needs %s)', vote_days, days, vote_need) end,
               case when stream_days < stream_need then format('Streaming %s of %s days (needs %s)', stream_days, days, stream_need) end)
           end) order by agent_no), '[]'::jsonb)
  from x
$$;

-- ── prepare / refresh the draft ────────────────────────────────────────────
create or replace function public.rc_giveaway_prepare(
  p_id text, p_campaign_id text, p_team text, p_rules jsonb
) returns jsonb language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status text; v_label text; v_d0 date; v_d1 date; v_list jsonb;
begin
  select status into v_status from rc_giveaways where id = p_id for update;
  if v_status is not null and v_status <> 'draft' then raise exception 'giveaway_locked'; end if;

  select rc_kst_day(opens_at), rc_kst_day(closes_at),
         coalesce((select t->>'label' from jsonb_array_elements(battle->'teams') t where t->>'id' = p_team), upper(p_team))
    into v_d0, v_d1, v_label
  from rc_vote_campaigns where id = p_campaign_id;
  if v_d0 is null then raise exception 'unknown_campaign'; end if;

  v_list := rc_giveaway_candidates(p_campaign_id, p_team, p_rules);

  insert into rc_giveaways (id, campaign_id, team, team_label, status, rules, window_start, window_end, candidates, prepared_at)
  values (p_id, p_campaign_id, p_team, v_label, 'draft', p_rules, v_d0, v_d1, v_list, clock_timestamp())
  on conflict (id) do update set
    campaign_id = excluded.campaign_id, team = excluded.team, team_label = excluded.team_label,
    rules = excluded.rules, window_start = excluded.window_start, window_end = excluded.window_end,
    candidates = excluded.candidates, prepared_at = excluded.prepared_at;

  return jsonb_build_object('prepared_at', (select prepared_at from rc_giveaways where id = p_id));
end $$;

-- ── freeze ─────────────────────────────────────────────────────────────────
-- Freezes exactly the list the admin reviewed: p_prepared_at must match the
-- draft's, and p_expected_count the number of eligible members on it.
create or replace function public.rc_giveaway_freeze(
  p_id text, p_prepared_at timestamptz, p_expected_count integer
) returns jsonb language plpgsql
set search_path = public, pg_temp
as $$
declare
  g rc_giveaways; v_entries jsonb; v_n integer; v_hash text;
begin
  select * into g from rc_giveaways where id = p_id for update;
  if g.id is null then raise exception 'unknown_giveaway'; end if;
  if g.status <> 'draft' then raise exception 'giveaway_locked'; end if;
  if g.prepared_at is distinct from p_prepared_at then raise exception 'list_changed_review_again'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('agent_no', c->>'agent_no', 'display', c->>'display') order by c->>'agent_no'), '[]'::jsonb)
    into v_entries
  from jsonb_array_elements(g.candidates) c where (c->>'eligible')::boolean;
  v_n := jsonb_array_length(v_entries);
  if v_n = 0 then raise exception 'no_eligible_members'; end if;
  if v_n <> p_expected_count then raise exception 'count_mismatch'; end if;

  v_hash := encode(sha256(convert_to(v_entries::text, 'UTF8')), 'hex');
  update rc_giveaways set status = 'frozen', entries = v_entries, entries_hash = v_hash, frozen_at = clock_timestamp()
  where id = p_id;
  return jsonb_build_object('entries', v_n, 'entries_hash', v_hash);
end $$;

-- ── the one official draw ──────────────────────────────────────────────────
-- The caller supplies the index it drew with a secure RNG (equal odds via
-- rejection sampling) and the raw value. This only checks and records.
create or replace function public.rc_giveaway_draw(
  p_id text, p_entry_count integer, p_winner_index integer, p_random_value bigint
) returns jsonb language plpgsql
set search_path = public, pg_temp
as $$
declare
  g rc_giveaways; v_n integer; v_w jsonb;
begin
  select * into g from rc_giveaways where id = p_id for update;
  if g.id is null then raise exception 'unknown_giveaway'; end if;
  if g.status = 'drawn' or exists (select 1 from rc_giveaway_draws where giveaway_id = p_id) then
    raise exception 'already_drawn';
  end if;
  if g.status <> 'frozen' then raise exception 'not_frozen'; end if;
  v_n := jsonb_array_length(g.entries);
  if p_entry_count <> v_n then raise exception 'count_mismatch'; end if;
  if p_winner_index < 0 or p_winner_index >= v_n then raise exception 'bad_index'; end if;
  v_w := g.entries -> p_winner_index;

  insert into rc_giveaway_draws (giveaway_id, winner_index, winner_agent_no, winner_display,
                                 entry_count, entries, entries_hash, random_value)
  values (p_id, p_winner_index, v_w->>'agent_no', v_w->>'display', v_n, g.entries, g.entries_hash, p_random_value);
  update rc_giveaways set status = 'drawn' where id = p_id;

  return jsonb_build_object('winner_index', p_winner_index, 'winner_display', v_w->>'display',
                            'drawn_at', (select drawn_at from rc_giveaway_draws where giveaway_id = p_id));
end $$;

revoke all on function public.rc_giveaway_candidates(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rc_giveaway_prepare(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rc_giveaway_freeze(text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.rc_giveaway_draw(text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.rc_giveaway_candidates(text, text, jsonb) to service_role;
grant execute on function public.rc_giveaway_prepare(text, text, text, jsonb) to service_role;
grant execute on function public.rc_giveaway_freeze(text, timestamptz, integer) to service_role;
grant execute on function public.rc_giveaway_draw(text, integer, integer, bigint) to service_role;
