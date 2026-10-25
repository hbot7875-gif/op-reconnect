-- RUN AMI: watchers, and real-time chat.
--
-- Watchers. A room code can now seat you OR let you watch. A watcher sees the
-- live table (no one's hand — lib/run-ami-view.js viewForSpectator), the
-- lobby and the room chat, and can chat; they can't act, can't hold up a
-- round and don't take one of the four seats. Watching works mid-match and in
-- a full room, needs no ARMY Bomb (it powers nothing), and is capped per room.
-- Taking a seat (rc_run_ami_join_room) or creating a room ends a watch, so an
-- agent is never both; a room closing ends every watch in it.
--
-- Real-time chat. Chat used to ride the 4s poll only. rc_run_ami_ping
-- broadcasts {k} on the room's topic after every chat message and watcher
-- change — a nudge to refetch, like rc_run_ami_notify, never the message
-- itself. It deliberately leaves the room version alone: startMatch's
-- version check must not go stale because someone said hi or sat down to
-- watch.
--
-- Same posture as the rest of RUN AMI: RLS on, no browser grants, functions
-- for service_role only.

create table if not exists public.rc_run_ami_watchers (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rc_run_ami_rooms(id) on delete cascade,
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz
);
-- One watch per agent at a time.
create unique index if not exists rc_run_ami_watchers_one_per_agent
  on public.rc_run_ami_watchers (agent_no) where left_at is null;
create index if not exists rc_run_ami_watchers_room_idx
  on public.rc_run_ami_watchers (room_id) where left_at is null;

alter table public.rc_run_ami_watchers enable row level security;
revoke all on public.rc_run_ami_watchers from public, anon, authenticated;

-- Which messages came from someone watching (shown as a tag in the chat).
alter table public.rc_run_ami_chat add column if not exists watching boolean not null default false;

-- Nudge the room to refetch without touching any version. `p_kind` is a
-- one-letter hint ('c' chat, 'w' watchers) the client only logs.
create or replace function public.rc_run_ami_ping(p_room_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic text;
begin
  select topic into v_topic from rc_run_ami_rooms where id = p_room_id;
  if v_topic is null then return; end if;
  begin
    perform realtime.send(jsonb_build_object('k', left(coalesce(p_kind, ''), 1)), 'p', 'run-ami:' || v_topic, false);
  exception when others then
    null;  -- a nudge; polling covers a missed one
  end;
end;
$$;

-- Watch the room with this code. Seated agents can't also watch; an agent
-- watching another room moves here.
create or replace function public.rc_run_ami_watch_room(p_agent_no text, p_code text, p_max_watchers integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room rc_run_ami_rooms%rowtype;
  v_seated uuid;
  v_old uuid;
begin
  select * into v_room from rc_run_ami_rooms
   where code = upper(p_code) and status <> 'closed' for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'room_not_found');
  end if;

  select room_id into v_seated from rc_run_ami_seats
   where agent_no = p_agent_no and left_at is null;
  if v_seated = v_room.id then
    return jsonb_build_object('ok', true, 'room_id', v_room.id, 'already', true, 'seated', true);
  elsif v_seated is not null then
    return jsonb_build_object('ok', false, 'error', 'already_seated');
  end if;

  select room_id into v_old from rc_run_ami_watchers
   where agent_no = p_agent_no and left_at is null for update;
  if v_old = v_room.id then
    update rc_run_ami_watchers set last_seen_at = now()
     where agent_no = p_agent_no and left_at is null;
    return jsonb_build_object('ok', true, 'room_id', v_room.id, 'already', true);
  end if;

  if (select count(*) from rc_run_ami_watchers where room_id = v_room.id and left_at is null)
       >= greatest(coalesce(p_max_watchers, 20), 1) then
    return jsonb_build_object('ok', false, 'error', 'watchers_full');
  end if;

  if v_old is not null then
    update rc_run_ami_watchers set left_at = now() where agent_no = p_agent_no and left_at is null;
    perform rc_run_ami_ping(v_old, 'w');
  end if;

  begin
    insert into rc_run_ami_watchers (room_id, agent_no) values (v_room.id, p_agent_no);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_watching');
  end;
  perform rc_run_ami_ping(v_room.id, 'w');
  return jsonb_build_object('ok', true, 'room_id', v_room.id);
end;
$$;

create or replace function public.rc_run_ami_unwatch(p_agent_no text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  update rc_run_ami_watchers set left_at = now()
   where agent_no = p_agent_no and left_at is null
  returning room_id into v_room;
  if v_room is not null then perform rc_run_ami_ping(v_room, 'w'); end if;
  return jsonb_build_object('ok', true, 'room_id', v_room);
end;
$$;

-- Heartbeat for a watcher. A watch on a closed room, or one nobody has
-- touched for p_idle_minutes, ends here instead of reviving later.
create or replace function public.rc_run_ami_watch_touch(p_agent_no text, p_idle_minutes integer default 30)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_seen timestamptz;
  v_status text;
begin
  select w.room_id, w.last_seen_at, r.status into v_room, v_seen, v_status
    from rc_run_ami_watchers w join rc_run_ami_rooms r on r.id = w.room_id
   where w.agent_no = p_agent_no and w.left_at is null
   for update of w;
  if v_room is null then return null; end if;
  if v_status = 'closed' or v_seen < now() - make_interval(mins => greatest(coalesce(p_idle_minutes, 30), 1)) then
    update rc_run_ami_watchers set left_at = now() where agent_no = p_agent_no and left_at is null;
    return null;
  end if;
  update rc_run_ami_watchers set last_seen_at = now() where agent_no = p_agent_no and left_at is null;
  return v_room;
end;
$$;

-- A closed room ends every watch in it.
create or replace function public.rc_run_ami_watchers_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update rc_run_ami_watchers set left_at = now() where room_id = new.id and left_at is null;
  return new;
end;
$$;

drop trigger if exists rc_run_ami_watchers_release on public.rc_run_ami_rooms;
create trigger rc_run_ami_watchers_release
  after update of status on public.rc_run_ami_rooms
  for each row when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function public.rc_run_ami_watchers_release();

-- Unchanged from 20261018120000 except: creating a room ends a watch.
create or replace function public.rc_run_ami_create_room(p_agent_no text, p_code text, p_topic text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_watched uuid;
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

  update rc_run_ami_watchers set left_at = now()
   where agent_no = p_agent_no and left_at is null
  returning room_id into v_watched;
  if v_watched is not null then perform rc_run_ami_ping(v_watched, 'w'); end if;

  insert into rc_run_ami_events (room_id, type, agent_no, seat)
  values (v_room_id, 'PLAYER_JOINED', p_agent_no, 0);
  return jsonb_build_object('ok', true, 'room_id', v_room_id);
end;
$$;

-- Unchanged from 20261018120000 except: taking a seat ends a watch — so a
-- watcher can sit in when a seat is free between rounds.
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
  v_watched uuid;
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

  update rc_run_ami_watchers set left_at = now()
   where agent_no = p_agent_no and left_at is null
  returning room_id into v_watched;
  if v_watched is not null and v_watched <> v_room.id then perform rc_run_ami_ping(v_watched, 'w'); end if;

  insert into rc_run_ami_events (room_id, type, agent_no, seat)
  values (v_room.id, 'PLAYER_JOINED', p_agent_no, v_seat);
  update rc_run_ami_rooms set version = version + 1, updated_at = now() where id = v_room.id;
  perform rc_run_ami_notify(v_room.id);
  return jsonb_build_object('ok', true, 'room_id', v_room.id);
end;
$$;

-- Unchanged from 20261018150000 except: a watcher may send too (tagged), and
-- every message pings the room so it shows up at once.
create or replace function public.rc_run_ami_chat_send(p_agent_no text, p_kind text, p_body text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_watching boolean := false;
  v_id bigint;
begin
  select s.room_id into v_room
    from rc_run_ami_seats s
    join rc_run_ami_rooms r on r.id = s.room_id
   where s.agent_no = p_agent_no and s.left_at is null and r.status <> 'closed';
  if v_room is null then
    select w.room_id into v_room
      from rc_run_ami_watchers w
      join rc_run_ami_rooms r on r.id = w.room_id
     where w.agent_no = p_agent_no and w.left_at is null and r.status <> 'closed';
    v_watching := v_room is not null;
  end if;
  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'not_in_room');
  end if;
  if p_kind not in ('text', 'react') or coalesce(char_length(p_body), 0) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'error', 'chat_text');
  end if;

  insert into rc_run_ami_chat (room_id, agent_no, name, kind, body, watching)
  values (v_room, p_agent_no, left(coalesce(nullif(p_name, ''), 'AGENT'), 40), p_kind, p_body, v_watching)
  returning id into v_id;

  delete from rc_run_ami_chat
   where room_id = v_room
     and (created_at < now() - interval '12 hours'
          or id < (select min(id) from (select id from rc_run_ami_chat where room_id = v_room order by id desc limit 100) newest));
  perform rc_run_ami_ping(v_room, 'c');
  return jsonb_build_object('ok', true, 'id', v_id, 'room_id', v_room);
end;
$$;

revoke all on function public.rc_run_ami_ping(uuid, text) from public, anon, authenticated;
revoke all on function public.rc_run_ami_watch_room(text, text, integer) from public, anon, authenticated;
revoke all on function public.rc_run_ami_unwatch(text) from public, anon, authenticated;
revoke all on function public.rc_run_ami_watch_touch(text, integer) from public, anon, authenticated;
revoke all on function public.rc_run_ami_watchers_release() from public, anon, authenticated;
revoke all on function public.rc_run_ami_create_room(text, text, text) from public, anon, authenticated;
revoke all on function public.rc_run_ami_join_room(text, text) from public, anon, authenticated;
revoke all on function public.rc_run_ami_chat_send(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rc_run_ami_watch_room(text, text, integer) to service_role;
grant execute on function public.rc_run_ami_unwatch(text) to service_role;
grant execute on function public.rc_run_ami_watch_touch(text, integer) to service_role;
grant execute on function public.rc_run_ami_create_room(text, text, text) to service_role;
grant execute on function public.rc_run_ami_join_room(text, text) to service_role;
grant execute on function public.rc_run_ami_chat_send(text, text, text, text) to service_role;
