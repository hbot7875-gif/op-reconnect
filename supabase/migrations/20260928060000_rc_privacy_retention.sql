-- Privacy retention: one purge, one deletion queue, two schedules.
--
-- APPLIED IN PRODUCTION. Recorded in supabase_migrations.schema_migrations;
-- verified read-only on 2026-09-29. Do not re-run it: this file is committed as
-- applied history so a clean checkout matches production, not as pending work.
--
-- The header here used to say this file was staged in supabase/pending/ and
-- must be moved before it could run. It was approved, moved and applied; the
-- note outlived the decision it described. rc_purge_agent_data and
-- rc_storage_deletion_queue both exist in production.
--
-- NOTE: the purge function live in production is NOT the one this file
-- creates. 20260928120000 replaced one statement in it — see that file.
--
--
-- WHY THIS IS A QUEUE AND NOT AN UPDATE ... RETURNING
--
-- The first draft of this file did:
--
--     update rc_vma_votes set proof_path = null ... returning proof_path
--
-- which returns the NEW value. Every path came back NULL, the caller had
-- nothing to delete, and 1,852 screenshots would have been stranded in the
-- bucket with every database reference to them erased — unreachable,
-- unlistable, and impossible to clean up afterwards. Verified against this
-- database. RETURNING OLD.col would fix it, but that is PostgreSQL 18 and
-- this project is on 17.6.
--
-- More fundamentally: clearing the row and deleting the file are two writes to
-- two different systems, and anything between them — a crash, a timeout, a
-- storage outage — must not lose the path. So the path is written to a durable
-- queue FIRST, the file is deleted SECOND, and the row is cleared only THIRD,
-- once storage has confirmed. Every step is idempotent and safe to re-run, and
-- a crash at any point leaves the work still queued.
--
-- The same queue is what stops the purge orphaning files. rc_purge_agent_data
-- deletes rc_vma_votes rows but cannot reach Storage; today that is why the
-- bucket already holds 92 files nothing points at. Queueing the agent's paths
-- before their vote rows go closes that.
--
--
-- WHAT THIS MIGRATION DELETES WHEN APPLIED: nothing.
-- It creates a table and functions and schedules two jobs. The first scheduled
-- run afterwards is NOT a no-op, though — see the note above the cron section.

begin;

-- ── The queue ──────────────────────────────────────────────────────────
-- One row per file to remove. Unique on (bucket, path) so re-queueing the
-- same file is a no-op, which is what makes every producer safe to re-run.
create table if not exists rc_storage_deletion_queue (
  id              bigserial primary key,
  bucket          text        not null,
  path            text        not null,
  reason          text        not null,
  queued_at       timestamptz not null default now(),
  attempts        integer     not null default 0,
  last_attempt_at timestamptz,
  last_error      text,
  deleted_at      timestamptz,
  -- Lease. A claim is durable: it survives the claiming transaction, so a
  -- second worker cannot take the same row while the first is still deleting.
  -- It also EXPIRES, so a worker that crashes mid-sweep does not hold the row
  -- for ever — the lease simply lapses and the next sweep picks it up.
  lease_owner     uuid,
  lease_expires_at timestamptz,
  constraint rc_sdq_path_unique unique (bucket, path)
);

-- The worker's hot path: pending rows, oldest first, skipping ones that have
-- failed too often to be worth retrying automatically.
create index if not exists rc_sdq_pending
  on rc_storage_deletion_queue (queued_at)
  where deleted_at is null;

-- Finding lapsed leases to reclaim.
create index if not exists rc_sdq_lease
  on rc_storage_deletion_queue (lease_expires_at)
  where deleted_at is null and lease_owner is not null;

-- Used by the ref-clearing step to find confirmed deletions.
create index if not exists rc_sdq_confirmed
  on rc_storage_deletion_queue (deleted_at)
  where deleted_at is not null;

comment on table rc_storage_deletion_queue is
  'Files awaiting deletion from Storage. A row survives until Storage confirms the file is gone, so a crash between clearing a database reference and deleting the file cannot lose the path.';

-- Attempts beyond this stop being retried automatically. They stay in the
-- queue, visible, rather than being dropped or spun on forever.
create or replace function rc_storage_queue_max_attempts()
returns integer language sql immutable as $$ select 8 $$;


