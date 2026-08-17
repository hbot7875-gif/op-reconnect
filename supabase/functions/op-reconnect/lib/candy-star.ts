// Candy Star Generator — orchestrator.
//
// Ported from arirang-btsbackend/index.ts's "Generator" (generatePlaylist,
// validatePlaylist) and "CANDY STAR GENERATOR (agent-facing)" sections
// (getAlpacaOptions / generateAlpaca / previewAlpaca — per the source's own
// comment, generateAlpaca is "a thin wrapper around generatePlaylist so
// agents can build their own rule-compliant playlists").
//
// generatePlaylist itself is admin-only (index.ts). generateAlpaca is what
// agents actually call — it resolves what to focus on, then defers to
// generatePlaylist for the hard part.
//
// Originally ported with NO daily-generation cap — arirang-btsbackend's own
// comment on this section read "No daily limit — an agent can generate as
// many as they want", and neither it nor migrations/015_candy_star_agent_
// playlists.sql (the old site) enforced one; `generated_playlists.agent_no`
// was only ever recorded for attribution (migration 030). That's since been
// reversed on explicit request as part of the BOTZ redesign (see
// docs/botz-network-redesign.md): generateAlpaca now caps real generations
// at ALPACA_DAILY_LIMIT/day per agent and spends a Wing per generation
// (`js/magic-shop.js` sells Wings). previewAlpaca (dry runs, no DB write, no
// Spotify write) stays completely free — the gate only applies to the real
// thing, checked right before generatePlaylist() is called.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseDB } from './spotify-shared.ts'
import {
  utcNow, isBTSArtists, spotifyGetJson, spotifyGetJsonOrThrow, fetchArtistGenres,
  looksKpop, normalizeKey, stripVersionSuffix, fetchAllPlaylistTracks, parseSpotifyId,
  fetchTracksByIds, BTS_ARTIST_IDS,
} from './spotify-shared.ts'
import { getUserAccessToken } from './spotify-oauth.ts'
import { getBTSCatalog, getAlbumsMap } from './spotify-catalog.ts'
import { getFillerLibrary } from './spotify-filler.ts'
import { todayKst, kstDayBounds } from './kst.ts'
import {
  analyzeTracklist, buildHumanPlaylistMeta, buildPlaylistOrder, buildPlaylistOrder2Focus,
  spreadFocusPlays, createUserPlaylist, uploadPlaylistCover,
} from './candy-star-rules.ts'
import { dedupeTracksByIdentity, excludeTracksByIdentity } from './candy-star-planner.js'

/** Shared by both validate paths: run the rule engine, then layer the
 *  K-pop-filler genre check on top (needs a token for `/v1/artists` —
 *  public catalog data, unaffected by the playlist-read restriction the
 *  from-tracks path exists to route around). */
async function runValidation(supabase: SupabaseDB, tracks: any[]): Promise<any> {
  const report = analyzeTracklist(tracks)

  const { token } = await getUserAccessToken(supabase)
  const nonBts = tracks.filter((t: any) => !t.isBTS)
  const genreMap = await fetchArtistGenres(token, [...new Set(nonBts.flatMap((t: any) => (t.artists || []).map((a: any) => a.id)))] as string[])
  const kpopHits = nonBts.filter((t: any) => looksKpop(t.artists.flatMap((a: any) => genreMap[a.id] || [])))
  report.findings.push({
    rule: 'No K-pop fillers', status: kpopHits.length === 0 ? 'pass' : 'fail',
    detail: kpopHits.length === 0 ? 'No non-BTS K-pop tracks detected.'
      : `${kpopHits.length} K-pop track(s): ${kpopHits.slice(0, 5).map((t: any) => t.name).join(', ')}.`,
  })
  report.summary.failed = report.findings.filter((f: any) => f.status === 'fail').length
  report.summary.passed = report.findings.filter((f: any) => f.status === 'pass').length
  return report
}

/** Validate an existing playlist by URL against the ARMY ruleset. Admin-only.
 *  Only works for playlists the connected account's token can actually read
 *  — in practice, its own playlists. Spotify's Web API won't serve playlist
 *  contents for another user's playlist to an app still in Development Mode,
 *  even when that playlist is public in the Spotify app itself; it 403s as
 *  if the resource doesn't belong to us, which — for this app's quota tier —
 *  it doesn't. `validatePlaylistFromTracks` below is the workaround. */
export async function validatePlaylist(supabase: SupabaseDB, params: { playlistUrl: string }): Promise<any> {
  const pid = parseSpotifyId(params.playlistUrl, 'playlist')
  if (!pid) throw new Error('Could not parse a Spotify playlist id from that input.')
  const { token } = await getUserAccessToken(supabase)
  const tracks = await fetchAllPlaylistTracks(token, pid)
  if (!tracks.length) throw new Error('No tracks found (private playlist, or wrong link).')

  const report = await runValidation(supabase, tracks)
  return { success: true, playlistId: pid, ...report }
}

