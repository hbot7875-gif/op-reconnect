-- Badge Collection launch policy: start with the district each agent is
-- currently restoring. Do not reward districts, wards or ReConnect missions
-- that were already completed before the collection launched.
--
-- The live triggers remain intentionally unchanged: they award only on a new
-- restoration/mission-completion transition, while handlers.ts awards 25/50/
-- 75% progress for the one active district. VMA and Supply Chest badges are
-- new live-event activity and are not part of this historical cleanup.

begin;

-- Avoid leaving a removed historical badge selected as the profile icon.
-- Keep a district-progress badge only when its scope is the agent's current
-- active district; every other district/ward/ReConnect award came from the
-- launch backfill and should disappear.
update rc_players p
set equipped_badge_id = null
where exists (
  select 1
  from rc_badges b
  where b.agent_no = p.agent_no
    and b.badge_id = p.equipped_badge_id
    and split_part(b.badge_id, ':', 1) in (
      'district_frag_1', 'district_frag_2', 'district_frag_3',
      'district_restored', 'ward', 'mission_bond'
    )
    and not (
      split_part(b.badge_id, ':', 1) in (
        'district_frag_1', 'district_frag_2', 'district_frag_3'
      )
      and exists (
        select 1
        from rc_player_districts current_district
        where current_district.agent_no = b.agent_no
          and current_district.status = 'active'
          and current_district.district_id = split_part(b.badge_id, ':', 2)
      )
    )
);

delete from rc_badges b
where split_part(b.badge_id, ':', 1) in (
    'district_frag_1', 'district_frag_2', 'district_frag_3',
    'district_restored', 'ward', 'mission_bond'
  )
  and not (
    split_part(b.badge_id, ':', 1) in (
      'district_frag_1', 'district_frag_2', 'district_frag_3'
    )
    and exists (
      select 1
      from rc_player_districts current_district
      where current_district.agent_no = b.agent_no
        and current_district.status = 'active'
        and current_district.district_id = split_part(b.badge_id, ':', 2)
    )
  );

commit;
