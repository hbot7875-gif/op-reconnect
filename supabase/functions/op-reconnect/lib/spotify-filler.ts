// Candy Star Generator — non-BTS filler library.
//
// Ported from arirang-btsbackend/index.ts's "Filler library" section.
// Reads/writes `spotify_filler_library` (migration 030), upserted on
// track_id. All four actions are admin-only.

import type { SupabaseDB } from './spotify-shared.ts'
import { utcNow, parseSpotifyId, looksKpop, regionFromGenres, fetchArtistGenres, fetchAllPlaylistTracks } from './spotify-shared.ts'
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

/** Add a single filler track manually by url/id. BTS/K-pop validation is
 *  skipped here — the admin vouches it's neither. */
export async function addFillerManual(supabase: SupabaseDB, params: { trackUrl: string }): Promise<any> {
  const tid = parseSpotifyId(params.trackUrl, 'track')
  if (!tid) throw new Error('Could not parse a Spotify track id from that input.')
  const uri = `spotify:track:${tid}`

  let name = `filler:${tid.slice(0, 8)}`
  try {
    const oe = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${tid}`)}`)
    if (oe.ok) { const j = await oe.json(); if (j.title) name = j.title }
  } catch (_) { /* non-fatal — name stays as fallback */ }

  const { error } = await supabase.from('spotify_filler_library').upsert({
    track_id: tid, uri, isrc: null, name,
    artists: [], album: '', duration_ms: 210000,
    genres: [], region: 'Unknown', source: 'manual', created_at: utcNow(),
  }, { onConflict: 'track_id' })
  if (error) throw new Error(error.message)
  return { success: true, name }
}

export async function getFillerLibrary(supabase: SupabaseDB): Promise<any> {
  const { data } = await supabase.from('spotify_filler_library')
    .select('track_id, uri, name, artists, album, duration_ms, region, genres, source')
    .order('name', { ascending: true })
  return { success: true, fillers: data || [], count: (data || []).length }
}

export async function removeFiller(supabase: SupabaseDB, params: { trackId: string }): Promise<any> {
  const { error } = await supabase.from('spotify_filler_library').delete().eq('track_id', params.trackId)
  if (error) throw new Error(error.message)
  return { success: true }
}
