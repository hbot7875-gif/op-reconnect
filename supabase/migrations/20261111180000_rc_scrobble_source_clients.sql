-- Every ListenBrainz app that reported one stored listen.
--
-- rc_scrobbles keeps one row per (agent, second, title). When two apps on one
-- ListenBrainz account submit the same listen at the same second (the Last.fm
-- importer carrying Pano's scrobble, or the importer carrying a Spotify play
-- that LB's own reader also submitted), the table stores ONE row, and
-- source_client can name only one of them. The 2026-11-11 backfill left
-- source_client null on 24,166 such rows rather than pick one.
--
-- lib/listen-copies.ts needs to know the row belongs to ALL those apps: a
-- third app's later report of the same listen (LB's reader ~one track length
-- later) is then recognised as a copy, and a day mixing these rows with
-- another source is judged per app instead of counting both.
--
-- Nullable and informational, filled only where ListenBrainz itself shows two
-- or more apps at that exact second and title (never guessed). source_client
-- is not touched by it. The unique key is unchanged, so this column cannot
-- add, suppress or merge a row.
alter table public.rc_scrobbles add column if not exists source_clients text[];

alter table public.rc_scrobbles drop constraint if exists rc_scrobbles_source_clients_check;
alter table public.rc_scrobbles add constraint rc_scrobbles_source_clients_check
  check (source_clients is null or (source = 'listenbrainz' and cardinality(source_clients) >= 2)) not valid;
alter table public.rc_scrobbles validate constraint rc_scrobbles_source_clients_check;

comment on column public.rc_scrobbles.source_clients is
  'ListenBrainz only: every app that reported this exact second and title, when two or more did (sorted). Null otherwise. Read by listen-copies.ts.';
