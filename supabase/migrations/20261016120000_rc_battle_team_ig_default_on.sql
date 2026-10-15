-- MAMA Event Hub · Team: Instagram usernames are now ON by default, and
-- each player can switch theirs off. A username shows to the player's own
-- team when they switched it on, or have never chosen (show_ig_at is null).
-- An explicit "off" (show_ig false with show_ig_at set) is always respected.
-- Still own team only and Team only; never in Chat or anywhere public.
-- privacy.html and the switch wording say "on by default".

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
               'ig', case when (t.show_ig or t.show_ig_at is null) and a.handle ~ '^@?[A-Za-z0-9._]{1,30}$' then ltrim(a.handle, '@') end,
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

  return jsonb_build_object('team', me.team, 'showIg', (me.show_ig or me.show_ig_at is null), 'count', n, 'online', online, 'members', members);
end $$;

revoke all on function public.rc_battle_team_roster(text, text, date) from public, anon, authenticated;
grant execute on function public.rc_battle_team_roster(text, text, date) to service_role;

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
  -- Recorded as an explicit "off" (show_ig_at set): with the default now
  -- "on unless chosen", a cleared choice must not read as on again.
  update rc_campaign_teams t set show_ig = false, show_ig_at = now()
    from rc_vote_campaigns v
   where v.id = t.campaign_id and v.closes_at < now() - interval '30 days'
     and (t.show_ig or t.show_ig_at is null);
  return n;
end $$;

revoke all on function public.rc_battle_chat_retention() from public, anon, authenticated;
grant execute on function public.rc_battle_chat_retention() to service_role;
