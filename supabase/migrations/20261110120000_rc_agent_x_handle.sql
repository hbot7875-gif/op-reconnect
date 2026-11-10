-- X (Twitter) username on the agent file; sign-up takes Instagram or X.
--
-- * Sign-up asks for an Instagram username, an X username, or both (at least
--   one). The Instagram username stays the account name (rc_agents.handle)
--   when given, exactly as before. With only X, the X username becomes the
--   account name and rc_agents.handle_source = 'x', so it is never shown as
--   an Instagram link. Every existing row is 'instagram' (the default).
--
-- * rc_agents.x_handle: nullable, stored lowercase without the @ (X names are
--   case-insensitive), the same shape rc_agent_x_handles already uses. Asked
--   at sign-up and editable in Settings; required only when Instagram is blank.
-- * One agent per X username: a partial unique index, so any number of
--   agents can leave it blank.
-- * Visibility: the player, the admin tools, and their own team's roster in
--   a fan battle (next to the Instagram username). Never Chat or public.
-- * rc_agents keeps RLS on with zero policies, so anon/authenticated still
--   cannot read it; only the Edge Function (service_role) touches it.
-- * Event voting accounts (rc_agent_x_handles) are untouched and separate.
--   The police check compares the two (lib/police-check.ts).
-- No existing row's data changes (handle_source defaults to 'instagram').

alter table public.rc_agents add column if not exists x_handle text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rc_agents_x_handle_format') then
    alter table public.rc_agents add constraint rc_agents_x_handle_format
      check (x_handle is null or x_handle ~ '^[a-z0-9_]{1,15}$');
  end if;
end $$;

alter table public.rc_agents add column if not exists handle_source text not null default 'instagram';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rc_agents_handle_source_check') then
    alter table public.rc_agents add constraint rc_agents_handle_source_check
      check (handle_source in ('instagram', 'x'));
  end if;
end $$;

create unique index if not exists rc_agents_x_handle_key
  on public.rc_agents (x_handle) where x_handle is not null;

comment on column public.rc_agents.x_handle is
  'Optional X (Twitter) username, lowercase, no @. Unique when set. Shown only to the owner, admins and their own battle team.';

-- Team roster: same as 20261016150000, plus each teammate's X username, and
-- the Instagram link only when the account name really is an Instagram one.
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
               'ig', case when a.handle_source = 'instagram' and a.handle ~ '^@?[A-Za-z0-9._]{1,30}$' then ltrim(a.handle, '@') end,
               'x', case when a.x_handle ~ '^[a-z0-9_]{1,15}$' then a.x_handle end,
               'today', (select count(*) from rc_campaign_proofs pr
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

  return jsonb_build_object('team', me.team, 'showIg', true, 'count', n, 'online', online, 'members', members);
end $$;

revoke all on function public.rc_battle_team_roster(text, text, date) from public, anon, authenticated;
grant execute on function public.rc_battle_team_roster(text, text, date) to service_role;
