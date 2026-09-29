-- "This Is RM: Full Playlist" (mono-carabonara-diner) could not be finished.
--
-- Reported as "I streamed the RM playlist and the quest didn't count it; the
-- stream log says artist not eligible, but it IS RM". Both halves are true,
-- and the second explains the first.
--
-- Two thirds of that 48-track checklist are collabs where RM is a FEATURED
-- artist, so the scrobble's artist field is the host act — Younha, TABLO,
-- Colde, HONNE, Lil Nas X, Megan Thee Stallion — with no "rm" token in it at
-- all. artistAllowed() (lib/text.ts) checks that field against the global
-- BTS allowlist, finds nothing, and counts the play as zero. The track key
-- matched perfectly the whole time; only the artist was refused.
--
-- rc_config.track_artist_overrides is the mechanism built for exactly this:
-- it lets a song's real credited collaborator count toward THAT song's key
-- only, without adding them to the global allowlist (where a collaborator's
-- unrelated solo catalogue could collide with a BTS title). Twenty-two songs
-- were already covered this way. These sixteen were missed.
--
-- Measured over 60 days before this shipped: 5,268 plays refused across
-- these keys, affecting up to 63 agents on a single track (Neva Play).
--
-- Retroactive by construction. rc_daily_activity stores the artist
-- breakdown per track — "stop the rain": {"a": {"tablo": 1}, "n": 1} — and
-- the filter runs at READ time, so every previously-refused play starts
-- counting on the next poll. Nothing needs rebuilding.
--
-- Two keys are deliberately the long, specific form. The checklist also
-- carries the short aliases "old town road" and "champion", and granting
-- Lil Nas X the bare "old town road" would make the ORIGINAL, RM-less Old
-- Town Road count. Scoping to the remix's full key keeps the override honest.

update public.rc_config
   set value = value || jsonb_build_object(
         'winter flower',          jsonb_build_array('younha'),
         'neva play',              jsonb_build_array('megan thee stallion'),
         'smoke sprite',           jsonb_build_array('soyoon'),
         'stop the rain',          jsonb_build_array('tablo'),
         'dont ever say love me',  jsonb_build_array('colde'),
         -- One entry covers both reported spellings: artistAllowed does a
         -- token-boundary substring test, and the combined credit string
         -- "balming tiger omega sapien bj wnjn mudd the student" contains it.
         'sexy nukim',             jsonb_build_array('balming tiger'),
         'old town road feat rm of bts seoul town road remix',
                                   jsonb_build_array('lil nas x'),
         'prometheus',             jsonb_build_array('yankie'),
         'gajah',                  jsonb_build_array('gaeko'),
         'crying over you',        jsonb_build_array('honne'),
         'dont',                   jsonb_build_array('eaeon'),
         'around the world in a day', jsonb_build_array('moses sumney'),
         'champion remix',         jsonb_build_array('fall out boy'),
         'change',                 jsonb_build_array('wale'),
         'buckubucku',             jsonb_build_array('mfbty'),
         'timeless',               jsonb_build_array('drunken tiger')
       ),
       updated_at = now()
 where key = 'track_artist_overrides';
