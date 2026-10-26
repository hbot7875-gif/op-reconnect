-- MAMA 2026 · Round 2 (Fans' Choice 2nd VOTE + Fans' Choice of the Year
-- with VISA, the Daesang), and the MAMA Battle again.
--
-- Official schedule (@MnetMAMA 2nd VOTE GUIDE): 26.10.28 18:00 –
-- 26.11.08 23:59 KST, on Mnet Plus and on X.
--
-- What is new, and nothing else moves:
--   * a second campaign row, mama_2026_r2. Every Round 1 table is keyed by
--     campaign, so Round 2 gets its own proofs, Voting Gift, Battle score,
--     milestones, chat and winner, and Round 1's history stays as it was.
--   * Round 1 teams carry over: every agent who was HOOLIGANS or ALIENS stays
--     on that side (assigned_via 'carried'). New agents pick with the usual
--     7-second choice.
--   * a pre-open promo window (battle.promo_from → opens_at): the City shows
--     a countdown, new agents can pick a side and team chat is open, so the
--     battle can recruit before voting starts. No proof is accepted before
--     opens_at (the edge function checks the instant, rc_campaign_submit_proof
--     the KST day), and no point can be scored before a proof exists.
--   * battle state also reports team sizes and how many joined this round
--     ("recruits") — aggregate counts only, for the hype on the public page.
--   * recruit bonus (battle.recruit_bonus {per, points}): every 3 NEW agents
--     on a side (joined this round, not carried) who scored at least one
--     verified point for it add +1 to that side's battle score. Only a
--     recruit who actually voted counts, so empty sign-ups earn nothing, and
--     the freeze stops it with the votes (points are stamped before the
--     freeze). It moves team scores and the winner, never the community
--     total or the Battle Gift milestones, which stay verified votes.
--   * the MAMA 2026 badge counts verified days across BOTH rounds
--     (rewards.badge_scope), so ARMY who missed it in Round 1 can finish it.
--   * X: "only one artist hashtag is permitted" — any hashtag beyond
--     #2026MAMAVOTE and #BTS sends the post to a reviewer (never an automatic
--     rejection; missions[].exclusive_hashtags).
--
-- Battle Gift milestones are a PROPOSAL pending Round 1's final total
-- (config only: update rc_vote_campaigns.battle -> milestones to change).

begin;

-- ── Carried teams ──────────────────────────────────────────────────────
alter table public.rc_campaign_teams drop constraint if exists rc_campaign_teams_assigned_via_check;
alter table public.rc_campaign_teams add constraint rc_campaign_teams_assigned_via_check
  check (assigned_via in ('choice', 'timeout', 'carried'));


-- ── Badge days across rounds ───────────────────────────────────────────
-- Unchanged except the badge count: with rewards.badge_scope (a list of
-- campaign ids) the N different verified days may come from any of them.
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


