// BOTZ data layer, rewired to Op: Reconnect's own backend.
//
// The page structure came over from the old site's BOTZ verbatim. Its data
// did NOT: the old page called five arirang-btsbackend actions
// (getBotzJams, getBotzNowPlaying, getDashboardData, getBotzAlbumBreakdown,
// getBotzTrackHistory) against a different Supabase project, a different
// accounts table, and a different session key. None of those exist here.
//
// What this project has today is `getSignalLog` — now playing plus the last
// 24h of streams, tagged counted/not-counted. That's enough to light up the
// live parts of the page honestly. The aggregate views (all-time totals, top
// tracks/albums/members, streaks, per-album breakdowns) need a real
// op-reconnect action that rolls up rc_daily_activity — until that exists,
// they report themselves as unavailable rather than erroring or, worse,
// showing numbers that aren't real.
//
// Classic script on purpose: botz.js is not an ES module, so this can't be
// one either. It publishes window.RCBotz and nothing else.

;(function () {
  'use strict'

  const API = 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect'
  // Op: Reconnect's own session key. The old BOTZ read `arirang_agent`, which
  // belongs to a different site and a different account system entirely.
  const SESSION_KEY = 'rc_agent'

  const NOT_WIRED = 'This view needs a rollup action on the Op: Reconnect backend — not built yet.'

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch (e) { return null }
  }

  /** POST, never GET: every game action is session-verified, and a session
   *  token has no business sitting in a URL where it lands in logs and
   *  history. The old page used GET because its actions took no token. */
  async function callAction(action, params) {
    const s = session()
    const body = Object.assign({ action, agentNo: s && s.agentNo }, params || {})
    if (s && s.sessionToken) body.sessionToken = s.sessionToken
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      return await res.json()
    } catch (e) {
      return { success: false, error: 'Network error' }
    }
  }

  let _logCache = null
  let _logAt = 0

  /** getSignalLog is the only real source here, and the page asks for it from
   *  several places at once — cache it briefly so one screen paint doesn't
   *  fire the same 24h fetch four times. */
  async function signalLog(maxAgeMs) {
    const ttl = typeof maxAgeMs === 'number' ? maxAgeMs : 20000
    if (_logCache && Date.now() - _logAt < ttl) return _logCache
    const res = await callAction('getSignalLog', {})
    if (res && res.success) { _logCache = res; _logAt = Date.now() }
    return res
  }

  window.RCBotz = {
    API,
    SESSION_KEY,
    NOT_WIRED,
    session,
    callAction,
    signalLog,

    agentNo() {
      const s = session()
      return (s && s.agentNo) || null
    },

    /** The backend only knows the latest received jam. It never claims that
     *  a provider is actively playing it right now. */
    async lastPlayed() {
      const res = await signalLog(15000)
      if (!res || !res.success) return { success: false, lastPlayed: null }
      return { success: true, lastPlayed: res.lastPlayed || null }
    },

    /** The main dashboard payload. Only `recent` and the 24h counts are real;
     *  everything the old backend aggregated is reported as unavailable so the
     *  page renders empty states instead of inventing numbers. */
    async jams() {
      const res = await signalLog()
      if (!res || !res.success) return { success: false, error: (res && res.error) || 'Could not reach the uplink' }
      return {
        success: true,
        tracking: res.tracking || null,
        today: res.today || { btsJams: 0, helpedMissions: 0, trackedOnly: 0 },
        missions: res.missions || [],
        lastPlayed: res.lastPlayed || null,
        recent: res.streams || [],
      }
    },

    /** No equivalent action exists yet; say so instead of failing silently. */
    async unavailable() {
      return { success: false, error: NOT_WIRED }
    },
  }
})()
