-- Rollback for 20261025170000_rc_album.sql. Run by hand only.
--
-- Deletes every agent's collected covers and gift history. Take a copy of
-- both tables first if anyone has started collecting. The Edge Function's
-- album routes and the game-state album summary must be removed (or the
-- function redeployed from before the Album) before running this, or every
-- game-state poll will fail on the missing table.

drop function if exists public.rc_album_gift(text, text, text, date, integer);
drop function if exists public.rc_album_award_daily(text, date, double precision);
drop table if exists public.rc_album_gifts;
drop table if exists public.rc_album_covers;
