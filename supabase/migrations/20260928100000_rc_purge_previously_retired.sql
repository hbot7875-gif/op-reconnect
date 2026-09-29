-- One-time backfill: the 13 accounts retired before retirement deleted anything.
--
-- APPLIED IN PRODUCTION. Recorded in supabase_migrations.schema_migrations;
-- verified read-only on 2026-09-29. Do not re-run it: this file is committed as
-- applied history so a clean checkout matches production, not as pending work.
--
-- THIS ONE HAS ALREADY DELETED REAL DATA. It removed 53,814 rows belonging to
-- 13 people who retired before retirement deleted anything. It is a one-time
-- backfill and is NOT idempotent — running it again is not a no-op. It is
-- kept here as history, never as an instruction.
--
-- It was deliberately separate from 20260928060000, which changes behaviour
-- going forward and deletes nothing when applied, so the first could be
-- applied and observed without committing to this one. 20260928060000 was
-- applied first; this file calls rc_purge_agent_data, which that one creates.
--
--
-- WHO THIS AFFECTS
--
-- 13 accounts with retired_at set, retired between 8 Aug and 26 Sep 2026. They
-- asked to leave under wording that said their progress would stay on the map,
-- and it did — along with their email addresses, their listening history and
-- everything else. Under the new behaviour retiring deletes all of it. This
-- brings the people who already left in line with the people who leave next.
--
-- Verified before writing this:
--   * 0 of the 13 have logged in since retiring, so none of this is a
--     reactivated account losing live progress.
--   * 1 still carries a session token valid until 15 Dec 2026. It is inert —
--     verifySession() refuses any agent with retired_at set — but it is stale
--     credential material, and this removes it.
--   * 0 of them uploaded badge artwork, so no badge another agent wears loses
--     its photo. (rc_purge_agent_data would null uploaded_by rather than
--     delete the photo in any case.)
--   * AGENT001, the test account, is not among them.
--
--
-- EXACTLY WHAT GOES
--
-- THESE NUMBERS ARE A SNAPSHOT, NOT A GUARANTEE. Measured 2026-09-28 09:44 UTC.
-- They move: re-run the read-only preview immediately before applying and
-- compare, rather than trusting what is written here. The migration's own
-- guards check the ACCOUNT COUNT (13) and that none has been reactivated; they
-- do not check row counts, so a large drift here is something a human has to
-- notice.
--
--   rc_scrobbles                 51,762      listening history
--   rc_engagement_events          3,900
--   rc_feed_events                  778
--   rc_xp_ledger                    690
--   rc_daily_activity               540
--   rc_badges                        82
--   rc_agent_lit_eras                81
--   rc_vma_votes                     50
--   rc_player_districts              24
--   rc_player_items                  23
--   rc_agent_charge                  13
--   rc_players                       13      codename, avatar crop
--   rc_agents                        13      email, handle, password hash
--   rc_stream_sync_state              5
--   rc_share_snapshots                3
--   ------------------------------------
--   57,977 rows, plus 50 proof screenshots (see the Storage note below).
--
-- Changed since the first preview (53,814 rows), for two reasons worth knowing:
--   * scrobbles kept arriving for these accounts until Stage 1 stopped
--     collection — 51,508 became 51,762;
--   * rc_engagement_events (3,900) and rc_stream_sync_state (5) now appear
--     because Stage 2A added them to rc_purge_agent_data. The original purge
--     left those rows behind.
--
-- Nulled rather than deleted, because the row belongs to someone else:
--   generated_playlists.agent_no            8
--   rc_reconnect_participants.invited_by    5
--
-- Deleted because it is theirs:
--   rc_share_snapshots                      3
--
-- Written to rc_deleted_agent_log: 13 rows, which the 30-day log purge then
-- removes on its own schedule. So this does NOT create a permanent record.
--
--
-- STORAGE: THIS CHANGED AFTER STAGE 2B, AND IT MATTERS
--
-- When this file was written, queueing a file was inert: the sweep functions
-- did not exist, so "queued" meant "parked until someone builds the sweep".
--
-- That is no longer true. Stage 2A created the sweep and Stage 2B started it,
-- and rc_next_storage_deletions excludes only reason = 'qa'. The 50 files this
-- purge queues carry reason = 'agent_purged', so THE HOURLY SYNC WILL CLAIM AND
-- PERMANENTLY DELETE THEM, typically within the hour.
--
-- Database backups do not cover Storage. Once that sweep runs, those 50 files
-- are unrecoverable by any route — unlike the 57,977 rows, which a point-in-
-- time restore could in principle bring back.
--
-- If the Storage decision is to be made separately from the database purge,
-- this migration needs a hold step. See the accompanying design review; no
-- executable SQL here has been changed for it yet.

begin;

-- Fail loudly rather than silently doing nothing if the retention migration
-- has not been applied yet.
do $$
begin
  if to_regprocedure('public.rc_purge_agent_data(text, text)') is null then
    raise exception 'rc_purge_agent_data is missing — apply 20260928060000_rc_privacy_retention.sql first';
  end if;
end $$;

-- Refuse to run if the population has shifted since this was written and
-- reviewed. 13 is what the owner approved; 40 is not.
do $$
declare n integer;
begin
  select count(*) into n from rc_agents where retired_at is not null;
  if n <> 13 then
    raise exception 'expected 13 retired accounts, found % — re-run the preview and have this re-approved', n;
  end if;
end $$;

-- Refuse if any of them has come back since the preview was taken.
do $$
declare n integer;
begin
  select count(*) into n from rc_agents
   where retired_at is not null and last_login_at > retired_at;
  if n > 0 then
    raise exception '% retired account(s) have logged in since retiring — stop and re-check', n;
  end if;
end $$;

-- The purge itself. One transaction: either all 13 go or none do.
do $$
declare
  r record;
  done integer := 0;
begin
  for r in
    select agent_no from rc_agents
     where retired_at is not null
       and agent_no <> 'AGENT001'
     order by agent_no
  loop
    if rc_purge_agent_data(r.agent_no, 'retired_backfill') then
      done := done + 1;
    end if;
  end loop;

  if done <> 13 then
    raise exception 'purged % accounts, expected 13 — rolling back', done;
  end if;
  raise notice 'purged % previously-retired accounts', done;
end $$;

-- Post-condition: nothing retired should remain.
do $$
declare n integer;
begin
  select count(*) into n from rc_agents where retired_at is not null;
  if n <> 0 then
    raise exception 'expected 0 retired accounts after the purge, found %', n;
  end if;
end $$;

commit;

-- ROLLBACK
--
-- There is none. This deletes personal data on purpose and a rollback that
-- restored it would defeat the point. The recovery path, if this is run in
-- error, is the daily physical backup — restore to a point in time before the
-- migration ran. Confirm a recent backup exists BEFORE applying this.
