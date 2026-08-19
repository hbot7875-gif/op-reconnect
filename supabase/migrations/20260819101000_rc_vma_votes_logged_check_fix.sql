-- 20260819100000 already applied with a votes_logged check that didn't
-- anticipate 0-credit pending/rejected rows — caught live when the first
-- real 'pending' test submission failed it. Fixing here since that
-- migration is already applied to production and isn't edited in place.
-- Upper bound is the double-day cap (daily_cap_per_category * 2 = 20), not
-- the normal 10 — a single screenshot's cumulative total can jump straight
-- past 10 in one submission if MTV's own displayed cap is doubled that day.
alter table rc_vma_votes drop constraint if exists rc_vma_votes_votes_logged_check;
alter table rc_vma_votes add constraint rc_vma_votes_votes_logged_check check (votes_logged between 0 and 20);
