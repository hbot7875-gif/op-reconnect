-- ARIRANG RE:CELEBRATE — Hooligans vs Aliens: 17 independent track battles.
--
-- Streams are NOT submitted to the battle. They come from rc_scrobbles, the
-- same accepted-stream table every other ReConnect count reads, and the
-- Edge Function (lib/recelebrate-battle.ts) decides which of those rows
-- qualify using the exact rules Red Zone already uses (exact window, the
-- agent's own selected source, BTS-artist allowlist, track match).
--
--   rc_recelebrate_battle_state   one row per event: window, scan cursor,
--                                 refresh claim, finalisation + frozen result
--   rc_recelebrate_battle_tracks  the 17 tracks and their match keys (frozen
--                                 here, so editing goals can't move the battle)
--   rc_recelebrate_battle_streams the attribution ledger: one row per
--                                 qualifying scrobble, keyed by the SAME
--                                 identity as rc_scrobbles' own dedup key, so a
--                                 play can never be attributed twice
--   rc_recelebrate_battle_counts  the read model: 17 tracks × 2 teams, kept up
--                                 to date by trigger as ledger rows land. The
--                                 Party page reads only this (34 rows).
--
-- The ledger's BEFORE INSERT guard is the final authority: it drops rows
-- outside the window, rows after finalisation, rows from agents with no team,
-- and plays from before the agent's team was chosen — and it overwrites the
-- team with the one stored on the agent's pass, so no caller (let alone a
-- client) can choose which side a stream counts for.

create table if not exists public.rc_recelebrate_battle_state (
  event_id text primary key,
  opens_at timestamptz not null,
  ends_at timestamptz not null,
  -- Scrobble sources (the hourly sync, LB polling) land plays late; results
  -- only freeze once this grace has passed. Plays still must be inside the
  -- window to count — the grace only lets already-made plays arrive.
  finalize_after timestamptz not null,
  scan_cursor bigint not null default 0,
  refresh_claimed_at timestamptz,
  refreshed_at timestamptz,
  finalized_at timestamptz,
  final_result jsonb,
  check (ends_at > opens_at),
  check (finalize_after >= ends_at)
);

create table if not exists public.rc_recelebrate_battle_tracks (
  event_id text not null references public.rc_recelebrate_battle_state(event_id) on delete cascade,
  track_id text not null,
  position integer not null,
  title text not null,
  match_keys text[] not null check (cardinality(match_keys) > 0),
  primary key (event_id, track_id),
  unique (event_id, position)
);

create table if not exists public.rc_recelebrate_battle_streams (
  event_id text not null references public.rc_recelebrate_battle_state(event_id) on delete cascade,
  agent_no text not null,
  listened_at bigint not null,
  track_name text not null,
  scrobble_id bigint not null,
  track_id text not null,
  team text not null check (team in ('hooligans', 'aliens')),
  attributed_at timestamptz not null default now(),
  primary key (event_id, agent_no, listened_at, track_name),
  foreign key (event_id, track_id) references public.rc_recelebrate_battle_tracks(event_id, track_id) on delete cascade
);

create table if not exists public.rc_recelebrate_battle_counts (
  event_id text not null,
  track_id text not null,
  team text not null check (team in ('hooligans', 'aliens')),
  streams bigint not null default 0 check (streams >= 0),
  primary key (event_id, track_id, team),
  foreign key (event_id, track_id) references public.rc_recelebrate_battle_tracks(event_id, track_id) on delete cascade
);

alter table public.rc_recelebrate_battle_state enable row level security;
alter table public.rc_recelebrate_battle_tracks enable row level security;
alter table public.rc_recelebrate_battle_streams enable row level security;
alter table public.rc_recelebrate_battle_counts enable row level security;
revoke all on public.rc_recelebrate_battle_state from anon, authenticated;
revoke all on public.rc_recelebrate_battle_tracks from anon, authenticated;
revoke all on public.rc_recelebrate_battle_streams from anon, authenticated;
revoke all on public.rc_recelebrate_battle_counts from anon, authenticated;

-- Ledger guard: the database, not the caller, decides whether a row counts
-- and for which team.
create or replace function public.rc_recelebrate_battle_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_opens timestamptz;
  v_ends timestamptz;
  v_final timestamptz;
  v_team text;
  v_chosen timestamptz;
begin
  select s.opens_at, s.ends_at, s.finalized_at into v_opens, v_ends, v_final
  from rc_recelebrate_battle_state s where s.event_id = new.event_id;
  if not found or v_final is not null then return null; end if;
  if new.listened_at < extract(epoch from v_opens)::bigint
     or new.listened_at >= extract(epoch from v_ends)::bigint then
    return null;
  end if;
  select p.team, p.team_chosen_at into v_team, v_chosen
  from rc_recelebrate_passes p where p.event_id = new.event_id and p.agent_no = new.agent_no;
  if v_team is null or v_chosen is null or new.listened_at < floor(extract(epoch from v_chosen))::bigint then
    return null;
  end if;
  new.team := v_team;
  return new;
end;
$$;

create or replace function public.rc_recelebrate_battle_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into rc_recelebrate_battle_counts (event_id, track_id, team, streams)
  values (new.event_id, new.track_id, new.team, 1)
  on conflict (event_id, track_id, team)
  do update set streams = rc_recelebrate_battle_counts.streams + 1;
  return null;
end;
$$;

drop trigger if exists rc_recelebrate_battle_guard on public.rc_recelebrate_battle_streams;
create trigger rc_recelebrate_battle_guard before insert on public.rc_recelebrate_battle_streams
  for each row execute function public.rc_recelebrate_battle_guard();
drop trigger if exists rc_recelebrate_battle_count on public.rc_recelebrate_battle_streams;
create trigger rc_recelebrate_battle_count after insert on public.rc_recelebrate_battle_streams
  for each row execute function public.rc_recelebrate_battle_count();

-- The live board, straight from the 34-row read model. Leaders, diffs,
-- tracks led, totals — and, once finalised, the winner with the
-- total-streams tiebreak. All on the server.
create or replace function public.rc_recelebrate_battle_live(p_event text)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select * from rc_recelebrate_battle_state where event_id = p_event
  ), t as (
    select tr.position, tr.track_id, tr.title,
           coalesce(sum(c.streams) filter (where c.team = 'hooligans'), 0)::bigint as h,
           coalesce(sum(c.streams) filter (where c.team = 'aliens'), 0)::bigint as a
    from rc_recelebrate_battle_tracks tr
    left join rc_recelebrate_battle_counts c on c.event_id = tr.event_id and c.track_id = tr.track_id
    where tr.event_id = p_event
    group by tr.position, tr.track_id, tr.title
  ), agg as (
    select count(*) filter (where h > a) as h_led,
           count(*) filter (where a > h) as a_led,
           count(*) filter (where h = a) as tied,
           coalesce(sum(h), 0)::bigint as total_h,
           coalesce(sum(a), 0)::bigint as total_a
    from t
  )
  select jsonb_build_object(
    'eventId', p_event,
    'status', case
      when now() < s.opens_at then 'upcoming'
      when now() < s.ends_at then 'live'
      else 'counting' end,
    'opensAt', s.opens_at, 'endsAt', s.ends_at, 'finalizeAfter', s.finalize_after,
    'refreshedAt', s.refreshed_at, 'serverNow', now(),
    'hooligansLeading', agg.h_led, 'aliensLeading', agg.a_led, 'tiedTracks', agg.tied,
    'totalHooligans', agg.total_h, 'totalAliens', agg.total_a,
    'tracks', (select coalesce(jsonb_agg(jsonb_build_object(
        'trackId', track_id, 'position', position, 'title', title,
        'hooligans', h, 'aliens', a,
        'leader', case when h > a then 'hooligans' when a > h then 'aliens' else 'tied' end,
        'difference', abs(h - a)
      ) order by position), '[]'::jsonb) from t)
  )
  from s, agg
