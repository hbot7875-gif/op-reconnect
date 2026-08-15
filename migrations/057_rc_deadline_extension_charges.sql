-- Deadline extensions become an earned, banked resource instead of an
-- unconditional freebie — per the site owner: Fuel currently does nothing
-- (nothing in the game reads or spends it), so level-up grants an Extension
-- Charge instead of 5 Fuel. Same shape as streak_freeze_charges: a plain
-- counter on rc_players, credited by applyLevelUpIfNeeded (leveling.ts),
-- spent by extendDistrictDeadline (handlers.ts) — one charge per use, and
-- rc_player_districts.deadline_extended (migration 056) still caps it at
-- one use per district attempt even for an agent sitting on several charges.

alter table rc_players
  add column if not exists deadline_extension_charges int not null default 0;

update rc_config
set value = jsonb_set(value - 'fuelPerLevel', '{extensionChargePerLevel}', '1'::jsonb)
where key = 'level_rewards';
