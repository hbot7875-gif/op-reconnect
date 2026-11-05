// BTS's MAMA Fans' Choice ranks — pure rules, shared by mama-rank.ts and the
// Voting screen (and Node tests).
//
// The source is Mnet Plus's own vote endpoint, read every 15 minutes by our
// Edge Function (cronMamaRankCheck). It gives ranks only: no vote counts,
// no percentages, no gaps, so nothing here ever shows or implies them.

/** The two categories BTS is ranked in, matched on Mnet's group names
 *  ("FANS' CHOICE MALE", "FANS' CHOICE OF THE YEAR with VISA"). */
export const MAMA_RANK_CATEGORIES = [
  { id: 'male', label: "Fans' Choice Male", short: 'Male', match: (n) => /\bMALE\b/i.test(n) && !/FEMALE/i.test(n) },
  { id: 'visa', label: "Fans' Choice of the Year with VISA", short: 'VISA · Daesang', match: (n) => /VISA|OF THE YEAR/i.test(n) },
]

/** A last success older than this reads as stale on the card. Three missed
 *  15-minute checks in a row. */
export const MAMA_RANK_STALE_MS = 50 * 60_000

export const MAMA_RANK_HISTORY_HOURS = 24

/** How far back the "Latest moves" list looks, and how many it shows. */
export const MAMA_RANK_MOVES_HOURS = 48
export const MAMA_RANK_MOVES_SHOWN = 8

/** Who may see the ranks for now (the site owner, while it's tried out).
 *  Collection runs regardless; only the read is gated. */
export const MAMA_RANK_VIEWERS = ['AGENT000']
export const canSeeMamaRank = (agentNo) => MAMA_RANK_VIEWERS.includes(String(agentNo || '').trim().toUpperCase())

const VOTE_ID = /^[0-9a-f]{24}$/

/** The ranks endpoint for one vote. */
export function mamaRankUrl(voteId) {
  if (!VOTE_ID.test(String(voteId || ''))) throw new Error('bad_vote_id')
  return `https://api.mnetplus.world/vote/v1/public/guest/votes/${voteId}/options?sort=RANKED`
}

const posInt = (n) => Number.isInteger(n) && n > 0

/** BTS's rank in each category from the endpoint's JSON, plus the full
 *  standings (every artist's rank and name, by rank). Fails closed: a
 *  missing category, a missing BTS entry or a non-integer rank is an error,
 *  never a guess. Names are kept as Mnet sends them, trimmed to 60 chars;
 *  the card escapes them. */
export function parseMamaRanks(json, artist = 'BTS') {
  const groups = Array.isArray(json?.groups) ? json.groups : null
  if (!groups) return { ok: false, error: 'shape' }
  const want = String(artist).trim().toUpperCase()
  const ranks = {}
  const standings = {}
  for (const cat of MAMA_RANK_CATEGORIES) {
    const group = groups.find((g) => cat.match(String(g?.groupName || '')))
    if (!group || !Array.isArray(group.options)) return { ok: false, error: `missing_${cat.id}` }
    const options = group.options.filter((o) => o && o.isEnabled !== false)
    const me = options.find((o) => String(o.title || '').trim().toUpperCase() === want)
    if (!me) return { ok: false, error: `artist_missing_${cat.id}` }
    if (!posInt(me.rank) || me.rank > options.length) return { ok: false, error: `bad_rank_${cat.id}` }
    ranks[cat.id] = { rank: me.rank, of: options.length }
    standings[cat.id] = options
      .filter((o) => posInt(o.rank) && o.rank <= options.length && String(o.title || '').trim())
      .map((o) => ({ rank: o.rank, title: String(o.title).trim().slice(0, 60) }))
      .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
  }
  return { ok: true, ranks, standings }
}

/** Who moved in one category, newest first: each check whose rank numbers
 *  differ from the check before, with every artist who changed. `checks`
 *  run oldest first: { checkedAt, standings }. Names are matched without
 *  case or spaces, because Mnet has respelled one mid-vote (Lee Young Ji /
 *  LEE YOUNGJI); an artist seen in only one of the two checks is skipped. */
export function mamaRankMoves(checks, category, limit = MAMA_RANK_MOVES_SHOWN) {
  const key = (t) => String(t).toUpperCase().replace(/\s+/g, '')
  const out = []
  let prev = null
  for (const c of checks || []) {
    const list = c?.standings?.[category]
    if (!Array.isArray(list) || !list.length) continue
    const cur = new Map(list.map((s) => [key(s.title), s]))
    if (prev) {
      const moves = [...cur].filter(([k, s]) => prev.has(k) && prev.get(k).rank !== s.rank)
        .map(([k, s]) => ({ title: s.title, from: prev.get(k).rank, to: s.rank }))
        .sort((a, b) => a.to - b.to || a.title.localeCompare(b.title))
      if (moves.length) out.push({ at: c.checkedAt, moves })
    }
    prev = cur
  }
  return out.reverse().slice(0, limit)
}

/** The start of the hour a check belongs to (UTC; KST is a whole-hour
 *  offset, so the same instant starts the KST hour too). */
export function hourStart(at) {
  const d = new Date(at)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

/** What the Voting screen shows: the latest ranks, when they were last
 *  read successfully, whether that's stale, each rank's move against the
 *  previous hour, and an hourly series (last rank of each hour) for the
 *  chart. `history` rows: { category, hour, last_rank, best_rank,
 *  worst_rank }. */
export function mamaRankView(latest, history = [], now = new Date(), checks = []) {
  if (!latest?.ranks || !latest.checkedAt) return null
  const nowMs = new Date(now).getTime()
  const since = nowMs - MAMA_RANK_HISTORY_HOURS * 3_600_000
  const categories = MAMA_RANK_CATEGORIES.map((cat) => {
    const r = latest.ranks[cat.id]
    if (!r) return null
    const series = history
      .filter((h) => h.category === cat.id && new Date(h.hour).getTime() >= since)
      .sort((a, b) => new Date(a.hour) - new Date(b.hour))
      .map((h) => ({ hour: h.hour, rank: h.last_rank, best: h.best_rank, worst: h.worst_rank }))
    // The move: now against the last rank of the previous full hour.
    const thisHour = hourStart(latest.checkedAt)
    const prev = [...series].reverse().find((s) => s.hour < thisHour)
    const move = prev ? prev.rank - r.rank : 0
    const standings = Array.isArray(latest.standings?.[cat.id]) ? latest.standings[cat.id] : []
    return { id: cat.id, label: cat.label, short: cat.short, rank: r.rank, of: r.of, move, series, standings, moves: mamaRankMoves(checks, cat.id) }
  }).filter(Boolean)
  return {
    checkedAt: latest.checkedAt,
    stale: nowMs - new Date(latest.checkedAt).getTime() > MAMA_RANK_STALE_MS,
    categories,
  }
}