/**
 * Validate a tracklist collected client-side (see js/validate-bookmarklet.js)
 * from a playlist page the connected account's own token can't read via the
 * API — any public playlist is readable by a logged-in browser tab, so the
 * bookmarklet scrapes it there and hands the list to this endpoint instead
 * of us fetching it ourselves. Admin-only, same as the URL-based validator.
 */
export async function validatePlaylistFromTracks(supabase: SupabaseDB, params: { name?: string; tracks: any[] }): Promise<any> {
  const raw = Array.isArray(params.tracks) ? params.tracks : []
  if (!raw.length) throw new Error('No tracks in that submission — the bookmarklet may not have found the tracklist. Scroll the playlist to the bottom first, then run it again.')

  const tracks = raw
    .filter((t: any) => t && t.id && t.name)
    .map((t: any) => ({
      id: t.id, uri: `spotify:track:${t.id}`, name: String(t.name),
      artists: (Array.isArray(t.artists) ? t.artists : []).map((a: any) => ({ id: a.id, name: a.name })),
      album: t.album || '', durationMs: parseInt(t.durationMs) || 0, isrc: null,
      isBTS: isBTSArtists(Array.isArray(t.artists) ? t.artists : []),
    }))
  if (!tracks.length) throw new Error('Submitted tracks were missing id/name — the page structure may have changed.')

  const report = await runValidation(supabase, tracks)
  return { success: true, name: params.name || null, scraped: true, trackCount: tracks.length, ...report }
}

/**
 * Main generator. Admin-only (writes real Spotify playlists on the one
 * connected account, and self-validates before publishing).
 * params: { focus: [{key|isrc, multiplier}], album?: [key...], targetMinutes?, name?, agentNo? }
 */
