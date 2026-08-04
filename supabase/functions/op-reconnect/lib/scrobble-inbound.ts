// Direct-scrobble ingest — two protocols, one destination (rc_scrobbles).
// Ported from arirang-btsbackend's handleWSWebhook / handleListenBrainzLike,
// adapted to rc_agents/rc_scrobbles since this project no longer shares a
// database with the old site. "Now playing" live-bar events (which the old
// handlers also captured, into botz_now_playing) are acknowledged but not
// stored — BOTZ isn't wired into op-reconnect yet, so there's nowhere to put
// them; see docs/op-reconnect-backend-audit.md.

import { isAdScrobble } from './text.ts'
import type { SupabaseDB } from './config.ts'

const HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS })

async function agentForPin(supabase: SupabaseDB, pin: string) {
  const { data } = await supabase.from('rc_agents').select('agent_no').eq('scrobble_pin', pin).maybeSingle()
  return data
}

async function storeScrobble(supabase: SupabaseDB, agentNo: string, track: string, artist: string | null, album: string | null, listenedAt: number, source: string) {
  if (!track || isAdScrobble(track, artist)) return
  await supabase.from('rc_scrobbles').upsert(
    { agent_no: agentNo, track_name: track, artist_name: artist, album_name: album, listened_at: listenedAt, source },
    { onConflict: 'agent_no,listened_at,track_name', ignoreDuplicates: true },
  )
}

/** Web Scrobbler's native JSON webhook. URL: .../op-reconnect?pin=AGENT_PIN */
export async function handleWebScrobblerWebhook(supabase: SupabaseDB, payload: any, pin: string): Promise<Response> {
  if (!pin) return ok({ success: false, error: 'Missing ?pin= in webhook URL.' }, 400)

  if (payload.eventName !== 'scrobble') {
    return ok({ success: true, ignored: true, event: payload.eventName })
  }

  const song = payload.data?.song?.processed || payload.data?.song?.parsed || {}
  const trackName = (song.track || '').trim()
  const artistName = (song.artist || '').trim() || null
  const albumName = (song.album || '').trim() || null
  const timestamp: number = payload.data?.timestamp || Math.floor(Date.now() / 1000)
  if (!trackName) return ok({ success: false, error: 'No track name in webhook payload' }, 400)
  if (isAdScrobble(trackName, artistName)) return ok({ success: true, ignored: true, reason: 'advertisement' })

  const agent = await agentForPin(supabase, pin)
  if (!agent) return ok({ success: false, error: 'Invalid PIN — check your webhook URL' }, 401)

  await storeScrobble(supabase, agent.agent_no, trackName, artistName, albumName, timestamp, 'webhook')
  return ok({ success: true, agent: agent.agent_no, track: trackName, timestamp })
}

/** ListenBrainz-like instance protocol — Pano Scrobbler, and Web Scrobbler in
 *  "LB instance" mode. Token = agent's scrobble_pin, sent as `Token <pin>`. */
export async function handleListenBrainzLike(supabase: SupabaseDB, req: Request, pathname: string): Promise<Response> {
  const token = (req.headers.get('Authorization') || '').replace(/^Token\s+/i, '').trim()

  if (pathname.includes('/validate-token')) {
    if (!token) return ok({ code: 200, message: 'Token invalid', valid: false })
    const agent = await agentForPin(supabase, token)
    if (!agent) return ok({ code: 200, message: 'Token invalid', valid: false })
    return ok({ code: 200, message: 'Token valid', valid: true, user_name: agent.agent_no })
  }

  if (pathname.includes('/playing-now') && req.method === 'GET') {
    return ok({ payload: { playing_now: false, count: 0, listens: [] } })
  }

  if (pathname.includes('/listen-count') && req.method === 'GET') {
    const agent = await agentForPin(supabase, token)
    if (!agent) return ok({ code: 401, error: 'Invalid token' }, 401)
    const { count } = await supabase.from('rc_scrobbles').select('*', { count: 'exact', head: true }).eq('agent_no', agent.agent_no)
    return ok({ payload: { count: count ?? 0, user_name: agent.agent_no } })
  }

  if (pathname.includes('/listens') && req.method === 'GET') {
    const agent = await agentForPin(supabase, token)
    if (!agent) return ok({ code: 401, error: 'Invalid token' }, 401)
    const { data: rows } = await supabase.from('rc_scrobbles')
      .select('listened_at, track_name, artist_name, album_name')
      .eq('agent_no', agent.agent_no).order('listened_at', { ascending: false }).limit(25)
    const listens = (rows || []).map((r: any) => ({
      listened_at: r.listened_at,
      track_metadata: { track_name: r.track_name, artist_name: r.artist_name || '', release_name: r.album_name || '' },
    }))
    return ok({ payload: { count: listens.length, latest_listen_ts: listens[0]?.listened_at || 0, listens, user_name: agent.agent_no } })
  }

  // POST bodies (playing-now already handled by GET above; the rest submit listens)
  let body: any = {}
  try { const raw = await req.text(); body = raw ? JSON.parse(raw) : {} } catch { /* empty */ }

  if (body?.listen_type === 'playing_now' || pathname.includes('/playing-now')) {
    return ok({ status: 'ok' })
  }

  if (!token) return ok({ code: 401, error: 'Missing token' }, 401)
  const agent = await agentForPin(supabase, token)
  if (!agent) return ok({ code: 401, error: 'Invalid token — generate a PIN in your agent profile' }, 401)

  const payload: any[] = body.payload || []
  for (const p of payload) {
    const track = (p.track_metadata?.track_name || '').trim()
    if (!track || !p.listened_at) continue
    await storeScrobble(
      supabase, agent.agent_no, track,
      (p.track_metadata.artist_name || '').trim() || null,
      (p.track_metadata.release_name || '').trim() || null,
      p.listened_at, 'lb-like',
    )
  }
  return ok({ status: 'ok' })
}
