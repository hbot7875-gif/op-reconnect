-- PROPOSED — NOT APPLIED. Rename off the PROPOSED_ prefix to run it.
-- Rollback: PROPOSED_20260927090000_rollback.sql
--
-- Close direct PostgREST access to this project's own tables and functions.
--
-- WHY THIS IS SAFE. Every legitimate caller reaches the database as a role
-- this migration does not touch:
--   * the Edge Function connects with SUPABASE_SERVICE_ROLE_KEY (index.ts);
--     service_role bypasses RLS and keeps every grant below;
--   * all four pg_cron jobs run as `postgres`, which owns all 74 rc_*
--     objects and is unaffected by grants to other roles;
--   * the Web Scrobbler / Pano Scrobbler webhooks and the /share/* Worker
--     route both POST to the Edge Function, not to PostgREST.
-- Nothing in js/, worker/, public/js/ or any HTML page builds a Supabase
-- client, embeds an anon key, or opens a Realtime channel. anon and
-- authenticated are unused roles in this project.
--
-- WHAT IS CURRENTLY REACHABLE, measured rather than assumed:
--   * 33 rc_* tables carry anon + authenticated grants, and not read-only
--     ones: the full set, SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--     TRIGGER — 462 grant rows in all. 28 of those tables have no RLS, so
--     the grants are live. The other five (rc_agents, rc_share_snapshots,
--     rc_engagement_events, rc_stream_sync_locks, rc_stream_sync_state)
--     have RLS on with ZERO policies, which already denies anon; their
--     grants are inert and are cleared here so both layers agree.
--   * 21 rc_* functions are EXECUTE-able by anon, 12 of them SECURITY
--     DEFINER. Those run as their owner, so revoking table grants alone
--     would NOT have stopped them — rc_drop_district_item (a free item),
--     rc_feed_charge / rc_auto_feed_charge / rc_credit_charge_cells (free
--     charge), rc_claim_jk_birthday_2026 (a badge for any agent_no),
--     rc_admin_fill_reconnect_team, and the stream-sync lock/token
--     functions. Closing the tables without the functions would have looked
--     like a fix while leaving the capability grants open.
--
-- Same lockdown pattern migrations 20260819140000 and 20260819143000
-- already applied to a subset; this generalises it to every rc_* object
-- instead of naming them one at a time.

-- ── 0. Preconditions ─────────────────────────────────────────────────────
-- db push runs each migration in a transaction, so any exception raised here
-- aborts the whole thing and leaves the database exactly as it was. These
-- checks exist so a wrong assumption fails loudly at deploy time instead of
-- silently locking out a role the app depends on.
do $$
declare missing text;
begin
  select string_agg(r, ', ') into missing
    from unnest(array['anon', 'authenticated', 'service_role', 'postgres']) r
   where not exists (select 1 from pg_roles where rolname = r);
  if missing is not null then
    raise exception 'expected roles missing: % — refusing to change grants', missing;
  end if;

  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname like 'rc\_%') then
    raise exception 'no rc_* objects found in public — wrong database?';
  end if;

  -- Every rc_* object must be owned by postgres, or the ALTER DEFAULT
  -- PRIVILEGES in step 6 would not govern objects created later.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind in ('r','p','S')
                and c.relname like 'rc\_%' and c.relowner <> 'postgres'::regrole) then
    raise exception 'some rc_* objects are not owned by postgres — review before locking down';
  end if;
end $$;

-- ── 1. Snapshot the exact pre-migration grants ───────────────────────────
-- So the rollback restores precisely what existed rather than blanket-
-- granting. Tables that earlier lockdowns had already closed have no rows
-- here, so a rollback cannot silently re-open them.
create table if not exists public.rc_grant_backup_20260927 (
  obj_type text not null,
  obj_ident text not null,
  grantee text not null,
  privilege text not null
);

-- Locked the moment it exists, so the record of who could reach what is
-- never itself reachable — the table loop below would also catch it, but
-- that leaves a window and relies on a naming coincidence.
revoke all on table public.rc_grant_backup_20260927 from public, anon, authenticated;

insert into public.rc_grant_backup_20260927 (obj_type, obj_ident, grantee, privilege)
select 'table', quote_ident(table_schema) || '.' || quote_ident(table_name), grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name like 'rc\_%'
   -- The snapshot table is created a moment ago and so picks up the same
   -- default anon grants as everything else. Recording them would make the
   -- rollback re-grant on a table that did not exist before this migration,
   -- leaving a new anon-writable table behind: 476 restored grants instead
   -- of the 462 that were actually there. Exclude it.
   and table_name <> 'rc_grant_backup_20260927'
   and grantee in ('anon', 'authenticated')
   and not exists (select 1 from public.rc_grant_backup_20260927);

insert into public.rc_grant_backup_20260927 (obj_type, obj_ident, grantee, privilege)
select 'function', p.oid::regprocedure::text, g.grantee, 'EXECUTE'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 cross join (values ('anon'), ('authenticated'), ('PUBLIC')) as g(grantee)
 where n.nspname = 'public' and p.proname like 'rc\_%'
   and has_function_privilege(
         case when g.grantee = 'PUBLIC' then 'public' else g.grantee end, p.oid, 'EXECUTE')
   and not exists (select 1 from public.rc_grant_backup_20260927 where obj_type = 'function');

insert into public.rc_grant_backup_20260927 (obj_type, obj_ident, grantee, privilege)
select 'sequence', c.oid::regclass::text, g.grantee, 'ALL'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 cross join (values ('anon'), ('authenticated')) as g(grantee)
 where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'rc\_%'
   and has_sequence_privilege(g.grantee, c.oid, 'SELECT')
   and not exists (select 1 from public.rc_grant_backup_20260927 where obj_type = 'sequence');

-- ── 2. Tables ────────────────────────────────────────────────────────────
-- A loop by name rather than 33 hand-typed statements, so it cannot miss one
-- or typo one. The snapshot table above matches rc\_% too and is locked down
-- with everything else.
do $$
declare r record;
begin
  for r in
    select c.oid::regclass::text as tbl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'rc\_%'
  loop
    execute format('revoke all on table %s from anon, authenticated', r.tbl);
  end loop;
end $$;

-- ── 3. Functions ─────────────────────────────────────────────────────────
-- Table grants do nothing for a SECURITY DEFINER function, so these need
-- their own revoke. service_role is granted back explicitly because the Edge
-- Function calls many of these through supabase.rpc(); postgres keeps access
-- as owner, which is what the pg_cron jobs run as.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'rc\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ── 4. Sequences ─────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select c.oid::regclass::text as seq
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'rc\_%'
  loop
    execute format('revoke all on sequence %s from anon, authenticated', r.seq);
  end loop;
end $$;

-- ── 5. One deviation found while reviewing all 52 SECURITY DEFINER bodies ─
-- rc_delete_engagement_for_player is the only one of the 52 with no pinned
-- search_path, and it references rc_engagement_events unqualified. It is a
-- TRIGGER function, so it was never reachable through PostgREST regardless
-- — this is closing the last gap against search_path hijacking, and making
-- it match the convention every other function here already follows.
-- Body is unchanged.
create or replace function public.rc_delete_engagement_for_player()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from rc_engagement_events where agent_no = old.agent_no;
  return old;
end;
$$;

-- ── 6. Stop future objects being re-exposed ──────────────────────────────
-- The root cause, and why the earlier lockdowns had to keep naming tables:
-- pg_default_acl grants anon and authenticated on every newly created object
-- in `public`. There are six such entries — three owned by supabase_admin
-- and three by postgres. All 74 rc_* objects are owned by postgres and every
-- migration runs as postgres, so the postgres-owned defaults are the ones
-- that actually apply here, and postgres may alter its own. Verified in a
-- rolled-back transaction: a table created after this change comes up with
-- anon = false while service_role and postgres keep access.
--
-- The supabase_admin-owned defaults are left alone — they are platform
-- state, they apply to objects supabase_admin creates rather than ours, and
-- postgres cannot alter them.
--
-- NOTE FOR THE SITE OWNER: this makes "not exposed to anon" the default for
-- every future table in public. If a genuinely public, Supabase-client-read
-- table is ever wanted, it will need an explicit grant plus RLS.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- ── 7. Post-conditions ───────────────────────────────────────────────────
-- Assert the end state rather than trusting the loops. Any failure here
-- aborts the migration's transaction, so a partial lockdown cannot ship.
do $$
declare
  leftover_tbl integer;
  leftover_fn integer;
  svc_fn integer;
  total_fn integer;
  snap_open integer;
  snap_rows integer;
begin
  select count(*) into leftover_tbl
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'rc\_%'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leftover_tbl > 0 then
    raise exception 'still % anon/authenticated/PUBLIC table grants after lockdown', leftover_tbl;
  end if;

  select count(*) into leftover_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'rc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if leftover_fn > 0 then
    raise exception 'anon can still execute % rc_* functions', leftover_fn;
  end if;

  -- The one that would actually break the game: service_role is how the
  -- Edge Function reaches every RPC.
  select count(*) into total_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'rc\_%';
  select count(*) into svc_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'rc\_%'
     and has_function_privilege('service_role', p.oid, 'EXECUTE');
  if svc_fn <> total_fn then
    raise exception 'service_role lost EXECUTE: % of % functions — aborting', svc_fn, total_fn;
  end if;

  select count(*) into snap_open
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'rc_grant_backup_20260927'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if snap_open > 0 then
    raise exception 'the grant snapshot is itself readable by anon/authenticated';
  end if;

  select count(*) into snap_rows from public.rc_grant_backup_20260927;
  if snap_rows = 0 then
    raise exception 'grant snapshot is empty — rollback would have nothing to restore';
  end if;

  raise notice 'lockdown ok: % grants recorded, service_role retains %/% functions', snap_rows, svc_fn, total_fn;
end $$;
