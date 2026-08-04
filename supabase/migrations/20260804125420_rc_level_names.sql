-- Level names — a narrative label per numeric level (rc_config.level_names),
-- read by leveling.ts's levelFor() alongside the existing level_curve/
-- level_rewards keys. Purely cosmetic: nothing in the level math changes,
-- this only gives the HUD/Progress sheet/level-up moment something to show
-- besides a bare number. Falls back to no name past the last entry — see
-- levelFor()'s `names[level - 1] || null`.
--
-- Names are drawn from real, documented BTS member names/nicknames/meanings
-- and the group's own history (Bangtan Sonyeondan, Beyond The Scene, ARMY),
-- plus original phrasing — no song lyrics anywhere in this list.

insert into rc_config (key, value) values
('level_names', '[
  "Signal Cadet",
  "Bangtan Recruit",
  "Worldwide Handsome Watch",
  "Min Genius Protocol",
  "Hobi Hope Relay",
  "Joonie Compass",
  "Victory Frequency",
  "Skybound Signal",
  "Golden Maknae Op",
  "Beyond the Scene Scout",
  "Bulletproof Vanguard",
  "Adorable Representative",
  "Seven Signal Array",
  "Purple Heart Sentinel",
  "Borahae Operative",
  "ARMY Frequency",
  "Reconnect Vanguard",
  "Reconnect Elite",
  "Reconnect Sentinel",
  "Reconnect Legend"
]')
on conflict (key) do update set value = excluded.value;
