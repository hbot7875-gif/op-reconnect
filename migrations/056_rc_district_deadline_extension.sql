-- A one-time, free lifeline for a district attempt about to lapse — see
-- AGENT077's report: she and her ReConnect partner were 99/100 combined
-- streams into their shared goal when her 7-day deadline ran out, and lost
-- everything (track/album progress included, per the existing "miss the
-- deadline, the whole attempt resets" rule). This gives every agent one
-- +3-day extension per district attempt instead of a hard cliff.
--
-- Boolean, not a counter — deliberately one-time, so it stays a genuine
-- "I was this close" rescue rather than a way to just always run districts
-- 3 days longer. Cleared automatically whenever the row itself is cleared
-- (deleted on expiry, or a fresh insert on restart), so a new attempt
-- always gets its own extension available again.

alter table rc_player_districts
  add column if not exists deadline_extended boolean not null default false;
