// RUN AMI — Supabase Realtime, as a doorbell only.
//
// The database broadcasts {r, v} (room and match version numbers) on the
// room's unguessable topic after every committed change
// (rc_run_ami_notify). This module listens and calls onNudge; the screen
// then fetches its own private view from the Edge Function. Nothing here
// ever sends anything to the channel, and nothing it receives is trusted as
// state: a forged message can at most cause an extra fetch.
//
// No supabase-js: a broadcast-only subscriber is a few Phoenix frames, and
// the app has never shipped a Supabase client.
//
// DISABLED until REALTIME_KEY is set. Connecting needs the project's
// publishable (anon) key in the browser, and on 2026-10-11 the live database
// still granted anon full access to three non-rc tables (spotify_oauth,
// bts_song_catalog, spotify_filler_library, RLS off). Until those grants
// are closed the key must not ship; with it empty the game runs on the
// polling fallback alone, which is a complete, correct experience.

const REALTIME_KEY = ''
const SOCKET_URL = 'wss://lcvmwlioqpyaprxicdfl.supabase.co/realtime/v1/websocket'
const HEARTBEAT_MS = 25_000
const RETRY_MS = [1000, 3000, 8000, 15000]

export function realtimeAvailable() {
  return !!REALTIME_KEY && typeof WebSocket !== 'undefined'
}

/** Subscribe to one room's nudges. Returns { close(), isLive() }. isLive()
 *  is true only while the channel join has been acknowledged, so the screen
 *  knows when to fall back to polling. */
export function subscribeRoom(topic, onNudge) {
  let socket = null
  let live = false
  let closed = false
  let ref = 0
  let joinRef = null
  let heartbeat = null
  let retry = 0
  let retryTimer = null
  const channel = `realtime:run-ami:${topic}`

  const send = (msg) => { if (socket?.readyState === 1) socket.send(JSON.stringify(msg)) }

  function connect() {
    if (closed || !realtimeAvailable()) return
    socket = new WebSocket(`${SOCKET_URL}?apikey=${encodeURIComponent(REALTIME_KEY)}&vsn=1.0.0`)
    socket.onopen = () => {
      retry = 0
      joinRef = String(++ref)
      send({
        topic: channel, event: 'phx_join', ref: joinRef, join_ref: joinRef,
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false } },
      })
      heartbeat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), HEARTBEAT_MS)
    }
    socket.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }
      if (msg.topic !== channel) return
      if (msg.event === 'phx_reply' && msg.ref === joinRef) {
        live = msg.payload?.status === 'ok'
        if (live) onNudge(null)
        return
      }
      if (msg.event === 'broadcast' && msg.payload?.event === 'v') {
        const p = msg.payload.payload || {}
        onNudge({ r: Number.isInteger(p.r) ? p.r : null, v: Number.isInteger(p.v) ? p.v : null })
      }
      if (msg.event === 'phx_error' || msg.event === 'phx_close') live = false
    }
    socket.onclose = () => {
      live = false
      clearInterval(heartbeat)
      if (closed) return
      retryTimer = setTimeout(connect, RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)])
    }
    socket.onerror = () => { try { socket.close() } catch { /* already closing */ } }
  }

  connect()
  return {
    isLive: () => live,
    close() {
      closed = true
      live = false
      clearInterval(heartbeat)
      clearTimeout(retryTimer)
      try { socket?.close() } catch { /* ignore */ }
    },
  }
}
