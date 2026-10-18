-- RUN AMI — LAST CARD (Phase 1): rooms, seats, server-authoritative matches.
--
-- The Edge Function (lib/run-ami.ts → run-ami-service.js) is the only
-- caller. Every table here has RLS on with no policies and no anon or
-- authenticated grants, and every function is service_role-only — the same
-- posture 20260927090000_rc_lock_down_anon_access.sql gives every rc_*
-- object. Browsers never read these tables; they receive per-seat views
-- built by lib/run-ami-view.js.
--
-- Privacy. rc_run_ami_match_secrets holds the full game state (every hand
-- and the draw pile). rc_run_ami_matches.public_state holds only counts and
-- the face-up top card. rc_run_ami_events.private (drawn card ids, kept for
-- debugging) is never selected by any player route.
--
-- Concurrency. A match changes only through rc_run_ami_commit, which applies
-- a new state only when the caller's expected version is still current. Of
-- two simultaneous actions exactly one lands; the other gets 'stale'.
-- (match, agent, action_id) is unique, so a replayed request applies once.
--
-- ARMY Bomb. Entry needs an active Bomb: rc_agent_charge.charged_until in
-- the future. These functions only ever READ rc_agent_charge. Nothing here
-- writes charged_until, last_fed_at, auto_feed, the blackout columns or
-- rc_players.charge_cells — RUN AMI costs no charge in V1.
--
-- Realtime. After each committed change, realtime.send() broadcasts
-- {v, r} — the new match/room version numbers and nothing else — on the
-- room's unguessable topic. It is a nudge to refetch, never state. A failed
-- send can never fail the commit.

-- ── Tables ─────────────────────────────────────────────────────────────

create table if not exists public.rc_run_ami_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-NP-Z2-9]{6}$'),  -- no 0, O or 1
  host_agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'in_match', 'closed')),
  -- Realtime topic suffix. Only seated agents are ever shown it.
  topic text not null check (char_length(topic) >= 32),
  version integer not null default 1,
  current_match_id uuid,
  last_match_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- A code is unique among rooms that are still open; closed rooms free it.
create unique index if not exists rc_run_ami_rooms_open_code_uq
  on public.rc_run_ami_rooms (code) where status <> 'closed';
create index if not exists rc_run_ami_rooms_waiting_idx
  on public.rc_run_ami_rooms (updated_at) where status = 'waiting';

create table if not exists public.rc_run_ami_seats (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rc_run_ami_rooms(id) on delete cascade,
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz
);

-- One room per agent, one agent per seat.
create unique index if not exists rc_run_ami_seats_one_room_per_agent
  on public.rc_run_ami_seats (agent_no) where left_at is null;
create unique index if not exists rc_run_ami_seats_one_agent_per_seat
  on public.rc_run_ami_seats (room_id, seat) where left_at is null;