$$;

-- Freeze the result once the sync grace after the end has passed. Runs once:
-- only while finalized_at is still null. Track wins decide it; if tied tracks
-- leave the track count level, total qualifying streams across all 17 break
-- the tie; only an exact total match is a draw.
create or replace function public.rc_recelebrate_battle_finalize(p_event text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_live jsonb;
  v_h integer; v_a integer; v_th bigint; v_ta bigint;
  v_winner text; v_by text;
  v_final jsonb;
begin
  perform 1 from rc_recelebrate_battle_state
  where event_id = p_event and finalized_at is null and now() >= finalize_after
  for update;
  if not found then return null; end if;

  v_live := rc_recelebrate_battle_live(p_event);
  v_h := (v_live->>'hooligansLeading')::int;
  v_a := (v_live->>'aliensLeading')::int;
  v_th := (v_live->>'totalHooligans')::bigint;
  v_ta := (v_live->>'totalAliens')::bigint;
  if v_h > v_a then v_winner := 'hooligans'; v_by := 'tracks';
  elsif v_a > v_h then v_winner := 'aliens'; v_by := 'tracks';
  elsif v_th > v_ta then v_winner := 'hooligans'; v_by := 'total_streams';
  elsif v_ta > v_th then v_winner := 'aliens'; v_by := 'total_streams';
  else v_winner := 'draw'; v_by := 'draw';
  end if;

  v_final := v_live || jsonb_build_object(
    'status', 'final', 'hooligansWon', v_h, 'aliensWon', v_a,
    'winner', v_winner, 'decidedBy', v_by, 'finalizedAt', now());
  update rc_recelebrate_battle_state
  set finalized_at = now(), final_result = v_final
  where event_id = p_event;
  return v_final;
end;
$$;

-- What the Party page reads: the frozen result once final, else the live board.
create or replace function public.rc_recelebrate_battle_board(p_event text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select final_result from rc_recelebrate_battle_state where event_id = p_event and finalized_at is not null),
    rc_recelebrate_battle_live(p_event))
