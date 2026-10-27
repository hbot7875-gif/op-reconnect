// Rap Line to 1B — informational Spotify totals for three solo tracks.
//
// Shared by the Edge Function (rapline-tracker.ts) and the City card
// (js/rapline-tracker.js). Deliberately separate from the Road to 1B scrobble
// mission in side-missions.ts: nothing here counts plays, pays XP or touches
// rewards, and that mission's track list is not reused.
//
// The source reports, per calendar day, "the total stream count displayed on
// that day on Spotify". Three things in that series must never be shown as a
// day's streams:
//   - a missing day: the gain across a gap covers several days
//   - a repeated total: the source copied the previous figure (its collection
//     missed), so the change around it belongs to more than one day
//   - a drop: Spotify corrected the count, which is not negative streaming
// summariseSeries() labels each day accordingly and only ever reports a gain
// between two consecutive, genuine readings.

export const RAPLINE_GOAL = 1_000_000_000

export const RAPLINE_TRACKS = [
  { id: 'wild-flower', spotifyId: '1AZjCZSGEjlxUufFQwSszF', name: 'Wild Flower', artist: 'RM' },
  { id: 'haegeum', spotifyId: '4bjN59DRXFRxBE1g5ne6B1', name: 'Haegeum', artist: 'Agust D' },
  { id: 'killin-it-girl', spotifyId: '2GzwtXPlI0gZEOS6xFOZ2j', name: "Killin' It Girl", artist: 'j-hope', feature: 'feat. GloRilla' },
]

// Already past 1B. Shown apart from the Rap Line progress and never fetched.
export const RAPLINE_MILESTONES = [
  { id: 'dsylm', spotifyId: '27xkOIER6uDLKALIelHylZ', name: "Don't Say You Love Me", artist: 'Jin' },
  { id: 'swim', spotifyId: '4g5eopb54XIaV2ciooY3St', name: 'SWIM', artist: 'BTS', group: true },
]

// A refresh is due every 3 days; a report older than this is marked stale.
export const RAPLINE_STALE_DAYS = 4

// Request budget. The free plan allows 50 requests per ~31-day window and
// blocks the rest; these leave room for retries and manual checks.
export const RAPLINE_BUDGET = {
  windowDays: 31,
  cap: 42,           // our own ceiling inside the provider's 50
  quotaFloor: 5,     // stop if the provider says this few remain
  refreshHours: 69,  // ~3 days between successful refreshes
  retryHours: 20,    // after a failed attempt, wait until the next daily run
}

// Days of history kept per track. The card needs the last week; the rest is
// a cushion for gaps and for the detail sheet.
export const RAPLINE_KEEP_DAYS = 120

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
const dayIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10)

/** Validate a provider response: an array of {date, streams}. Throws on
 *  anything that isn't one, so a changed or error payload is never stored.
 *  Returns [{day, streams}] sorted by day, one entry per day. */
export function parseHistory(json) {
  if (!Array.isArray(json)) throw new Error('history_not_array')
  const byDay = new Map()
  for (const row of json) {
    const day = row?.date
    const streams = row?.streams
    if (typeof day !== 'string' || !ISO_DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      throw new Error('history_bad_date')
    }
    if (!Number.isSafeInteger(streams) || streams < 0) throw new Error('history_bad_streams')
    byDay.set(day, streams)
  }
  return [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, streams]) => ({ day, streams }))
}

/** Keep only the last `keepDays` days ending at the series' newest day. */
export function trimHistory(points, keepDays = RAPLINE_KEEP_DAYS) {
  if (!points.length) return []
  const newest = dayNumber(points[points.length - 1].day)
  return points.filter((p) => dayNumber(p.day) > newest - keepDays)
}

/** Summarise one track's stored series as of `todayIso` (UTC date).
 *  `points` is [{day, streams}] in any order. */
