-- Freezes the streaming mode used for a day's XP conversion at whatever it
-- was when that day's row was first touched, same shape as bomb_mult's
-- existing "past days keep whatever they were finalized with" rule
-- (derive.ts). Without this, changing mode mid-day retroactively rewrites
-- today's already-earned XP on every subsequent poll — stream on Hard,
-- switch to Easy before midnight, and the day's whole XP total silently
-- recomputes at Easy's faster rate (or the reverse, losing XP).
alter table rc_daily_activity add column if not exists mode text;