export async function generatePlaylist(supabase: SupabaseDB, params: any): Promise<any> {
  const targetMs = Math.min((params.targetMinutes || 180), 180) * 60000
  const fillerEvery = Math.max(5, Math.min(parseInt(params.fillerEvery) || 20, 30))
  const cat = await getBTSCatalog(supabase)
  const lib = await getFillerLibrary(supabase)
  const albumsMap = await getAlbumsMap(supabase)
  const keyOf = (s: any) => s.key || s.isrc || (s.versions?.[0]?.id ? `TID:${s.versions[0].id}` : null)
  const byKey = new Map<string, any>((cat.songs || []).map((s: any) => [keyOf(s), s]))

  const focusInput = (params.focus || [])
    .filter((f: any) => (f.key || f.isrc) && f.multiplier > 0)
    .map((f: any) => ({ ...f, isrc: f.key || f.isrc }))
  if (focusInput.length === 0) throw new Error('Pick at least one focus song with a multiplier.')

  const { token, userId } = await getUserAccessToken(supabase)

  const focusSongs = await Promise.all(focusInput.map(async (f: any) => {
    const s = byKey.get(f.isrc)
    if (!s) throw new Error(`Focus song not in catalog (${f.isrc}). Refresh the catalog.`)
    let versions = [...(s.versions || [])]
    if (!versions.length) {
      const artist = (s.artists || ['BTS'])[0]
      const queries = [`${s.name} ${artist}`, `${s.name} BTS`, s.name]
      let match: any = null
      for (let qi = 0; qi < queries.length; qi++) {
        const d = qi === 0
          ? await spotifyGetJsonOrThrow(`https://api.spotify.com/v1/search?q=${encodeURIComponent(queries[qi])}&type=track&limit=10`, token)
          : await spotifyGetJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(queries[qi])}&type=track&limit=10`, token)
        match = (d?.tracks?.items ?? []).find((item: any) => isBTSArtists(item.artists ?? []))
        if (match) break
      }
      if (!match) {
        for (const q of queries) {
          const d = await spotifyGetJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`, token)
          match = d?.tracks?.items?.[0] ?? null
          if (match) break
        }
      }
      if (!match) throw new Error(`Could not find "${s.name}" on Spotify. Refresh the catalog — it may be missing this song.`)
      versions = [{ id: match.id, uri: `spotify:track:${match.id}`, album: match.album?.name || '', durationMs: match.duration_ms || 0 }]
    }
    return { key: keyOf(s), isrc: s.isrc, name: s.name, artists: s.artists, versions, durationMs: versions[0]?.durationMs || s.durationMs, plays: Math.floor(f.multiplier) }
  }))

  const focusKeys = new Set<string>(focusSongs.map((s: any) => s.key))
  const albumKeys = new Set<string>(params.album || [])

  let albumOnce = (params.album || [])
    .filter((k: string) => !focusKeys.has(k))
    .map((k: string) => byKey.get(k))
    .filter((s: any) => s && s.versions?.length > 0)
    .map((s: any) => ({ key: keyOf(s), uri: s.versions[0].uri, id: s.versions[0].id, name: s.name, isrc: s.versions[0].isrc || s.isrc, durationMs: s.versions[0].durationMs || s.durationMs, album: s.versions[0].album }))

  const totalFocusPlays = focusSongs.reduce((n: number, s: any) => n + s.plays, 0) + albumOnce.length

  let albumLabel: string | null = null
  if ((params.album || []).length > 0) {
    const wanted = new Set<string>(params.album)
    for (const a of Object.values(albumsMap || {})) {
      const keys: string[] = (a as any)?.trackKeys || []
      if (keys.length === wanted.size && keys.every((k) => wanted.has(k))) {
        albumLabel = (a as any).name
        break
      }
    }
  }

  // A real generation once repeated a "filler" because the exact same
  // Spotify recording (same ISRC) had ALSO been resolved into the BTS
  // catalog — the filler-library copy was credited to "Jung Kook" (a BTS
  // member), which live re-validation correctly recognizes as BTS, so the
  // playlist ended up with the same recording once from each pool and only
  // Spotify's own real ISRC data caught it (dedupeTracksByIdentity only
  // dedupes WITHIN the filler pool, not against the separate BTS catalog).
  // Filtering member-credited tracks out of the filler pool up front closes
  // that path regardless of how a future filler entry gets added.
  const btsMemberNames = new Set(Object.keys(BTS_ARTIST_IDS).map((n) => n.toLowerCase()))
  let nonBtsFillers = dedupeTracksByIdentity(
    (lib.fillers || [])
      .filter((f: any) => !(f.artists || []).some((a: string) => btsMemberNames.has(String(a || '').toLowerCase())))
      .map((f: any) => ({ uri: f.uri, id: f.track_id, name: f.name, isrc: f.isrc, durationMs: f.duration_ms, isBTS: false })),
  )
  let btsSpacers = (cat.songs || [])
    .filter((s: any) => !focusKeys.has(keyOf(s)) && !albumKeys.has(keyOf(s)) && s.versions?.[0]?.uri && (s.versions[0].durationMs || s.durationMs || 0) >= 90000)
    .map((s: any) => ({ key: keyOf(s), uri: s.versions[0].uri, id: s.versions[0].id, name: s.name, isrc: s.versions[0].isrc || s.isrc, durationMs: s.versions[0].durationMs || s.durationMs, isBTS: true, album: s.versions[0].album }))

  // Resolve every candidate in the connected account's market before the
  // planner sees it. Spotify can relink unavailable IDs to another playable
  // pressing, so two unique stored IDs can collapse into the same live ID or
  // ISRC after publication. That was the remaining source of playlists that
  // passed locally and then failed R4 ("fillers never repeat") every time.
  const candidateTracks = [
    ...focusSongs.flatMap((s: any) => s.versions || []),
    ...albumOnce, ...btsSpacers, ...nonBtsFillers,
  ]
  const candidateIds = candidateTracks
    .map((t: any) => parseSpotifyId(t.id || t.uri || '', 'track'))
    .filter(Boolean) as string[]
  const liveById = await fetchTracksByIds(token, candidateIds)
  const hydrate = (t: any): any => {
    const requestedId = parseSpotifyId(t.id || t.uri || '', 'track')
    const live = requestedId ? liveById.get(requestedId) : null
    if (!live) return t
    return {
      ...t,
      id: live.id,
      uri: live.uri,
      isrc: live.isrc || t.isrc || null,
      durationMs: live.durationMs || t.durationMs,
      spotifyArtists: live.artists,
      spotifyIsBTS: live.isBTS,
    }
  }

  for (const song of focusSongs) {
    const seenVersionIds = new Set<string>()
    song.versions = (song.versions || []).map(hydrate).filter((v: any) => {
      if (v.spotifyIsBTS === false) return false
      const id = parseSpotifyId(v.id || v.uri || '', 'track')
      if (!id || seenVersionIds.has(id)) return false
      seenVersionIds.add(id)
      return true
    })
    if (!song.versions.length) throw new Error(`No playable Spotify version remains for "${song.name}".`)
    song.durationMs = song.versions[0].durationMs || song.durationMs
  }
  albumOnce = dedupeTracksByIdentity(albumOnce.map(hydrate))
  const invalidAlbumTrack = albumOnce.find((t: any) => t.spotifyIsBTS === false)
  if (invalidAlbumTrack) {
    throw new Error(`"${invalidAlbumTrack.name}" is not credited to the verified BTS/member Spotify artists, so it cannot be used as an album track.`)
  }
  btsSpacers = dedupeTracksByIdentity(btsSpacers.map(hydrate))
    .filter((t: any) => t.spotifyIsBTS !== false)
  nonBtsFillers = dedupeTracksByIdentity(nonBtsFillers.map(hydrate))
    .filter((f: any) => f.spotifyIsBTS !== true)

  // A filler must also be unique against every BTS-side recording, not only
  // against other fillers. Using both live ID and ISRC catches stale catalog
  // copies whose ISRC has not been populated yet.
  const btsRecordings = [
    ...focusSongs.flatMap((s: any) => s.versions || []),
    ...albumOnce, ...btsSpacers,
  ]
  nonBtsFillers = excludeTracksByIdentity(nonBtsFillers, btsRecordings)

  const avgMs = (focusSongs.reduce((n: number, s: any) => n + s.durationMs, 0) / Math.max(1, focusSongs.length)) || 200000
  const focusTotalMs = focusSongs.reduce((n: number, s: any) => n + s.durationMs * s.plays, 0)
  const tracksByTime = Math.floor(targetMs / avgMs)
  const is2Focus = focusSongs.length === 2

  let approxTracks: number
  if (is2Focus) {
    const totalPlays = focusSongs.reduce((n: number, s: any) => n + s.plays, 0)
    approxTracks = Math.ceil(totalPlays * 4)
  } else {
    approxTracks = focusTotalMs > targetMs * 0.65
      ? Math.max(totalFocusPlays, tracksByTime)
      : Math.min(tracksByTime, Math.ceil(totalFocusPlays * 2.2))
  }

  const estimatedMs = Math.min(targetMs, approxTracks * avgMs)
  const timeBasedFillers = Math.ceil(estimatedMs / (27.5 * 60000))
  const fillersNeeded = Math.max(2, Math.ceil(approxTracks / fillerEvery), timeBasedFillers)
  if (nonBtsFillers.length < fillersNeeded) {
    throw new Error(`Need ~${fillersNeeded} unique non-BTS fillers for this size but the library only has ${nonBtsFillers.length}. Import more playlists or add some manually.`)
  }
  if (btsSpacers.length === 0) {
    throw new Error(`No playable BTS catalog songs available as spacers. Add songs via Search or Resolve, then regenerate.`)
  }

  const focusPlays = is2Focus ? [] : spreadFocusPlays(focusSongs)
  const { order } = is2Focus
    ? buildPlaylistOrder2Focus(focusSongs, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery)
    : buildPlaylistOrder(focusPlays, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery)

  // Safety net: assert the builder actually delivered every requested play.
  // A real generation once came back with only 7 of a requested 10 plays
  // (a builder skeleton bug silently dropped the rest) while every rule
  // still reported "pass", since nothing checked requested vs. actual
  // counts. Fail loudly instead of silently shipping an undercounted
  // playlist — this should never fire now that the underlying bug is
  // fixed, but it's cheap insurance against the next one.
  for (const s of focusSongs) {
    const actual = order.filter((t: any) => t.key === s.key).length
    if (actual !== s.plays) {
      throw new Error(`Internal error: "${s.name}" requested ${s.plays} play(s) but the builder produced ${actual}. Please try generating again.`)
    }
  }
  // Album tracks are mandatory too (each selected album track should
  // appear exactly once) — the 2-focus builder's placement logic defers
  // album tracks to whichever window has room and only force-flushes
  // leftovers at the very end, so the same "never lose it silently"
  // guarantee needs the same explicit check here.
  const actualAlbumCount = order.filter((t: any) => t.isAlbumTrack).length
  if (actualAlbumCount !== albumOnce.length) {
    throw new Error(`Internal error: requested ${albumOnce.length} album track(s) but the builder produced ${actualAlbumCount}. Please try generating again.`)
  }

  let trimTotal = order.reduce((s: number, t: any) => s + (t.durationMs || 0), 0)
  const MAX_RUNTIME_MS = 3 * 60 * 60 * 1000
  // Rules already failing before any trimming started aren't the trim's
  // fault — only guard against trimming NEWLY introducing a failure (e.g.
  // R3 same-song gap, R4 no-repeat fillers if it removes the last unique
  // one, R6 needing >=2 non-Kpop songs if it removes the last one).
  const preTrimFailedRules = new Set(
    analyzeTracklist(order).findings.filter((f: any) => f.status === 'fail').map((f: any) => f.rule),
  )
  // Tracks a trim attempt already found to be unsafe so it isn't retried.
  const unsafeToTrim = new Set<any>()
  while (trimTotal > MAX_RUNTIME_MS) {
    // Only ever drop an optional spacer/filler, never a requested focus
    // play or album track — used to pop blindly off the tail, which
    // happened to be safe only because trailing spacers usually ended up
    // there. Walk backward for the last untried optional track instead.
    let idx = -1
    for (let i = order.length - 1; i >= 0; i--) {
      if (!order[i].isFocus && !order[i].isAlbumTrack && !unsafeToTrim.has(order[i])) { idx = i; break }
    }
    if (idx === -1) break // nothing left that's both optional and safe; validation below will catch an overrun
    const candidate = order[idx]
    order.splice(idx, 1)
    // A spacer can be the only thing keeping two repeats of the same song
    // MIN_GAP_MS apart, the last unique filler, or the last non-Kpop track
    // — removing it blindly used to be able to trade a silent runtime fix
    // for a silent compliance break (validation would then just fail the
    // whole generation instead of the trim repairing itself). Re-check
    // every rule (not just the gap one) and put the track back in favor of
    // a different candidate if this specific removal newly broke any of
    // them.
    const recheck = analyzeTracklist(order)
    const introducedNewFailure = recheck.findings.some(
      (f: any) => f.status === 'fail' && !preTrimFailedRules.has(f.rule),
    )
    if (introducedNewFailure) {
      order.splice(idx, 0, candidate)
      unsafeToTrim.add(candidate)
      continue
    }
    trimTotal -= candidate.durationMs || 0
  }

  const report = analyzeTracklist(order)
  const ruleFails = report.findings.filter((f: any) => f.status === 'fail')
  if (ruleFails.length > 0) {
    throw new Error(
      `Playlist violates ${ruleFails.length} rule(s) — not created:\n` +
      ruleFails.map((f: any) => `• ${f.rule}: ${f.detail}`).join('\n')
    )
  }

  const { name: humanName, description: humanDescription } = buildHumanPlaylistMeta(focusSongs, albumLabel)
  const name = params.name || humanName
  const uris = order.map((t: any) => t.uri).filter(Boolean)
  const created = await createUserPlaylist(token, userId, name, humanDescription, uris)

  // Catalog rows can be stale or represent another Spotify pressing. Validate
  // the exact tracks Spotify saved, with Spotify's real durations and ISRCs,
  // before treating the generation as successful. This closes the gap where
  // a locally valid order could publish with a 7:59 repeat window or two
  // alternate track IDs for one filler recording. Invalid attempts are
  // unfollowed immediately and never consume the agent's Wing because the
  // caller charges only after generatePlaylist() returns successfully.
  const savedTracks = await fetchAllPlaylistTracks(token, created.id)
  const savedReport = await runValidation(supabase, savedTracks)
  const savedFailures = savedReport.findings.filter((f: any) => f.status === 'fail')
  if (savedFailures.length > 0) {
    await fetch(`https://api.spotify.com/v1/playlists/${created.id}/followers`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    throw new Error(
      `Spotify copy failed live validation — please retry (no Wing spent):\n` +
      savedFailures.map((f: any) => `• ${f.rule}: ${f.detail}`).join('\n')
    )
  }

  try {
    await uploadPlaylistCover(token, created.id, created.id)
  } catch (e) {
    console.log('[cover-upload] failed (non-fatal):', (e as any)?.message || e)
  }

  await supabase.from('generated_playlists').insert({
    name, playlist_id: created.id, url: created.url,
    agent_no: params.agentNo || null,
    config: { focus: focusInput, album: params.album || [], targetMinutes: params.targetMinutes || 180, fillerEvery },
    track_count: order.length, created_at: utcNow(),
  })

  return { success: true, name, url: created.url, trackCount: order.length, report }
}

