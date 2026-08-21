-- AGENT009 reported "Trivia 承 : Love" not counting toward Dazzledew
-- Fountain's Love Yourself 結 'Answer' album goal, again — this time not a
-- missing romanization on the track's own title (that key already matches
-- exactly), but their scrobbler mislabeling those plays with the same
-- title text as the neighboring track: "Trivia Ki : Just Dance" (the
-- romanized alias already added for 20260819230000's fix). Adding that
-- same key onto the Love track too so an ambiguous scrobble counts toward
-- either — same two-part pattern as before: patch the template, then
-- backfill every row that already froze this album's goals (freezeGoals
-- copies keys once at activation; editing the template alone doesn't
-- reach already-active players).
update rc_goals
set tracks = (
  select jsonb_agg(
    case
      when t->>'label' = 'Trivia 承 : Love'
        then jsonb_set(t, '{aliases}', (t->'aliases') || '["Trivia Ki : Just Dance"]'::jsonb)
      else t
    end
  )
  from jsonb_array_elements(tracks) as t
),
updated_at = now()
where id = 'dazzledew-album-love-yourself-answer';

update rc_player_districts
set goals = jsonb_set(
  goals, '{albumGoals}',
  (
    select jsonb_agg(
      case
        when album->>'id' = 'dazzledew-album-love-yourself-answer'
          then jsonb_set(
            album, '{tracks}',
            (
              select jsonb_agg(
                case
                  when t->>'label' = 'Trivia 承 : Love'
                    then jsonb_set(t, '{keys}', (t->'keys') || '["trivia ki just dance"]'::jsonb)
                  else t
                end
              )
              from jsonb_array_elements(album->'tracks') as t
            )
          )
        else album
      end
    )
    from jsonb_array_elements(goals->'albumGoals') as album
  )
)
where district_id = 'mono-dazzledew-fountain';
