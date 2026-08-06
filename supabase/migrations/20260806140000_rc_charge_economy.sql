-- BOTZ redesign Phase 2 — new economy primitives (docs/botz-network-redesign.md).
--
-- Named "charge_cells", not "fuel": rc_players already has lifetime_fuel (a
-- district-restoration reward resource, unrelated), and "BOTZ" is already
-- this repo's name for a completely separate sub-app (botz.html). Charge
-- Cells are what the ARMY Bomb redesign calls "fuel/botz" in the design
-- doc — same currency, a name that collides with neither existing thing.
--
-- charge_cells: earned from album-goal streams (20:1, see charge-economy.ts).
-- wings: bought in the Magic Shop, spent on the Candy Star Generator.
-- tickets: Magic Shop unlock, gated by level/districts/xp (see charge-economy.ts).
-- wings_bought_today / wings_bought_date: the daily 3-wing cap resets on
-- kst_date change rather than needing a cron — same "compare stored date to
-- today" pattern this game already uses for streaks (see derive.ts's
-- computeStreak).
alter table rc_players add column if not exists charge_cells int not null default 0;
alter table rc_players add column if not exists wings int not null default 0;
alter table rc_players add column if not exists tickets int not null default 0;
alter table rc_players add column if not exists wings_bought_today int not null default 0;
alter table rc_players add column if not exists wings_bought_date text;

-- Per-activation baseline so charge_cells is only ever awarded for NEW
-- album-goal streams since last checked, never re-awarded on a repeat poll —
-- same "stored baseline, award the delta" shape as rc_player_districts'
-- existing `baseline` column already uses for goal progress.
alter table rc_player_districts add column if not exists charge_cells_awarded int not null default 0;
