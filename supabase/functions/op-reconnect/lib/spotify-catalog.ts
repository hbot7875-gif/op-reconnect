// Candy Star Generator — BTS song catalog.
//
// Ported from arirang-btsbackend/index.ts's "Catalog: every BTS song via
// Last.fm" section (despite the old comment, refreshBTSCatalog was actually
// wired to the iTunes-based builder — buildBTSCatalogFromItunes — free,
// no auth, no rate limits; the Last.fm/artist-albums/"This Is"-playlist
// builders in the source were dead code paths nothing calls, so only the
// iTunes one is ported).
//
// Reads/writes `bts_song_catalog` (migration 030) — single row, id='current'.

import type { SupabaseDB } from './spotify-shared.ts'
import { utcNow, isBTSArtists, parseSpotifyId, spotifyGetJson, spotifyGetJsonOrThrow, fetchAllPlaylistTracks } from './spotify-shared.ts'
import { getUserAccessToken } from './spotify-oauth.ts'

/**
 * Build BTS catalog from iTunes Search API — free, no auth, no rate limits,
 * globally available. No ISRC codes, so Spotify matching (resolveMoreCatalog)
 * uses name-based search instead of exact ISRC lookup.
 */
async function buildBTSCatalogFromItunes(): Promise<{ songs: any[]; diag: any }> {
  const QUERIES = [
    { label: 'BTS',       term: 'BTS',       accept: (a: string) => a === 'bts' },
    { label: 'RM',        term: 'RM',         accept: (a: string) => a === 'rm' },
    { label: 'Jin',       term: 'Jin',        accept: (a: string) => a === 'jin' },
    { label: 'Suga',      term: 'Agust D',    accept: (a: string) => a === 'agust d' || a === 'suga' },
    { label: 'j-hope',    term: 'j-hope',     accept: (a: string) => a === 'j-hope' },
    { label: 'Jimin',     term: 'Jimin',      accept: (a: string) => a === 'jimin' },
    { label: 'V',         term: 'V',          accept: (a: string) => a === 'v' },
    { label: 'Jung Kook', term: 'Jung Kook',  accept: (a: string) => a === 'jung kook' || a === 'jungkook' },
  ]

  const byKey = new Map<string, any>()
  let totalRequests = 0, totalRaw = 0

  for (const q of QUERIES) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q.term)}&media=music&entity=song&attribute=artistTerm&limit=200&country=us`
    const res = await fetch(url, { headers: { 'User-Agent': 'OpReconnect/1.0' } })
    totalRequests++
    if (!res.ok) continue

    const data = await res.json()
    const tracks: any[] = data.results || []
    totalRaw += tracks.length

    for (const t of tracks) {
      const artistName = (t.artistName || '').toLowerCase()
      if (!q.accept(artistName)) continue
      const name: string = (t.trackName || '').trim()
      if (!name) continue
      const key = `lfm:${artistName}:${name.toLowerCase()}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          key, isrc: null, name, artists: [q.label],
          durationMs: t.trackTimeMillis || 210000, versions: [], lfmPlaycount: 0,
        })
      }
    }
  }

  const songs = [...byKey.values()]
  return { songs, diag: { source: 'itunes', requests: totalRequests, rawTracks: totalRaw, songs: songs.length } }
}

/** Refresh + cache the BTS catalog using iTunes Search API. Admin-only. */
export async function refreshBTSCatalog(supabase: SupabaseDB): Promise<any> {
  const { songs, diag } = await buildBTSCatalogFromItunes()
  if (!songs.length) {
    throw new Error(`iTunes returned 0 songs (${diag.requests} requests, ${diag.rawTracks} raw tracks). Catalog NOT changed — nothing was overwritten.`)
  }
  const { error } = await supabase.from('bts_song_catalog').upsert(
    { id: 'current', songs, song_count: songs.length, updated_at: utcNow() },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`Catalog save failed: ${error.message}`)
  return { success: true, songCount: songs.length, diag }
}

