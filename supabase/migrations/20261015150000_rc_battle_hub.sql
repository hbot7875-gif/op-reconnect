-- MAMA Event Hub: Team (a private roster of the caller's own team) and Chat
-- (one room for HOOLIGANS and ALIENS, with system "moments").
--
-- Same access model as the RE:CELEBRATE party chat (20260920113000): RLS on,
-- no client grants, the Edge Function is the only reader/writer. Clients get
-- codenames, team ids and an opaque per-event member_key — never agent_no.
-- Everything an agent wrote is removed with their agent row (cascade).

-- ── Membership extras (per event) ────────────────────────────────────
alter table public.rc_campaign_teams
  add column if not exists member_key uuid not null default gen_random_uuid(),
  -- "Show my Instagram username to my team": off unless switched on.
  add column if not exists show_ig boolean not null default false,
  add column if not exists show_ig_at timestamptz,
  -- Hub heartbeat (Team / Chat polls), for the online counts only.
  add column if not exists last_seen_at timestamptz,
  -- Admin timeout: can read Chat, can't post or react until then.
  add column if not exists chat_timeout_until timestamptz;
create unique index if not exists rc_campaign_teams_member_key_idx on public.rc_campaign_teams (member_key);

-- ── Chat ─────────────────────────────────────────────────────────────
create table if not exists public.rc_battle_chat (
  id          bigint generated always as identity primary key,
  campaign_id text not null references public.rc_vote_campaigns (id),
  kind        text not null check (kind in ('player', 'system')),
  agent_no    text references public.rc_agents (agent_no) on delete cascade,
  team        text check (team ~ '^[a-z0-9_]{1,24}$'),
  body        text not null check (char_length(body) between 1 and 200),
  reply_to    bigint references public.rc_battle_chat (id) on delete set null,
  -- System moments only: 'lead:hooligans:…', 'tie:…', 'gift:2200:25', 'final:3'.
  system_key  text,
  status      text not null default 'visible' check (status in ('visible', 'auto_hidden', 'removed')),
  created_at  timestamptz not null default now(),
  constraint rc_battle_chat_author check ((kind = 'system') = (agent_no is null)),
  constraint rc_battle_chat_system_key check ((kind = 'system') = (system_key is not null)),
  constraint rc_battle_chat_moment_once unique (campaign_id, system_key)
);
create index if not exists rc_battle_chat_feed_idx on public.rc_battle_chat (campaign_id, id desc);
create index if not exists rc_battle_chat_agent_idx on public.rc_battle_chat (agent_no, created_at desc);

create table if not exists public.rc_battle_chat_reactions (
  message_id bigint not null references public.rc_battle_chat (id) on delete cascade,
  agent_no   text not null references public.rc_agents (agent_no) on delete cascade,
  emoji      text not null check (emoji in ('💜', '🔥', '😂', '👏', '😭', '🫡')),
  created_at timestamptz not null default now(),
  primary key (message_id, agent_no, emoji)
);
create index if not exists rc_battle_chat_reactions_agent_idx on public.rc_battle_chat_reactions (agent_no, created_at desc);

create table if not exists public.rc_battle_chat_reports (
  message_id    bigint not null references public.rc_battle_chat (id) on delete cascade,
  reporter      text not null references public.rc_agents (agent_no) on delete cascade,
  reporter_team text,
  reason        text not null check (reason in ('harassment', 'hate', 'sexual', 'personal_info', 'spam', 'other')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  primary key (message_id, reporter)
);

-- Personal mutes: hide that member's messages and reactions for the muter only.
create table if not exists public.rc_battle_chat_mutes (
  campaign_id text not null references public.rc_vote_campaigns (id),
  muter       text not null references public.rc_agents (agent_no) on delete cascade,
  muted       text not null references public.rc_agents (agent_no) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, muter, muted)
);

alter table public.rc_battle_chat enable row level security;
alter table public.rc_battle_chat_reactions enable row level security;
alter table public.rc_battle_chat_reports enable row level security;
alter table public.rc_battle_chat_mutes enable row level security;
revoke all on public.rc_battle_chat, public.rc_battle_chat_reactions, public.rc_battle_chat_reports, public.rc_battle_chat_mutes
  from anon, authenticated;

-- ── Team roster: the caller's own team, nothing else ────────────────
create or replace function public.rc_battle_team_roster(p_campaign_id text, p_agent_no text, p_day date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  me rc_campaign_teams;
  n integer;
  online integer;
  members jsonb;
begin
  select * into me from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no;
  if me.team is null then
    return jsonb_build_object('team', null);
  end if;
  update rc_campaign_teams set last_seen_at = now()
   where campaign_id = p_campaign_id and agent_no = p_agent_no
     and (last_seen_at is null or last_seen_at < now() - interval '45 seconds');

  select count(*), count(*) filter (where agent_no = p_agent_no or last_seen_at >= now() - interval '2 minutes')
    into n, online
    from rc_campaign_teams where campaign_id = p_campaign_id and team = me.team;

  select coalesce(jsonb_agg(m.item order by m.is_me desc, m.sort, m.member_key), '[]'::jsonb) into members
    from (
      select jsonb_build_object(
               'codename', coalesce(nullif(btrim(p.codename), ''), 'Agent'),
               'ig', case when t.show_ig and a.handle ~ '^@?[A-Za-z0-9._]{1,30}$' then ltrim(a.handle, '@') end,
               'votedToday', exists (select 1 from rc_campaign_proofs pr
                                      where pr.campaign_id = t.campaign_id and pr.agent_no = t.agent_no
                                        and pr.vote_day = p_day and pr.status = 'verified'),
               'me', t.agent_no = p_agent_no) as item,
             t.agent_no = p_agent_no as is_me,
             lower(coalesce(p.codename, '')) as sort,
             t.member_key
        from rc_campaign_teams t
        join rc_agents a on a.agent_no = t.agent_no
        left join rc_players p on p.agent_no = t.agent_no
       where t.campaign_id = p_campaign_id and t.team = me.team
       order by t.agent_no = p_agent_no desc, lower(coalesce(p.codename, '')), t.member_key
       limit 500
    ) m;

  return jsonb_build_object('team', me.team, 'showIg', me.show_ig, 'count', n, 'online', online, 'members', members);
end $$;

-- ── Chat feed: the latest messages as the caller should see them ─────
create or replace function public.rc_battle_chat_feed(p_campaign_id text, p_agent_no text, p_limit integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  me rc_campaign_teams;
  msgs jsonb;
  moments jsonb;
  presence jsonb;
  muted jsonb;
begin
  select * into me from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no;
  if me.team is null then
    return jsonb_build_object('team', null);
  end if;
  update rc_campaign_teams set last_seen_at = now()
   where campaign_id = p_campaign_id and agent_no = p_agent_no
     and (last_seen_at is null or last_seen_at < now() - interval '45 seconds');

  with recent as (
    select c.* from rc_battle_chat c
     where c.campaign_id = p_campaign_id
       and (c.kind = 'system' or c.agent_no = p_agent_no or (
             not exists (select 1 from rc_battle_chat_mutes mu
                          where mu.campaign_id = p_campaign_id and mu.muter = p_agent_no and mu.muted = c.agent_no)
         and not exists (select 1 from rc_battle_chat_reports r
                          where r.message_id = c.id and r.reporter = p_agent_no)))
     order by c.id desc
     limit greatest(1, least(p_limit, 100))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'kind', c.kind,
           'sys', case when c.kind = 'system' then split_part(c.system_key, ':', 1) end,
           'team', c.team,
           'codename', case when c.kind = 'player' then coalesce(nullif(btrim(p.codename), ''), 'Agent') end,
           'memberKey', t.member_key,
           'body', case when c.status = 'visible' then c.body end,
           'status', c.status,
           'mine', c.agent_no = p_agent_no,
           'at', c.created_at,
           'replyTo', case when q.id is not null then jsonb_build_object(
                        'id', q.id, 'team', q.team,
                        'codename', coalesce(nullif(btrim(qp.codename), ''), 'Agent'),
                        'body', case when q.status = 'visible' then left(q.body, 80) end) end,
           'reactions', coalesce((select jsonb_object_agg(x.emoji, x.n) from (
                          select r.emoji, count(*) as n from rc_battle_chat_reactions r
                           where r.message_id = c.id
                             and not exists (select 1 from rc_battle_chat_mutes mu
                                              where mu.campaign_id = p_campaign_id and mu.muter = p_agent_no and mu.muted = r.agent_no)
                           group by r.emoji) x), '{}'::jsonb),
           'myReactions', coalesce((select jsonb_agg(r.emoji order by r.emoji) from rc_battle_chat_reactions r
                                     where r.message_id = c.id and r.agent_no = p_agent_no), '[]'::jsonb)
         ) order by c.id), '[]'::jsonb) into msgs
    from recent c
    left join rc_players p on p.agent_no = c.agent_no
    left join rc_campaign_teams t on t.campaign_id = p_campaign_id and t.agent_no = c.agent_no
    left join rc_battle_chat q on q.id = c.reply_to
    left join rc_players qp on qp.agent_no = q.agent_no;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'sys', split_part(s.system_key, ':', 1), 'team', s.team, 'body', s.body, 'at', s.created_at) order by s.id desc), '[]'::jsonb)
    into moments
    from (select * from rc_battle_chat where campaign_id = p_campaign_id and kind = 'system' order by id desc limit 6) s;

  select coalesce(jsonb_object_agg(x.team, x.n), '{}'::jsonb) into presence
    from (select team, count(*) as n from rc_campaign_teams
           where campaign_id = p_campaign_id and team is not null
             and (agent_no = p_agent_no or last_seen_at >= now() - interval '2 minutes')
           group by team) x;

  select coalesce(jsonb_agg(jsonb_build_object('memberKey', t.member_key, 'codename', coalesce(nullif(btrim(p.codename), ''), 'Agent')) order by mu.created_at), '[]'::jsonb)
    into muted
    from rc_battle_chat_mutes mu
    join rc_campaign_teams t on t.campaign_id = mu.campaign_id and t.agent_no = mu.muted
    left join rc_players p on p.agent_no = mu.muted
   where mu.campaign_id = p_campaign_id and mu.muter = p_agent_no;

  return jsonb_build_object(
    'team', me.team, 'messages', msgs, 'moments', moments, 'presence', presence, 'muted', muted,
    'timeoutUntil', case when me.chat_timeout_until > now() then me.chat_timeout_until end);
