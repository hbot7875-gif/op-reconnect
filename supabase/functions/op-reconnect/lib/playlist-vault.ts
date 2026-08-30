// Candy Star Playlist Vault — browse, bookmark, share, and report playlists.
//
// generated_playlists remains the single source of truth: Candy Star writes
// generated rows there and agents may add an existing public Spotify link as
// a shared row.  A save is only a bookmark; playlists are deliberately never
// "claimed" because the same Spotify playlist can help every agent at once.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseDB } from './spotify-shared.ts'
import { parseSpotifyId, utcNow } from './spotify-shared.ts'
import { getUserAccessToken } from './spotify-oauth.ts'
import { getDistrictGoalCatalogMatch } from './candy-star.ts'

const PAGE_SIZE = 24
const MAX_PAGE_SIZE = 48
const SHARE_DAILY_LIMIT = 5
const REPORTS_TO_HIDE = 3
// 'relevant' scores every active generated playlist against one district's
// goals (see districtMatch below) rather than paging through the table, so
// this bounds how many rows that scoring pass ever reads at once. Generous
// for this game's actual scale (dozens to low hundreds of generated
// playlists) — well short of a real pagination concern.
const RELEVANT_SCAN_LIMIT = 500
const ALWAYS_PLAYLIST_MAKER = 'AGENT000'

function agentNoOf(params: any): string {
  return String(params.agentNo || '').trim().toUpperCase()
}

function clampPageSize(raw: any): number {
  return Math.max(1, Math.min(Number(raw) || PAGE_SIZE, MAX_PAGE_SIZE))
}

