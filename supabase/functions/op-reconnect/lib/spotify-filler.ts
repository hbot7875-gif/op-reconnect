// Candy Star Generator — non-BTS filler library.
//
// Ported from arirang-btsbackend/index.ts's "Filler library" section.
// Reads/writes `spotify_filler_library` (migration 030), upserted on
// track_id. All four actions are admin-only.

import type { SupabaseDB } from './spotify-shared.ts'
import {
  utcNow, parseSpotifyId, looksKpop, regionFromGenres, fetchArtistGenres,
  fetchAllPlaylistTracks, spotifyGetJsonOrThrow, normTrack,
} from './spotify-shared.ts'
import { getUserAccessToken } from './spotify-oauth.ts'

/** Import a playlist's non-BTS, non-Kpop tracks into the filler library. */
export async function importFillerPlaylist(supabase: SupabaseDB, params: { playlistUrl: string }): Promise<any> {
  const pid = parseSpotifyId(params.playlistUrl, 'playlist')
  if (!pid) throw new Error('Could not parse a Spotify playlist id from that input.')
  const { token } = await getUserAccessToken(supabase)
  const tracks = await fetchAllPlaylistTracks(token, pid)
  if (!tracks.length) throw new Error('No tracks fetched — playlist may be private, empty, or the Spotify account needs reconnecting.')

  const candidates = tracks.filter(t => !t.isBTS)
  if (!candidates.length) throw new Error(`Fetched ${tracks.length} track(s) but all were BTS songs. Paste a non-BTS playlist.`)
  const artistIds = [...new Set(candidates.flatMap(t => t.artists.map((a: any) => a.id)))]
  const genreMap = await fetchArtistGenres(token, artistIds)

  const rows: any[] = []
  const skipped: any[] = []
  const seen = new Set<string>()
  for (const t of candidates) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    const genres = t.artists.flatMap((a: any) => genreMap[a.id] || [])
    if (looksKpop(genres)) { skipped.push({ name: t.name, reason: 'k-pop' }); continue }
    rows.push({
      track_id: t.id, uri: t.uri, isrc: t.isrc, name: t.name,
      artists: t.artists.map((a: any) => a.name), album: t.album,
      duration_ms: t.durationMs, genres: [...new Set(genres)].slice(0, 6),
      region: regionFromGenres(genres), source: 'import', created_at: utcNow(),
    })
  }

  let added = 0
  if (rows.length) {
    const { error } = await supabase.from('spotify_filler_library').upsert(rows, { onConflict: 'track_id' })
    if (error) throw new Error(`Library save failed: ${error.message}`)
    added = rows.length
  }
  return { success: true, scanned: tracks.length, added, skippedKpop: skipped.length, skipped }
}

/** Add one filler with Spotify's real metadata. The old manual path wrote a
 * placeholder 3:30 duration and null ISRC, which defeated duration planning
 * and recording-level deduplication until somebody backfilled the row. */
export async function addFillerManual(supabase: SupabaseDB, params: { trackUrl: string }): Promise<any> {
  const tid = parseSpotifyId(params.trackUrl, 'track')
  if (!tid) throw new Error('Could not parse a Spotify track id from that input.')
  let name = ''
  let artist = ''
  try {
    const oe = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${tid}`)}`)
    if (oe.ok) {
      const title = String((await oe.json())?.title || '')
      const bullet = title.indexOf(' · ')
      name = bullet > -1 ? title.slice(0, bullet).trim() : title.trim()
      artist = bullet > -1 ? title.slice(bullet + 3).trim() : ''
    }
  } catch (_) { /* resolved below through Spotify search */ }
  if (!name) throw new Error('Could not read that Spotify track title. Try importing it from a playlist instead.')

  const { token } = await getUserAccessToken(supabase)
  const search = await spotifyGetJsonOrThrow(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${name} ${artist}`)}&type=track&market=from_token&limit=10`,
    token,
  )
  const items = search?.tracks?.items || []
  const raw = items.find((t: any) => t.id === tid || t.linked_from?.id === tid) || items[0]
  if (!raw?.id) throw new Error('Spotify did not return a playable track for that link.')
  const track = normTrack(raw)
  if (track.isBTS) throw new Error('That track is credited to BTS or a BTS member, so it belongs in the BTS catalog—not the filler library.')

  const artistIds = (track.artists || []).map((a: any) => a.id).filter(Boolean)
  const genreMap = await fetchArtistGenres(token, artistIds)
  const genres: string[] = [...new Set<string>(
    track.artists.flatMap((a: any) => genreMap[a.id] || []) as string[],
  )]
  if (looksKpop(genres)) throw new Error('That track is K-pop, so it cannot be used as a non-K-pop filler.')

  const { error } = await supabase.from('spotify_filler_library').upsert({
    track_id: track.id, uri: track.uri, isrc: track.isrc, name: track.name,
    artists: track.artists.map((a: any) => a.name), album: track.album,
    duration_ms: track.durationMs, genres: genres.slice(0, 6),
    region: regionFromGenres(genres), source: 'manual', created_at: utcNow(),
  }, { onConflict: 'track_id' })
  if (error) throw new Error(error.message)
  return { success: true, name: track.name }
}

export async function getFillerLibrary(supabase: SupabaseDB): Promise<any> {
  const { data } = await supabase.from('spotify_filler_library')
    // Keep the recording identity. The generator dedupes fillers by ISRC
    // before shuffling; omitting this field made two Spotify track IDs for
    // the same recording look unique locally, only for the post-publish
    // validator to (correctly) reject the playlist as a repeated filler.
    .select('track_id, uri, isrc, name, artists, album, duration_ms, region, genres, source')
    .order('name', { ascending: true })
  return { success: true, fillers: data || [], count: (data || []).length }
}

export async function removeFiller(supabase: SupabaseDB, params: { trackId: string }): Promise<any> {
  const { error } = await supabase.from('spotify_filler_library').delete().eq('track_id', params.trackId)
  if (error) throw new Error(error.message)
  return { success: true }
}