-- ── Battle state: + team sizes joined this round, + recruit bonus ─────
-- 'recruits' counts agents who picked (or were placed by the timeout) in
-- THIS campaign — not the carried ones. 'qualified' are those recruits who
-- scored at least one point for their side; with battle.recruit_bonus every
-- `per` of them add `points` to the side's score ('bonus'). 'votes' is the
-- side's verified votes alone; 'teams' (the score) is votes + bonus.
-- 'total' (the community total, milestones) stays verified votes only.
-- Aggregates only.
create or replace function public.rc_campaign_battle_state(p_campaign_id text, p_agent_no text)
returns jsonb language sql stable
set search_path = public, pg_temp
as $$
  with c as (
    select battle, coalesce((battle ->> 'freeze_at')::timestamptz, closes_at) as freeze_at,
           greatest(coalesce((battle -> 'recruit_bonus' ->> 'per')::integer, 0), 0) as per,
           greatest(coalesce((battle -> 'recruit_bonus' ->> 'points')::integer, 0), 0) as bonus_points
      from rc_vote_campaigns where id = p_campaign_id
  ), pts as (
    select agent_no, battle_team as team from rc_campaign_proofs
     where campaign_id = p_campaign_id and status = 'verified' and battle_team is not null
  ), teams as (
    select tm ->> 'id' as id,
           (select count(*) from pts where pts.team = tm ->> 'id') as votes,
           (select count(*) from rc_campaign_teams x
             where x.campaign_id = p_campaign_id and x.team = tm ->> 'id' and x.assigned_via in ('choice', 'timeout')
               and exists (select 1 from pts where pts.agent_no = x.agent_no and pts.team = x.team)) as qualified
      from c, jsonb_array_elements(c.battle -> 'teams') tm
  ), scored as (
    select t.id, t.votes, t.qualified,
           case when c.per > 0 then (t.qualified / c.per) * c.bonus_points else 0 end as bonus
      from teams t, c
  ), final as (
    select id, votes, qualified, bonus, votes + bonus as points from scored
  )
  select jsonb_build_object(
    'total', (select count(*) from pts),
    'teams', coalesce((select jsonb_object_agg(id, points) from final), '{}'::jsonb),
    'votes', coalesce((select jsonb_object_agg(id, votes) from final), '{}'::jsonb),
    'bonus', coalesce((select jsonb_object_agg(id, bonus) from final), '{}'::jsonb),
    'qualified', coalesce((select jsonb_object_agg(id, qualified) from final), '{}'::jsonb),
    'teamSizes', coalesce((
      select jsonb_object_agg(tm ->> 'id', (select count(*) from rc_campaign_teams x
        where x.campaign_id = p_campaign_id and x.team = tm ->> 'id'))
        from c, jsonb_array_elements(c.battle -> 'teams') tm
    ), '{}'::jsonb),
    'recruits', coalesce((
      select jsonb_object_agg(tm ->> 'id', (select count(*) from rc_campaign_teams x
        where x.campaign_id = p_campaign_id and x.team = tm ->> 'id' and x.assigned_via in ('choice', 'timeout')))
        from c, jsonb_array_elements(c.battle -> 'teams') tm
    ), '{}'::jsonb),
    'mine', (select count(*) from pts where agent_no = p_agent_no),
    'freezeAt', (select freeze_at from c),
    'frozen', (select now() > freeze_at from c),
    -- Every team on the top score wins, so a tie gives two winners.
    'winners', case when (select now() > freeze_at from c) then coalesce((
      select jsonb_agg(id order by id) from final where points = (select max(points) from final)
    ), '[]'::jsonb) end
  )
$$;


-- ── Team chat opens with the promo window ──────────────────────────────
-- Unchanged except the opening time: battle.promo_from when set, else
-- opens_at, so a team can talk while it recruits.
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
  if now() < least(c.opens_at, coalesce((c.battle ->> 'promo_from')::timestamptz, c.opens_at)) or now() >= c.closes_at then
    return jsonb_build_object('ok', false, 'error', 'chat_closed');
  end if;
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


