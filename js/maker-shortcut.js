// Playlist makers get a 🎧 DJ Booth place on the City map (city-map.js,
// opts.onDjBooth) that opens the Playlist Maker page, so adding a district
// playlist is one tap from the home screen instead of a trip through
// Settings. Whether this agent is a maker is asked once per tab
// (amIPlaylistMaker) and remembered, so map redraws don't refetch.

import { call } from './api.js'
import { getAgentNo } from './session.js'

const KEY = 'rc_is_playlist_maker:'
let memo = { agentNo: '', allowed: null, pending: null }

/** true / false once known for this agent, null while unknown. */
export function playlistMakerKnown() {
  const agentNo = getAgentNo()
  if (!agentNo) return false
  if (memo.agentNo === agentNo && memo.allowed !== null) return memo.allowed
  try {
    const v = sessionStorage.getItem(KEY + agentNo)
    if (v === '1' || v === '0') return (memo = { agentNo, allowed: v === '1', pending: null }).allowed
  } catch { /* no storage: ask the server */ }
  return null
}

/** Resolves true/false; never throws. A failed request isn't remembered,
 *  so the next redraw asks again. */
export function isPlaylistMaker() {
  const agentNo = getAgentNo()
  const known = playlistMakerKnown()
  if (known !== null) return Promise.resolve(known)
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

export const openPlaylistMaker = () => { window.location.href = 'playlist-maker.html' }
