-- The PTD album-goal swap (migration 20260819220000) assumed 0 activations
-- and only patched the rc_goals TEMPLATE — but by the time it ran, one
-- player (AGENT069, activated 2026-08-19 16:17 UTC, shortly before the
-- swap) had already frozen the OLD 3-track "Permission to Dance" single
-- into their save. Every stream since of the actual live album
-- ("ON - Live", "Dynamite - Live", ...) can never match that stale frozen
-- track list — exactly the "PTD live album isn't counting" report this
-- fixes. Literal replacement (not derived via SQL regex) so there's no
-- risk of it drifting from the real goalKeys() normalization the backend
-- actually uses — this is the exact frozen shape a correct activation
-- already has (verified against one), copied in directly.
update rc_player_districts
set goals = jsonb_set(
  goals, '{albumGoals}',
  (
    select jsonb_agg(
      case
        when a->>'id' = 'mos7-album-permission-to-dance' and a->>'label' = 'Permission to Dance'
        then '{
          "id": "mos7-album-permission-to-dance",
          "label": "PERMISSION TO DANCE ON STAGE - LIVE",
          "target": 2,
          "tracks": [
            {"label":"ON - Live","keys":["on live"]},
            {"label":"Burning Up (FIRE) - Live","keys":["burning up fire live","burning up live","fire live"]},
            {"label":"Dope - Live","keys":["dope live"]},
            {"label":"DNA - Live","keys":["dna live"]},
            {"label":"Blue & Grey - Live","keys":["blue grey live","blue and grey live"]},
            {"label":"Black Swan - Live","keys":["black swan live"]},
            {"label":"Blood Sweat & Tears - Live","keys":["blood sweat tears live","blood sweat and tears live"]},
            {"label":"FAKE LOVE - Live","keys":["fake love live"]},
            {"label":"Life Goes On - Live","keys":["life goes on live"]},
            {"label":"Boy With Luv (Feat. Halsey) - Live","keys":["boy with luv feat halsey live","boy with luv live"]},
            {"label":"Dynamite - Live","keys":["dynamite live"]},
            {"label":"Butter - Live","keys":["butter live"]},
            {"label":"Telepathy - Live","keys":["telepathy live"]},
            {"label":"Outro : Wings - Live","keys":["outro wings live"]},
            {"label":"Stay - Live","keys":["stay live"]},
            {"label":"So What - Live","keys":["so what live"]},
            {"label":"IDOL - Live","keys":["idol live"]},
            {"label":"Airplane pt.2 - Live","keys":["airplane pt2 live","airplane pt 2 live"]},
            {"label":"Silver Spoon - Live","keys":["silver spoon live"]},
            {"label":"Dis-ease - Live","keys":["dis ease live","disease live"]},
            {"label":"Spring Day - Live","keys":["spring day live"]},
            {"label":"Permission to Dance - Live","keys":["permission to dance live"]}
          ]
        }'::jsonb
        else a
      end
    )
    from jsonb_array_elements(goals->'albumGoals') as a
  )
)
where district_id = 'mono-map-of-seven-crossing'
  and goals->'albumGoals' @> '[{"id":"mos7-album-permission-to-dance","label":"Permission to Dance"}]';
