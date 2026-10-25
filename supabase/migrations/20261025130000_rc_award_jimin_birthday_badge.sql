-- Jimin Birthday Badge for everyone who completed the MUSE Birthday card.
--
-- Jimin Day 2026 (2026-10-13..14) was built so the card paid its 10 hours
-- and BOTH badges came from the Birthday Room gift (birthday-eras.ts
-- roomGift), which opened once the community reached 1,013 lights. The room
-- finished at 927 (recomputed 2026-10-25 from the event window's
-- rc_daily_activity with agent-charge.ts computeBirthdayRoom's own scoring),
-- so no gift ever opened and none of the 57 card finishers got the badge — while
-- Jung Kook's GOLDEN card awarded its badge on completion. Site owner's call
-- (2026-10-25): give the card badge to every finisher. Birthday Lightkeeper,
-- the room's own badge, stays unawarded because the room missed its target.
--
-- Finishers = every agent whose event-window plays light all nine MUSE tracks
-- under the same scoring: the 54 holding the card claim (rc_agent_lit_eras)
-- plus AGENT070, AGENT095 and AGENT170, who completed the card but were never
-- claimed (their plays landed after the event window closed). Hours are not
-- re-paid. rc_award_badge is idempotent, so a re-run changes nothing.
do $$
declare
  v_agent text;
  v_count integer;
begin
  foreach v_agent in array array[
    'AGENT000', 'AGENT003', 'AGENT004', 'AGENT005', 'AGENT008', 'AGENT009', 'AGENT010', 'AGENT012',
    'AGENT013', 'AGENT015', 'AGENT018', 'AGENT019', 'AGENT020', 'AGENT021', 'AGENT026', 'AGENT027',
    'AGENT028', 'AGENT029', 'AGENT030', 'AGENT033', 'AGENT034', 'AGENT035', 'AGENT037', 'AGENT038',
    'AGENT041', 'AGENT042', 'AGENT043', 'AGENT046', 'AGENT047', 'AGENT050', 'AGENT053', 'AGENT055',
    'AGENT057', 'AGENT058', 'AGENT060', 'AGENT063', 'AGENT064', 'AGENT066', 'AGENT069', 'AGENT070',
    'AGENT073', 'AGENT074', 'AGENT077', 'AGENT079', 'AGENT083', 'AGENT094', 'AGENT095', 'AGENT103',
    'AGENT104', 'AGENT107', 'AGENT110', 'AGENT118', 'AGENT120', 'AGENT140', 'AGENT157', 'AGENT166',
    'AGENT170'
  ] loop
    perform public.rc_award_badge(v_agent, 'event_jimin_birthday_2026', null);
  end loop;

  select count(distinct agent_no) into v_count from rc_badges where badge_id = 'event_jimin_birthday_2026';
  if v_count < 57 then
    raise exception 'expected at least 57 Jimin Birthday Badges, found %', v_count;
  end if;
end $$;