const ALPACA_QUICK_PLAYS = 4
const ALPACA_QUICK_MINUTES = 180
const ALPACA_MAX_TOTAL_PLAYS = 120

/** Playable catalog songs + album bundles for the agent-facing picker. */
export async function getAlpacaOptions(supabase: SupabaseDB, _params: any): Promise<any> {
  const [cat, albumsMap] = await Promise.all([
    getBTSCatalog(supabase),
    getAlbumsMap(supabase),
  ])

  const songs = (cat.songs || [])
    .filter((s: any) => s?.name && (s.key || s.isrc))
    .map((s: any) => ({ key: s.key || s.isrc, name: s.name, artists: s.artists || ['BTS'] }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name))

  const albums = Object.values(albumsMap || {})
    .filter((a: any) => a?.name && (a.trackKeys || []).length > 0 && !BANNED_ALBUM_NAMES.has(normalizeKey(a.name)))
    .map((a: any) => ({ id: a.id, name: a.name, trackKeys: a.trackKeys, count: a.trackKeys.length }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name))

  return { success: true, songs, albums }
}

/**
 * Quick mode: derive the focus list from the live goal list (`rc_goals`),
 * so the generator follows every comeback with no code change. Unlike the
 * source (which also fell back to an old per-week `goal_definitions` table),
 * op-reconnect has exactly one goals table — `rc_goals` — so that's the only
 * source read here.
 */
