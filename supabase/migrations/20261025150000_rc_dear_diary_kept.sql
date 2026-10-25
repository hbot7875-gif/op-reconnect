-- Dear Diary: moments a player chose to keep.
--
-- The big pop-ups (badge unlocked, level up, district restored) now offer
-- "Keep in Dear Diary". Those facts already appear on their day's page from
-- the ledgers; keeping one pins it to the top of that page as a "Kept" card
-- with an optional line in the player's own words, and is the door into the
-- diary from the moment itself.
--
-- `kept` lives beside the frozen summary_snapshot rather than inside it, so a
-- page frozen days ago still shows a keepsake added today (a badge whose
-- reveal comes late is kept on the day it was earned). Each item is built and
-- verified by lib/dear-diary.ts keepDearDiaryMoment — kind, ref, title, the
-- player's line, art path, kept_at — never taken from the browser as-is.
-- Same posture as the table: RLS on, no browser grants.
alter table public.rc_dear_diary_entries
  add column if not exists kept jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rc_dear_diary_entries_kept_array') then
    alter table public.rc_dear_diary_entries
      add constraint rc_dear_diary_entries_kept_array
      check (jsonb_typeof(kept) = 'array' and jsonb_array_length(kept) <= 12);
  end if;
end $$;
