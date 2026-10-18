-- RUN AMI: room chat.
--
-- Players in the same room (lobby or match) can send short messages and
-- quick reactions. Reads ride on the state RUN AMI already polls every 4s
-- (run-ami-service.js buildView reads the newest 30 rows); there is no
-- Realtime and no extra request. Text is filtered in the Edge Function
-- (run-ami-chat-rules.js, which reuses the Battle chat filter); this table
-- only enforces length, kind, room membership and retention.
--
-- Retention: a room's chat is deleted the moment the room closes (trigger
-- below), and a send keeps at most the newest 100 rows per room, none older
-- than 12 hours. Agent numbers are stored to find rows and are never
-- returned to a browser; each row carries the codename it was sent under.
--
-- Same posture as the rest of RUN AMI: RLS on, no browser grants, functions
-- for service_role only.

create table if not exists public.rc_run_ami_chat (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rc_run_ami_rooms(id) on delete cascade,
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  kind text not null check (kind in ('text', 'react')),
  body text not null check (char_length(body) between 1 and 120),
  created_at timestamptz not null default now()
);
create index if not exists rc_run_ami_chat_room_idx on public.rc_run_ami_chat (room_id, id desc);

alter table public.rc_run_ami_chat enable row level security;
revoke all on public.rc_run_ami_chat from public, anon, authenticated;

-- Send one message as `p_agent_no` into the room they are seated in now.
create or replace function public.rc_run_ami_chat_send(p_agent_no text, p_kind text, p_body text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
  v_id bigint;
begin
  select s.room_id into v_room
    from rc_run_ami_seats s
    join rc_run_ami_rooms r on r.id = s.room_id
   where s.agent_no = p_agent_no and s.left_at is null and r.status <> 'closed';
  if v_room is null then
    return jsonb_build_object('ok', false, 'error', 'not_in_room');
  end if;
  if p_kind not in ('text', 'react') or coalesce(char_length(p_body), 0) not between 1 and 120 then
    return jsonb_build_object('ok', false, 'error', 'chat_text');
  end if;

  insert into rc_run_ami_chat (room_id, agent_no, name, kind, body)
  values (v_room, p_agent_no, left(coalesce(nullif(p_name, ''), 'AGENT'), 40), p_kind, p_body)
  returning id into v_id;

  delete from rc_run_ami_chat
   where room_id = v_room
     and (created_at < now() - interval '12 hours'
          or id < (select min(id) from (select id from rc_run_ami_chat where room_id = v_room order by id desc limit 100) newest));
  return jsonb_build_object('ok', true, 'id', v_id, 'room_id', v_room);
end;
$$;

-- A closed room takes its chat with it.
create or replace function public.rc_run_ami_chat_clear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rc_run_ami_chat where room_id = new.id;
  return new;
end;
$$;

drop trigger if exists rc_run_ami_chat_clear on public.rc_run_ami_rooms;
create trigger rc_run_ami_chat_clear
  after update of status on public.rc_run_ami_rooms
  for each row when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function public.rc_run_ami_chat_clear();

revoke all on function public.rc_run_ami_chat_send(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rc_run_ami_chat_clear() from public, anon, authenticated;
grant execute on function public.rc_run_ami_chat_send(text, text, text, text) to service_role;