/** Read the resolved-URI map from the `uris` column of the `current` row. */
async function getResolvedUriMap(supabase: SupabaseDB): Promise<Record<string, any>> {
  const { data } = await supabase.from('bts_song_catalog').select('uris').eq('id', 'current').maybeSingle()
  return (data?.uris as Record<string, any>) || {}
}

/** Persist the resolved-URI map back to the `uris` column of the `current` row. */
async function saveResolvedUriMap(supabase: SupabaseDB, uriMap: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('bts_song_catalog')
    .update({ uris: uriMap, updated_at: utcNow() })
    .eq('id', 'current')
  if (error) throw new Error(`URI map save failed: ${error.message}`)
}

/** Read the albums map from the `albums` column of the `current` row. */
export async function getAlbumsMap(supabase: SupabaseDB): Promise<Record<string, any>> {
  const { data } = await supabase.from('bts_song_catalog').select('albums').eq('id', 'current').maybeSingle()
  return (data?.albums as Record<string, any>) || {}
}

/** Persist the albums map back to the `albums` column of the `current` row. */
async function saveAlbumsMap(supabase: SupabaseDB, albums: Record<string, any>): Promise<void> {
  const { error } = await supabase.from('bts_song_catalog')
    .update({ albums, updated_at: utcNow() })
    .eq('id', 'current')
  if (error) throw new Error(`Albums map save failed: ${error.message}`)
}

/** Full catalog, with the `uris` side store merged in (search/manual-add
 *  results become playable picks without a full refresh). */
export async function getBTSCatalog(supabase: SupabaseDB): Promise<any> {
  const { data } = await supabase.from('bts_song_catalog').select('songs, uris, updated_at').eq('id', 'current').maybeSingle()
  const base: any[] = data?.songs || []
  const uriMap: Record<string, any> = (data?.uris as Record<string, any>) || {}

  const byKey = new Map<string, any>()
  const byName = new Map<string, any>()
  for (const s of base) {
    byKey.set(s.key, s)
    if (s.name) byName.set(s.name.toLowerCase(), s)
  }

  const primaryKeys = new Set<string>(base.map((s: any) => s.key))

  const trackIdToIsrc = new Map<string, string>()
  for (const [, r] of Object.entries(uriMap)) {
    if (r && (r as any).id && (r as any).isrc) trackIdToIsrc.set((r as any).id, (r as any).isrc)
    for (const v of ((r as any)?.versions || [])) {
      if (v.id && v.isrc) trackIdToIsrc.set(v.id, v.isrc)
    }
  }
  const withIsrc = (v: any, fallback?: string | null) => ({
    ...v,
    isrc: v.isrc || trackIdToIsrc.get(v.id) || fallback || null,
  })

  for (const [key, r] of Object.entries(uriMap)) {
    if (!r || !(r as any).uri) continue
    const rr = r as any

    let song = byKey.get(key)
    if (!song && rr.name) song = byName.get(rr.name.toLowerCase())

    if (song) {
      const primaryVer = rr.id && rr.uri ? [withIsrc({ id: rr.id, uri: rr.uri, album: '', durationMs: rr.durationMs }, rr.isrc)] : []
      const extraVers = (rr.versions || []).map((v: any) => withIsrc({ id: v.id, uri: v.uri, album: v.album || '', durationMs: v.durationMs }, rr.isrc))
      const allVers = [...primaryVer, ...extraVers]
      if (!song.versions || song.versions.length === 0) {
        song.versions = allVers
        if (!song.durationMs && rr.durationMs) song.durationMs = rr.durationMs
      } else {
        const existingIds = new Set(song.versions.map((v: any) => v.id))
        for (const v of allVers) { if (!existingIds.has(v.id)) song.versions.push(v) }
      }
      if (!byKey.has(key)) byKey.set(key, song)
    } else {
      const newSong = {
        key, isrc: rr.isrc || null, name: rr.name, artists: rr.artists || ['BTS'],
        durationMs: rr.durationMs || 210000, versions: [withIsrc({ id: rr.id, uri: rr.uri, album: '' }, rr.isrc)], lfmPlaycount: 0,
      }
      byKey.set(key, newSong)
      primaryKeys.add(key)
      if (rr.name) byName.set(rr.name.toLowerCase(), newSong)
    }
  }

  const songs = [...primaryKeys].map(k => byKey.get(k)).filter(Boolean)
  return { success: true, songs, songCount: songs.length, updatedAt: data?.updated_at || null }
}