async function alpacaQuickPlan(supabase: SupabaseDB): Promise<{ focus: any[]; album: string[] }> {
  const [cat, albumsMap, goalsRes] = await Promise.all([
    getBTSCatalog(supabase),
    getAlbumsMap(supabase),
    supabase.from('rc_goals').select('kind, label, aliases').eq('active', true),
  ])

  const goals: { target_type: string; target_name: string; aliases?: any }[] =
    (goalsRes.data || []).map((g: any) => ({ target_type: g.kind, target_name: g.label, aliases: g.aliases }))

  const songByExactName = new Map<string, any>()
  const songByName = new Map<string, any>()
  for (const s of cat.songs || []) {
    if (!s?.name || !(s.key || s.isrc)) continue
    const exactK = normalizeKey(s.name)
    if (!songByExactName.has(exactK)) songByExactName.set(exactK, s)
    const k = normalizeKey(stripVersionSuffix(s.name))
    if (!songByName.has(k)) songByName.set(k, s)
  }
  const albumByName = new Map<string, any>()
  for (const a of Object.values(albumsMap || {})) {
    if ((a as any)?.name) albumByName.set(normalizeKey((a as any).name), a)
  }

  const focus: any[] = []
  const album: string[] = []
  const seen = new Set<string>()

  for (const g of goals) {
    const name = g.target_name || ''
    if (g.target_type === 'track') {
      const candidates = [name, ...(Array.isArray(g.aliases) ? g.aliases : [])]
      let s: any = null
      for (const cand of candidates) {
        s = songByExactName.get(normalizeKey(String(cand || '')))
        if (s) break
      }
      if (!s) {
        for (const cand of candidates) {
          s = songByName.get(normalizeKey(stripVersionSuffix(String(cand || ''))))
          if (s) break
        }
      }
      const key = s && (s.key || s.isrc)
      if (!key || seen.has(key)) continue
      seen.add(key)
      focus.push({ key, multiplier: ALPACA_QUICK_PLAYS })
    } else {
      const a = albumByName.get(normalizeKey(name))
      for (const k of (a?.trackKeys || [])) if (!album.includes(k)) album.push(k)
    }
  }
  return { focus, album }
}

