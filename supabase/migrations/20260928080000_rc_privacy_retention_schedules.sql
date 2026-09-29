-- Stage 2B: start the three retention jobs.
--
-- APPLIED IN PRODUCTION. Recorded in supabase_migrations.schema_migrations;
-- verified read-only on 2026-09-29. Do not re-run it: this file is committed as
-- applied history so a clean checkout matches production, not as pending work.
--
-- It contains nothing but cron.schedule calls, and it is NOT idempotent, so it
-- must never be run by hand. Its jobs are live: rc-inactive-reminders (09:00),
-- rc-delete-inactive-agents (18:00) and rc-queue-expired-vote-proofs (03:40),
-- all active. Every function and table they reference comes from Stage 2A
-- (20260928060000_rc_privacy_retention), which was applied first.
--
--
-- THIS IS THE FILE THAT MAKES THINGS HAPPEN
--
-- Stage 2A installs machinery and starts nothing. This starts it. On the first
-- night after applying:
--
--   03:20  rc-purge-deleted-agent-log      DELETES ~5 rows from
--                                          rc_deleted_agent_log (those older
--                                          than 30 days). Real records, gone.
--                                          Recoverable only from the 7-day
--                                          physical backup.
--
--   03:40  rc-queue-expired-vote-proofs    queues 0 — vma_2026 is not due
--                                          until 2026-10-25 21:59:59Z. It only
--                                          ever WRITES QUEUE ROWS; the Edge
--                                          Function sweep does the deleting.
--
--   09:00  rc-inactive-reminders           EMAILS the accounts currently in
--                                          the 9-14 day band. At the time of
--                                          review that was 3 real people.
--                                          Re-check the count immediately
--                                          before applying — it moves daily.
--
-- The 18:00 inactivity job is NOT scheduled here. It already exists and has
-- run daily since August; Stage 2A changed the function it calls.
--
--
-- RE-CHECK BEFORE APPLYING (read-only):
--
--   select
--     (select count(*) from rc_deleted_agent_log
--       where deleted_at < now() - interval '30 days')            as log_rows_that_will_go,
--     (select count(*) from rc_inactive_agent_candidates(9) c
--        join rc_agents a on a.agent_no = c.agent_no
--       where c.days_inactive < 14 and coalesce(a.email,'') <> '') as people_who_will_be_emailed;
--
-- If either number is larger than you expected, stop and find out why before
-- scheduling anything.
--
--
-- TIMING
--
-- 03:20 and 03:40 sit clear of the 18:00 inactivity sweep and of the stream
-- capture jobs at :02/:07/:17/:22/:32/:37/:47/:52.
--
-- 09:00 is nine hours before the 18:00 deletion, so a warning and the deletion
-- it warns about can never land on the same account on the same day. The
-- handler's own 9-14 day band is narrower than the deletion threshold, so it
-- cannot email somebody the sweep is about to take anyway.
--
--
-- ROLLBACK: immediate and complete, with no data implications.
--
--   select cron.unschedule('rc-purge-deleted-agent-log');
--   select cron.unschedule('rc-queue-expired-vote-proofs');
--   select cron.unschedule('rc-inactive-reminders');
--
-- Unscheduling stops all three at once and leaves Stage 2A's machinery intact.
-- It does not undo anything a job has already done — an email that has been
-- sent cannot be unsent, and log rows already deleted are only in the backup.
-- So unschedule BEFORE 03:20 if there is any doubt.

begin;

-- Fail loudly rather than silently scheduling jobs that cannot run.
do $$
begin
  if to_regprocedure('public.rc_purge_deleted_agent_log(integer)') is null
     or to_regprocedure('public.rc_queue_expired_vote_proofs(text, integer, integer)') is null
     or to_regprocedure('public.rc_invoke_inactive_reminders()') is null then
    raise exception 'Stage 2A is not applied — apply 20260928060000_rc_privacy_retention.sql first';
  end if;
end $$;

-- Refuse to double-schedule.
do $$
declare n integer;
begin
  select count(*) into n from cron.job
   where jobname in ('rc-purge-deleted-agent-log','rc-queue-expired-vote-proofs','rc-inactive-reminders');
  if n > 0 then
    raise exception '% of these jobs already exist — unschedule them first or skip this migration', n;
  end if;
end $$;

select cron.schedule(
  'rc-purge-deleted-agent-log',
  '20 3 * * *',
  $cron$ select rc_purge_deleted_agent_log(30) $cron$
);

select cron.schedule(
  'rc-queue-expired-vote-proofs',
  '40 3 * * *',
  $cron$ select rc_queue_expired_vote_proofs('vma_2026', 30) $cron$
);

select cron.schedule(
  'rc-inactive-reminders',
  '0 9 * * *',
  $cron$ select rc_invoke_inactive_reminders() $cron$
);

commit;

-- VERIFY (read-only): expect exactly three rows, all active.
--
--   select jobname, schedule, active from cron.job
--    where jobname in ('rc-purge-deleted-agent-log',
--                      'rc-queue-expired-vote-proofs',
--                      'rc-inactive-reminders')
--    order by jobname;