$$;

-- One sweeper at a time: claim a refresh only if nobody has in the last
-- p_min_seconds (the database clock decides). Returns the cursor to resume
-- from, or null when there's nothing to do.
create or replace function public.rc_recelebrate_battle_claim(p_event text, p_min_seconds integer)
returns bigint language sql security definer set search_path = public as $$
  update rc_recelebrate_battle_state
  set refresh_claimed_at = now()
  where event_id = p_event
    and finalized_at is null
    and now() >= opens_at
    and (refresh_claimed_at is null or refresh_claimed_at < now() - make_interval(secs => p_min_seconds))
  returning scan_cursor
$$;

create or replace function public.rc_recelebrate_battle_advance(p_event text, p_cursor bigint)
returns void language sql security definer set search_path = public as $$
  update rc_recelebrate_battle_state
  set scan_cursor = greatest(scan_cursor, p_cursor), refreshed_at = now()
  where event_id = p_event
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'rc_recelebrate_battle_live(text)', 'rc_recelebrate_battle_finalize(text)',
    'rc_recelebrate_battle_board(text)', 'rc_recelebrate_battle_claim(text, integer)',
    'rc_recelebrate_battle_advance(text, bigint)', 'rc_recelebrate_battle_guard()',
    'rc_recelebrate_battle_count()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'rc_recelebrate_battle_live(text)', 'rc_recelebrate_battle_finalize(text)',
    'rc_recelebrate_battle_board(text)', 'rc_recelebrate_battle_claim(text, integer)',
    'rc_recelebrate_battle_advance(text, bigint)'
  ] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- The event itself: Sept 20, 2026 9:30 AM IST → Sept 21, 2026 9:30 AM IST,
-- results freeze 90 minutes after the end (covers the hourly sync).
insert into public.rc_recelebrate_battle_state (event_id, opens_at, ends_at, finalize_after)
values ('arirang-recelebrate-2026', '2026-09-20T04:00:00Z', '2026-09-21T04:00:00Z', '2026-09-21T05:30:00Z')
on conflict (event_id) do nothing;

-- Match keys are normKeyFull() output (lib/text.ts): lower-case, version
-- suffixes like "(Clean Ver.)" stripped, punctuation removed. Korean titles
-- are included for the Road to 1B tracks, as the existing goals already do.
insert into public.rc_recelebrate_battle_tracks (event_id, track_id, position, title, match_keys) values
  ('arirang-recelebrate-2026', 'body-to-body', 1, 'Body to Body', array['body to body']),
  ('arirang-recelebrate-2026', 'hooligan', 2, 'Hooligan', array['hooligan']),
  ('arirang-recelebrate-2026', 'aliens', 3, 'Aliens', array['aliens']),
  ('arirang-recelebrate-2026', 'fya', 4, 'FYA', array['fya']),
  ('arirang-recelebrate-2026', 'two-point-oh', 5, '2.0', array['20']),
  ('arirang-recelebrate-2026', 'no-29', 6, 'No. 29', array['no 29', 'no29']),
  ('arirang-recelebrate-2026', 'swim', 7, 'SWIM', array['swim']),
  ('arirang-recelebrate-2026', 'merry-go-round', 8, 'Merry Go Round', array['merry go round']),
  ('arirang-recelebrate-2026', 'normal', 9, 'NORMAL', array['normal']),
  ('arirang-recelebrate-2026', 'like-animals', 10, 'Like Animals', array['like animals']),
  ('arirang-recelebrate-2026', 'they-dont-know-bout-us', 11, 'they don''t know ''bout us', array['they dont know bout us']),
  ('arirang-recelebrate-2026', 'one-more-night', 12, 'One More Night', array['one more night']),
  ('arirang-recelebrate-2026', 'please', 13, 'Please', array['please']),
  ('arirang-recelebrate-2026', 'into-the-sun', 14, 'Into the Sun', array['into the sun']),
  ('arirang-recelebrate-2026', 'wild-flower', 15, 'Wild Flower', array['wild flower', '야생화', '야생화 wild flower']),
  ('arirang-recelebrate-2026', 'haegeum', 16, 'Haegeum', array['haegeum', '해금', '해금 haegeum']),
  ('arirang-recelebrate-2026', 'killin-it-girl', 17, 'Killin'' It Girl', array['killin it girl', 'killing it girl'])
on conflict (event_id, track_id) do nothing;

insert into public.rc_recelebrate_battle_counts (event_id, track_id, team, streams)
select event_id, track_id, team, 0
from public.rc_recelebrate_battle_tracks, unnest(array['hooligans', 'aliens']) as team
where event_id = 'arirang-recelebrate-2026'
on conflict do nothing;