end $$;

-- ── Send: team, open room, timeout, slow mode and repeats, atomically ─
-- Slow mode: one message every 5 s and at most 6 a minute per player; when
-- the whole room passes 60 messages a minute, one every 15 s.
create or replace function public.rc_battle_chat_send(p_campaign_id text, p_agent_no text, p_body text, p_reply_to bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c rc_vote_campaigns;
  me rc_campaign_teams;
  last_at timestamptz;
  last_body text;
  minute_count integer;
  oldest timestamptz;
  room integer;
  gap interval := interval '5 seconds';
  wait numeric;
  reply bigint;
  new_id bigint;
begin
  select * into c from rc_vote_campaigns where id = p_campaign_id and active;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'no_campaign'); end if;
  if now() < c.opens_at or now() >= c.closes_at then return jsonb_build_object('ok', false, 'error', 'chat_closed'); end if;
  if coalesce((c.battle ->> 'chat_paused')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'chat_paused'); end if;
  if char_length(coalesce(p_body, '')) not between 1 and 200 then return jsonb_build_object('ok', false, 'error', 'bad_length'); end if;

  -- One sender at a time per agent, so two quick taps can't both pass the gap.
  perform pg_advisory_xact_lock(hashtext('rc_battle_chat:' || p_agent_no));

  select * into me from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no;
  if me.team is null then return jsonb_build_object('ok', false, 'error', 'team_required'); end if;
  if me.chat_timeout_until > now() then
    return jsonb_build_object('ok', false, 'error', 'timed_out', 'until', me.chat_timeout_until);
  end if;

  select count(*) into room from rc_battle_chat
   where campaign_id = p_campaign_id and kind = 'player' and created_at > now() - interval '60 seconds';
  if room > 60 then gap := interval '15 seconds'; end if;

  select created_at, body into last_at, last_body from rc_battle_chat
   where campaign_id = p_campaign_id and agent_no = p_agent_no order by id desc limit 1;
  if last_at is not null and last_at > now() - gap then
    wait := ceil(extract(epoch from (last_at + gap - now())));
    return jsonb_build_object('ok', false, 'error', 'slow_down', 'wait', greatest(1, wait));
  end if;
  select count(*), min(created_at) into minute_count, oldest from rc_battle_chat
   where campaign_id = p_campaign_id and agent_no = p_agent_no and created_at > now() - interval '60 seconds';
  if minute_count >= 6 then
    wait := ceil(extract(epoch from (oldest + interval '60 seconds' - now())));
    return jsonb_build_object('ok', false, 'error', 'slow_down', 'wait', greatest(1, wait));
  end if;
  if last_at > now() - interval '2 minutes' and lower(btrim(last_body)) = lower(btrim(p_body)) then
    return jsonb_build_object('ok', false, 'error', 'repeat');
  end if;

  select id into reply from rc_battle_chat where id = p_reply_to and campaign_id = p_campaign_id;
  insert into rc_battle_chat (campaign_id, kind, agent_no, team, body, reply_to)
  values (p_campaign_id, 'player', p_agent_no, me.team, p_body, reply)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

