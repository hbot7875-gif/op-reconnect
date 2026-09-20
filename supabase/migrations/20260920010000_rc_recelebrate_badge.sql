-- ARIRANG RE:CELEBRATE (Sept 20, 2026) event badges: proof of what an agent
-- did on the day, so they stay limited/collectible afterwards. Nothing here
-- is based on district restoration.
--
-- All triggers come from data collected during the event, and are awarded
-- after it (rc_award_badge):
--   PARTY CRASHER     1+ accepted battle stream (rc_recelebrate_battle_streams)
--   ARIRANG CULT      all 14 ARIRANG tracks (battle positions 1-14) at least once
--   SIDE QUEST        all 17 battle tracks for their side; one template per side
--                     so the art differs (Hooligans / Aliens). No winners-only
--                     badge: the side you fought for is the record either way.
--   RE:CELEBRATE '26  all 17 tracks + at least one Watch Party check-in
--
-- This only adds the catalog entries so badge makers can upload art in the
-- Badge Vault now; nothing awards them yet.
insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values
  ('event_rc26_party_crasher', 'event', 'common', 'PARTY CRASHER ✦',
   'Stream at least 1 battle track during ARIRANG RE:CELEBRATE (Sept 20, 2026).', 140, true),
  ('event_rc26_arirang_cult', 'event', 'common', 'ARIRANG CULT MEMBER ♡',
   'Stream all 14 ARIRANG tracks at least once during ARIRANG RE:CELEBRATE (Sept 20, 2026).', 141, true),
  ('event_rc26_side_quest_hooligans', 'event', 'rare', 'SIDE QUEST ⚡ Hooligans',
   'Stream all 17 battle tracks for the Hooligans during ARIRANG RE:CELEBRATE (Sept 20, 2026).', 142, true),
  ('event_rc26_side_quest_aliens', 'event', 'rare', 'SIDE QUEST 🛸 Aliens',
   'Stream all 17 battle tracks for the Aliens during ARIRANG RE:CELEBRATE (Sept 20, 2026).', 143, true),
  ('event_arirang_recelebrate_2026', 'event', 'rare', 'RE:CELEBRATE ''26 ✦',
   'Stream all 17 battle tracks and join a Watch Party during ARIRANG RE:CELEBRATE (Sept 20, 2026).', 144, true)
on conflict (id) do update set
  name = excluded.name,
  rarity = excluded.rarity,
  unlock_hint = excluded.unlock_hint,
  sort_order = excluded.sort_order,
  active = true;
