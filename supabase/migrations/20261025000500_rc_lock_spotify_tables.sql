-- Close the last three tables the browser roles could reach.
--
-- spotify_oauth, bts_song_catalog and spotify_filler_library were created
-- outside these migrations with RLS off and the platform's default grants, so
-- anon and authenticated could SELECT, INSERT, UPDATE and DELETE every row —
-- spotify_oauth included. Nothing in the app touches them with a browser key:
-- the Edge Function reads and writes all three with the service role
-- (lib/spotify-oauth.ts, spotify-catalog.ts, spotify-filler.ts), which
-- bypasses RLS and these grants. 20260927090000_rc_lock_down_anon_access.sql
-- gave every rc_* object this posture; these were missed because they aren't
-- rc_*.
--
-- This is also what lets the RUN AMI Realtime subscriber ship the project's
-- publishable key (js/run-ami-realtime.js): with these closed, that key reaches
-- no table or function at all (verified against pg_class/pg_proc before
-- release).
do $$
declare
  t text;
begin
  foreach t in array array['spotify_oauth', 'bts_song_catalog', 'spotify_filler_library'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
