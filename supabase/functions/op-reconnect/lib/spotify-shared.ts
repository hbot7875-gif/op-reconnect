// Candy Star Generator — shared Spotify/BTS plumbing.
//
// Ported from arirang-btsbackend/index.ts (its §38 "SPOTIFY CHARTS
// INTEGRATION" / §38b "PLAYLIST GENERATOR" sections). This file only carries
// what generateAlpaca's dependency chain actually calls — the chart-snapshot
// stuff (fetchBTSFromPlaylist, refreshSpotifyCharts, etc.) and three of the
// four catalog-building strategies (Last.fm, artist-albums, "This Is"
// playlists) aren't wired to anything Candy Star uses and were left behind;
// only buildBTSCatalogFromItunes (spotify-catalog.ts) is actually called by
// refreshBTSCatalog in the source.

// deno-lint-ignore-file no-explicit-any
export type { SupabaseDB } from './config.ts'

/** Verified Spotify artist IDs for BTS + all 7 members' solo pages — same
 *  list the source uses to decide "is this actually BTS" everywhere. */
export const BTS_ARTIST_IDS: Record<string, string> = {
  'BTS':       '3Nrfpe0tUJi4K4DXYWgMUX',
  'RM':        '2auC28zjQyVTsiZKNgPRGs',
  'Jin':       '3R2P6dkTxyHpdiWByKyIjR',
  'Agust D':   '5RmQ8k4l3HZ8JoPb4mNsML',
  'j-hope':    '0b1sIQumIAsNbqAoIClSpy',
  'Jimin':     '0bxSJJ7V2M4Zb9lpRzWPD8',
  'V':         '3VjBcaujewrKozjpWuMHTW',
  'Jung Kook': '6HaGTQPmzraVmaVxvz6EUc',
}
export const BTS_ID_SET = new Set(Object.values(BTS_ARTIST_IDS))

// Genre hints that mark an artist as K-pop (gg/bg) — blocked from the filler pool.
export const KPOP_GENRE_HINTS = [
  'k-pop', 'k pop', 'kpop', 'korean pop', 'k-rap', 'k rap', 'k-rock',
  'k-indie', 'korean r&b', 'k-r&b', 'krnb', 'k-hip hop', 'korean hip hop',
  'k-ballad', 'korean ost', 'k-pop boy group', 'k-pop girl group',
]

// A focus song under this length needs 3+ fillers between repeats; longer needs 2.
export const SHORT_SONG_MS = 210000      // 3.5 min
export const MIN_GAP_MS    = 480000      // 8 min minimum — matches the real observed floor
export const MAX_RUNTIME_MS = 3 * 60 * 60 * 1000  // 3 hours

export function utcNow(): string {
  return new Date().toISOString()
}

/** Extract a Spotify id from a url / uri / raw id. */
export function parseSpotifyId(input: string, kind: 'playlist' | 'track' | 'album' = 'playlist'): string | null {
  if (!input) return null
  const s = String(input).trim()
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s
  const uri = s.match(new RegExp(`spotify:${kind}:([A-Za-z0-9]{22})`, 'i'))
  if (uri) return uri[1]
  const url = s.match(new RegExp(`open\\.spotify\\.com/(?:[A-Za-z-]+/)?${kind}/([A-Za-z0-9]{22})`, 'i'))
  if (url) return url[1]
  return null
}

export const isBTSArtists = (artists: any[]): boolean =>
  (artists || []).some((a: any) => BTS_ID_SET.has(a.id))

/** Normalise a Spotify full/simplified track object into our shape. */
export function normTrack(t: any): any {
  return {
    id:         t.id,
    uri:        t.uri || (t.id ? `spotify:track:${t.id}` : null),
    name:       t.name,
    artists:    (t.artists || []).map((a: any) => ({ id: a.id, name: a.name })),
    album:      t.album?.name || '',
    durationMs: t.duration_ms || 0,
    isrc:       t.external_ids?.isrc || null,
    isBTS:      isBTSArtists(t.artists || []),
  }
}

