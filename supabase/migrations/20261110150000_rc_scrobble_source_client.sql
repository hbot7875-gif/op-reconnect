-- Which ListenBrainz app submitted a stored listen (the Last.fm importer,
-- LB's own Spotify reader, Pano Scrobbler, Web Scrobbler, LB Android...).
--
-- Several apps often write to one ListenBrainz account, and each reports the
-- same listen with a timestamp 0 s to one track length apart. Without the
-- app, two copies of one listen and a song played twice back to back look
-- identical in rc_scrobbles. The Edge Function (lib/listen-copies.ts) counts
-- reports of one song from different apps within 10 minutes as one play, and
-- needs this column to do it for stored rows.
--
-- Nullable and informational: null for every other source and for LB rows
-- stored before this migration. The unique key is unchanged, so this column
-- cannot add, suppress or merge a row.
alter table public.rc_scrobbles add column if not exists source_client text;

comment on column public.rc_scrobbles.source_client is
  'ListenBrainz submission_client (or media_player) of the listen; null for other sources. Read by listen-copies.ts.';
