-- MAMA Event Hub · Team: every teammate's Instagram username shows to
-- their own team (a fan battle the players joined for this). The hide
-- switch is gone; show_ig / show_ig_at are no longer read here. Still own
-- team only and Team only — never Chat or anywhere public.

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
               'ig', case when a.handle ~ '^@?[A-Za-z0-9._]{1,30}$' then ltrim(a.handle, '@') end,
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