/** Page through every track in a playlist (full track objects incl. ISRC). */
export async function fetchAllPlaylistTracks(token: string, playlistId: string): Promise<any[]> {
  const headers = { Authorization: `Bearer ${token}` }
  const out: any[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100`
  let page = 0
  let guard = 0
  while (url && guard++ < 50) {
    const res: Response = await fetch(url, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (page === 0) throw new Error(`Spotify ${res.status} fetching playlist tracks: ${body.slice(0, 200)}`)
      break
    }
    page++
    const data: any = await res.json()
    for (const it of (data.items || [])) {
      const t = it?.item || it?.track
      if (!t || t.is_local || !t.id) continue
      out.push(normTrack(t))
    }
    url = data.next
  }
  return out
}

/** Fetch a Spotify JSON endpoint with retry on 429 and 5xx.
 *  Retry-After is honored but capped at 8s — unbounded sleeps inside one request cause 504s.
 *  Returns null on hard failure when throws=false (default); throws when throws=true. */
async function spotifyFetch(url: string, token: string, opts: { throws?: boolean; tries?: number } = {}): Promise<any | null> {
  const { throws = false, tries = 4 } = opts
  for (let attempt = 0; attempt < tries; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (r.ok) return await r.json()
    if (r.status === 429) {
      const ra = parseInt(r.headers.get('Retry-After') || '')
      const waitMs = (isNaN(ra) ? Math.min(2 ** attempt, 8) : Math.min(ra, 8)) * 1000
      await new Promise(res => setTimeout(res, waitMs))
      continue
    }
    if (r.status >= 500) { await new Promise(res => setTimeout(res, 600)); continue }
    const body = await r.text().catch(() => '')
    if (throws) throw new Error(`Spotify API error ${r.status}: ${body.slice(0, 300)}`)
    console.error(`Spotify ${r.status} on ${url}: ${body.slice(0, 300)}`)
    return null
  }
  if (throws) throw new Error('Spotify API error: too many rate-limit retries')
  return null
}
export const spotifyGetJson = (url: string, token: string, tries = 4) => spotifyFetch(url, token, { tries })
export const spotifyGetJsonOrThrow = (url: string, token: string) => spotifyFetch(url, token, { throws: true })

/** Batch-fetch artist genres (for K-pop detection + region tagging). */
export async function fetchArtistGenres(token: string, ids: string[]): Promise<Record<string, string[]>> {
  const headers = { Authorization: `Bearer ${token}` }
  const map: Record<string, string[]> = {}
  const uniq = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50)
    const res = await fetch(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, { headers })
    if (!res.ok) continue
    const d = await res.json()
    for (const a of (d.artists || [])) if (a && a.id) map[a.id] = a.genres || []
  }
  return map
}

export const looksKpop = (genres: string[]): boolean =>
  (genres || []).some(g => KPOP_GENRE_HINTS.some(h => g.toLowerCase().includes(h)))

/** Coarse region label from genre strings — best-effort, for the "different regions" rule. */
export function regionFromGenres(genres: string[]): string {
  const g = (genres || []).join(' ').toLowerCase()
  if (/j-pop|j-rock|japanese|city pop|anime/.test(g)) return 'Japan'
  if (/latin|reggaeton|bossa|brazil|spanish|mexican|cumbia/.test(g)) return 'Latin'
  if (/french|chanson/.test(g)) return 'France'
  if (/afro|amapiano|nigeria|highlife/.test(g)) return 'Africa'
  if (/bollywood|hindi|punjabi|desi|indian/.test(g)) return 'India'
  if (/uk |british|grime|brit/.test(g)) return 'UK'
  if (/german|deutsch/.test(g)) return 'Germany'
  if (/thai|indonesia|viet|mandopop|cantopop|c-pop/.test(g)) return 'Asia'
  if (/turkish|arab/.test(g)) return 'MENA'
  if (g) return 'Western'
  return 'Unknown'
}

/** Normalise a track/album name for fuzzy matching — strips diacritics,
 *  apostrophes, punctuation; lowercases; collapses whitespace. */
export function normalizeKey(s: string): string {
  if (!s) return ''
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // combining diacritics
    .toLowerCase()
    .replace(/['`’‘´]/g, '')          // apostrophes / backticks / smart quotes
    .replace(/[:~–—\-]/g, ' ')         // dashes / colons → space
    .replace(/[^\p{L}\p{N}\s]/gu, '')  // keep all letters/numbers (unicode-aware)
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim()
}

// Strips trailing parenthetical version tags so versioned scrobbles match
// base goal names: "NORMAL (Clean Ver.)" → "NORMAL", "Swim (Live)" → "Swim"
export function stripVersionSuffix(s: string): string {
  if (!s) return s
  let result = s.trim()
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\s*[([（【][^)\]）】]*[)\]）】]\s*$/, '').trim()
  }
  return result
}

/** Admin gate for the Candy Star catalog/OAuth/generator actions — same
 *  SYNC_ADMIN_KEY pattern handlers.ts's adminLaunchDefuse already uses. */
export function isAdminAuthorized(params: Record<string, any>): boolean {
  const key = Deno.env.get('SYNC_ADMIN_KEY') || ''
  return !!key && params.adminKey === key
}
