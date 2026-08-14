// Op: Reconnect — standalone game backend. Runs beside arirang-btsbackend
// against the same database; mirrors its serve/CORS/dispatch conventions but
// stays small and modular (every file under ~300 lines).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0'
import { getGameState, joinGame, startDistrict, setMode, updateCodename, adminLaunchDefuse } from './lib/handlers.ts'
import { registerAgent, loginAgent, logoutAgent, checkHandle, verifySession } from './lib/auth.ts'
import { getAccount, updateEmail, changePassword, generateScrobblePin, getWebhookPin, setStreamSource, retireAccount } from './lib/settings.ts'
import { requestPasswordReset, resetPassword } from './lib/recovery.ts'
import { handleWebScrobblerWebhook, handleListenBrainzLike } from './lib/scrobble-inbound.ts'
import { placeItem, useItem } from './lib/items.ts'
import { getSignalLog, getMySelfCheck } from './lib/signal-log.ts'
import { getPublicStats } from './lib/public.ts'
import { isAdminAuthorized } from './lib/spotify-shared.ts'
import { spotifyAuthUrl, spotifyExchangeCode, getSpotifyConnection, disconnectSpotify } from './lib/spotify-oauth.ts'
import {
  refreshBTSCatalog, getBTSCatalog, searchBTSTracks, resolveMoreCatalog, addPlaylistToCatalog,
  addCatalogSongManual, patchCatalogSongIsrc, bulkFetchIsrcs, addAlbumToCatalog, getCatalogAlbums,
  removeCatalogAlbum,
} from './lib/spotify-catalog.ts'
import { importFillerPlaylist, addFillerManual, getFillerLibrary, removeFiller } from './lib/spotify-filler.ts'
import { generatePlaylist, validatePlaylist, validatePlaylistFromTracks, getAlpacaOptions, generateAlpaca, previewAlpaca } from './lib/candy-star.ts'
import { adminGetActiveDefuse } from './lib/bomb.ts'
import { adminCreateBroadcast, adminListBroadcasts, adminDeleteBroadcast } from './lib/broadcasts.ts'
import { adminDeleteAgent, adminGetAgent, adminGetAgentTracks, adminScanAltAccounts, adminResetAgentXp } from './lib/admin-agent.ts'
import { adminSyncAllStreams } from './lib/sync-all.ts'
import { adminListGoals, adminAddGoal, adminUpdateGoal, adminDeleteGoal } from './lib/goals.ts'
import {
  getReconnectMission, getInviteCandidates, openReconnectMission,
  inviteReconnectMission, removeReconnectParticipant, respondReconnectInvite, adminAutoAssignMissions,
  getMyInvites, sendReconnectMessage,
} from './lib/reconnect-missions.ts'
import { submitReconnectPuzzleAnswer } from './lib/reconnect-puzzle.ts'
import { getLeaderboard } from './lib/leaderboard.ts'
import { setEquippedBadge } from './lib/badge-profile.ts'
import { getMagicShop, buyWings, claimTicket } from './lib/magic-shop.ts'
import { feedCharge, setAutoFeed, getAgentCharge, useLitEra } from './lib/agent-charge.ts'
import { submitSuggestion } from './lib/suggestions.ts'
import { loadContent } from './lib/config.ts'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data ?? { success: false, error: 'Handler returned no data' }), {
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
    status,
  })
}

type Handler = (supabase: unknown, params: Record<string, unknown>) => Promise<unknown>
// 'admin' is centrally gated below via SYNC_ADMIN_KEY (params.adminKey) — the
// same shared-secret pattern handlers.ts's adminLaunchDefuse already uses,
// just generalized to a route-table flag instead of repeating the check
// inside every one of the dozen-plus Candy Star admin handlers.
interface Route { auth: 'public' | 'agent' | 'admin'; handler: Handler }

