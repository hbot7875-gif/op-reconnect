-- Map of Seven Crossing's base (easy-mode) targets were still noticeably
-- lighter than Dazzledew Fountain's — the comparison district used to
-- gauge whether this one was set too easy (see the earlier balance
-- review). Still 0 activations (verified before writing this), so it's
-- safe to raise outright rather than only apply to future joins.
--
-- Track split follows Dazzledew's own exact pattern (its 5 lead-single
-- tracks sit at base 50, its 3 lighter/older tracks at base 20): the 5
-- lead tracks here go to 50, the 4 lighter ones stay at the same 20 floor
-- Dazzledew already uses.
update rc_goals set target = 50, updated_at = now()
 where id in ('mos7-track-haegeum', 'mos7-track-wild-flower',
              'mos7-track-killin-it-girl', 'mos7-track-winter-ahead',
              'mos7-track-swim');

-- Album targets matched to Dazzledew's actual values for the closest
-- track-count band: ARIRANG (14 tracks) and Keep Swimming (9 tracks) are
-- an exact track-count match to Dazzledew's own Arirang/Keep Swimming, so
-- take their same target (5). LY Tear (11) is closest to Indigo's 10 -> 3.
-- Happy (6, the smallest here) goes to 5, in line with the pattern that a
-- smaller album asks for more full passes, not fewer. PTD (22 tracks) is
-- closest to Dazzledew's 15-26 track albums, both at 2.
update rc_goals set target = 5, updated_at = now() where id = 'mos7-album-arirang';
update rc_goals set target = 5, updated_at = now() where id = 'mos7-album-keep-swimming';
update rc_goals set target = 3, updated_at = now() where id = 'mos7-album-love-yourself-tear';
update rc_goals set target = 5, updated_at = now() where id = 'mos7-album-happy';
update rc_goals set target = 2, updated_at = now() where id = 'mos7-album-permission-to-dance';

-- Backfill every already-frozen attempt too (9 agents, all easy mode, so
-- these base numbers ARE their frozen numbers directly, no multiplier
-- math needed) -- template-only would leave them on the old, lighter
-- targets while everyone joining after this migration gets the raised
-- ones, which is exactly the inconsistency this migration exists to fix.
update rc_player_districts
set goals = jsonb_set(
  jsonb_set(
    goals, '{trackGoals}',
    (
      select jsonb_agg(
        case when t->>'id' in (
          'mos7-track-haegeum', 'mos7-track-wild-flower',
          'mos7-track-killin-it-girl', 'mos7-track-winter-ahead', 'mos7-track-swim'
        ) then jsonb_set(t, '{target}', '50')
        else t end
      )
      from jsonb_array_elements(goals->'trackGoals') as t
    )
  ),
  '{albumGoals}',
  (
    select jsonb_agg(
      case a->>'id'
        when 'mos7-album-arirang' then jsonb_set(a, '{target}', '5')
        when 'mos7-album-keep-swimming' then jsonb_set(a, '{target}', '5')
        when 'mos7-album-love-yourself-tear' then jsonb_set(a, '{target}', '3')
        when 'mos7-album-happy' then jsonb_set(a, '{target}', '5')
        when 'mos7-album-permission-to-dance' then jsonb_set(a, '{target}', '2')
        else a
      end
    )
    from jsonb_array_elements(goals->'albumGoals') as a
  )
)
where district_id = 'mono-map-of-seven-crossing';