const ALPACA_DAILY_LIMIT = 5
const ALPACA_WING_COST = 1

// Custom-tab combo lock: an agent picking their own focus songs/albums may
// only land on one of these three shapes — nothing else. Quick mode is
// exempt (checked separately, mode !== 'quick' below): it pulls every
// active goal for the week in one go, which routinely adds up to far more
// than 2 songs or 2 albums, and that's by design, not something a player
// chose. "song"/"album" counts here mean distinct picks, not play counts —
// picking one song ×10 is still 1 song.
const ALLOWED_CUSTOM_COMBOS = new Set(['2:1', '1:2', '1:1'])

// Never eligible for a generated playlist, in any mode — full-length
// live/anthology/compilation releases that either re-use previously
// released masters or run far longer than a normal era album, neither of
// which the PL ruleset wants counted through the generator. Matched by
// normalized name against the album catalog (bts_song_catalog.albums),
// covering the likely spellings an admin would use if one of these is ever
// added there — none are in the catalog today, so this is a standing
// guard against it happening later, not a fix for a live problem.
const BANNED_ALBUM_NAMES = new Set([
  'proof',
  'permission to dance on stage',
  'permission to dance on stage live',
  'ptd on stage',
  'ptd live',
  'love yourself answer',
  'the most beautiful moment in life young forever',
  'the most beautiful moment in life pt 2 young forever',
  'hyyh young forever',
  'young forever',
].map((n) => normalizeKey(n)))

/** Every catalog album whose full tracklist is present in `trackKeys` — the
 *  Custom builder's album checkboxes each contribute one whole album's
 *  worth of keys, never a partial pick (js/candy-star.js's
 *  candyCollectCustom), so this recovers "which albums were selected" and
 *  "how many" straight from the flattened list the client actually sends,
 *  rather than trusting a second, separately-suppliable field that could
 *  drift out of sync with the tracks themselves. */
function detectSelectedAlbums(albumsMap: Record<string, any>, trackKeys: string[], albumIds?: string[]): { id: string; name: string }[] {
  // Explicit album IDs from the checkboxes take precedence — checking full
  // tracklist containment alone is ambiguous when one catalog album's tracks
  // are wholly contained in another's (e.g. a single reused on a later
  // release), which would silently count an album the user never checked.
  // Still verified against trackKeys so a forged/stale ID can't slip through.
  if (Array.isArray(albumIds)) {
    const set = new Set(trackKeys)
    const out: { id: string; name: string }[] = []
    const seen = new Set<string>()
    for (const id of albumIds) {
      if (seen.has(id)) continue
      const a = (albumsMap || {})[id]
      const keys: string[] = a?.trackKeys || []
      if (a && keys.length > 0 && keys.every((k) => set.has(k))) {
        seen.add(id)
        out.push({ id: a.id, name: a.name })
      }
    }
    return out
  }

  const set = new Set(trackKeys)
  const out: { id: string; name: string }[] = []
  for (const a of Object.values(albumsMap || {})) {
    const keys: string[] = (a as any)?.trackKeys || []
    if (keys.length > 0 && keys.every((k) => set.has(k))) out.push({ id: (a as any).id, name: (a as any).name })
  }
  return out
}

/** Agent-facing wrapper around generatePlaylist — "so agents can build their
 *  own rule-compliant playlists." Capped at ALPACA_DAILY_LIMIT/day per agent
 *  and costs ALPACA_WING_COST Wings per generation — see this file's header
 *  comment for why that reverses the original ported behavior. */