-- ── Producer 1: vote proofs whose event finished long enough ago ───────
-- Queues only. Does not touch rc_vma_votes: the row still points at the file
-- until the file is actually gone.
--
-- p_limit paginates, so an event with far more proofs than one sweep can
-- handle is queued across several runs rather than in one oversized statement.
create or replace function rc_queue_expired_vote_proofs(
  p_event_id text,
  p_days     integer default 30,
  p_limit    integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ends_at timestamptz;
  n integer;
begin
  select (value ->> 'period_end_utc')::timestamptz into ends_at
    from rc_config where key = p_event_id;

  -- No such event, malformed config, or simply not due yet.
  if ends_at is null or now() < ends_at + make_interval(days => p_days) then
    return 0;
  end if;

  insert into rc_storage_deletion_queue (bucket, path, reason)
  select distinct 'vma-vote-proofs', v.proof_path, 'vote_proof_expired'
    from rc_vma_votes v
   where v.event_id = p_event_id
     and v.proof_path is not null
     -- A path shared with a vote that is NOT expired must not be deleted.
     -- No such path exists today (1,852 paths across 1,852 rows), but a
     -- future event that reuses one would otherwise lose a live proof.
     and not exists (
       select 1 from rc_vma_votes o
        where o.proof_path = v.proof_path
          and o.event_id <> p_event_id
     )
   order by 2
   limit p_limit
  on conflict (bucket, path) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;


-- ── Producer 2: everything one agent uploaded ─────────────────────────
-- Called from inside rc_purge_agent_data, BEFORE their vote rows are deleted —
-- after that the paths are unrecoverable.
create or replace function rc_queue_agent_proof_files(p_agent_no text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  insert into rc_storage_deletion_queue (bucket, path, reason)
  select distinct 'vma-vote-proofs', v.proof_path, 'agent_purged'
    from rc_vma_votes v
   where v.agent_no = p_agent_no
     and v.proof_path is not null
     -- Never delete a file another agent's vote still points at.
     and not exists (
       select 1 from rc_vma_votes o
        where o.proof_path = v.proof_path and o.agent_no <> p_agent_no
     )
  on conflict (bucket, path) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ── The worker's calls ────────────────────────────────────────────────
--
-- WHY A LEASE AND NOT JUST SKIP LOCKED.
--
-- The first version of this claim used FOR UPDATE SKIP LOCKED and stamped
-- last_attempt_at. That is not enough over PostgREST. An RPC is one statement
-- in its own transaction: it commits the moment it returns, and the row locks
-- go with it. The worker then spends seconds talking to Storage with nothing
-- holding those rows — and nothing in the claim's own WHERE clause excluded a
-- row that had just been claimed, because last_attempt_at was written but
-- never read. A second sweep starting in that window took the identical set.
--
-- So the claim is now DURABLE: it writes a lease_owner and a lease_expires_at
-- that outlive the transaction, and the claim predicate skips any row whose
-- lease is still live. SKIP LOCKED stays, but only to stop two simultaneous
-- claims blocking on each other.
--
-- The lease EXPIRES, which is what makes a crashed worker recoverable: it
-- holds nothing for ever, the lease simply lapses and the next sweep reclaims
-- the row. A lease is not a guarantee the work happened — completion is
-- checked separately, below.
create or replace function rc_storage_lease_seconds()
returns integer language sql immutable as $$ select 900 $$;   -- 15 minutes

-- p_reason isolates a rehearsal from production, in BOTH directions:
--
--   * a normal sweep passes nothing and never claims a 'qa' row, so the
--     hourly job cannot wander into a test in progress;
--   * a rehearsal passes 'qa' and can claim nothing else, so a test sweep
--     cannot delete one of the 92 real orphans by accident.
--
-- Without this the only thing standing between a rehearsal and real files
-- would be remembering to empty the queue first.
create or replace function rc_next_storage_deletions(
  p_limit integer default 100,
  p_owner uuid default gen_random_uuid(),
  p_reason text default null
)
returns table (id bigint, bucket text, path text, lease_owner uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner uuid := coalesce(p_owner, gen_random_uuid());
begin
  return query
  with claimed as (
    select q.id
      from rc_storage_deletion_queue q
     where q.deleted_at is null
       and q.attempts < rc_storage_queue_max_attempts()
       -- Free, or the previous holder's lease has lapsed.
       and (q.lease_expires_at is null or q.lease_expires_at < now())
       and (case when p_reason is null then q.reason <> 'qa' else q.reason = p_reason end)
     order by q.queued_at, q.id
     limit greatest(1, p_limit)
     for update skip locked
  )
  update rc_storage_deletion_queue u
     set lease_owner = owner,
         lease_expires_at = now() + make_interval(secs => rc_storage_lease_seconds()),
         last_attempt_at = now()
    from claimed
   where u.id = claimed.id
  returning u.id, u.bucket, u.path, u.lease_owner;
end;
$$;

-- Completion is ownership-checked. A worker whose lease lapsed while it was
-- talking to Storage — a long GC pause, a slow bucket — must NOT be able to
-- mark rows another worker has since taken: it would report someone else's
-- work as its own, and could mark a row that has since been re-queued for a
-- file that was uploaded again under the same path.
--
-- The count these return is the number of rows the caller actually owned, so
-- a worker can see it lost a race rather than silently over-reporting.
create or replace function rc_mark_storage_deleted(p_ids bigint[], p_owner uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update rc_storage_deletion_queue
     set deleted_at = now(), last_error = null, last_attempt_at = now(),
         lease_owner = null, lease_expires_at = null
   where id = any(p_ids)
     and deleted_at is null
     and lease_owner = p_owner
     and lease_expires_at >= now();
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function rc_mark_storage_failed(p_ids bigint[], p_error text, p_owner uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  -- Releases the lease as well as recording the failure, so the row is
  -- retryable immediately rather than after the lease runs out.
  update rc_storage_deletion_queue
     set attempts = attempts + 1,
         last_attempt_at = now(),
         last_error = left(coalesce(p_error, 'unknown'), 500),
         lease_owner = null, lease_expires_at = null
   where id = any(p_ids)
     and deleted_at is null
     and lease_owner = p_owner
     and lease_expires_at >= now();
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ── The third step: clear references, but only to confirmed-gone files ─
-- Runs after the worker. A vote row keeps pointing at its screenshot until
-- the screenshot is actually gone, so the pointer is never the thing that
-- goes missing first.
--
-- ocr_text goes with the path: it is text read off a screenshot of somebody's
-- own account, and is no more ours to keep than the image was.
--
-- image_hash is KEPT. It is what rc_vma_submit_vote checks to reject a
-- duplicate screenshot, and that check is global rather than per-event, so
-- clearing it would let an old screenshot be resubmitted to a future event.
-- It is a fingerprint of an image rather than of a person, and the row it
-- sits on keeps agent_no regardless — so dropping it would weaken a working
-- anti-abuse control without making the row any less identifying. See the
-- note in the accompanying report; this is the owner's call to reverse.
create or replace function rc_clear_expired_proof_refs(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  with gone as (
    select q.path
      from rc_storage_deletion_queue q
     where q.bucket = 'vma-vote-proofs'
       and q.deleted_at is not null
       and q.reason <> 'qa'      -- a rehearsal never touches rc_vma_votes
     limit p_limit
  )
  update rc_vma_votes v
     set proof_path = null, ocr_text = null
    from gone
   where v.proof_path = gone.path;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ── The single per-agent purge ────────────────────────────────────────
-- Extracted from rc_delete_inactive_agents_scheduled so there is exactly ONE
-- list of tables. Two copies of a 30-table delete list is how a "deleted"
-- account quietly keeps data: one copy gets a new table, the other does not.
--
-- Runs inside the caller's transaction. If any statement raises, the whole
-- purge rolls back and the account is untouched — including the log row, so a
-- half-deleted account can never be recorded as deleted.
create or replace function rc_purge_agent_data(p_agent_no text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select a.agent_no, a.handle, a.email, a.lb_username, a.created_at as joined_at, p.codename
    into r
    from rc_agents a
    left join rc_players p on p.agent_no = a.agent_no
   where a.agent_no = p_agent_no
   for update of a;                -- no concurrent purge of the same account

  if not found then
    return false;
  end if;

  -- BEFORE the vote rows go: once they are deleted the paths are gone.
  perform rc_queue_agent_proof_files(r.agent_no);

  insert into rc_deleted_agent_log (agent_no, handle, email, codename, lb_username, joined_at, reason)
  values (r.agent_no, r.handle, r.email, r.codename, r.lb_username, r.joined_at, p_reason);

  -- Unchanged from the original job, in the original order.
  delete from rc_reconnect_puzzle_attempts where agent_no = r.agent_no;
  delete from rc_reconnect_participants where agent_no = r.agent_no;
  update rc_reconnect_participants set invited_by = null where invited_by = r.agent_no;
  delete from rc_reconnect_missions where created_by = r.agent_no;
  delete from rc_defuse_contrib where agent_no = r.agent_no;
  delete from rc_backup_requests where owner_agent_no = r.agent_no;
  update rc_backup_requests set helper_agent_no = null where helper_agent_no = r.agent_no;
  delete from rc_player_items where agent_no = r.agent_no;
  delete from rc_streak_freeze_log where agent_no = r.agent_no;
  delete from rc_badges where agent_no = r.agent_no;
  delete from rc_xp_ledger where agent_no = r.agent_no;
  delete from rc_daily_activity where agent_no = r.agent_no;
  delete from rc_player_districts where agent_no = r.agent_no;
  delete from rc_agent_lit_eras where agent_no = r.agent_no;
  delete from rc_agent_charge where agent_no = r.agent_no;
  delete from rc_feed_events where agent_no = r.agent_no;
  delete from rc_reconnect_messages where agent_no = r.agent_no;
  delete from rc_suggestions where agent_no = r.agent_no;
  update generated_playlists set agent_no = null where agent_no = r.agent_no;
  delete from rc_scrobbles where agent_no = r.agent_no;
  delete from rc_password_resets where agent_no = r.agent_no;
  delete from rc_playlist_reports where agent_no = r.agent_no;
  delete from rc_playlist_saves where agent_no = r.agent_no;
  delete from rc_supply_chest_opens where agent_no = r.agent_no;
  delete from rc_supply_chest_progress where agent_no = r.agent_no;
  delete from rc_vma_community_chest_claims where agent_no = r.agent_no;
  delete from rc_vma_votes where agent_no = r.agent_no;

  -- Seven tables that neither cascaded from rc_agents nor appeared in the
  -- original list, so an agent's rows in them survived deletion.
  delete from rc_defuse_messages where agent_no = r.agent_no;
  delete from rc_engagement_events where agent_no = r.agent_no;
  delete from rc_share_snapshots where created_by = r.agent_no;
  delete from rc_recelebrate_presence where agent_no = r.agent_no;
  delete from rc_recelebrate_passes where agent_no = r.agent_no;
  delete from rc_recelebrate_battle_streams where agent_no = r.agent_no;
  delete from rc_recelebrate_after_party_claims where agent_no = r.agent_no;

  -- Badge artwork is SHARED: other agents wear badges awarded from this
  -- person's uploads. The photo stays so those badges keep their picture;
  -- only the link to the uploader goes.
  update rc_badge_art set uploaded_by = null where uploaded_by = r.agent_no;

  delete from rc_players where agent_no = r.agent_no;
  delete from rc_agents where agent_no = r.agent_no;
  return true;
end;
$$;


-- ── Warning delivery, recorded ────────────────────────────────────────
-- Terms §6 and the Privacy Policy both promise an email before an inactive
-- file is deleted. Until now nothing recorded whether one was ever sent, so
-- the promise could not be enforced and a double-run of the job would simply
-- email the same person twice.
create table if not exists rc_inactivity_warnings (
  agent_no          text primary key references rc_agents(agent_no) on delete cascade,
  first_warned_at   timestamptz not null default now(),
  last_warned_at    timestamptz,          -- last SUCCESSFUL delivery
  last_attempt_at   timestamptz not null default now(),
  warn_count        integer     not null default 0,
  last_delivery_ok  boolean     not null default false,
  last_error        text
);

comment on table rc_inactivity_warnings is
  'Proof that an inactive-file warning was delivered. The deletion sweep will not remove an account that has a usable email address but no delivered warning.';

revoke all on table rc_inactivity_warnings from public, anon, authenticated;
grant select, insert, update, delete on table rc_inactivity_warnings to service_role;

-- How long after a delivered warning the sweep may act. Two days, so a warning
-- and the deletion it warns about can never land within the same day even if
-- the job runs late.
create or replace function rc_warning_notice_days()
returns integer language sql immutable as $$ select 2 $$;

-- How long a delivered warning stays valid. Beyond this the agent has been
-- through the band again and needs a fresh one.
create or replace function rc_warning_valid_days()
returns integer language sql immutable as $$ select 45 $$;

-- Mail providers echo the recipient back in their error text. sendMail
-- already returns fixed codes rather than provider bodies, but this table
-- outlives any one version of that function, and an address landing here
-- would be personal data nobody intended to store. Anything address-shaped is
-- replaced before it is written.
create or replace function rc_scrub_mail_error(p_error text)
returns text
language sql
immutable
as $$
  select case
           when p_error is null or p_error = '' then null
           else left(regexp_replace(p_error, '[[:alnum:]._%%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[address]', 'g'), 200)
         end
$$;

-- Called by the Edge Function after each send attempt.
create or replace function rc_record_inactivity_warning(
  p_agent_no text,
  p_ok       boolean,
  p_error    text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into rc_inactivity_warnings
    (agent_no, first_warned_at, last_warned_at, last_attempt_at, warn_count, last_delivery_ok, last_error)
  values
    (p_agent_no, now(), case when p_ok then now() end, now(), case when p_ok then 1 else 0 end, p_ok,
     rc_scrub_mail_error(p_error))
  on conflict (agent_no) do update
    set last_attempt_at  = now(),
        last_warned_at   = case when p_ok then now() else rc_inactivity_warnings.last_warned_at end,
        warn_count       = rc_inactivity_warnings.warn_count + case when p_ok then 1 else 0 end,
        last_delivery_ok = p_ok,
        last_error       = case when p_ok then null else rc_scrub_mail_error(p_error) end;
end;
$$;

-- Who still needs one. Feeds the reminder job, and is the same predicate the
-- deletion gate uses inverted — so the two can never disagree about what
-- "warned" means. p_within_hours suppresses a second email when the job runs
-- twice in a day.
create or replace function rc_agents_awaiting_warning(
  p_min_days      integer default 9,
  p_within_hours  integer default 20
)
returns table (agent_no text, days_inactive numeric)
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.agent_no, c.days_inactive
    from rc_inactive_agent_candidates(p_min_days) c
    left join rc_inactivity_warnings w on w.agent_no = c.agent_no
   where w.agent_no is null
      or (
        -- Not warned successfully inside the suppression window, and either
        -- never delivered or delivered so long ago it has lapsed.
        coalesce(w.last_attempt_at, '-infinity'::timestamptz) < now() - make_interval(hours => p_within_hours)
        and (
          w.last_warned_at is null
          or w.last_warned_at < now() - make_interval(days => rc_warning_valid_days())
        )
      )
$$;

-- ── The inactivity job now delegates ──────────────────────────────────
-- Unchanged behaviour: same 14-day default, same candidate function, so
-- approved leave still pauses the clock exactly as it does today.
create or replace function rc_delete_inactive_agents_scheduled(p_inactive_days integer default 14)
returns table (deleted_agent_no text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  -- THE GATE. An account with a usable email address is not deleted until a
  -- warning has actually been delivered and had time to be read. Without this
  -- the promise in Terms §6 was only as reliable as the reminder job, and the
  -- reminder job was not even scheduled.
  --
  -- An account with no address is still deleted on time: there is no warning
  -- we could send, and holding it for ever would keep the data longer, not
  -- less, which is the opposite of the point.
  for r in
    select c.agent_no
      from rc_inactive_agent_candidates(p_inactive_days) c
      join rc_agents a on a.agent_no = c.agent_no
      left join rc_inactivity_warnings w on w.agent_no = c.agent_no
     where coalesce(a.email, '') = ''
        or (
          w.last_warned_at is not null
          and w.last_warned_at <= now() - make_interval(days => rc_warning_notice_days())
          and w.last_warned_at >= now() - make_interval(days => rc_warning_valid_days())
        )
  loop
    if rc_purge_agent_data(r.agent_no, 'inactive_' || p_inactive_days || 'd') then
      deleted_agent_no := r.agent_no;
      return next;
    end if;
  end loop;
end;
$$;


-- ── The deletion log forgets after 30 days ────────────────────────────
create or replace function rc_purge_deleted_agent_log(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  delete from rc_deleted_agent_log
   where deleted_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;


-- ── Privileges ────────────────────────────────────────────────────────
-- Every function here is SECURITY DEFINER and owned by postgres, so each one
-- must be unreachable from PostgREST. The database lockdown (migration
-- 20260927090000) already revoked EXECUTE from anon and authenticated at the
-- schema level; these are new functions, so they are revoked explicitly and
-- granted only to service_role, which is the only identity the Edge Function
-- and pg_cron use.
do $$
declare f text;
begin
  foreach f in array array[
    'rc_queue_expired_vote_proofs(text, integer, integer)',
    'rc_queue_agent_proof_files(text)',
    'rc_next_storage_deletions(integer, uuid, text)',
    'rc_storage_lease_seconds()',
    'rc_warning_valid_days()',
    'rc_warning_notice_days()',
    'rc_scrub_mail_error(text)',
    'rc_agents_awaiting_warning(integer, integer)',
    'rc_record_inactivity_warning(text, boolean, text)',
    'rc_mark_storage_deleted(bigint[], uuid)',
    'rc_mark_storage_failed(bigint[], text, uuid)',
    'rc_clear_expired_proof_refs(integer)',
    'rc_purge_agent_data(text, text)',
    'rc_purge_deleted_agent_log(integer)',
    'rc_delete_inactive_agents_scheduled(integer)',
    'rc_storage_queue_max_attempts()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- The queue itself is service-role only. No player ever reads it.
revoke all on table rc_storage_deletion_queue from public, anon, authenticated;
revoke all on sequence rc_storage_deletion_queue_id_seq from public, anon, authenticated;
grant select, insert, update on table rc_storage_deletion_queue to service_role;
grant usage on sequence rc_storage_deletion_queue_id_seq to service_role;

commit;


-- ── NO SCHEDULES HERE. THIS IS STAGE 2A. ─────────────────────────────
--
-- This migration installs machinery and changes behaviour. It starts nothing.
--
-- Applying it:
--   * creates rc_storage_deletion_queue and rc_inactivity_warnings
--   * creates the purge, queue, lease, warning and gate functions
--   * REPLACES rc_delete_inactive_agents_scheduled with the gated version,
--     which the EXISTING 18:00 job will then use
--   * sends 0 emails, deletes 0 log rows, queues 0 proof deletions,
--     purges 0 agents, touches 0 files
--
-- The three cron jobs that would make any of that happen on a timer live in
-- Stage 2B (20260928HHMMSS_rc_privacy_retention_schedules.sql) and are applied
-- separately, after this has been verified in place.
--
-- One behaviour DOES change the moment this lands, with no cron involved: the
-- existing rc-delete-inactive-agents job at 18:00 starts calling the gated
-- function. From then on an account with a usable email address cannot be
-- deleted until a warning has been delivered and two days have passed. Since
-- no warnings exist yet, that pauses email-holding deletions rather than
-- causing any — the safe direction, and currently moot at 0 candidates.
-- Queueing is safe in SQL; the deletion itself is not, so no cron job ever
-- calls the worker. rc_queue_expired_vote_proofs only writes rows to the
-- queue, and the Edge Function sweep (lib/proof-retention.ts, riding the
-- hourly sync) is what talks to Storage and then clears the references.

-- ── The warning email, which was never actually scheduled ─────────────
-- Terms §6 and the Privacy Policy both say a warning is emailed before an
-- inactive file is deleted. rc-delete-inactive-agents has run daily since
-- August; sendInactiveReminders has only ever been an admin route somebody
-- had to remember to press. So the promise has been resting on a manual step.
--
-- This schedules it for 09:00 UTC, nine hours before the 18:00 deletion, so a
-- warning and the deletion it warns about can never land on the same agent in
-- the same day. The handler's own 9–14 day band is deliberately narrower than
-- the deletion's threshold, so it cannot email someone the sweep is about to
-- take anyway.
--
-- Mirrors rc_invoke_stream_capture exactly, including the Vault token.
create or replace function rc_invoke_inactive_reminders()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cron_token text;
  request_id bigint;
begin
  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;

  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; inactivity reminders skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronInactiveReminders', 'cronToken', cron_token)
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function rc_invoke_inactive_reminders() from public, anon, authenticated;
grant execute on function rc_invoke_inactive_reminders() to service_role;

