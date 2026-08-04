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
// NOT ported: any daily-generation cap. arirang-btsbackend's own comment on
// this section reads "No daily limit — an agent can generate as many as they
// want", and grepping its ROUTES/generateAlpaca confirms no cap is actually
// enforced anywhere — migrations/015_candy_star_agent_playlists.sql (the old
// site) only adds `agent_no` for attribution, not a limit. Ported faithfully
// as-is: `generated_playlists.agent_no` is recorded (migration 030) but
// nothing reads it to block a request.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseDB } from './spotify-shared.ts'
import {
  utcNow, isBTSArtists, spotifyGetJson, spotifyGetJsonOrThrow, fetchArtistGenres,
  looksKpop, normalizeKey, stripVersionSuffix, fetchAllPlaylistTracks, parseSpotifyId,
} from './spotify-shared.ts'
import { getUserAccessToken } from './spotify-oauth.ts'
import { getBTSCatalog, getAlbumsMap } from './spotify-catalog.ts'
import { getFillerLibrary } from './spotify-filler.ts'
import {
  analyzeTracklist, buildHumanPlaylistMeta, buildPlaylistOrder, buildPlaylistOrder2Focus,
  spreadFocusPlays, createUserPlaylist, uploadPlaylistCover,
} from './candy-star-rules.ts'

/** Validate an existing playlist by URL against the ARMY ruleset. Admin-only. */
export async function validatePlaylist(supabase: SupabaseDB, params: { playlistUrl: string }): Promise<any> {
  const pid = parseSpotifyId(params.playlistUrl, 'playlist')
  if (!pid) throw new Error('Could not parse a Spotify playlist id from that input.')
  const { token } = await getUserAccessToken(supabase)
  const tracks = await fetchAllPlaylistTracks(token, pid)
  if (!tracks.length) throw new Error('No tracks found (private playlist, or wrong link).')

  const report = analyzeTracklist(tracks)

  const nonBts = tracks.filter((t: any) => !t.isBTS)
  const genreMap = await fetchArtistGenres(token, [...new Set(nonBts.flatMap((t: any) => t.artists.map((a: any) => a.id)))] as string[])
  const kpopHits = nonBts.filter((t: any) => looksKpop(t.artists.flatMap((a: any) => genreMap[a.id] || [])))
  report.findings.push({
    rule: 'No K-pop fillers', status: kpopHits.length === 0 ? 'pass' : 'fail',
    detail: kpopHits.length === 0 ? 'No non-BTS K-pop tracks detected.'
      : `${kpopHits.length} K-pop track(s): ${kpopHits.slice(0, 5).map((t: any) => t.name).join(', ')}.`,
  })
  report.summary.failed = report.findings.filter((f: any) => f.status === 'fail').length
  report.summary.passed = report.findings.filter((f: any) => f.status === 'pass').length
  return { success: true, playlistId: pid, ...report }
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

  const albumOnce = (params.album || [])
    .filter((k: string) => !focusKeys.has(k))
    .map((k: string) => byKey.get(k))
    .filter((s: any) => s && s.versions?.length > 0)
    .map((s: any) => ({ key: keyOf(s), uri: s.versions[0].uri, id: s.versions[0].id, name: s.name, isrc: s.isrc, durationMs: s.durationMs, album: s.versions[0].album }))

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

  const nonBtsFillers = (lib.fillers || []).map((f: any) => ({ uri: f.uri, id: f.track_id, name: f.name, isrc: f.isrc, durationMs: f.duration_ms, isBTS: false }))
  const btsSpacers = (cat.songs || [])
    .filter((s: any) => !focusKeys.has(keyOf(s)) && !albumKeys.has(keyOf(s)) && s.versions?.[0]?.uri && (s.durationMs || 0) >= 90000)
    .map((s: any) => ({ key: keyOf(s), uri: s.versions[0].uri, id: s.versions[0].id, name: s.name, isrc: s.isrc, durationMs: s.durationMs, isBTS: true, album: s.versions[0].album }))

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

  let trimTotal = order.reduce((s: number, t: any) => s + (t.durationMs || 0), 0)
  const MAX_RUNTIME_MS = 3 * 60 * 60 * 1000
  while (order.length > 1 && trimTotal > MAX_RUNTIME_MS) {
    trimTotal -= order[order.length - 1].durationMs || 0
    order.pop()
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
    .filter((a: any) => a?.name && (a.trackKeys || []).length > 0)
    .map((a: any) => ({ name: a.name, trackKeys: a.trackKeys, count: a.trackKeys.length }))
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

/** Agent-facing wrapper around generatePlaylist — "so agents can build their
 *  own rule-compliant playlists." No daily limit, matching the source. */
export async function generateAlpaca(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = params.agentNo
  let focus = params.focus || []
  let album = params.album || []
  let targetMinutes = 180

  if (params.mode === 'quick') {
    const plan = await alpacaQuickPlan(supabase)
    focus = plan.focus
    album = plan.album
    targetMinutes = ALPACA_QUICK_MINUTES
    if (!focus.length) {
      return { success: false, error: "This week's goals aren't set up yet — try the custom builder below." }
    }
  }

  if (!focus.length) return { success: false, error: 'Pick at least one song with a count.' }

  const totalPlays = focus.reduce((n: number, f: any) => n + (parseInt(f.multiplier) || 0), 0)
  if (totalPlays > ALPACA_MAX_TOTAL_PLAYS) {
    return { success: false, error: `That's a lot of streams — keep the total under ${ALPACA_MAX_TOTAL_PLAYS}.` }
  }

  if (params.dryRun) {
    return { success: true, dryRun: true, mode: params.mode || 'custom', targetMinutes, totalPlays, focus, albumTrackCount: album.length }
  }

  try {
    const res = await generatePlaylist(supabase, { focus, album, targetMinutes, agentNo, name: params.name || '' })
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