export function summariseSeries(points, todayIso, goal = RAPLINE_GOAL) {
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : 1))
  if (!sorted.length) return null
  const value = new Map(sorted.map((p) => [dayNumber(p.day), Number(p.streams)]))
  const has = (n) => value.has(n)
  // A reading is a repeat when it equals the reading of an adjacent day.
  const isRepeat = (n) => has(n) && ((has(n - 1) && value.get(n - 1) === value.get(n))
    || (has(n + 1) && value.get(n + 1) === value.get(n)))

  const classify = (n) => {
    if (!has(n)) return { kind: 'missing', gain: null }
    if (!has(n - 1)) return { kind: 'gap', gain: null }
    const diff = value.get(n) - value.get(n - 1)
    if (diff === 0) return { kind: 'repeat', gain: null }
    if (diff < 0) return { kind: 'correction', gain: diff }
    if (isRepeat(n) || isRepeat(n - 1)) return { kind: 'spans_repeat', gain: null }
    return { kind: 'gain', gain: diff }
  }

  const last = dayNumber(sorted[sorted.length - 1].day)
  const total = value.get(last)
  // The newest total was first reported on the first day of its trailing run
  // of identical readings; later copies don't make it any newer.
  let asOf = last
  while (has(asOf - 1) && value.get(asOf - 1) === total) asOf--

  let latestGain = null
  let latestCorrection = null
  for (let n = last; n > last - 14; n--) {
    const c = classify(n)
    if (!latestGain && c.kind === 'gain') latestGain = { day: dayIso(n), streams: c.gain }
    if (!latestCorrection && c.kind === 'correction') latestCorrection = { day: dayIso(n), streams: c.gain }
  }

  const days = []
  for (let n = last - 6; n <= last; n++) {
    const c = classify(n)
    days.push({ day: dayIso(n), streams: has(n) ? value.get(n) : null, kind: c.kind, gain: c.gain })
  }

  const ageDays = Math.max(0, dayNumber(todayIso) - asOf)
  return {
    total,
    asOf: dayIso(asOf),
    latestDay: dayIso(last),
    ageDays,
    stale: ageDays > RAPLINE_STALE_DAYS,
    remaining: Math.max(0, goal - total),
    percent: Math.min(100, Math.floor((total / goal) * 10000) / 100),
    reached: total >= goal,
    latestGain,
    latestCorrection,
    days,
  }
}

/** The public payload: the three tracks, the completed milestones, and when
 *  the source was last checked. `rowsBySpotifyId` maps id → [{day, streams}]. */
export function summariseTracker(rowsBySpotifyId, todayIso, lastCheckedAt = null) {
  const tracks = RAPLINE_TRACKS.map((t) => ({
    id: t.id, spotifyId: t.spotifyId, name: t.name, artist: t.artist, feature: t.feature || null,
    summary: summariseSeries(rowsBySpotifyId[t.spotifyId] || [], todayIso),
  }))
  const reported = tracks.filter((t) => t.summary)
  const newestAsOf = reported.reduce((max, t) => (t.summary.asOf > max ? t.summary.asOf : max), '')
  const ageDays = newestAsOf ? Math.max(0, dayNumber(todayIso) - dayNumber(newestAsOf)) : null
  return {
    goal: RAPLINE_GOAL,
    today: todayIso,
    asOf: newestAsOf || null,
    ageDays,
    stale: ageDays === null ? false : ageDays > RAPLINE_STALE_DAYS,
    lastCheckedAt,
    tracks,
    milestones: RAPLINE_MILESTONES.map((m) => ({ ...m })),
  }
}

/** Whether a refresh of `trackCount` requests may run now.
 *  `log` = { requestsInWindow, lastRemaining, lastSuccessAt, lastAttemptAt }
 *  (timestamps as ISO strings or null; lastRemaining from inside the window). */
export function raplineFetchDecision(log, nowMs, trackCount = RAPLINE_TRACKS.length, budget = RAPLINE_BUDGET) {
  const hoursSince = (iso) => (iso ? (nowMs - Date.parse(iso)) / 3_600_000 : Infinity)
  if ((log.requestsInWindow || 0) + trackCount > budget.cap) return { ok: false, reason: 'budget' }
  if (log.lastRemaining != null && log.lastRemaining - trackCount < budget.quotaFloor) {
    return { ok: false, reason: 'quota_floor' }
  }
  if (hoursSince(log.lastSuccessAt) < budget.refreshHours) return { ok: false, reason: 'fresh' }
  if (hoursSince(log.lastAttemptAt) < budget.retryHours) return { ok: false, reason: 'cooldown' }
  return { ok: true, reason: 'due' }
}
