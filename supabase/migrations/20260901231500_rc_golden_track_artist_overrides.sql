-- Fix: GOLDEN Era Card / Golden Corner silently not counting some tracks
-- for stats.fm-linked agents ("some tracks not counting but BOTZ shows
-- them" — confirmed as an artist-name issue, not a track-title issue).
--
-- stats.fm's public API reports only a single primary artist per stream
-- (streams.ts fetchStatsFm: `t.artists?.[0]?.name`), and for these GOLDEN
-- collab tracks stats.fm lists the FEATURED artist first instead of Jung
-- Kook/BTS the way ListenBrainz/Spotify metadata does. countedArtistPlays
-- (text.ts) then rejects the play outright because that featured artist
-- isn't in the bts_artists allowlist and had no per-track override —
-- title matching was fine, so BOTZ (which doesn't apply this allowlist)
-- still showed the scrobble while the Era Card counted it as zero.
--
-- Verified against live rc_scrobbles rows, e.g.:
--   track_name='3D', artist_name='Jack Harlow'
--   track_name='Seven', artist_name='Latto'
--   track_name="Closer to You (feat. Major Lazer)", artist_name='Major Lazer'
--   track_name="Please Don't Change (feat. DJ Snake)", artist_name='DJ Snake'
--
-- Same admin-editable rc_config pattern as bts_artists/badge_editors — keys
-- are normKeyFull() of the GOLDEN track titles (birthday-eras.ts), matching
-- how countedArtistPlays looks the override up (trackKey param).
update rc_config
set value = value || '{
  "3d": ["jack harlow"],
  "seven": ["latto"],
  "closer to you": ["major lazer"],
  "please dont change": ["dj snake"]
}'::jsonb
where key = 'track_artist_overrides';
