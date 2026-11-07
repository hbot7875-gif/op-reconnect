// War of Cards stats and unlock — pure rules, shared by war-of-cards.ts and
// the Run ARMY screens (and Node tests). What counts as a win or a loss is
// decided in SQL (rc_war_outcomes, 20261107120000); this file only ranks
// those numbers and decides when to show things.

/** Every this many counted wins earns a Card Champion badge (the SQL trigger uses 10 too). */
export const WAR_CHAMPION_WINS = 10
/** Completed games needed before an agent is ranked by win percentage. */
export const WAR_PCT_MIN_GAMES = 10
/** Rows shown on the board; the viewer's own row is added when lower. */
export const WAR_BOARD_SIZE = 20
export const WAR_CHAMPION_BADGE = 'achievement_card_champion'

/** Start of the current leaderboard week: Monday 00:00 KST. */
export function weekStartKst(now = new Date()) {
  const kst = new Date(new Date(now).getTime() + 9 * 3_600_000)
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7
  const monday = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysSinceMonday)
  return new Date(monday - 9 * 3_600_000).toISOString()
}

/** Win percentage, whole number; null with no games. */
export const winPct = (wins, played) => (played > 0 ? Math.round((wins / played) * 100) : null)

/** Rank stat rows ({ agentNo, played, wins, currentStreak, bestStreak }).
 *  'wins' (default): most wins, then best win %, then fewer games, then name.
 *  'pct': only agents with WAR_PCT_MIN_GAMES+ games, best win % first, then
 *  most wins. Ties share a position, so equal records rank equally. */
export function rankWar(rows, sort = 'wins', nameOf = (a) => a) {
  const list = rows.map((r) => ({ ...r, pct: winPct(r.wins, r.played) }))
    .filter((r) => r.played > 0 && (sort !== 'pct' || r.played >= WAR_PCT_MIN_GAMES))
  const key = sort === 'pct'
    ? (r) => [-r.pct, -r.wins, r.played]
    : (r) => [-r.wins, -(r.pct ?? 0), r.played]
  list.sort((a, b) => {
    const ka = key(a), kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return String(nameOf(a.agentNo)).localeCompare(String(nameOf(b.agentNo)))
  })
  let pos = 0
  let prev = null
  return list.map((r, i) => {
    const k = key(r).join(',')
    if (k !== prev) { pos = i + 1; prev = k }
    return { ...r, position: pos }
  })
}

/** The top of the board, and the viewer's own row if it isn't already
 *  shown. `me` is null when the viewer has no counted games in this view. */
export function boardWithMe(ranked, agentNo, size = WAR_BOARD_SIZE) {
  const top = ranked.slice(0, size)
  const mine = ranked.find((r) => r.agentNo === agentNo) || null
  return { top, me: mine && !top.includes(mine) ? mine : null, mineShown: !!mine && top.includes(mine) }
}

/** The site owner sees the unlock pop-up once too, though AGENT000 is
 *  always a tester and may not hold the whole album. */
export const WAR_UNLOCK_OWNER = 'AGENT000'

/** Show the War of Cards unlock pop-up? For an agent who holds the whole
 *  album and isn't a tester — or the owner — and hasn't been shown it on
 *  any device. */
export const warUnlockDue = ({ albumComplete, tester, seen, owner = false }) =>
  !seen && (!!owner || (!!albumComplete && !tester))