/** On-demand BTS track search — one Spotify search call, persists resolved
 *  URIs to the `uris` side store so searched songs become playable. Admin-only. */
export async function searchBTSTracks(supabase: SupabaseDB, params: { query: string }): Promise<any> {
  const q = (params.query || '').trim()
  if (!q) throw new Error('Type a song or artist to search.')
  const { token } = await getUserAccessToken(supabase)
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&market=US&limit=20`
  const d = await spotifyGetJsonOrThrow(url, token)
  const items: any[] = d?.tracks?.items || []

  const seen = new Set<string>()
  const results: any[] = []
  for (const t of items) {
    if (!t.id || seen.has(t.id) || !isBTSArtists(t.artists || [])) continue
    seen.add(t.id)
    const isrc = t.external_ids?.isrc || null
    const key = `lfm:${(t.artists[0]?.name || 'BTS').toLowerCase()}:${t.name.toLowerCase()}`
    results.push({
      key, isrc, name: t.name,
      artists: (t.artists || []).map((a: any) => a.name),
      durationMs: t.duration_ms || 210000,
      versions: [{ id: t.id, uri: t.uri, album: t.album?.name || '' }],
      lfmPlaycount: 0,
    })
  }

  let added = 0
  let mergedVersions = 0
  if (results.length) {
    const uriMap = await getResolvedUriMap(supabase)
    for (const s of results) {
      const existing = uriMap[s.key]
      const primary = s.versions[0]
      if (existing && existing.uri) {
        // A prior search or manual add may already have alternate versions
        // (covers, remixes, mastering variants) attached to this key —
        // this used to overwrite the whole entry and silently discard
        // them. Merge instead, same as addCatalogSongManual: add the new
        // track as an extra version if it's not already known, and only
        // backfill isrc/durationMs if the existing entry is missing them.
        const allIds = new Set([existing.id, ...(existing.versions || []).map((v: any) => v.id)])
        if (!allIds.has(primary.id)) {
          existing.versions = [...(existing.versions || []), { id: primary.id, uri: primary.uri, album: primary.album }]
          mergedVersions++
        }
        if (!existing.isrc && s.isrc) existing.isrc = s.isrc
        if (!existing.durationMs && s.durationMs) existing.durationMs = s.durationMs
        uriMap[s.key] = existing
      } else {
        added++
        uriMap[s.key] = { id: primary.id, uri: primary.uri, name: s.name, artists: s.artists, isrc: s.isrc, durationMs: s.durationMs }
      }
    }
    await saveResolvedUriMap(supabase, uriMap)
  }
  return { success: true, results, found: results.length, addedToCatalog: added, mergedVersions, rawTracks: items.length }
}

/** Manually add a BTS song by pasting a Spotify track link/URI/ID.
 *  Rate-limit-proof: name comes from the public oembed endpoint. Admin-only. */
export async function addCatalogSongManual(supabase: SupabaseDB, params: { trackUrl: string; songName?: string }): Promise<any> {
  const tid = parseSpotifyId(params.trackUrl, 'track')
  if (!tid) throw new Error('Paste a Spotify track link (e.g. https://open.spotify.com/track/…), URI, or 22-char ID.')
  const uri = `spotify:track:${tid}`

  let name = (params.songName || '').trim()
  let artist = 'bts'
  if (!name) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const oe = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${tid}`)}`,
        { signal: ctrl.signal },
      ).finally(() => clearTimeout(timer))
      if (oe.ok) {
        const j = await oe.json()
        if (j.title) {
          const bullet = j.title.indexOf(' · ')
          if (bullet > -1) {
            name   = j.title.slice(0, bullet).trim()
            artist = j.title.slice(bullet + 3).trim().toLowerCase()
          } else {
            name = j.title.trim()
          }
        }
      }
    } catch (_) { /* non-fatal — falls back to track ID */ }
  }
  if (!name) name = `track ${tid.slice(0, 8)}`

  let isrc: string | null = null
  try {
    const { token: spTok } = await getUserAccessToken(supabase)
    const sd = await spotifyGetJson(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${name} ${artist}`)}&type=track&market=US&limit=10`,
      spTok, 1,
    )
    const spMatch = (sd?.tracks?.items || []).find((it: any) => it.id === tid)
    isrc = spMatch?.external_ids?.isrc || null
  } catch (_) { /* non-fatal */ }

  const key = `lfm:${artist}:${name.toLowerCase()}`
  const uriMap = await getResolvedUriMap(supabase)
  const existing = uriMap[key]
  let added = false
  let addedCover = false
  if (existing && existing.uri) {
    const allIds = new Set([existing.id, ...(existing.versions || []).map((v: any) => v.id)])
    if (!allIds.has(tid)) {
      existing.versions = [...(existing.versions || []), { id: tid, uri }]
      uriMap[key] = existing
      addedCover = true
    }
    if (isrc && !existing.isrc) { existing.isrc = isrc; uriMap[key] = existing }
  } else {
    uriMap[key] = { id: tid, uri, name, artists: [artist], isrc, durationMs: 210000 }
    added = true
  }
  await saveResolvedUriMap(supabase, uriMap)
  const totalVersions = 1 + ((uriMap[key].versions || []).length)
  return { success: true, name, key, added, addedCover, totalVersions }
}

/** Bulk-add every BTS track from a Spotify playlist into the URI catalog. Admin-only. */
export async function addPlaylistToCatalog(supabase: SupabaseDB, params: { playlistUrl: string }): Promise<any> {
  const pid = parseSpotifyId(params.playlistUrl, 'playlist')
  if (!pid) throw new Error('Could not parse a Spotify playlist ID from that URL.')
  const { token } = await getUserAccessToken(supabase)
  const tracks = await fetchAllPlaylistTracks(token, pid)
  if (!tracks.length) throw new Error('No tracks fetched — playlist may be private, or the Spotify account needs reconnecting.')

  const btsTracks = tracks.filter(t => t.uri && t.id)

  const uriMap = await getResolvedUriMap(supabase)
  let added = 0
  for (const t of btsTracks) {
    const artist = ((t.artists?.[0]?.name as string) || 'BTS').toLowerCase()
    const key = `lfm:${artist}:${t.name.toLowerCase()}`
    if (!uriMap[key] || !uriMap[key].uri) added++
    uriMap[key] = {
      id: t.id, uri: t.uri, name: t.name,
      artists: (t.artists || []).map((a: any) => a.name),
      isrc: t.isrc || null, durationMs: t.durationMs || 210000,
    }
  }
  await saveResolvedUriMap(supabase, uriMap)
  return { success: true, found: btsTracks.length, added, skipped: tracks.length - btsTracks.length }
}

/** Add a whole album by pasting a Spotify album link. Admin-only. */
export async function addAlbumToCatalog(supabase: SupabaseDB, params: { albumUrl: string }): Promise<any> {
  const aid = parseSpotifyId(params.albumUrl, 'album')
  if (!aid) throw new Error('Paste a Spotify album link (e.g. https://open.spotify.com/album/…), URI, or 22-char ID.')
  const { token } = await getUserAccessToken(supabase)
  const album = await spotifyGetJsonOrThrow(`https://api.spotify.com/v1/albums/${aid}?market=US`, token)
  const albumName = album?.name || `album ${aid.slice(0, 8)}`
  const image = album?.images?.[0]?.url || null

  let items: any[] = album?.tracks?.items || []
  let next: string | null = album?.tracks?.next || null
  for (let guard = 0; next && guard < 5; guard++) {
    const pg = await spotifyGetJson(next, token)
    if (!pg) break
    items = items.concat(pg.items || [])
    next = pg.next || null
  }
  if (!items.length) throw new Error('No tracks found on that album.')

  const uriMap = await getResolvedUriMap(supabase)
  const trackKeys: string[] = []
  let added = 0
  for (const t of items) {
    if (!t.id) continue
    const name = t.name
    const artists = (t.artists || []).map((a: any) => a.name)
    const key = `lfm:${(artists[0] || 'bts').toLowerCase()}:${String(name).toLowerCase()}`
    if (!uriMap[key] || !uriMap[key].uri) added++
    uriMap[key] = { id: t.id, uri: t.uri || `spotify:track:${t.id}`, name, artists, isrc: null, durationMs: t.duration_ms || 210000 }
    if (!trackKeys.includes(key)) trackKeys.push(key)
  }
  await saveResolvedUriMap(supabase, uriMap)

  const albums = await getAlbumsMap(supabase)
  albums[aid] = { id: aid, name: albumName, image, trackKeys, count: trackKeys.length, updatedAt: utcNow() }
  await saveAlbumsMap(supabase, albums)
  return { success: true, name: albumName, trackCount: trackKeys.length, addedToCatalog: added }
}