export async function generateAlpaca(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = params.agentNo
  const isQuick = params.mode === 'quick'
  let focus = params.focus || []
  let album = params.album || []
  let targetMinutes = 180

  if (isQuick) {
    const plan = await alpacaQuickPlan(supabase)
    focus = plan.focus
    album = plan.album
    targetMinutes = ALPACA_QUICK_MINUTES
    if (!focus.length) {
      return { success: false, error: "This week's goals aren't set up yet — try the custom builder below." }
    }
  }

  if (!focus.length) return { success: false, error: 'Pick at least one song with a count.' }

  // Valid, deduped picks only — a raw params.focus from a direct API call
  // could carry a duplicate key or a zero multiplier that candyCollectCustom
  // would never have produced; counting those against the combo cap would
  // make it gameable in exactly the way this check exists to prevent.
  const validFocusKeys = new Set<string>(
    focus.filter((f: any) => (f.key || f.isrc) && parseInt(f.multiplier) > 0).map((f: any) => f.key || f.isrc),
  )

  const albumsMap = await getAlbumsMap(supabase)
  const selectedAlbums = detectSelectedAlbums(albumsMap, album, params.albumIds)

  const banned = selectedAlbums.find((a) => BANNED_ALBUM_NAMES.has(normalizeKey(a.name)))
  if (banned) {
    return { success: false, error: `${banned.name} can't be used for generated playlists — pick a different album.` }
  }

  if (!isQuick) {
    const comboKey = `${validFocusKeys.size}:${selectedAlbums.length}`
    if (!ALLOWED_CUSTOM_COMBOS.has(comboKey)) {
      return { success: false, error: 'Pick exactly one of: 2 songs + 1 album, 1 song + 2 albums, or 1 song + 1 album.' }
    }
  }

  const totalPlays = focus.reduce((n: number, f: any) => n + (parseInt(f.multiplier) || 0), 0)
  if (totalPlays > ALPACA_MAX_TOTAL_PLAYS) {
    return { success: false, error: `That's a lot of streams — keep the total under ${ALPACA_MAX_TOTAL_PLAYS}.` }
  }

  if (params.dryRun) {
    return { success: true, dryRun: true, mode: params.mode || 'custom', targetMinutes, totalPlays, focus, albumTrackCount: album.length }
  }

  // Daily cap — counts real generations only (generated_playlists rows are
  // only ever inserted after a successful run), so a failed attempt never
  // eats into the limit.
  const { fromTs } = kstDayBounds(todayKst())
  const { count: todayCount } = await supabase.from('generated_playlists')
    .select('id', { count: 'exact', head: true })
    .eq('agent_no', agentNo).gte('created_at', new Date(fromTs * 1000).toISOString())
  if ((todayCount || 0) >= ALPACA_DAILY_LIMIT) {
    return { success: false, error: `You've made ${ALPACA_DAILY_LIMIT} Alpacas today — come back tomorrow.` }
  }

  const { data: player } = await supabase.from('rc_players').select('wings').eq('agent_no', agentNo).maybeSingle()
  if (!player || (player.wings || 0) < ALPACA_WING_COST) {
    return { success: false, error: `Not enough Wings — this costs ${ALPACA_WING_COST}. The Magic Shop sells up to 3 a day.` }
  }

  try {
    const res = await generatePlaylist(supabase, { focus, album, targetMinutes, agentNo, name: params.name || '' })
    if (res.success) {
      await supabase.from('rc_players').update({ wings: player.wings - ALPACA_WING_COST }).eq('agent_no', agentNo)
    }
    return res
  } catch (e: any) {
    return { success: false, error: e?.message || 'Generation failed.' }
  }
}

/**
 * Non-destructive preview for the Candy Star builder UI — same builder
 * functions generatePlaylist uses, but never touches Spotify's write APIs or
 * the DB. Only pre-resolved catalog versions are used (no live Spotify
 * search fallback), so this is safe on every debounced keystroke.
 */
