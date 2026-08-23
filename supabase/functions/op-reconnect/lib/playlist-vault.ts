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

const PAGE_SIZE = 24
const MAX_PAGE_SIZE = 48
const SHARE_DAILY_LIMIT = 5
const REPORTS_TO_HIDE = 3

function agentNoOf(params: any): string {
  return String(params.agentNo || '').trim().toUpperCase()
}

function clampPageSize(raw: any): number {
  return Math.max(1, Math.min(Number(raw) || PAGE_SIZE, MAX_PAGE_SIZE))
}

function safeConfig(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Agent-scoped, paged list. Agent numbers never leave the backend. */
export async function getCandyPlaylistLibrary(supabase: SupabaseDB, params: any): Promise<any> {
  const agentNo = agentNoOf(params)
  const view = ['community', 'mine', 'saved'].includes(String(params.view)) ? String(params.view) : 'community'
  const limit = clampPageSize(params.limit)
  const offset = Math.max(0, Number(params.offset) || 0)

  let savedIds: string[] | null = null
  if (view === 'saved') {
    const { data, error } = await supabase.from('rc_playlist_saves')
      .select('playlist_id').eq('agent_no', agentNo).order('created_at', { ascending: false })
    if (error) return { success: false, error: error.message }
    savedIds = (data || []).map((r: any) => String(r.playlist_id)).filter(Boolean)
    if (!savedIds.length) return { success: true, playlists: [], hasMore: false, nextOffset: 0 }
  }

  let query = supabase.from('generated_playlists')
    .select('name, playlist_id, url, agent_no, config, track_count, created_at, source, status', { count: 'exact' })
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (view === 'mine') query = query.eq('agent_no', agentNo)
  if (savedIds) query = query.in('playlist_id', savedIds)

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) return { success: false, error: error.message }
  const rows = data || []
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
    creator: row.agent_no === agentNo ? 'You' : (codenames.get(row.agent_no) || 'Another agent'),
    isMine: row.agent_no === agentNo,
    saved: savedByMe.has(row.playlist_id),
    saveCount: saveCounts.get(row.playlist_id) || 0,
    reported: reportedByMe.has(row.playlist_id),
  }))

  const total = Number(count) || playlists.length
  return {
    success: true,
    playlists,
    hasMore: offset + playlists.length < total,
    nextOffset: offset + playlists.length,
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
  }
  const { error } = await supabase.from('generated_playlists').insert({
    name,
    playlist_id: playlistId,
    url,
    agent_no: agentNo,
    config,
    track_count: 0,
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
