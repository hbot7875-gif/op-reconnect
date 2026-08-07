// BOTZ in-game — "now playing" + recent streams, from whatever source the
// agent already has linked. Reuses fetchStreamRows (same source resolution
// startDistrict/getGameState already use) rather than a second ingest path.

import type { SupabaseDB } from './config.ts'
import { loadContent, limits } from './config.ts'
import { fetchStreamRows } from './streams.ts'
import { normalizeKey, artistAllowed } from './text.ts'
import { flagStreamRows, findPossibleAlts } from './police-check.ts'

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

/** Agent-facing self-check — the same "PL rules" flags and alt-identity
 *  check Moon Station gives an admin, but for your own account only. This
 *  is `auth: 'agent'` in index.ts, which verifies params.agentNo against
 *  params.sessionToken before this ever runs — so unlike adminGetAgentTracks
 *  (which can look up ANY agent given the admin key), this can only ever
 *  answer "is my own account clean, and does my own identity show up
 *  anywhere else." An agent can't use this to go looking for other
 *  agents' alts; they can only ever discover accounts that share THEIR
 *  identity specifically, which is a narrower, self-scoped exposure. */
export async function getMySelfCheck(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: agent } = await supabase
    .from('rc_agents')
    .select('agent_no, handle, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
    .eq('agent_no', agentNo).maybeSingle()
  if (!agent) return { success: false, error: 'Agent not found' }

  const days = Math.max(1, Math.min(30, Number(params.days) || 7))
  const toTs = Math.floor(Date.now() / 1000)
  const fromTs = toTs - days * 86400

  const content = await loadContent(supabase)
  const lim = limits(content)
  const [rows, possibleAlts] = await Promise.all([
    fetchStreamRows(supabase, agent, fromTs, toTs, lim.lbMaxPages),
    findPossibleAlts(supabase, agent),
  ])
  const tracks = flagStreamRows(rows)

  return {
    success: true,
    windowDays: days,
    fromDate: new Date(fromTs * 1000).toISOString(),
    toDate: new Date(toTs * 1000).toISOString(),
    trackCount: tracks.length,
    flaggedCount: tracks.filter((t) => t.flags.length > 0).length,
    tracks,
    possibleAlts,
  }
}
