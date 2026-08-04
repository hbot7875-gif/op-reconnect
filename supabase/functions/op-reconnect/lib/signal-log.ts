// BOTZ in-game — "now playing" + recent streams, from whatever source the
// agent already has linked. Reuses fetchStreamRows (same source resolution
// startDistrict/getGameState already use) rather than a second ingest path.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { fetchStreamRows } from './streams.ts'
import { normalizeKey, artistAllowed } from './text.ts'

export async function getSignalLog(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: agentRow } = await supabase
    .from('rc_agents')
    .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
    .eq('agent_no', agentNo).maybeSingle()
  if (!agentRow) return { success: false, error: 'Agent not found' }

  const content = await loadContent(supabase)
  const allowlist: string[] = content.config.bts_artists || []
  const now = Math.floor(Date.now() / 1000)
  const from = now - 86400 // last 24h — "recent," not a full history browser

  const rows = await fetchStreamRows(supabase, agentRow, from, now, 5)
  rows.sort((a, b) => b.listened_at - a.listened_at)

  const streams = rows.slice(0, 50).map((r) => {
    const counted = artistAllowed(normalizeKey(r.artist_name || ''), allowlist)
    return {
      track: r.track_name,
      artist: r.artist_name || null,
      at: r.listened_at,
      counted,
      reason: counted ? null : 'not_bts',
    }
  })

  return {
    success: true,
    nowPlaying: streams[0] ? { track: streams[0].track, artist: streams[0].artist, at: streams[0].at } : null,
    streams,
    totals: { streams24h: streams.length, counted24h: streams.filter((s) => s.counted).length },
  }
}
