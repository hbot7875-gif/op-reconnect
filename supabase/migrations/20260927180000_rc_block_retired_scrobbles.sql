-- Stage 1 safeguard: the database refuses to store listening history for an
-- account that has retired.
--
-- APPLIED IN PRODUCTION. Recorded in supabase_migrations.schema_migrations;
-- verified read-only on 2026-09-29. Do not re-run it: this file is committed as
-- applied history so a clean checkout matches production, not as pending work.
--
-- Deliberately its own file, and deliberately tiny: this is the only migration
-- Stage 1 needed. It does not depend on the retention migration
-- (20260927150000) and that one does not depend on this. Either could be
-- applied without the other; both now are. The trigger it creates,
-- rc_scrobbles_block_retired, is present and enabled in production.
--
--
-- WHY A TRIGGER AND NOT JUST THE APPLICATION CHECKS
--
-- The application now filters retired agents in four places — the 5-minute
-- capture, the hourly fleet sync, the webhook PIN lookup, and persistScrobbles
-- itself. That is four separate predicates which have already drifted apart
-- once: the capture and the sync both read every row in rc_agents and stored
-- 19,519 scrobbles belonging to people who had left.
--
-- Two things application checks cannot fix:
--
--   * THE RACE. persistScrobbles asks "has this agent retired?", gets an
--     answer, builds a payload and upserts. An account that retires in the
--     gap between the question and the write still gets written to. The gap
--     is small and the race is unlikely, but the fix costs one index lookup.
--
--   * THE NEXT CALLER. Someone adds a fifth path in six months and does not
--     know about any of this. The trigger does not care where the insert came
--     from.
--
--
-- WHAT IT DOES WHEN APPLIED: nothing, immediately. It creates a function and
-- a trigger. No existing row is read, changed or deleted. It only affects
-- INSERTs made after it exists.
--
--
-- SILENT, NOT LOUD
--
-- It returns NULL rather than raising. A retired agent's row is skipped and
-- the rest of the batch lands. Raising would abort an entire multi-row upsert
-- because of one bad row, which would turn a privacy safeguard into an
-- outage — and the application layer already reports the condition properly.
-- This is the backstop, not the diagnosis.
--
--
-- WHY UPDATE IS COVERED TOO
--
-- Both writers currently upsert with ignoreDuplicates: true, which PostgREST
-- renders as ON CONFLICT DO NOTHING — so no UPDATE is issued against this
-- table today, and covering UPDATE costs nothing. It is covered anyway
-- because that is one boolean away from changing: flipping ignoreDuplicates
-- to false turns the same call into ON CONFLICT DO UPDATE, which would write
-- to an existing row on a path an INSERT-only trigger never sees. A safeguard
-- that silently stops applying when someone changes an unrelated-looking flag
-- is not a safeguard.
--
-- DELETE is deliberately NOT covered: the purge has to be able to remove a
-- retired agent's rows.
--
--
-- A MISSING AGENT ROW IS THE FOREIGN KEY'S JOB, NOT THIS TRIGGER'S
--
-- rc_scrobbles.agent_no carries
--   FOREIGN KEY (agent_no) REFERENCES rc_agents(agent_no) ON DELETE CASCADE
-- so a scrobble for an agent that does not exist cannot be inserted at all —
-- the constraint rejects it loudly. This trigger deliberately does not also
-- block that case: silently skipping a row that violates a foreign key would
-- turn a clear constraint error into invisible data loss, which is a worse
-- failure than the one it would be guarding against. The application guard
-- (assertMayCollect) refuses a missing row for its own reasons, before the
-- write is ever attempted.
--
--
-- CONCURRENCY
--
-- The trigger's lookup runs inside the inserting transaction and, under READ
-- COMMITTED, takes its own snapshot — so a retirement committed before the
-- trigger fires is seen and the row is skipped.
--
-- The remaining window is a retirement committing AFTER the trigger's lookup
-- but before the insert commits. For the path that matters this closes
-- itself: retiring runs rc_purge_agent_data, which deletes the rc_agents row,
-- and the ON DELETE CASCADE above removes any scrobble that landed in that
-- window. A row left behind would need an account marked retired_at whose
-- agent row is never deleted — which is the pre-existing state of the 13
-- legacy accounts, none of which are racing anything.
--
-- COST: one primary-key lookup on rc_agents (114 rows) per inserted or
-- updated scrobble. Updates are currently zero.

begin;

create or replace function rc_block_retired_scrobbles()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- NEW.agent_no is the right column for both operations: on an UPDATE it is
  -- the value the row would end up with, which is what must not be written.
  if exists (
    select 1 from rc_agents a
     where a.agent_no = new.agent_no
       and a.retired_at is not null
  ) then
    return null;   -- skip this row; the rest of the batch is unaffected
  end if;
  return new;
end;
$$;

revoke all on function rc_block_retired_scrobbles() from public, anon, authenticated;

drop trigger if exists rc_scrobbles_block_retired on rc_scrobbles;

create trigger rc_scrobbles_block_retired
  before insert or update on rc_scrobbles
  for each row execute function rc_block_retired_scrobbles();

commit;

-- VERIFY, after applying (read-only):
--
--   select tgname, tgtype, tgenabled from pg_trigger
--    where tgrelid = 'rc_scrobbles'::regclass and not tgisinternal;
--   -- expect rc_scrobbles_block_retired, enabled ('O'), covering INSERT+UPDATE
--
-- And the behavioural check, on AGENT001 (the disposable test account) only —
-- never a real one. Run it as one block so the account cannot be left retired:
--
--   begin;
--   update rc_agents set retired_at = now() where agent_no = 'AGENT001';
--
--   -- INSERT must be skipped
--   insert into rc_scrobbles (agent_no, track_name, artist_name, listened_at, source)
--   values ('AGENT001', 'trigger test', 'test', extract(epoch from now())::bigint, 'qa');
--   select count(*) from rc_scrobbles where agent_no='AGENT001' and source='qa';   -- expect 0
--
--   -- UPDATE must be skipped too: try to move an existing row onto the
--   -- retired agent and confirm nothing changes.
--   rollback;   -- leaves AGENT001 active and the table untouched
--
-- ROLLBACK
--
--   drop trigger if exists rc_scrobbles_block_retired on rc_scrobbles;
--   drop function if exists rc_block_retired_scrobbles();