-- ── React (toggle), 30 a minute ─────────────────────────────────────
create or replace function public.rc_battle_chat_react(p_campaign_id text, p_agent_no text, p_message_id bigint, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  me rc_campaign_teams;
  recent integer;
begin
  select * into me from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no;
  if me.team is null then return jsonb_build_object('ok', false, 'error', 'team_required'); end if;
  if me.chat_timeout_until > now() then return jsonb_build_object('ok', false, 'error', 'timed_out', 'until', me.chat_timeout_until); end if;
  if p_emoji not in ('💜', '🔥', '😂', '👏', '😭', '🫡') then return jsonb_build_object('ok', false, 'error', 'bad_emoji'); end if;
  if not exists (select 1 from rc_battle_chat where id = p_message_id and campaign_id = p_campaign_id and status = 'visible') then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  delete from rc_battle_chat_reactions where message_id = p_message_id and agent_no = p_agent_no and emoji = p_emoji;
  if found then return jsonb_build_object('ok', true, 'on', false); end if;
  select count(*) into recent from rc_battle_chat_reactions where agent_no = p_agent_no and created_at > now() - interval '60 seconds';
  if recent >= 30 then return jsonb_build_object('ok', false, 'error', 'slow_down', 'wait', 10); end if;
  insert into rc_battle_chat_reactions (message_id, agent_no, emoji) values (p_message_id, p_agent_no, p_emoji)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'on', true);