export async function getCatalogAlbums(supabase: SupabaseDB): Promise<any> {
  const albums = await getAlbumsMap(supabase)
  return { success: true, albums: Object.values(albums) }
}

export async function removeCatalogAlbum(supabase: SupabaseDB, params: { albumId: string }): Promise<any> {
  const albums = await getAlbumsMap(supabase)
  delete albums[params.albumId]
  await saveAlbumsMap(supabase, albums)
  return { success: true }
}

/** Patch the ISRC on a song already in the catalog. Admin-only. */
export async function patchCatalogSongIsrc(supabase: SupabaseDB, params: { key: string; isrc: string }): Promise<any> {
  if (!params.key) throw new Error('key is required')
  const clean = (params.isrc || '').trim().toUpperCase()
  if (!clean) throw new Error('isrc is required')

  const { data } = await supabase.from('bts_song_catalog').select('songs').eq('id', 'current').maybeSingle()
  const songs: any[] = data?.songs || []
  const idx = songs.findIndex((s: any) => s.key === params.key)
  if (idx === -1) throw new Error(`Song with key "${params.key}" not found in catalog`)

  songs[idx] = { ...songs[idx], isrc: clean }
  const { error } = await supabase.from('bts_song_catalog').upsert(
    { id: 'current', songs, song_count: songs.length, updated_at: utcNow() },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`Save failed: ${error.message}`)
  return { success: true, key: params.key, isrc: clean, name: songs[idx].name }
}

