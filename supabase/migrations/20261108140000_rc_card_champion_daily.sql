-- Card Champion: one badge a day instead of one every 10 wins.
--
-- The first counted War of Cards win of a KST day earns that day's badge,
-- scoped by the date ('achievement_card_champion:2026-11-08'). More wins the
-- same day earn nothing more, but agents can keep playing. What counts as a
-- win is unchanged (rc_war_outcomes: played out, 12+ turns, at most 3 a day
-- against the same opponents). rc_award_badge is idempotent on (agent,
-- badge), so a day's badge is awarded once and kept. Any error is swallowed
-- with a warning: a badge must never block a match result.
--
-- Existing milestone badges ('…:10', '…:20') are kept as they are; none had
-- been earned when this landed.
--
-- Every 10 counted wins earns a second badge, War of Cards — Champion Pro
-- ('achievement_card_champion_pro:10', ':20', …), each milestone once. It
-- uses a gold version of the Polaroid frame ('polaroid_pro') and Fun photos.
alter table public.rc_badge_catalog drop constraint if exists rc_badge_catalog_art_frame_check;
alter table public.rc_badge_catalog add constraint rc_badge_catalog_art_frame_check
  check (art_frame is null or art_frame in ('polaroid', 'polaroid_pro'));

insert into public.rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active, art_frame, photo_style)
values ('achievement_card_champion_pro', 'achievement', 'rare', 'War of Cards — Champion Pro',
        'Win 10 games of War of Cards. Every 10 more wins earns another.', 81, true, 'polaroid_pro', 'fun')
on conflict (id) do update set art_frame = excluded.art_frame, photo_style = excluded.photo_style;

create or replace function public.rc_war_award_champion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date;
  v_wins integer;
  v_m integer;
begin
  if new.result = 'won' and old.result is distinct from 'won' then
    begin
      select (o.ended_at at time zone 'Asia/Seoul')::date into v_day
        from rc_war_outcomes() o
       where o.match_id = new.match_id and o.agent_no = new.agent_no and o.outcome = 'win';
      if v_day is not null then
        perform rc_award_badge(new.agent_no, 'achievement_card_champion', v_day::text);
        -- Champion Pro: every milestone reached, so none is ever skipped.
        select count(*) into v_wins from rc_war_outcomes() o
         where o.agent_no = new.agent_no and o.outcome = 'win';
        for v_m in 1 .. (v_wins / 10) loop
          perform rc_award_badge(new.agent_no, 'achievement_card_champion_pro', (v_m * 10)::text);
        end loop;
      end if;
    exception when others then
      raise warning 'Card Champion check failed for %: %', new.agent_no, sqlerrm;
    end;
  end if;
  return null;
end $$;

revoke all on function public.rc_war_award_champion() from public, anon, authenticated;

update public.rc_badge_catalog
   set unlock_hint = 'Win a game of War of Cards. One new badge a day — play as much as you like.'
 where id = 'achievement_card_champion';

-- Every past day with a counted win gets its badge now.
select rc_award_badge(d.agent_no, 'achievement_card_champion', d.day::text)
  from (select distinct o.agent_no, (o.ended_at at time zone 'Asia/Seoul')::date as day
          from rc_war_outcomes() o where o.outcome = 'win') d;

select rc_award_badge(l.agent_no, 'achievement_card_champion_pro', (m.n * 10)::text)
  from rc_war_leaderboard(null) l
  cross join lateral generate_series(1, l.wins / 10) as m(n)
 where l.wins >= 10;

do $$
begin
  if (select art_frame from rc_badge_catalog where id = 'achievement_card_champion_pro') is distinct from 'polaroid_pro' then
    raise exception 'Champion Pro template not set';
  end if;
end $$;