-- ── MAMA 2026 · Round 2 ────────────────────────────────────────────────
-- Same Voting Gift, Battle Gift pool and winner reward as Round 1 (approved
-- "same, bigger milestones"). Freeze Nov 9 12:00 KST, final result shown
-- for 48h after. Pulse stays disabled, as in Round 1.
--
-- Mnet: Round 2 asks for all three categories in one round (Fans' Choice
-- Male, Female, and Of the Year with VISA). The real Round 2 vote link and
-- certificate wording are confirmed when voting opens; until then the
-- Mnet Plus MAMA event page is the link, and a certificate whose wording
-- doesn't match goes to a reviewer, never an automatic rejection.
insert into public.rc_vote_campaigns (id, title, round_label, opens_at, closes_at, missions, rewards, gift, battle, pulse)
values (
  'mama_2026_r2', 'MAMA 2026', 'Round 2 · Daesang',
  '2026-10-28T18:00:00+09:00', '2026-11-08T23:59:59+09:00',
  '[
    {
      "id": "mnet", "kind": "mnet_certificate", "label": "Mnet Vote", "max_daily": 3,
      "vote_url": "https://mnetplus.world/event/2026-mama",
      "category_label": "Fans'' Choice 2nd Vote",
      "rule": "Vote all three: Male → BTS, Female → your pick, Of the Year with VISA → BTS. Your certificate should show BTS / your female pick / BTS.",
      "guide": [
        "Vote once per day per Mnet Plus ID and device. The day resets at 00:00 KST.",
        "Vote in all three categories to finish one round: Fans'' Choice Male → BTS, Fans'' Choice Female → your pick, Fans'' Choice of the Year with VISA (the Daesang) → BTS.",
        "Fan tip: many ARMY vote for the lowest-ranked artist in Female. The Daesang vote for BTS is the one that matters most.",
        "Press the final submit button, then save the certificate Mnet shows you. It should read BTS / your female pick / BTS.",
        "Round 1 votes are not added to Round 2. Every day counts again."
      ],
      "certificate": {
        "title_keywords": ["voting certificate"],
        "structure_keywords": ["participation date"],
        "issuer_keywords": ["mnet plus", "mnetplus"],
        "category_keywords": ["fans'' choice category 2nd vote", "fans choice category 2nd vote", "fans'' choice of the year", "fans choice of the year"]
      }
    },
    {
      "id": "x", "kind": "x_post", "label": "X Vote", "max_daily": 3, "max_handles": 3,
      "hashtags": ["2026MAMAVOTE", "BTS"],
      "exclusive_hashtags": true,
      "rule": "Use only #2026MAMAVOTE and #BTS. A post with another artist''s hashtag is not counted.",
      "guide": [
        "Once per day per X account, and only public accounts count.",
        "Use exactly #2026MAMAVOTE and #BTS (any case). Add no other artist hashtag; posts with several artist hashtags are not counted.",
        "Only your first voting post of the day counts. One post counts for both Fans'' Choice Male and the Daesang.",
        "Reposting a valid vote post also counts on X. Here, add the link to your own post. Don''t delete it until voting closes."
      ],
      "require_handle_match": true
    }
  ]'::jsonb,
  '{"badge_template_id": "event_mama_2026", "badge_verified_days": 5, "badge_scope": ["mama_2026"]}'::jsonb,
  '{"name": "Voting Gift", "fill_per_verified": 1, "threshold": 5, "daily_open_cap": 2, "rolls": 3,
    "pool": [
      {"kind": "charge_cell", "weight": 30, "amount": 1},
      {"kind": "xp", "weight": 20, "amount": 10},
      {"kind": "streak_freeze", "weight": 15, "amount": 1},
      {"kind": "extension", "weight": 10, "amount": 1},
      {"kind": "wings", "weight": 15, "amount": 1},
      {"kind": "backup_pass", "weight": 10, "amount": 1}
    ]}'::jsonb,
  '{"enabled": true, "choose_seconds": 7,
    "teams": [{"id": "hooligans", "label": "HOOLIGANS"}, {"id": "aliens", "label": "ALIENS"}],
    "promo_from": "2026-10-26T00:00:00+09:00", "carry_teams_from": "mama_2026",
    "recruit_bonus": {"per": 3, "points": 1},
    "freeze_at": "2026-11-09T12:00:00+09:00", "final_visible_hours": 48,
    "milestones": [300, 750, 1350, 2100, 3000],
    "gift": {"name": "Battle Gift", "rolls_min": 1, "rolls_max": 2, "pool": [
      {"kind": "charge_cell", "weight": 32, "amount": 1},
      {"kind": "xp", "weight": 26, "amount": 10},
      {"kind": "wings", "weight": 17, "amount": 1},
      {"kind": "streak_freeze", "weight": 15, "amount": 1},
      {"kind": "extension", "weight": 6, "amount": 1},
      {"kind": "backup_pass", "weight": 4, "amount": 1}
    ]},
    "winner_reward": [{"kind": "xp", "amount": 20}, {"kind": "charge_cell", "amount": 1}]}'::jsonb,
  '{"enabled": false, "provider": "apify", "actor": "xquik~x-tweet-scraper",
    "price_per_1000_usd": 0.15, "max_items_per_run": 600, "budget_usd": 4.00,
    "collect_until_hours_after_close": 12, "exclude_retweets": false}'::jsonb
)
on conflict (id) do nothing;

-- Round 1 sides carry over, with each agent's own Instagram choice. Chat
-- timeouts and mutes do not: Round 2 starts clean.
insert into public.rc_campaign_teams (campaign_id, agent_no, team, assigned_via, started_at, assigned_at, show_ig, show_ig_at)
select 'mama_2026_r2', t.agent_no, t.team, 'carried', now(), now(), t.show_ig, t.show_ig_at
  from public.rc_campaign_teams t
 where t.campaign_id = 'mama_2026' and t.team is not null
on conflict (campaign_id, agent_no) do nothing;

update public.rc_badge_catalog
   set unlock_hint = 'Verified MAMA 2026 votes on 5 different days, across Round 1 and Round 2.'
 where id = 'event_mama_2026';

commit;