/**
 * Drip resolver — resolves a small batch of still-unresolved catalog songs to
 * Spotify URIs, highest Last.fm playcount first. Songs Spotify can't find get
 * a { notFound: true } tombstone so they're never retried. Admin-only.
 */
export async function resolveMoreCatalog(supabase: SupabaseDB, batchSize = 15): Promise<any> {
  const { data } = await supabase.from('bts_song_catalog').select('songs').eq('id', 'current').maybeSingle()
  const all: any[] = data?.songs || []
  const uriMap = await getResolvedUriMap(supabase)
  const pending = all
    .filter((s: any) => !uriMap[s.key])
    .sort((a: any, b: any) => (b.lfmPlaycount || 0) - (a.lfmPlaycount || 0))
  if (!pending.length) {
    const totalResolved = Object.values(uriMap).filter((v: any) => v && v.uri).length
    return { success: true, resolvedThisRun: 0, notFoundThisRun: 0, requests: 0, totalResolved, remaining: 0, done: true }
  }

  const { token } = await getUserAccessToken(supabase)
  const DEADLINE = Date.now() + 60_000
  let resolved = 0, notFound = 0, reqs = 0, rateLimited = false
  for (const s of pending.slice(0, batchSize)) {
    if (Date.now() > DEADLINE) break
    if (reqs > 0) await new Promise(r => setTimeout(r, 600))
    const isrc = s.key?.startsWith('isrc:') ? s.key.slice(5) : (s.isrc || null)
    const artist = (s.artists || ['BTS'])[0]
    const searchQ = isrc ? `isrc:${isrc}` : `${s.name} ${artist}`
    const d = await spotifyGetJson(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQ)}&type=track&market=US&limit=5`,
      token,
    )
    reqs++
    if (d === null) { rateLimited = true; break }
    const items: any[] = d?.tracks?.items || []
    const match = isrc
      ? (items[0] || null)
      : items.find((it: any) => isBTSArtists(it.artists || []))
    if (match) {
      uriMap[s.key] = { id: match.id, uri: match.uri || `spotify:track:${match.id}`, name: s.name, artists: s.artists, isrc: match.external_ids?.isrc || null, durationMs: match.duration_ms || s.durationMs }
      resolved++
    } else {
      uriMap[s.key] = { notFound: true }
      notFound++
    }
  }

  await saveResolvedUriMap(supabase, uriMap)
  const totalResolved = Object.values(uriMap).filter((v: any) => v && v.uri).length
  const remaining = all.filter((s: any) => !uriMap[s.key]).length
  return { success: true, resolvedThisRun: resolved, notFoundThisRun: notFound, requests: reqs, totalResolved, remaining, done: remaining === 0, rateLimited }
}

/**
 * Auto-fetch ISRCs for catalog songs missing one, via MusicBrainz
 * (free, rate-limited to 1 req/sec). Admin-only.
 */
export async function bulkFetchIsrcs(supabase: SupabaseDB, batchSize = 10): Promise<any> {
  const MB = 'https://musicbrainz.org/ws/2'
  const MB_HDR = { 'User-Agent': 'OpReconnect/1.0 (op-reconnect)', 'Accept': 'application/json' }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  const mbFetch = async (url: string): Promise<any | null> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    try {
      const r = await fetch(url, { headers: MB_HDR, signal: ctrl.signal })
      if (!r.ok) return null
      return await r.json()
    } catch { return null } finally { clearTimeout(timer) }
  }

  const mbIsrc = async (name: string, artist: string): Promise<string | null> => {
    const q = encodeURIComponent(`recording:"${name}" AND artist:${artist}`)
    const searchData = await mbFetch(`${MB}/recording?query=${q}&limit=5&fmt=json`)
    await sleep(1100)
    const recordings: any[] = searchData?.recordings || []
    const rec = recordings.find((r: any) => (r.title || '').toLowerCase() === name.toLowerCase()) || recordings[0]
    if (!rec?.id) return null

    const lookupData = await mbFetch(`${MB}/recording/${rec.id}?inc=isrcs&fmt=json`)
    await sleep(1100)
    const isrcs: string[] = lookupData?.isrcs || []
    return isrcs[0] || null
  }

  const { data: catData } = await supabase.from('bts_song_catalog').select('songs').eq('id', 'current').maybeSingle()
  const catalog: any[] = (catData?.songs || []) as any[]

  const needIsrc = catalog.filter((s: any) => !s.isrc)
  const toProcess = needIsrc.slice(0, batchSize)

  let updated = 0, notFound = 0, errors = 0

  for (const song of toProcess) {
    const artist = (song.artists || ['BTS'])[0]
    let isrc: string | null = null
    try { isrc = await mbIsrc(song.name, artist) } catch { errors++ }
    if (isrc) {
      const idx = catalog.findIndex((s: any) => s.key === song.key)
      if (idx !== -1) { catalog[idx] = { ...catalog[idx], isrc }; updated++ }
    } else { notFound++ }
  }

  if (updated > 0) {
    const { error } = await supabase.from('bts_song_catalog').upsert(
      { id: 'current', songs: catalog, song_count: catalog.length, updated_at: utcNow() },
      { onConflict: 'id' },
    )
    if (error) throw new Error(`Save failed: ${error.message}`)
  }

  return { success: true, processed: toProcess.length, updated, notFound, errors, remaining: needIsrc.length - toProcess.length }
}