export async function previewAlpaca(supabase: SupabaseDB, params: any): Promise<any> {
  let focus = params.focus || []
  let album = params.album || []

  if (params.mode === 'quick') {
    const plan = await alpacaQuickPlan(supabase)
    focus = plan.focus
    album = plan.album
  }

  const focusInput = focus
    .filter((f: any) => (f.key || f.isrc) && f.multiplier > 0)
    .map((f: any) => ({ ...f, isrc: f.key || f.isrc }))
  if (!focusInput.length) return { success: false, error: 'Pick at least one song with a count.' }

  // Same combo/banned-album gate generateAlpaca enforces — checked here too
  // so the builder can show the real rejection reason live, while typing,
  // instead of only at the final "Generate" tap.
  const albumsMapForCheck = await getAlbumsMap(supabase)
  const selectedAlbumsForCheck = detectSelectedAlbums(albumsMapForCheck, album, params.albumIds)
  const bannedPreview = selectedAlbumsForCheck.find((a) => BANNED_ALBUM_NAMES.has(normalizeKey(a.name)))
  if (bannedPreview) {
    return { success: false, error: `${bannedPreview.name} can't be used for generated playlists — pick a different album.` }
  }
  if (params.mode !== 'quick') {
    const distinctFocusKeys = new Set<string>(focusInput.map((f: any) => f.isrc))
    const comboKey = `${distinctFocusKeys.size}:${selectedAlbumsForCheck.length}`
    if (!ALLOWED_CUSTOM_COMBOS.has(comboKey)) {
      return { success: false, error: 'Pick exactly one of: 2 songs + 1 album, 1 song + 2 albums, or 1 song + 1 album.' }
    }
  }

  const targetMs = 180 * 60000
  const fillerEvery = 20
  const cat = await getBTSCatalog(supabase)
  const lib = await getFillerLibrary(supabase)
  const keyOf = (s: any) => s.key || s.isrc || (s.versions?.[0]?.id ? `TID:${s.versions[0].id}` : null)
  const byKey = new Map<string, any>((cat.songs || []).map((s: any) => [keyOf(s), s]))

  const focusSongs = focusInput
    .map((f: any) => {
      const s = byKey.get(f.isrc)
      if (!s || !(s.versions?.length)) return null
      return { key: keyOf(s), isrc: s.isrc, name: s.name, artists: s.artists, versions: s.versions, durationMs: s.versions[0]?.durationMs || s.durationMs, plays: Math.floor(f.multiplier) }
    })
    .filter(Boolean)
  if (!focusSongs.length) {
    return { success: false, error: 'Still resolving those songs — generate to fetch them, or try again in a moment.' }
  }

  const focusKeys = new Set<string>(focusSongs.map((s: any) => s.key))
  const albumOnce = album
    .filter((k: string) => !focusKeys.has(k))
    .map((k: string) => byKey.get(k))
    .filter((s: any) => s && s.versions?.length > 0)
    .map((s: any) => ({ key: keyOf(s), uri: s.versions[0].uri, id: s.versions[0].id, name: s.name, isrc: s.isrc, durationMs: s.durationMs, album: s.versions[0].album }))

  const nonBtsFillers = (lib.fillers || []).map((f: any) => ({ uri: f.uri, id: f.track_id, name: f.name, artists: f.artists, isrc: f.isrc, durationMs: f.duration_ms, isBTS: false }))
  const btsSpacers = (cat.songs || [])
    .filter((s: any) => !focusKeys.has(keyOf(s)) && !album.includes(keyOf(s)) && s.versions?.[0]?.uri && (s.durationMs || 0) >= 90000)
    .map((s: any) => ({ key: keyOf(s), uri: s.versions[0].uri, id: s.versions[0].id, name: s.name, isrc: s.isrc, durationMs: s.durationMs, isBTS: true, album: s.versions[0].album }))

  if (btsSpacers.length === 0 || nonBtsFillers.length < 2) {
    return { success: false, error: 'Catalog not ready for a preview yet.' }
  }

  const is2Focus = focusSongs.length === 2
  const focusPlays = is2Focus ? [] : spreadFocusPlays(focusSongs)
  const { order } = is2Focus
    ? buildPlaylistOrder2Focus(focusSongs, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery)
    : buildPlaylistOrder(focusPlays, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery)

  const totalDurationMs = order.reduce((n: number, t: any) => n + (t.durationMs || 0), 0)
  const preview = order.slice(0, 8).map((t: any) => ({
    name: t.name,
    artists: t.artists || (t.isBTS === false ? [] : ['BTS']),
    isFocus: focusKeys.has(t.key),
    isBTS: t.isBTS !== false,
  }))

  return {
    success: true,
    totalTracks: order.length,
    moreCount: Math.max(0, order.length - preview.length),
    totalDurationMs,
    totalFocusPlays: focusSongs.reduce((n: number, s: any) => n + s.plays, 0),
    albumTrackCount: albumOnce.length,
    nonKpopCount: order.filter((t: any) => t.isBTS === false).length,
    preview,
    partial: focusSongs.length < focusInput.length,
  }
}

/** Admin: remove a generated playlist from the connected Spotify account's
 *  library. Spotify has no true "delete" for a playlist you own — unfollow
 *  is the real equivalent, which is what this does. Exists for cleaning up
 *  test generations (the same connected account every generateAlpaca call
 *  rides on) without leaving throwaway playlists sitting in the real
 *  library indefinitely. */
export async function adminDeleteAlpacaPlaylist(supabase: SupabaseDB, params: any): Promise<any> {
  const playlistId = String(params.playlistId || '').trim()
  if (!playlistId) return { success: false, error: 'playlistId_required' }
  const { token } = await getUserAccessToken(supabase)
  const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return { success: false, error: `Spotify delete failed: ${res.status} ${await res.text()}` }
  return { success: true }
}