function safeConfig(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function isPlaylistMaker(supabase: SupabaseDB, agentNo: string): Promise<boolean> {
  const no = String(agentNo || '').trim().toUpperCase()
  if (!no) return false
  if (no === ALWAYS_PLAYLIST_MAKER) return true
  const { data, error } = await supabase.from('rc_config')
    .select('value').eq('key', 'playlist_makers').maybeSingle()
  if (error || !data) return false
  return (Array.isArray(data.value) ? data.value : [])
    .some((entry: any) => String(entry || '').trim().toUpperCase() === no)
}

export async function amIPlaylistMaker(supabase: SupabaseDB, params: any): Promise<any> {
  return { success: true, allowed: await isPlaylistMaker(supabase, agentNoOf(params)) }
}

export async function getPlaylistMakerHub(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  if (!(await isPlaylistMaker(supabase, agentNo))) return { success: false, error: 'not_playlist_maker' }
  const [districtsRes, mineRes] = await Promise.all([
    supabase.from('rc_districts').select('id, name, ward_id, sequence')
      .eq('active', true).order('sequence'),
    supabase.from('generated_playlists')
      .select('name, playlist_id, url, district_id, config, created_at, status')
      .eq('agent_no', agentNo).eq('source', 'shared')
      .order('created_at', { ascending: false }).limit(100),
  ])
  if (districtsRes.error || mineRes.error) {
    return { success: false, error: districtsRes.error?.message || mineRes.error?.message }
  }
  return { success: true, districts: districtsRes.data || [], playlists: mineRes.data || [] }
}

/** Which of a playlist's real focus songs/albums land on this district's
 *  actual goal catalog keys right now — never a guess. Shared (non-generated)
 *  playlists carry no config.focus/albumIds at all, so they always score
 *  zero matches here rather than being assigned a fake one. */
function districtMatch(row: any, trackKeyToGoal: Record<string, string>, albumIdToGoal: Record<string, string>): string[] {
  const config = safeConfig(row.config)
  const labels = new Set<string>()
  const focus = Array.isArray(config.display?.focus) ? config.display.focus : Array.isArray(config.focus) ? config.focus : []
  for (const f of focus) {
    const key = f?.key || f?.isrc
    const label = key && trackKeyToGoal[key]
    if (label) labels.add(label)
  }
  const albumIds = Array.isArray(config.albumIds) ? config.albumIds : []
  for (const id of albumIds) {
    const label = albumIdToGoal[id]
    if (label) labels.add(label)
  }
  return [...labels]
}

/** Agent-scoped, paged list. Agent numbers never leave the backend.
 *  `districtId` is optional context, not a hard filter: when present, every
 *  returned playlist (any view) also carries `matchedGoalLabels`/
 *  `matchCount` for that district, and view `relevant` additionally narrows
 *  + sorts by that real match instead of just recency. */
export async function getCandyPlaylistLibrary(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  const districtId = params.districtId ? String(params.districtId) : null
  const requestedView = String(params.view)
  const view = districtId
    ? (['relevant', 'community', 'mine'].includes(requestedView) ? requestedView : 'relevant')
    : (['community', 'mine', 'saved'].includes(requestedView) ? requestedView : 'mine')
  const limit = clampPageSize(params.limit)
  const offset = Math.max(0, Number(params.offset) || 0)

  const districtCatalog = districtId ? await getDistrictGoalCatalogMatch(supabase, districtId) : null

  let savedIds: string[] | null = null
  if (view === 'saved') {
    const { data, error } = await supabase.from('rc_playlist_saves')
      .select('playlist_id').eq('agent_no', agentNo).order('created_at', { ascending: false })
    if (error) return { success: false, error: error.message }
    savedIds = (data || []).map((r: any) => String(r.playlist_id)).filter(Boolean)
    if (!savedIds || !savedIds.length) return { success: true, playlists: [], total: 0, hasMore: false, nextOffset: 0, districtName: districtCatalog?.districtName || null }
  }

  let rows: any[]
  let total: number
  const selectCols = 'name, playlist_id, url, agent_no, config, track_count, created_at, source, status, district_id'

  if (view === 'relevant' && districtCatalog) {
    // Trusted district picks are explicit and come first. Candy Star rows
    // follow, scored from their saved recipe against the district's real
    // goals. The UI never needs to expose these implementation categories.
    const { data, error } = await supabase.from('generated_playlists')
      .select(selectCols)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(RELEVANT_SCAN_LIMIT)
    if (error) return { success: false, error: error.message }
    const scored = (data || []).map((row: any) => ({
      row,
      labels: districtMatch(row, districtCatalog.trackKeyToGoal, districtCatalog.albumIdToGoal),
      districtPick: row.source === 'shared' && row.district_id === districtId,
    }))
      .filter((entry: any) => entry.districtPick || entry.labels.length > 0)
      .sort((a: any, b: any) =>
        Number(b.districtPick) - Number(a.districtPick) ||
        b.labels.length - a.labels.length || +new Date(b.row.created_at) - +new Date(a.row.created_at))
    total = scored.length
    rows = scored.slice(offset, offset + limit).map((entry: any) => entry.row)
  } else {
    let query = supabase.from('generated_playlists')
      .select(selectCols, { count: 'exact' })
      .eq('status', 'active')
      .order('source', { ascending: false })
      .order('created_at', { ascending: false })
    if (view === 'mine') query = query.eq('agent_no', agentNo)
    if (savedIds) query = query.in('playlist_id', savedIds)

    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) return { success: false, error: error.message }
    rows = data || []
    total = Number(count) || rows.length
  }

  const playlistIds = [...new Set(rows.map((r: any) => String(r.playlist_id)).filter(Boolean))]
  const creatorIds = [...new Set(rows.map((r: any) => String(r.agent_no || '')).filter(Boolean))]

  const [savedRes, reportsRes, creatorsRes] = await Promise.all([
    playlistIds.length
      ? supabase.from('rc_playlist_saves').select('agent_no, playlist_id').in('playlist_id', playlistIds)
      : Promise.resolve({ data: [], error: null }),
    playlistIds.length
      ? supabase.from('rc_playlist_reports').select('playlist_id').eq('agent_no', agentNo).in('playlist_id', playlistIds)
      : Promise.resolve({ data: [], error: null }),
    creatorIds.length
      ? supabase.from('rc_players').select('agent_no, codename').in('agent_no', creatorIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (savedRes.error || reportsRes.error || creatorsRes.error) {
    return { success: false, error: savedRes.error?.message || reportsRes.error?.message || creatorsRes.error?.message }
  }

  const savedByMe = new Set((savedRes.data || []).filter((r: any) => r.agent_no === agentNo).map((r: any) => r.playlist_id))
  const saveCounts = new Map<string, number>()
  for (const row of savedRes.data || []) saveCounts.set(row.playlist_id, (saveCounts.get(row.playlist_id) || 0) + 1)
  const reportedByMe = new Set((reportsRes.data || []).map((r: any) => r.playlist_id))
  const codenames = new Map((creatorsRes.data || []).map((r: any) => [r.agent_no, r.codename]))

  const playlists = rows.map((row: any) => ({
    name: String(row.name || 'Untitled playlist'),
    playlistId: String(row.playlist_id),
    url: String(row.url || `https://open.spotify.com/playlist/${row.playlist_id}`),
    config: safeConfig(row.config),
    trackCount: Math.max(0, Number(row.track_count) || 0),
    createdAt: row.created_at,
    source: row.source === 'shared' ? 'shared' : 'generated',
    districtId: row.district_id || safeConfig(row.config).districtId || null,
    // Which generator rules a Candy Star playlist was built under. Rows made
    // before the rules were stamped carry no version at all, which is
    // exactly the "check this one before you use it" case the Vault flags.
    // Maker-added playlists are hand-picked and never carry a version.
    generatorVersion: row.source === 'shared' ? null : (Number(safeConfig(row.config).generatorVersion) || 0),
    creator: row.agent_no === agentNo ? 'You' : (codenames.get(row.agent_no) || 'Another agent'),
    isMine: row.agent_no === agentNo,
    saved: savedByMe.has(row.playlist_id),
    saveCount: saveCounts.get(row.playlist_id) || 0,
    reported: reportedByMe.has(row.playlist_id),
    ...(districtCatalog ? (() => {
      const labels = districtMatch(row, districtCatalog.trackKeyToGoal, districtCatalog.albumIdToGoal)
      return { matchedGoalLabels: labels, matchCount: labels.length }
    })() : {}),
  }))

  return {
    success: true,
    playlists,
    total,
    hasMore: offset + playlists.length < total,
    nextOffset: offset + playlists.length,
    districtName: districtCatalog?.districtName || null,
  }
}

export async function setCandyPlaylistSaved(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  const playlistId = parseSpotifyId(String(params.playlistId || ''), 'playlist')
  if (!playlistId) return { success: false, error: 'That Spotify playlist link is not valid.' }

  const shouldSave = params.saved !== false
  if (!shouldSave) {
    const { error } = await supabase.from('rc_playlist_saves').delete()
      .eq('agent_no', agentNo).eq('playlist_id', playlistId)
    return error ? { success: false, error: error.message } : { success: true, saved: false }
  }

  const { data: existing } = await supabase.from('generated_playlists')
    .select('playlist_id').eq('playlist_id', playlistId).eq('status', 'active').limit(1)
  if (!existing?.length) return { success: false, error: 'That playlist is no longer in the Vault.' }

  const { error } = await supabase.from('rc_playlist_saves').upsert(
    { agent_no: agentNo, playlist_id: playlistId, created_at: utcNow() },
    { onConflict: 'agent_no,playlist_id' },
  )
  return error ? { success: false, error: error.message } : { success: true, saved: true }
}

/** Remove an agent's own entry. Generated playlists are also unfollowed from
 * the connected Spotify account; shared links are only removed from Vault. */
export async function deleteCandyPlaylist(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  const playlistId = parseSpotifyId(String(params.playlistId || ''), 'playlist')
  if (!playlistId) return { success: false, error: 'Playlist id required.' }

  const { data: row, error: lookupError } = await supabase.from('generated_playlists')
    .select('agent_no, source, status').eq('playlist_id', playlistId).maybeSingle()
  if (lookupError) return { success: false, error: lookupError.message }
  if (!row || row.status !== 'active') return { success: false, error: 'That playlist is no longer in the Vault.' }
  if (String(row.agent_no || '').toUpperCase() !== agentNo) {
    return { success: false, error: 'You can only delete playlists you added.' }
  }

  const { error: hideError } = await supabase.from('generated_playlists')
    .update({ status: 'hidden', updated_at: utcNow() })
    .eq('playlist_id', playlistId).eq('agent_no', agentNo).eq('status', 'active')
  if (hideError) return { success: false, error: hideError.message }

  const cleanup = await Promise.all([
    supabase.from('rc_playlist_saves').delete().eq('playlist_id', playlistId),
    supabase.from('rc_playlist_reports').delete().eq('playlist_id', playlistId),
  ])
  for (const result of cleanup) {
    if (result.error) console.warn('[playlist-vault] cleanup failed', result.error.message)
  }

  let spotifyRemoved: boolean | null = null
  let warning: string | null = null
  if (row.source === 'generated') {
    try {
      const { token } = await getUserAccessToken(supabase)
      const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/followers`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      spotifyRemoved = response.ok
      if (!response.ok) warning = 'Removed from the Vault, but Spotify could not remove it from the connected library.'
    } catch (_) {
      spotifyRemoved = false
      warning = 'Removed from the Vault, but Spotify could not remove it from the connected library.'
    }
  }

  return { success: true, deleted: true, spotifyRemoved, warning }
}

/** Share an existing public Spotify playlist. oEmbed safely supplies its real title. */
export async function shareCandyPlaylist(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  if (!(await isPlaylistMaker(supabase, agentNo))) {
    return { success: false, error: 'Only approved playlist makers can add district playlists.' }
  }
  const districtId = String(params.districtId || '').trim()
  if (!districtId) return { success: false, error: 'Choose the district this playlist is for.' }
  const { data: district, error: districtError } = await supabase.from('rc_districts')
    .select('id, name').eq('id', districtId).eq('active', true).maybeSingle()
  if (districtError) return { success: false, error: districtError.message }
  if (!district) return { success: false, error: 'That district is not available.' }
  const playlistId = parseSpotifyId(String(params.url || ''), 'playlist')
  if (!playlistId) return { success: false, error: 'Paste a Spotify playlist link.' }
  const url = `https://open.spotify.com/playlist/${playlistId}`

  const { data: duplicate, error: duplicateError } = await supabase.from('generated_playlists')
    .select('name, status').eq('playlist_id', playlistId).limit(1)
  if (duplicateError) return { success: false, error: duplicateError.message }
  if (duplicate?.length) {
    return duplicate[0].status === 'active'
      ? { success: true, alreadyThere: true, name: duplicate[0].name }
      : { success: false, error: 'That playlist was removed from the Vault after being reported.' }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase.from('generated_playlists')
    .select('playlist_id', { count: 'exact', head: true })
    .eq('agent_no', agentNo).eq('source', 'shared').gte('created_at', since)
  if (countError) return { success: false, error: countError.message }
  if ((count || 0) >= SHARE_DAILY_LIMIT) {
    return { success: false, error: `You can share up to ${SHARE_DAILY_LIMIT} playlists a day.` }
  }

  let meta: any
  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { success: false, error: 'Spotify could not open that playlist. Check that it is public.' }
    meta = await response.json()
  } catch (_) {
    return { success: false, error: 'Spotify could not check that link right now. Please try again.' }
  }

  const name = String(meta?.title || 'Shared Spotify playlist').trim().slice(0, 160)
  const config = {
    source: 'shared',
    thumbnailUrl: typeof meta?.thumbnail_url === 'string' ? meta.thumbnail_url : null,
    districtId,
    districtName: district.name,
    note: String(params.note || '').trim().slice(0, 180),
  }
  const { error } = await supabase.from('generated_playlists').insert({
    name,
    playlist_id: playlistId,
    url,
    agent_no: agentNo,
    config,
    track_count: 0,
    district_id: districtId,
    source: 'shared',
    status: 'active',
    created_at: utcNow(),
    updated_at: utcNow(),
  })
  return error ? { success: false, error: error.message } : { success: true, name, playlistId, url }
}

export async function reportCandyPlaylist(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  const playlistId = parseSpotifyId(String(params.playlistId || ''), 'playlist')
  if (!playlistId) return { success: false, error: 'Playlist id required.' }

  const { data: prior } = await supabase.from('rc_playlist_reports').select('playlist_id')
    .eq('agent_no', agentNo).eq('playlist_id', playlistId).limit(1)
  if (!prior?.length) {
    const { error } = await supabase.from('rc_playlist_reports').insert({
      agent_no: agentNo,
      playlist_id: playlistId,
      reason: 'broken_link',
      created_at: utcNow(),
    })
    if (error) return { success: false, error: error.message }
  }

  const { count, error: countError } = await supabase.from('rc_playlist_reports')
    .select('playlist_id', { count: 'exact', head: true }).eq('playlist_id', playlistId)
  if (countError) return { success: false, error: countError.message }

  const hidden = (count || 0) >= REPORTS_TO_HIDE
  const { error: updateError } = await supabase.from('generated_playlists').update({
    report_count: count || 0,
    ...(hidden ? { status: 'broken' } : {}),
    updated_at: utcNow(),
  }).eq('playlist_id', playlistId)
  if (updateError) return { success: false, error: updateError.message }
  return { success: true, reported: true, hidden }
}
