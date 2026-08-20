-- AGENT009 reported "Trivia 起 : Just Dance" not counting toward Dazzledew
-- Fountain's Love Yourself 結 'Answer' album goal. Root cause: her scrobble
-- source reports the track as "Trivia Ki : Just Dance" (Latin
-- transliteration of 起, not the Hanja character), and the goal's only key
-- was the Hanja form — normalizeKey() keeps CJK letters as-is, so "Ki" and
-- "起" never collapse to the same key. Same issue on the neighboring track:
-- "Trivia 轉 : Seesaw" also shows up as "Trivia Ten : Seesaw" for some
-- sources (轉 -> "Ten"). Checked: this album (dazzledew-album-love-yourself-
-- answer) is the only rc_goals row anywhere with either title, so this is
-- scoped correctly to just it.
--
-- Two parts: fix the source template (for anyone activating this district
-- from now on), and backfill every row that already froze this album's
-- goals at activation time (freezeGoals copies keys once; editing the
-- template alone doesn't reach already-active players) — 27 agents total,
-- active and restored, so nobody's history changes but future counting
-- does for the ones still in progress.

update rc_goals
set tracks = (
  select jsonb_agg(
    case
      when t->>'label' = 'Trivia 起 : Just Dance'
        then jsonb_set(t, '{aliases}', (t->'aliases') || '["Trivia Ki : Just Dance"]'::jsonb)
      when t->>'label' = 'Trivia 轉 : Seesaw'
        then jsonb_set(t, '{aliases}', (t->'aliases') || '["Trivia Ten : Seesaw"]'::jsonb)
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
                  when t->>'label' = 'Trivia 起 : Just Dance'
                    then jsonb_set(t, '{keys}', (t->'keys') || '["trivia ki just dance"]'::jsonb)
                  when t->>'label' = 'Trivia 轉 : Seesaw'
                    then jsonb_set(t, '{keys}', (t->'keys') || '["trivia ten seesaw"]'::jsonb)
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
