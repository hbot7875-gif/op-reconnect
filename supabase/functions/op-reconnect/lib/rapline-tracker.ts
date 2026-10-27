// Rap Line to 1B — fetch and serve informational Spotify totals.
//
// cronRaplineRefresh (pg_cron rc-rapline-refresh, 20261027200500) pulls each
// track's daily history from the stream-count API on RapidAPI's free plan and
// stores it in rc_rapline_daily. getRaplineTracker is the public read the City
// card uses. The API key (RAPIDAPI_KEY) lives only in this function's secrets;
// nothing here ever returns it or the provider's raw response.
//
// Not part of gameplay: no XP, no rewards, and the Road to 1B scrobble
// mission (side-missions.ts) neither reads nor writes any of this.

import {
  RAPLINE_BUDGET, RAPLINE_KEEP_DAYS, RAPLINE_TRACKS,
  parseHistory, raplineFetchDecision, summariseTracker, trimHistory,
} from './rapline-rules.js'

const HOST = 'spotify-stream-count.p.rapidapi.com'
const FETCH_TIMEOUT_MS = 15_000

// deno-lint-ignore no-explicit-any
type Sb = any

async function requestLog(sb: Sb, nowMs: number) {
  const since = new Date(nowMs - RAPLINE_BUDGET.windowDays * 86_400_000).toISOString()
  const { count, error } = await sb.from('rc_rapline_requests')
    .select('id', { count: 'exact', head: true }).gte('requested_at', since)
  if (error) throw new Error(`rapline_log: ${error.message}`)
  const { data: latest } = await sb.from('rc_rapline_requests')
    .select('requested_at, quota_remaining').gte('requested_at', since)
    .not('quota_remaining', 'is', null).order('requested_at', { ascending: false }).limit(1)
  const { data: lastOk } = await sb.from('rc_rapline_requests')
    .select('requested_at').eq('ok', true).order('requested_at', { ascending: false }).limit(1)
  const { data: lastAny } = await sb.from('rc_rapline_requests')
    .select('requested_at').order('requested_at', { ascending: false }).limit(1)
  return {
    requestsInWindow: count || 0,
    lastRemaining: latest?.[0]?.quota_remaining ?? null,
    lastSuccessAt: lastOk?.[0]?.requested_at ?? null,
    lastAttemptAt: lastAny?.[0]?.requested_at ?? null,
  }
}

export async function cronRaplineRefresh(sb: Sb, opts: { now?: number } = {}) {
  const key = Deno.env.get('RAPIDAPI_KEY') || ''
  if (!key) return { success: false, error: 'rapidapi_key_missing' }
  const nowMs = opts.now ?? Date.now()
  const decision = raplineFetchDecision(await requestLog(sb, nowMs), nowMs)
  if (!decision.ok) return { success: true, skipped: decision.reason }

  const results: { id: string; ok: boolean; changed?: number; error?: string }[] = []
  for (const track of RAPLINE_TRACKS) {
    let status: number | null = null
    let remaining: number | null = null
    try {
      const res = await fetch(`https://${HOST}/v1/spotify/tracks/${track.spotifyId}/streams`, {
        headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': HOST },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      status = res.status
      const left = Number.parseInt(res.headers.get('x-ratelimit-requests-remaining') || '', 10)
      remaining = Number.isFinite(left) ? left : null
      if (!res.ok) throw new Error(`http_${res.status}`)
      const points = trimHistory(parseHistory(await res.json()), RAPLINE_KEEP_DAYS)
      if (!points.length) throw new Error('history_empty')
      const { data: changed, error } = await sb.rpc('rc_rapline_store', { p_spotify_id: track.spotifyId, p_points: points })
      if (error) throw new Error(`store: ${error.message}`)
      await sb.from('rc_rapline_requests').insert({ spotify_id: track.spotifyId, http_status: status, ok: true, quota_remaining: remaining })
      results.push({ id: track.id, ok: true, changed: Number(changed) || 0 })
    } catch (e) {
      const message = String((e as Error)?.message || e).slice(0, 200)
      await sb.from('rc_rapline_requests').insert({ spotify_id: track.spotifyId, http_status: status, ok: false, quota_remaining: remaining, error: message })
      results.push({ id: track.id, ok: false, error: message })
      // Out of quota or locked out: the remaining tracks would fail the same way.
      if (status === 401 || status === 403 || status === 429) break
    }
    if (remaining != null && remaining < RAPLINE_BUDGET.quotaFloor) break
  }
  return { success: true, results }
}

export async function getRaplineTracker(sb: Sb) {
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)
  const { data, error } = await sb.from('rc_rapline_daily')
    .select('spotify_id, day, streams')
    .in('spotify_id', RAPLINE_TRACKS.map((t) => t.spotifyId))
    .gte('day', since).order('day', { ascending: true })
  if (error) return { success: false, error: 'tracker_unavailable' }
  const rows: Record<string, { day: string; streams: number }[]> = {}
  for (const r of data || []) (rows[r.spotify_id] ||= []).push({ day: r.day, streams: Number(r.streams) })
  const { data: lastOk } = await sb.from('rc_rapline_requests')
    .select('requested_at').eq('ok', true).order('requested_at', { ascending: false }).limit(1)
  return { success: true, tracker: summariseTracker(rows, today, lastOk?.[0]?.requested_at ?? null) }
}
