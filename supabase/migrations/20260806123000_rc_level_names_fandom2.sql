-- Add two more fandom nicknames to the level ladder (see migration
-- 20260806120000): "purple mosquitoes" slotted in with the other
-- silly/creature nicknames, "chart bullies" slotted in near the top as a
-- confident/competitive flex line. Now 22 named levels instead of 20 —
-- levelName() already falls back to no name past the last entry, so this
-- just extends the ladder further before that fallback kicks in.
insert into rc_config (key, value) values
('level_names', '[
  "purple blobs",
  "pink smurfs",
  "bangwool",
  "ami",
  "buttercups",
  "purple blob fishes",
  "little sevens (little 7''s)",
  "purple whales",
  "purple mosquitoes",
  "ratmys",
  "tuna troops",
  "armchairs",
  "armeries",
  "streaming robots",
  "armybots",
  "bangtan baddies",
  "purple troops",
  "purple citizens",
  "chart bullies",
  "bora bish",
  "THAT fandom",
  "thanos coloured mfs"
]')
on conflict (key) do update set value = excluded.value;
