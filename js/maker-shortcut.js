// Playlist makers get a "🎧 Playlist" button on the City map, next to Share
// and Find, so adding a district playlist is one tap from the home screen
// instead of a trip through Settings. Whether this agent is a maker is asked
// once per tab (amIPlaylistMaker) and remembered, so redraws don't refetch.

import { call } from './api.js'
import { getAgentNo } from './session.js'

const KEY = 'rc_is_playlist_maker:'
let memo = { agentNo: '', allowed: null, pending: null }

function readCache(agentNo) {
  if (memo.agentNo === agentNo && memo.allowed !== null) return memo.allowed
  try {
    const v = sessionStorage.getItem(KEY + agentNo)
    if (v === '1' || v === '0') return (memo = { agentNo, allowed: v === '1', pending: null }).allowed
  } catch { /* no storage: ask the server */ }
  return null
}

/** Resolves true/false; never throws. A failed check reads as "not a maker"
 *  for this tab's lifetime only if the server answered; network errors retry. */
export function isPlaylistMaker() {
  const agentNo = getAgentNo()
  if (!agentNo) return Promise.resolve(false)
  const cached = readCache(agentNo)
  if (cached !== null) return Promise.resolve(cached)
  if (memo.agentNo === agentNo && memo.pending) return memo.pending
  const pending = call('amIPlaylistMaker', { agentNo }).then((res) => {
    if (!res?.success) { memo = { agentNo, allowed: null, pending: null }; return false }
    memo = { agentNo, allowed: !!res.allowed, pending: null }
    try { sessionStorage.setItem(KEY + agentNo, res.allowed ? '1' : '0') } catch { /* fine */ }
    return !!res.allowed
  }).catch(() => { memo = { agentNo, allowed: null, pending: null }; return false })
  memo = { agentNo, allowed: null, pending }
  return pending
}

/** The map button: starts hidden and shows once the check says yes. */
export function playlistMakerButton(el) {
  const btn = el('a', 'find-btn map-maker-btn', '🎧 Playlist')
  btn.href = 'playlist-maker.html'
  btn.setAttribute('aria-label', 'Add a playlist for a district (Playlist Makers)')
  btn.hidden = true
  isPlaylistMaker().then((yes) => { btn.hidden = !yes })
  return btn
}
