-- Swap the level ladder (rc_config.level_names, see migration 033) from the
-- original BTS-member-lore names to fandom-slang nicknames, per request.
-- Ordered silly-to-epic across the 20 levels: cute/self-deprecating early,
-- bold flex titles late. A few submitted nicknames were left out as too
-- mean-spirited toward the fandom itself (mocking broke/poor ARMYs etc.) or
-- explicit rather than just cheeky — same bar the rest of this game's copy
-- holds to. Purely cosmetic, same upsert pattern as 033: nothing in the
-- level math changes.
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
  "ratmys",
  "tuna troops",
  "armchairs",
  "armeries",
  "streaming robots",
  "armybots",
  "bangtan baddies",
  "purple troops",
  "purple citizens",
  "bora bish",
  "THAT fandom",
  "thanos coloured mfs"
]')
on conflict (key) do update set value = excluded.value;
