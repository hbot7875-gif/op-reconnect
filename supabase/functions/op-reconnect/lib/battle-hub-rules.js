// MAMA Event Hub rules with no I/O: the paced battle "moments" Chat posts,
// and small helpers the server and the game share. Tested in Node
// (js/battle-hub.test.mjs); the service (battle-hub-service.js) and the SQL
// functions (migration 20261015150000) do the reading and writing.

export const CHAT_EMOJI = ['💜', '🔥', '😂', '👏', '😭', '🫡']
export const REPORT_REASONS = ['harassment', 'hate', 'sexual', 'personal_info', 'spam', 'other']

// A new leader (or a tie) must hold this long before Chat announces it, and
// lead/tie announcements are at least this far apart. Gift and final-hours
// moments are once each by their key.
export const LEAD_HOLD_MS = 2 * 60_000
export const LEAD_GAP_MS = 10 * 60_000
const HOUR = 3600_000

/**
 * One check of the battle → which moments to post, and the state to keep.
 *   state  { init, lead, cand, candSince, lastAt } from the previous check
 *   battle getPublicBattle()'s view: { teams, total, next, closesAt }
 * Keys are deterministic, so two servers checking at once post one row
 * (unique (campaign_id, system_key)). The first check only records who is
 * leading: a long-standing lead is not news.
 */
export function decideMoments(state, battle, now) {
  const t = now.getTime()
  const iso = now.toISOString()
  const s = { ...(state || {}), checkedAt: iso }
  const out = []
  const teams = battle?.teams || []
  if (teams.length === 2 && Number(battle.total) > 0) {
    const [a, b] = teams
    const cur = a.points === b.points ? 'tie' : a.points > b.points ? a.id : b.id
    if (!s.init) Object.assign(s, { init: true, lead: cur, cand: cur, candSince: iso })
    else if (cur !== s.cand) Object.assign(s, { cand: cur, candSince: iso })
    else if (cur !== s.lead && t - Date.parse(s.candSince) >= LEAD_HOLD_MS && (!s.lastAt || t - Date.parse(s.lastAt) >= LEAD_GAP_MS)) {
      const team = teams.find((x) => x.id === cur)
      out.push(cur === 'tie'
        ? { key: `tie:${s.candSince}`, team: null, body: 'THE BATTLE IS TIED' }
        : { key: `lead:${cur}:${s.candSince}`, team: cur, body: `${team.label} TOOK THE LEAD` })
      Object.assign(s, { lead: cur, lastAt: iso })
    }
  }
  const next = battle?.next
  if (next && next.remaining > 0) {
    const band = next.remaining <= 5 ? 5 : next.remaining <= 25 ? 25 : null
    if (band) out.push({ key: `gift:${next.target}:${band}`, team: null, body: `${next.remaining} ${next.remaining === 1 ? 'VOTE' : 'VOTES'} TO THE NEXT BATTLE GIFT` })
  }
  const left = Date.parse(battle?.closesAt) - t
  if (left > 0) {
    const band = left <= HOUR ? 1 : left <= 3 * HOUR ? 3 : left <= 24 * HOUR ? 24 : null
    if (band) out.push({ key: `final:${band}`, team: null, body: band === 1 ? 'FINAL HOUR OF VOTING' : `FINAL ${band} HOURS OF VOTING` })
  }
  return { state: s, inserts: out }
}

/** Chat never shows two moments in a row: a run of them shows only the newest. */
export function collapseMoments(messages) {
  const out = []
  for (const m of messages || []) {
    if (m.kind === 'system' && out.length && out[out.length - 1].kind === 'system') out[out.length - 1] = m
    else out.push(m)
  }
  return out
}

/** The profile link for an opted-in Instagram username, or null. */
export function instagramUrl(handle) {
  const h = String(handle || '').replace(/^@/, '')
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://instagram.com/${h}` : null
}