const ROUTES: Record<string, Route> = {
  ping: { auth: 'public', handler: async () => ({ success: true, pong: true, at: new Date().toISOString() }) },
  // Landing page. Aggregate counts only — never anything per-player.
  getPublicStats: { auth: 'public', handler: (sb, p) => getPublicStats(sb, p) },
  // Run before a session exists — issue or verify one, they don't need one yet.
  // Every one of these is rate-limited inside its own handler, since being
  // reachable without a token is exactly what makes them worth hammering.
  registerAgent: { auth: 'public', handler: (sb, p) => registerAgent(sb, p) },
  loginAgent: { auth: 'public', handler: (sb, p) => loginAgent(sb, p) },
  checkHandle: { auth: 'public', handler: (sb, p) => checkHandle(sb, p) },
  // Locked out by definition — a session is the thing they've lost.
  requestPasswordReset: { auth: 'public', handler: (sb, p) => requestPasswordReset(sb, p) },
  resetPassword: { auth: 'public', handler: (sb, p) => resetPassword(sb, p) },
  logoutAgent: { auth: 'agent', handler: (sb, p) => logoutAgent(sb, p) },
  // Settings screen
  getAccount: { auth: 'agent', handler: (sb, p) => getAccount(sb, p) },
  updateEmail: { auth: 'agent', handler: (sb, p) => updateEmail(sb, p) },
  changePassword: { auth: 'agent', handler: (sb, p) => changePassword(sb, p) },
  retireAccount: { auth: 'agent', handler: (sb, p) => retireAccount(sb, p) },
  getGameState: { auth: 'agent', handler: (sb, p) => getGameState(sb, p) },
  joinGame: { auth: 'agent', handler: (sb, p) => joinGame(sb, p) },
  startDistrict: { auth: 'agent', handler: (sb, p) => startDistrict(sb, p) },
  setMode: { auth: 'agent', handler: (sb, p) => setMode(sb, p) },
  updateCodename: { auth: 'agent', handler: (sb, p) => updateCodename(sb, p) },
  generateScrobblePin: { auth: 'agent', handler: (sb, p) => generateScrobblePin(sb, p) },
  getWebhookPin: { auth: 'agent', handler: (sb, p) => getWebhookPin(sb, p) },
  setStreamSource: { auth: 'agent', handler: (sb, p) => setStreamSource(sb, p) },
  placeItem: { auth: 'agent', handler: (sb, p) => placeItem(sb, p) },
  useItem: { auth: 'agent', handler: (sb, p) => useItem(sb, p) },
  getSignalLog: { auth: 'agent', handler: (sb, p) => getSignalLog(sb, p) },
  getMySelfCheck: { auth: 'agent', handler: (sb, p) => getMySelfCheck(sb, p) },
  getLeaderboard: { auth: 'agent', handler: (sb, p) => getLeaderboard(sb, p) },
  setEquippedBadge: { auth: 'agent', handler: async (sb, p) => setEquippedBadge(sb, await loadContent(sb), p) },
  // BOTZ redesign Phase 2 — see lib/magic-shop.ts.
  getMagicShop: { auth: 'agent', handler: async (sb, p) => getMagicShop(sb, await loadContent(sb), p) },
  buyWings: { auth: 'agent', handler: async (sb, p) => buyWings(sb, await loadContent(sb), p) },
  claimTicket: { auth: 'agent', handler: async (sb, p) => claimTicket(sb, await loadContent(sb), p) },
  // BOTZ redesign Phase 3 — see lib/agent-charge.ts.
  feedCharge: { auth: 'agent', handler: (sb, p) => feedCharge(sb, String(p.agentNo || '').trim().toUpperCase(), Number(p.cells) || 0) },
  setAutoFeed: { auth: 'agent', handler: (sb, p) => setAutoFeed(sb, String(p.agentNo || '').trim().toUpperCase(), !!p.on) },
  getAgentCharge: { auth: 'agent', handler: async (sb, p) => getAgentCharge(sb, await loadContent(sb), String(p.agentNo || '').trim().toUpperCase()) },
  useLitEra: { auth: 'agent', handler: async (sb, p) => useLitEra(sb, await loadContent(sb), String(p.agentNo || '').trim().toUpperCase(), String(p.eraId || '')) },
  // Reconnect goal (connect/invite co-op variants) — gates restoration now,
  // not a post-restoration bonus. All agent-scoped since eligibility is
  // always checked against the caller's own active district+frozen goal
  // (rc_player_districts), never anyone else's.
  getReconnectMission: { auth: 'agent', handler: async (sb, p) => getReconnectMission(sb, await loadContent(sb), p) },
  getInviteCandidates: { auth: 'agent', handler: async (sb, p) => getInviteCandidates(sb, await loadContent(sb), p) },
  openReconnectMission: { auth: 'agent', handler: async (sb, p) => openReconnectMission(sb, await loadContent(sb), p) },
  inviteReconnectMission: { auth: 'agent', handler: async (sb, p) => inviteReconnectMission(sb, await loadContent(sb), p) },
  removeReconnectParticipant: { auth: 'agent', handler: async (sb, p) => removeReconnectParticipant(sb, await loadContent(sb), p) },
  respondReconnectInvite: { auth: 'agent', handler: async (sb, p) => respondReconnectInvite(sb, await loadContent(sb), p) },
  sendReconnectMessage: { auth: 'agent', handler: async (sb, p) => sendReconnectMessage(sb, await loadContent(sb), p) },
  getMyInvites: { auth: 'agent', handler: async (sb, p) => getMyInvites(sb, await loadContent(sb), String(p.agentNo || '').trim().toUpperCase()) },
  submitSuggestion: { auth: 'agent', handler: async (sb, p) => submitSuggestion(sb, p) },
  // Reconnect goal (sotd/cipher/memory puzzle variants).
  submitReconnectPuzzleAnswer: { auth: 'agent', handler: (sb, p) => submitReconnectPuzzleAnswer(sb, null, p) },
  // admin-gated inside the handler via SYNC_ADMIN_KEY
  launchDefuse: { auth: 'public', handler: (sb, p) => adminLaunchDefuse(sb, p) },

  // ── Candy Star Generator — player-facing ───────────────
  getAlpacaOptions: { auth: 'agent', handler: (sb, p) => getAlpacaOptions(sb, p) },
  generateAlpaca: { auth: 'agent', handler: (sb, p) => generateAlpaca(sb, p) },
  previewAlpaca: { auth: 'agent', handler: (sb, p) => previewAlpaca(sb, p) },

  // ── Candy Star Generator — admin-only (catalog/filler/OAuth/raw generate) ─
  // Gated centrally below via SYNC_ADMIN_KEY, same secret adminLaunchDefuse
  // uses — see candy-star-admin.html, which is the intended caller.
  refreshBTSCatalog: { auth: 'admin', handler: (sb) => refreshBTSCatalog(sb) },
  getBTSCatalog: { auth: 'admin', handler: (sb) => getBTSCatalog(sb) },
  searchBTSTracks: { auth: 'admin', handler: (sb, p) => searchBTSTracks(sb, p as any) },
  resolveMoreCatalog: { auth: 'admin', handler: (sb, p) => resolveMoreCatalog(sb, parseInt(String(p.batchSize)) || 15) },
  addPlaylistToCatalog: { auth: 'admin', handler: (sb, p) => addPlaylistToCatalog(sb, p as any) },
  addCatalogSongManual: { auth: 'admin', handler: (sb, p) => addCatalogSongManual(sb, p as any) },
  patchCatalogSongIsrc: { auth: 'admin', handler: (sb, p) => patchCatalogSongIsrc(sb, p as any) },
  bulkFetchIsrcs: { auth: 'admin', handler: (sb, p) => bulkFetchIsrcs(sb, parseInt(String(p.batchSize)) || 10) },
  addAlbumToCatalog: { auth: 'admin', handler: (sb, p) => addAlbumToCatalog(sb, p as any) },
  getCatalogAlbums: { auth: 'admin', handler: (sb) => getCatalogAlbums(sb) },
  removeCatalogAlbum: { auth: 'admin', handler: (sb, p) => removeCatalogAlbum(sb, p as any) },
  importFillerPlaylist: { auth: 'admin', handler: (sb, p) => importFillerPlaylist(sb, p as any) },
  addFillerManual: { auth: 'admin', handler: (sb, p) => addFillerManual(sb, p as any) },
  getFillerLibrary: { auth: 'admin', handler: (sb) => getFillerLibrary(sb) },
  removeFiller: { auth: 'admin', handler: (sb, p) => removeFiller(sb, p as any) },
  validatePlaylist: { auth: 'admin', handler: (sb, p) => validatePlaylist(sb, p as any) },
  validatePlaylistFromTracks: { auth: 'admin', handler: (sb, p) => validatePlaylistFromTracks(sb, p as any) },
  spotifyAuthUrl: { auth: 'admin', handler: (_sb, p) => spotifyAuthUrl(p as any) },
  spotifyExchangeCode: { auth: 'admin', handler: (sb, p) => spotifyExchangeCode(sb, p as any) },
  getSpotifyConnection: { auth: 'admin', handler: (sb) => getSpotifyConnection(sb) },
  disconnectSpotify: { auth: 'admin', handler: (sb) => disconnectSpotify(sb) },
  generatePlaylist: { auth: 'admin', handler: (sb, p) => generatePlaylist(sb, p) },

  // ── Admin panel (admin.html) — Red Zone status, broadcasts, agent lookup ─
  // Same SYNC_ADMIN_KEY gate as everything else marked 'admin' above.
  // launchDefuse itself stays as it was (public route, manual key check
  // inside adminLaunchDefuse) — this is a read-only companion so the panel
  // can show whether an event is already active before firing a new one.
  adminGetActiveDefuse: { auth: 'admin', handler: (sb) => adminGetActiveDefuse(sb) },
  adminCreateBroadcast: { auth: 'admin', handler: (sb, p) => adminCreateBroadcast(sb, p) },
  adminListBroadcasts: { auth: 'admin', handler: (sb) => adminListBroadcasts(sb) },
  adminDeleteBroadcast: { auth: 'admin', handler: (sb, p) => adminDeleteBroadcast(sb, p) },
  adminGetAgent: { auth: 'admin', handler: (sb, p) => adminGetAgent(sb, p) },
  adminGetAgentTracks: { auth: 'admin', handler: (sb, p) => adminGetAgentTracks(sb, p) },
  adminScanAltAccounts: { auth: 'admin', handler: (sb, p) => adminScanAltAccounts(sb, p) },
  adminDeleteAgent: { auth: 'admin', handler: (sb, p) => adminDeleteAgent(sb, p) },
  adminResetAgentXp: { auth: 'admin', handler: (sb, p) => adminResetAgentXp(sb, p) },
  adminSyncAllStreams: { auth: 'admin', handler: (sb, p) => adminSyncAllStreams(sb, p) },

  // Batch-assign a series of connect/invite missions for one reconnect goal
  // at once — the rest of that system's admin config now lives on the goal
  // itself (adminAddGoal/adminUpdateGoal below), not a separate panel.
  adminAutoAssignMissions: { auth: 'admin', handler: (sb, p) => adminAutoAssignMissions(sb, p) },

  // ── Admin panel (admin.html) — Goals ── rc_goals is per-district (track,
  // album, and reconnect kinds) — see goals.ts's module comment and
  // districts.ts's freezeGoals().
  adminListGoals: { auth: 'admin', handler: (sb) => adminListGoals(sb) },
  adminAddGoal: { auth: 'admin', handler: (sb, p) => adminAddGoal(sb, p) },
  adminUpdateGoal: { auth: 'admin', handler: (sb, p) => adminUpdateGoal(sb, p) },
  adminDeleteGoal: { auth: 'admin', handler: (sb, p) => adminDeleteGoal(sb, p) },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Scrobblers don't speak this API's {action: ...} JSON shape — they're
    // detected by request shape, same multiplexing arirang-btsbackend uses,
    // and handed off before the body is touched (or with it parsed once,
    // below) so the normal action dispatch never sees them.
    const reqUrl = new URL(req.url)
    const authHeader = req.headers.get('Authorization') || ''
    if (/^token\s+/i.test(authHeader)) {
      return handleListenBrainzLike(supabase, req, reqUrl.pathname)
    }

    let params: Record<string, unknown> = {}
    if (req.method === 'POST') {
      const text = await req.text()
      params = text ? JSON.parse(text) : {}
    } else {
      params = Object.fromEntries(reqUrl.searchParams)
    }

    if (params.eventName) {
      return handleWebScrobblerWebhook(supabase, params, reqUrl.searchParams.get('pin') || '')
    }

    const action = String(params.action || '')
    const route = ROUTES[action]
    if (!route) return jsonResponse({ success: false, error: `Action "${action}" not found` }, 404)

    if (route.auth === 'agent') {
      if (!params.agentNo) return jsonResponse({ success: false, error: 'Agent number required' }, 401)
      const ok = await verifySession(supabase, String(params.agentNo), params.sessionToken)
      if (!ok) return jsonResponse({ success: false, error: 'invalid_session' }, 401)
    }

    if (route.auth === 'admin' && !isAdminAuthorized(params)) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401)
    }

    const result = await route.handler(supabase, params)
    return jsonResponse(result, 200)
  } catch (error) {
    console.error('op-reconnect error:', (error as Error).message)
    return jsonResponse({ success: false, error: (error as Error).message }, 200)
  }
})
