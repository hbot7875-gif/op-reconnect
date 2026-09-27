-- ROLLBACK for PROPOSED_20260927090000_rc_lock_down_anon_access.sql.
--
-- Replays the snapshot the migration took immediately before revoking, so
-- this restores exactly the 462 grant rows that existed on 33 objects — not
-- a blanket re-grant across all 57 rc_* tables. That distinction matters:
-- migrations 20260819140000 and 20260819143000 had already closed
-- rc_vma_votes, rc_supply_chest_progress, rc_supply_chest_opens,
-- rc_backup_requests, rc_badge_catalog, rc_badge_art and eight functions
-- before this migration ran. Those have no rows in the snapshot, so rolling
-- this back cannot quietly undo their lockdown.
--
-- Safe to run more than once. If the snapshot table is missing, it stops
-- rather than guessing.

do $$
declare
  r record;
  n integer;
begin
  if to_regclass('public.rc_grant_backup_20260927') is null then
    raise exception 'rc_grant_backup_20260927 is missing — cannot restore grants exactly. Do not blanket-grant; recover the snapshot first.';
  end if;

  select count(*) into n from public.rc_grant_backup_20260927;
  if n = 0 then
    raise exception 'grant snapshot exists but is empty — refusing to guess at the pre-migration state';
  end if;
  raise notice 'restoring % recorded grants', n;

  for r in select distinct obj_type, obj_ident, grantee, privilege
             from public.rc_grant_backup_20260927
  loop
    if r.obj_type = 'table' then
      execute format('grant %s on table %s to %s', r.privilege, r.obj_ident, quote_ident(r.grantee));
    elsif r.obj_type = 'sequence' then
      execute format('grant select, update, usage on sequence %s to %s', r.obj_ident, quote_ident(r.grantee));
    elsif r.obj_type = 'function' then
      -- PUBLIC is a keyword, not an identifier, so it must not be quoted.
      execute format('grant execute on function %s to %s', r.obj_ident,
        case when r.grantee = 'PUBLIC' then 'public' else quote_ident(r.grantee) end);
    end if;
  end loop;
end $$;

-- Restore the default privileges the migration narrowed, so newly created
-- objects behave as they did before.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete, truncate, references, trigger on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated;
alter default privileges for role postgres in schema public
  grant select, update, usage on sequences to anon, authenticated;

-- rc_delete_engagement_for_player keeps its pinned search_path. Reverting
-- that would restore a SECURITY DEFINER function with a mutable search_path
-- for no benefit — the body is byte-identical either way, so there is
-- nothing to roll back behaviourally.

-- The snapshot table is deliberately NOT dropped: if a rollback is ever
-- needed twice, or the first attempt is interrupted, it is the only exact
-- record of the pre-migration state. Drop it by hand once you are satisfied:
--   drop table public.rc_grant_backup_20260927;

-- Post-condition: the restore must land on the same counts the snapshot
-- recorded, or the rollback aborts and leaves the lockdown in place rather
-- than a half-restored state.
do $$
declare recorded integer; restored integer;
begin
  select count(*) into recorded
    from public.rc_grant_backup_20260927 where obj_type = 'table';
  select count(*) into restored
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name like 'rc\_%'
     and table_name <> 'rc_grant_backup_20260927'
     and grantee in ('anon', 'authenticated');
  if restored <> recorded then
    raise exception 'restored % table grants but the snapshot recorded % — aborting', restored, recorded;
  end if;
  raise notice 'rollback ok: % table grants restored exactly', restored;
end $$;