create table if not exists public.rc_run_ami_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rc_run_ami_rooms(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  version integer not null default 1 check (version >= 1),
  public_state jsonb not null,
  turn_deadline_at timestamptz,
  rules_version smallint not null,
  -- How entry was gated. 'bomb_active' is V1's only mode: an active Bomb
  -- is required and nothing is spent. A future paid mode gets its own value
  -- (and its own ledger table) rather than reusing this one.
  entry_mode text not null default 'bomb_active' check (entry_mode in ('bomb_active')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  winner_seat smallint,
  end_reason text check (end_reason in ('played_out', 'last_standing', 'abandoned')),
  updated_at timestamptz not null default now()
);

create unique index if not exists rc_run_ami_matches_one_active_per_room
  on public.rc_run_ami_matches (room_id) where status = 'active';
create index if not exists rc_run_ami_matches_active_deadline_idx
  on public.rc_run_ami_matches (turn_deadline_at) where status = 'active';

alter table public.rc_run_ami_rooms
  drop constraint if exists rc_run_ami_rooms_current_match_fk,
  add constraint rc_run_ami_rooms_current_match_fk
    foreign key (current_match_id) references public.rc_run_ami_matches(id) on delete set null,
  drop constraint if exists rc_run_ami_rooms_last_match_fk,
  add constraint rc_run_ami_rooms_last_match_fk
    foreign key (last_match_id) references public.rc_run_ami_matches(id) on delete set null;

-- The full truth: every hand, the draw pile, the discard pile. Service role only.
create table if not exists public.rc_run_ami_match_secrets (
  match_id uuid primary key references public.rc_run_ami_matches(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Who sat where, and how it went — enough for future rewards to tell a
-- played-out win ('won') from a walkover ('last_standing') or a dead match.
create table if not exists public.rc_run_ami_match_players (
  match_id uuid not null references public.rc_run_ami_matches(id) on delete cascade,
  seat smallint not null check (seat between 0 and 3),
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  result text check (result in ('won', 'played', 'forfeited', 'last_standing', 'abandoned')),
  final_cards smallint,
  forfeit_reason text,
  run_ami_calls smallint not null default 0,
  times_caught smallint not null default 0,
  catches smallint not null default 0,
  timeouts smallint not null default 0,
  finished_at timestamptz,
  primary key (match_id, seat),
  unique (match_id, agent_no)
);
create index if not exists rc_run_ami_match_players_agent_idx
  on public.rc_run_ami_match_players (agent_no);

create table if not exists public.rc_run_ami_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rc_run_ami_rooms(id) on delete cascade,
  match_id uuid references public.rc_run_ami_matches(id) on delete cascade,
  version integer,
  ord smallint not null default 1,
  type text not null check (type in (
    'PLAYER_JOINED', 'PLAYER_LEFT', 'PLAYER_RECONNECTED', 'MATCH_STARTED',
    'CARD_PLAYED', 'COLOR_SELECTED', 'CARD_DRAWN', 'TURN_PASSED', 'TURN_SKIPPED',
    'DIRECTION_REVERSED', 'RUN_AMI_CALLED', 'PLAYER_CAUGHT', 'TURN_TIMEOUT',
    'PLAYER_FORFEITED', 'MATCH_WON', 'MATCH_ENDED'
  )),
  seat smallint,
  agent_no text references public.rc_agents(agent_no) on delete set null,
  action_id uuid,
  public jsonb not null default '{}'::jsonb,
  private jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists rc_run_ami_events_match_idx
  on public.rc_run_ami_events (match_id, id desc);
create unique index if not exists rc_run_ami_events_action_uq
  on public.rc_run_ami_events (match_id, agent_no, action_id) where action_id is not null;

alter table public.rc_run_ami_rooms enable row level security;
alter table public.rc_run_ami_seats enable row level security;
alter table public.rc_run_ami_matches enable row level security;
alter table public.rc_run_ami_match_secrets enable row level security;
alter table public.rc_run_ami_match_players enable row level security;
alter table public.rc_run_ami_events enable row level security;
revoke all on public.rc_run_ami_rooms, public.rc_run_ami_seats, public.rc_run_ami_matches,
  public.rc_run_ami_match_secrets, public.rc_run_ami_match_players, public.rc_run_ami_events
  from public, anon, authenticated;

comment on table public.rc_run_ami_match_secrets is
  'RUN AMI full match state including every hand. Service role only; never returned to a browser unfiltered.';

-- ── Helpers ────────────────────────────────────────────────────────────

-- Read-only. "Active" = charged_until is in the future. A never-fed Bomb
-- (no row, or charged_until null) is not active.
create or replace function public.rc_run_ami_bomb_active(p_agent_no text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.charged_until > now()
                     from rc_agent_charge c where c.agent_no = p_agent_no), false);
$$;

-- Nudge everyone in the room to refetch. Version numbers only.
create or replace function public.rc_run_ami_notify(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic text;
  v_room_version integer;
  v_match_version integer;
begin
  select r.topic, r.version, m.version into v_topic, v_room_version, v_match_version
    from rc_run_ami_rooms r
    left join rc_run_ami_matches m on m.id = r.current_match_id
   where r.id = p_room_id;
  if v_topic is null then return; end if;
  begin
    perform realtime.send(
      jsonb_build_object('r', v_room_version, 'v', v_match_version),
      'v', 'run-ami:' || v_topic, false);
  exception when others then
    null;  -- Realtime is a nudge; polling covers a missed one.
  end;
end;
$$;

-- Leave a room. Hands the host role to the lowest remaining seat, or closes
-- the room when nobody is left. Does not touch a running match: the Edge
-- Function forfeits the seat through rc_run_ami_commit first.
create or replace function public.rc_run_ami_release_seat(p_room_id uuid, p_agent_no text, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rc_run_ami_rooms%rowtype;
  v_next text;
begin
  select * into v_room from rc_run_ami_rooms where id = p_room_id for update;
  if not found then return; end if;

  update rc_run_ami_seats set left_at = now()
   where room_id = p_room_id and agent_no = p_agent_no and left_at is null;
  if not found then return; end if;

  insert into rc_run_ami_events (room_id, match_id, type, agent_no)
  values (p_room_id, v_room.current_match_id, p_event, p_agent_no);

  select s.agent_no into v_next from rc_run_ami_seats s
   where s.room_id = p_room_id and s.left_at is null order by s.seat limit 1;

  if v_next is null and v_room.current_match_id is null then
    update rc_run_ami_rooms set status = 'closed', closed_at = now(), updated_at = now(),
           version = version + 1
     where id = p_room_id;
  else
    update rc_run_ami_rooms
       set host_agent_no = case when host_agent_no = p_agent_no and v_next is not null
                                then v_next else host_agent_no end,
           version = version + 1, updated_at = now()
     where id = p_room_id;
  end if;
  perform rc_run_ami_notify(p_room_id);
end;
$$;

-- ── Rooms ──────────────────────────────────────────────────────────────

create or replace function public.rc_run_ami_create_room(p_agent_no text, p_code text, p_topic text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  if not rc_run_ami_bomb_active(p_agent_no) then
    return jsonb_build_object('ok', false, 'error', 'bomb_dark');
  end if;
  if exists (select 1 from rc_run_ami_seats where agent_no = p_agent_no and left_at is null) then
    return jsonb_build_object('ok', false, 'error', 'already_seated');
  end if;

  begin
    insert into rc_run_ami_rooms (code, host_agent_no, topic)
    values (p_code, p_agent_no, p_topic)
    returning id into v_room_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'code_taken');
  end;

  begin
    insert into rc_run_ami_seats (room_id, agent_no, seat) values (v_room_id, p_agent_no, 0);
  exception when unique_violation then
    -- Seated elsewhere by a concurrent request a moment ago.
    delete from rc_run_ami_rooms where id = v_room_id;
    return jsonb_build_object('ok', false, 'error', 'already_seated');
  end;

  insert into rc_run_ami_events (room_id, type, agent_no, seat)
  values (v_room_id, 'PLAYER_JOINED', p_agent_no, 0);
  return jsonb_build_object('ok', true, 'room_id', v_room_id);
end;
$$;

create or replace function public.rc_run_ami_join_room(p_agent_no text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rc_run_ami_rooms%rowtype;
  v_current uuid;
  v_seat smallint;
begin
  -- The code only finds a room. Authentication already happened in the
  -- Edge Function; the Bomb gate is checked here, inside the same
  -- transaction as the seat insert.
  if not rc_run_ami_bomb_active(p_agent_no) then
    return jsonb_build_object('ok', false, 'error', 'bomb_dark');
  end if;

  select * into v_room from rc_run_ami_rooms
   where code = upper(p_code) and status <> 'closed' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  select room_id into v_current from rc_run_ami_seats
   where agent_no = p_agent_no and left_at is null;
  if v_current = v_room.id then
    return jsonb_build_object('ok', true, 'room_id', v_room.id, 'already', true);
  elsif v_current is not null then
    return jsonb_build_object('ok', false, 'error', 'already_seated');
  end if;

  if v_room.status <> 'waiting' then
    return jsonb_build_object('ok', false, 'error', 'room_in_match');
  end if;

  select min(s) into v_seat from generate_series(0, 3) s
   where not exists (select 1 from rc_run_ami_seats x
                      where x.room_id = v_room.id and x.seat = s and x.left_at is null);
  if v_seat is null then
    return jsonb_build_object('ok', false, 'error', 'room_full');
  end if;

  begin
    insert into rc_run_ami_seats (room_id, agent_no, seat) values (v_room.id, p_agent_no, v_seat);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_seated');
  end;

  insert into rc_run_ami_events (room_id, type, agent_no, seat)
  values (v_room.id, 'PLAYER_JOINED', p_agent_no, v_seat);
  update rc_run_ami_rooms set version = version + 1, updated_at = now() where id = v_room.id;
  perform rc_run_ami_notify(v_room.id);
  return jsonb_build_object('ok', true, 'room_id', v_room.id);
end;
$$;

create or replace function public.rc_run_ami_leave_room(p_agent_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
begin
  select room_id into v_room_id from rc_run_ami_seats
   where agent_no = p_agent_no and left_at is null;
  if v_room_id is null then
    return jsonb_build_object('ok', true);
  end if;
  perform rc_run_ami_release_seat(v_room_id, p_agent_no, 'PLAYER_LEFT');
  return jsonb_build_object('ok', true, 'room_id', v_room_id);
end;
$$;

-- Heartbeat. Returns the agent's room and whether they had gone quiet for
-- longer than p_stale_seconds (logged once as PLAYER_RECONNECTED).
create or replace function public.rc_run_ami_touch(p_agent_no text, p_stale_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_seat smallint;
  v_prev timestamptz;
  v_match uuid;
  v_stale boolean;
begin
  select s.room_id, s.seat, s.last_seen_at into v_room_id, v_seat, v_prev
    from rc_run_ami_seats s where s.agent_no = p_agent_no and s.left_at is null
    for update;
  if v_room_id is null then return null; end if;

  update rc_run_ami_seats set last_seen_at = now()
   where agent_no = p_agent_no and left_at is null;

  v_stale := v_prev < now() - make_interval(secs => greatest(p_stale_seconds, 1));
  if v_stale then
    select current_match_id into v_match from rc_run_ami_rooms where id = v_room_id;
    if v_match is not null then
      insert into rc_run_ami_events (room_id, match_id, type, agent_no)
      values (v_room_id, v_match, 'PLAYER_RECONNECTED', p_agent_no);
    end if;
  end if;
  return jsonb_build_object('room_id', v_room_id, 'was_stale', v_stale);
end;
$$;

-- Waiting rooms nobody has touched for p_idle_minutes close, seats released.
create or replace function public.rc_run_ami_expire_rooms(p_idle_minutes integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with expired as (
    update rc_run_ami_rooms
       set status = 'closed', closed_at = now(), updated_at = now(), version = version + 1
     where status = 'waiting'
       and updated_at < now() - make_interval(mins => greatest(p_idle_minutes, 5))
       and not exists (select 1 from rc_run_ami_seats s
                        where s.room_id = rc_run_ami_rooms.id and s.left_at is null
                          and s.last_seen_at >= now() - make_interval(mins => greatest(p_idle_minutes, 5)))
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_ids from expired;

  update rc_run_ami_seats set left_at = now()
   where room_id = any(v_ids) and left_at is null;
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

-- ── Matches ────────────────────────────────────────────────────────────

create or replace function public.rc_run_ami_start_match(
  p_room_id uuid,
  p_agent_no text,
  p_room_version integer,
  p_agents text[],
  p_public jsonb,
  p_state jsonb,
  p_deadline timestamptz,
  p_rules_version smallint,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rc_run_ami_rooms%rowtype;
  v_seated text[];
  v_match_id uuid;
  v_agent text;
begin
  select * into v_room from rc_run_ami_rooms where id = p_room_id for update;
  if not found or v_room.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;
  if v_room.host_agent_no <> p_agent_no then
    return jsonb_build_object('ok', false, 'error', 'not_host');
  end if;
  if v_room.status <> 'waiting' then
    return jsonb_build_object('ok', false, 'error', 'already_started');
  end if;

  -- The state was dealt for exactly these agents in exactly this order. If
  -- anyone joined or left since the host's request read the seats, refuse.
  select array_agg(s.agent_no order by s.seat) into v_seated
    from rc_run_ami_seats s where s.room_id = p_room_id and s.left_at is null;
  if v_room.version <> p_room_version or v_seated is distinct from p_agents then
    return jsonb_build_object('ok', false, 'error', 'stale');
  end if;
  if coalesce(array_length(p_agents, 1), 0) not between 2 and 4 then
    return jsonb_build_object('ok', false, 'error', 'need_players');
  end if;

  foreach v_agent in array p_agents loop
    if not rc_run_ami_bomb_active(v_agent) then
      return jsonb_build_object('ok', false, 'error', 'bomb_dark');
    end if;
  end loop;

  insert into rc_run_ami_matches (room_id, public_state, turn_deadline_at, rules_version)
  values (p_room_id, p_public, p_deadline, p_rules_version)
  returning id into v_match_id;

  insert into rc_run_ami_match_secrets (match_id, state) values (v_match_id, p_state);

  insert into rc_run_ami_match_players (match_id, seat, agent_no)
  select v_match_id, (a.ord - 1)::smallint, a.agent_no
    from unnest(p_agents) with ordinality as a(agent_no, ord);

  insert into rc_run_ami_events (room_id, match_id, version, ord, type, seat, agent_no, public, private)
  select p_room_id, v_match_id, 1, e.ord::smallint, e.value->>'type',
         nullif(e.value->>'seat', '')::smallint, p_agent_no,
         coalesce(e.value->'pub', '{}'::jsonb), coalesce(e.value->'priv', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality as e(value, ord);

  update rc_run_ami_rooms
     set status = 'in_match', current_match_id = v_match_id,
         version = version + 1, updated_at = now()
   where id = p_room_id;
  perform rc_run_ami_notify(p_room_id);
  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'version', 1);
end;
$$;

-- The one way a match changes. Applies p_state only if the match is still
-- active at p_expected_version; anything else returns 'stale' and writes
-- nothing. p_action_id (the client's UUID) makes a replay a no-op.
create or replace function public.rc_run_ami_commit(
  p_match_id uuid,
  p_expected_version integer,
  p_public jsonb,
  p_state jsonb,
  p_status text,
  p_deadline timestamptz,
  p_winner_seat smallint,
  p_end_reason text,
  p_events jsonb,
  p_agent_no text,
  p_action_id uuid,
  p_final jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer;
  v_room_id uuid;
  v_ended boolean := p_status <> 'active';
begin
  if p_action_id is not null and exists (
    select 1 from rc_run_ami_events
     where match_id = p_match_id and agent_no = p_agent_no and action_id = p_action_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  begin
    update rc_run_ami_matches
       set public_state = p_public,
           version = version + 1,
           status = p_status,
           turn_deadline_at = case when v_ended then null else p_deadline end,
           winner_seat = p_winner_seat,
           end_reason = p_end_reason,
           ended_at = case when v_ended then now() else null end,
           updated_at = now()
     where id = p_match_id and version = p_expected_version and status = 'active'
    returning version, room_id into v_version, v_room_id;

    if v_version is null then
      return jsonb_build_object('ok', false, 'reason', 'stale',
        'version', (select version from rc_run_ami_matches where id = p_match_id));
    end if;

    update rc_run_ami_match_secrets set state = p_state, updated_at = now()
     where match_id = p_match_id;

    insert into rc_run_ami_events
      (room_id, match_id, version, ord, type, seat, agent_no, action_id, public, private)
    select v_room_id, p_match_id, v_version, e.ord::smallint, e.value->>'type',
           nullif(e.value->>'seat', '')::smallint, p_agent_no,
           case when e.ord = 1 then p_action_id end,
           coalesce(e.value->'pub', '{}'::jsonb), coalesce(e.value->'priv', '{}'::jsonb)
      from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality as e(value, ord);
  exception when unique_violation then
    -- The same action_id landed in a concurrent transaction first.
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end;

  if v_ended then
    update rc_run_ami_match_players mp
       set result = f.result, final_cards = f.final_cards, forfeit_reason = f.forfeit_reason,
           run_ami_calls = f.run_ami_calls, times_caught = f.times_caught,
           catches = f.catches, timeouts = f.timeouts, finished_at = now()
      from jsonb_to_recordset(coalesce(p_final, '[]'::jsonb)) as f(
             seat smallint, result text, final_cards smallint, forfeit_reason text,
             run_ami_calls smallint, times_caught smallint, catches smallint, timeouts smallint)
     where mp.match_id = p_match_id and mp.seat = f.seat;

    update rc_run_ami_rooms
       set status = 'waiting', current_match_id = null, last_match_id = p_match_id,
           version = version + 1, updated_at = now()
     where id = v_room_id and current_match_id = p_match_id;

    -- Seats dropped for disconnecting go back to the room, so the people
    -- still here can start again without them. (Released after the room is
    -- back to waiting, so a room left empty closes.) An agent who has come
    -- back since — heartbeat fresh again, watching as a spectator — keeps
    -- the seat, so they see the result and can play the next round.
    perform rc_run_ami_release_seat(v_room_id, mp.agent_no, 'PLAYER_LEFT')
       from rc_run_ami_match_players mp
       join rc_run_ami_seats s
         on s.room_id = v_room_id and s.agent_no = mp.agent_no and s.left_at is null
      where mp.match_id = p_match_id and mp.forfeit_reason = 'disconnect'
        and s.last_seen_at < now() - make_interval(secs =>
              greatest(coalesce((p_state->'cfg'->>'heartbeatStaleSeconds')::int, 15), 5));
  end if;

  perform rc_run_ami_notify(v_room_id);
  return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

-- Active matches the clock owes something: an expired turn, or a seated
-- player silent (or gone) for longer than p_grace_seconds. The cron sweep
-- settles these even when nobody is polling.
create or replace function public.rc_run_ami_due_matches(p_grace_seconds integer)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id from rc_run_ami_matches m
   where m.status = 'active'
     and (m.turn_deadline_at <= now()
          or exists (
            select 1 from rc_run_ami_match_players mp
             where mp.match_id = m.id
               and mp.result is null
               and coalesce((m.public_state->'seats'->(mp.seat::int)->>'out')::boolean, false) = false
               and not exists (
                 select 1 from rc_run_ami_seats s
                  where s.room_id = m.room_id and s.agent_no = mp.agent_no and s.left_at is null
                    and s.last_seen_at >= now() - make_interval(secs => greatest(p_grace_seconds, 1))
               )
          ))
   limit 200;
$$;

revoke all on function
  public.rc_run_ami_bomb_active(text),
  public.rc_run_ami_notify(uuid),
  public.rc_run_ami_release_seat(uuid, text, text),
  public.rc_run_ami_create_room(text, text, text),
  public.rc_run_ami_join_room(text, text),
  public.rc_run_ami_leave_room(text),
  public.rc_run_ami_touch(text, integer),
  public.rc_run_ami_expire_rooms(integer),
  public.rc_run_ami_start_match(uuid, text, integer, text[], jsonb, jsonb, timestamptz, smallint, jsonb),
  public.rc_run_ami_commit(uuid, integer, jsonb, jsonb, text, timestamptz, smallint, text, jsonb, text, uuid, jsonb),
  public.rc_run_ami_due_matches(integer)
  from public, anon, authenticated;
grant execute on function
  public.rc_run_ami_bomb_active(text),
  public.rc_run_ami_notify(uuid),
  public.rc_run_ami_release_seat(uuid, text, text),
  public.rc_run_ami_create_room(text, text, text),
  public.rc_run_ami_join_room(text, text),
  public.rc_run_ami_leave_room(text),
  public.rc_run_ami_touch(text, integer),
  public.rc_run_ami_expire_rooms(integer),
  public.rc_run_ami_start_match(uuid, text, integer, text[], jsonb, jsonb, timestamptz, smallint, jsonb),
  public.rc_run_ami_commit(uuid, integer, jsonb, jsonb, text, timestamptz, smallint, text, jsonb, text, uuid, jsonb),
  public.rc_run_ami_due_matches(integer)
  to service_role;

-- ── Config ─────────────────────────────────────────────────────────────
-- Admin-editable without a deploy. The resolved values are frozen into each
-- match when it starts (run-ami-rules.js resolveConfig clamps every field).
insert into public.rc_config (key, value)
values ('run_ami', jsonb_build_object(
  'turnSeconds', 30,
  'runAmiGraceMs', 2000,
  'catchPenalty', 2,
  'maxTimeouts', 3,
  'disconnectGraceSeconds', 90,
  'heartbeatStaleSeconds', 15,
  'roomIdleMinutes', 30,
  'catchCooldownMs', 1500
))
on conflict (key) do nothing;
