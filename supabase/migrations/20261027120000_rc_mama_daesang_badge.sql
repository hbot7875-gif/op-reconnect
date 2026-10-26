-- MAMA 2026 · Round 2: a second, Round-2-only badge — "MAMA 2026 · Daesang",
-- for verified votes on 7 different KST days in Round 2 (daily voting was
-- the fan accounts' main ask; Round 1's most regular voters managed 10 days).
--
-- The MAMA 2026 badge is unchanged (5 days across both rounds). A campaign
-- may now list more badges in rewards.extra_badges:
--   [{"template_id": "...", "verified_days": N}]   — days in THIS campaign only.
-- rc_campaign_apply_verified is unchanged otherwise. Art comes from Badge
-- Makers; until art is uploaded the badge is still awarded (art attaches
-- the way every other template's does).

begin;

insert into public.rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values ('event_mama_2026_daesang', 'event', 'rare', 'MAMA 2026 · Daesang',
        'Verified MAMA 2026 Round 2 votes on 7 different days.', 151, true)
on conflict (id) do update set
  name = excluded.name, unlock_hint = excluded.unlock_hint, active = true;

update public.rc_vote_campaigns
   set rewards = rewards || '{"extra_badges": [{"template_id": "event_mama_2026_daesang", "name": "MAMA 2026 · Daesang", "verified_days": 7}]}'::jsonb
 where id = 'mama_2026_r2';

-- Battle Gift milestones from Round 1's real result (2,130 votes in 10 days,
-- ~300 a day by the end; 4 of 5 gifts reached): four reachable at that pace
-- over Round 2's ~11.5 days, the fifth needs the new recruits. Already set in
-- production on 2026-10-27 before any claim; recorded here so the repo matches.
update public.rc_vote_campaigns
   set battle = jsonb_set(battle, '{milestones}', '[400, 1000, 1800, 2700, 3800]'::jsonb)
 where id = 'mama_2026_r2'
   and not exists (select 1 from public.rc_battle_gift_claims where campaign_id = 'mama_2026_r2');

create or replace function public.rc_campaign_apply_verified(p_proof_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.rc_campaign_proofs%rowtype;
  v_c public.rc_vote_campaigns%rowtype;
  v_fill integer;
  v_badge text;
  v_days integer;
  v_scope text[];
  v_own_days integer;
  v_extra jsonb;
  v_filled integer := 0;
  v_team text;
begin
  select * into v_p from rc_campaign_proofs where id = p_proof_id for update;
  if not found or v_p.status <> 'verified' then
    return jsonb_build_object('applied', false, 'reason', 'not_verified');
  end if;
  if v_p.rewarded_at is not null then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;
  select * into v_c from rc_vote_campaigns where id = v_p.campaign_id;

  -- Voting Gift fill.
  v_fill := coalesce((v_c.gift ->> 'fill_per_verified')::integer, 0);
  if v_fill > 0 then
    insert into rc_vote_gift_fills (proof_id, campaign_id, agent_no, mission_id, vote_day, amount)
    values (v_p.id, v_p.campaign_id, v_p.agent_no, v_p.mission_id, v_p.vote_day, v_fill)
    on conflict (proof_id) do nothing;
    if found then
      insert into rc_vote_gift_progress (campaign_id, agent_no, fill, updated_at)
      values (v_p.campaign_id, v_p.agent_no, v_fill, now())
      on conflict (campaign_id, agent_no) do update
        set fill = rc_vote_gift_progress.fill + excluded.fill, updated_at = now();
      v_filled := v_fill;
    end if;
  end if;

  -- Event badge after N different verified voting days (not a streak),
  -- counted over this campaign or the rounds listed in rewards.badge_scope.
  -- rc_award_badge is idempotent per (agent, badge), so it awards once.
  v_badge := nullif(v_c.rewards ->> 'badge_template_id', '');
  v_days := coalesce((v_c.rewards ->> 'badge_verified_days')::integer, 0);
  v_scope := case when jsonb_typeof(v_c.rewards -> 'badge_scope') = 'array'
                  then array(select jsonb_array_elements_text(v_c.rewards -> 'badge_scope')) || v_p.campaign_id
                  else array[v_p.campaign_id] end;
  if v_badge is not null and v_days > 0 and (
    select count(distinct vote_day) from rc_campaign_proofs
     where campaign_id = any (v_scope) and agent_no = v_p.agent_no and status = 'verified'
  ) >= v_days then
    perform rc_award_badge(v_p.agent_no, v_badge, null);
  end if;

  -- Extra badges: N different verified days in THIS campaign only.
  if jsonb_typeof(v_c.rewards -> 'extra_badges') = 'array' then
    select count(distinct vote_day) into v_own_days from rc_campaign_proofs
     where campaign_id = v_p.campaign_id and agent_no = v_p.agent_no and status = 'verified';
    for v_extra in select * from jsonb_array_elements(v_c.rewards -> 'extra_badges') loop
      if nullif(v_extra ->> 'template_id', '') is not null
         and coalesce((v_extra ->> 'verified_days')::integer, 0) > 0
         and v_own_days >= (v_extra ->> 'verified_days')::integer then
        perform rc_award_badge(v_p.agent_no, v_extra ->> 'template_id', null);
      end if;
    end loop;
  end if;

  -- Battle point: only for an agent already on a team, and only before the
  -- battle freezes. A proof verified later still filled the gift above and
  -- counts toward badge days, but can't move a frozen score.
  if coalesce((v_c.battle ->> 'enabled')::boolean, false)
     and now() <= coalesce((v_c.battle ->> 'freeze_at')::timestamptz, v_c.closes_at) then
    select team into v_team from rc_campaign_teams
     where campaign_id = v_p.campaign_id and agent_no = v_p.agent_no and team is not null;
  end if;

  update rc_campaign_proofs set rewarded_at = now(), battle_team = v_team where id = v_p.id;
  return jsonb_build_object('applied', true, 'giftFill', v_filled, 'battleTeam', v_team);
end;
$$;

commit;