end $$;

-- ── Report: hidden for the reporter at once; for everyone at 3 reports
-- when one comes from the sender's own team, otherwise at 5 ────────────
create or replace function public.rc_battle_chat_report(p_campaign_id text, p_agent_no text, p_message_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  me rc_campaign_teams;
  m rc_battle_chat;
  total integer;
  own integer;
begin
  select * into me from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no;
  if me.team is null then return jsonb_build_object('ok', false, 'error', 'team_required'); end if;
  if p_reason not in ('harassment', 'hate', 'sexual', 'personal_info', 'spam', 'other') then
    return jsonb_build_object('ok', false, 'error', 'bad_reason');
  end if;
  select * into m from rc_battle_chat where id = p_message_id and campaign_id = p_campaign_id for update;
  if m.id is null or m.kind <> 'player' then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if m.agent_no = p_agent_no then return jsonb_build_object('ok', false, 'error', 'own_message'); end if;

  insert into rc_battle_chat_reports (message_id, reporter, reporter_team, reason)
  values (p_message_id, p_agent_no, me.team, p_reason) on conflict do nothing;

  select count(*), count(*) filter (where reporter_team = m.team) into total, own
    from rc_battle_chat_reports where message_id = p_message_id;
  if m.status = 'visible' and ((total >= 3 and own >= 1) or total >= 5) then
    update rc_battle_chat set status = 'auto_hidden' where id = p_message_id;
    return jsonb_build_object('ok', true, 'hidden', true);
  end if;
  return jsonb_build_object('ok', true, 'hidden', m.status <> 'visible');
end $$;

-- ── Mute / unmute by member_key (never by agent number) ─────────────
create or replace function public.rc_battle_chat_mute(p_campaign_id text, p_agent_no text, p_member_key uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  target text;
begin
  if not exists (select 1 from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no and team is not null) then
    return jsonb_build_object('ok', false, 'error', 'team_required');
  end if;
  select agent_no into target from rc_campaign_teams where campaign_id = p_campaign_id and member_key = p_member_key;
  if target is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if target = p_agent_no then return jsonb_build_object('ok', false, 'error', 'own_message'); end if;
  if p_on then
    insert into rc_battle_chat_mutes (campaign_id, muter, muted) values (p_campaign_id, p_agent_no, target) on conflict do nothing;
  else
    delete from rc_battle_chat_mutes where campaign_id = p_campaign_id and muter = p_agent_no and muted = target;
  end if;
  return jsonb_build_object('ok', true, 'muted', p_on);
end $$;

revoke all on function public.rc_battle_team_roster(text, text, date) from public, anon, authenticated;
revoke all on function public.rc_battle_chat_feed(text, text, integer) from public, anon, authenticated;
revoke all on function public.rc_battle_chat_send(text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.rc_battle_chat_react(text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.rc_battle_chat_report(text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.rc_battle_chat_mute(text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.rc_battle_team_roster(text, text, date) to service_role;
grant execute on function public.rc_battle_chat_feed(text, text, integer) to service_role;
grant execute on function public.rc_battle_chat_send(text, text, text, bigint) to service_role;
grant execute on function public.rc_battle_chat_react(text, text, bigint, text) to service_role;
grant execute on function public.rc_battle_chat_report(text, text, bigint, text) to service_role;
grant execute on function public.rc_battle_chat_mute(text, text, uuid, boolean) to service_role;

-- ── Retention: Chat goes 30 days after its event ends (privacy.html),
-- like event proof screenshots. Reactions and reports go with their
-- messages (cascade); mutes and the Instagram choice go too. ─────────────
create or replace function public.rc_battle_chat_retention()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n integer;
begin
  delete from rc_battle_chat c using rc_vote_campaigns v
   where v.id = c.campaign_id and v.closes_at < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from rc_battle_chat_mutes m using rc_vote_campaigns v
   where v.id = m.campaign_id and v.closes_at < now() - interval '30 days';
  update rc_campaign_teams t set show_ig = false, show_ig_at = null
    from rc_vote_campaigns v
   where v.id = t.campaign_id and v.closes_at < now() - interval '30 days' and t.show_ig;
  return n;
end $$;
revoke all on function public.rc_battle_chat_retention() from public, anon, authenticated;
grant execute on function public.rc_battle_chat_retention() to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('rc-battle-chat-retention');
    exception when others then
      null; -- not scheduled yet, which is the normal case
    end;
    perform cron.schedule('rc-battle-chat-retention', '23 3 * * *', 'select public.rc_battle_chat_retention()');
  end if;
end $$;

comment on table public.rc_battle_chat is
  'MAMA Event Hub Chat: one room for both teams, plus paced system moments. Edge Function access only; clients see codename, team and member_key, never agent_no.';
