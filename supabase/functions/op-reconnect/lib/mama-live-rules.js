// MAMA 2026 live voting: a temporary homepage banner and a one-time popup.
//
// Three manual states, set by the owner from the admin dashboard only:
//   upcoming  banner "MAMA Live Voting · Today" with the ceremony start in
//             the visitor's own time. No popup.
//   live      banner "LIVE NOW · Vote for BTS" plus a compact popup, shown
//             once per visitor (per Live session).
//   hidden    nothing anywhere (the default, and what any bad value means).
// Nothing switches automatically — not at the ceremony start, not ever.
// No uploads, XP, points or vote checks: this only points at Mnet Plus.
//
// Pure functions, shared by the landing page, the game and the server.

export const MAMA_LIVE_URL = 'https://www.mnetplus.world/event/en/2026-mama'
export const MAMA_LIVE_STATES = Object.freeze(['upcoming', 'live', 'hidden'])
const SEEN_PREFIX = 'rc_seen_mama_live_popup:'

const isoOrNull = (v) => {
  const t = Date.parse(v || '')
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Any stored value → a safe shape. Unknown or missing state is hidden. */
export function normalizeMamaLive(raw) {
  const state = MAMA_LIVE_STATES.includes(raw?.state) ? raw.state : 'hidden'
  return {
    state,
    startsAt: isoOrNull(raw?.startsAt),
    liveSince: state === 'live' ? isoOrNull(raw?.liveSince) : null,
  }
}

/** The value the admin action stores. Switching to live stamps liveSince
 *  once (so the popup is once per Live session); staying live keeps it. */
export function nextMamaLive(current, { state, startsAt }, now = new Date()) {
  if (!MAMA_LIVE_STATES.includes(state)) return { error: 'bad_state' }
  const prev = normalizeMamaLive(current)
  const start = startsAt === undefined ? prev.startsAt : isoOrNull(startsAt)
  if (startsAt !== undefined && startsAt !== null && startsAt !== '' && !start) return { error: 'bad_start' }
  const liveSince = state === 'live' ? (prev.state === 'live' && prev.liveSince ? prev.liveSince : now.toISOString()) : null
  return { value: { state, startsAt: start, liveSince } }
}

/** "8 KST" written as an instant: a KST wall-clock date + time → ISO.
 *  KST is UTC+9 all year (no daylight saving). */
export function kstToIso(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  const n = /^(\d{2}):(\d{2})$/.exec(time || '')
  if (!m || !n) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +n[1] - 9, +n[2])).toISOString()
}

/** A short time-zone label for the visitor. India gets "IST" whatever the
 *  phone's language, because en-US formatting would say "GMT+5:30". */
export function zoneLabel(timeZone, locale, at = new Date()) {
  if (timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta') return 'IST'
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName')
    return part?.value || ''
  } catch { return '' }
}

function ymd(at, timeZone) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const g = (t) => p.find((x) => x.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}`
}

/** The ceremony start in the visitor's own zone: "Sat, 28 Nov · 2:30 PM IST",
 *  plus whether that is today / tomorrow for them. */
export function localStart(startsAt, { timeZone, locale = 'en', now = new Date() } = {}) {
  const at = new Date(startsAt || '')
  if (!Number.isFinite(at.getTime())) return null
  let tz = timeZone
  try { new Intl.DateTimeFormat('en', { timeZone: tz }) } catch { tz = 'UTC' }
  const date = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(at)
  const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at)
  const zone = zoneLabel(tz, locale, at)
  const startDay = ymd(at, tz)
  const today = ymd(now, tz)
  const tomorrow = ymd(new Date(now.getTime() + 86_400_000), tz)
  const when = startDay === today ? 'today' : startDay === tomorrow ? 'tomorrow' : startDay < today ? 'past' : 'later'
  return { date, time, zone, when, text: `${date} · ${time}${zone ? ` ${zone}` : ''}` }
}

/** The banner, or null when nothing should show. */
export function mamaBannerCopy(mama, opts = {}) {
  const m = normalizeMamaLive(mama)
  if (m.state === 'live') {
    return {
      state: 'live',
      heading: 'LIVE NOW · Vote for BTS 💜',
      text: "Open Mnet Plus → 2026 MAMA AWARDS → LIVE VOTE → Fans' Choice of the Year with VISA → BTS.",
      startLine: null,
      reminder: 'Complete all required steps and check your vote confirmation.',
      button: 'Vote on Mnet Plus',
      url: MAMA_LIVE_URL,
    }
  }
  if (m.state === 'upcoming') {
    const start = m.startsAt ? localStart(m.startsAt, opts) : null
    // "Today" only when the ceremony really is today for this visitor.
    const day = !start || start.when === 'today' ? 'Today' : start.when === 'tomorrow' ? 'Tomorrow' : start.date
    return {
      state: 'upcoming',
      heading: `MAMA Live Voting · ${day} 💜`,
      text: 'Get ready to vote for BTS! The MAMA Awards begin at 6 PM KST. Live voting will open during the broadcast.',
      startLine: start ? `Starts ${start.text} your time` : null,
      reminder: 'Update Mnet Plus, sign in and keep your device ready.',
      button: 'Get Ready to Vote',
      url: MAMA_LIVE_URL,
    }
  }
  return null
}

export const MAMA_POPUP_COPY = Object.freeze({
  heading: '🔴 LIVE NOW · Vote for BTS 💜',
  text: "MAMA live voting is open! Vote for BTS in Fans' Choice of the Year with VISA on Mnet Plus.",
  button: 'VOTE NOW',
  url: MAMA_LIVE_URL,
})

const seenKey = (m) => `${SEEN_PREFIX}${m.liveSince || 'live'}`

/** Popup only while Live, once per visitor per Live session. Storage that
 *  throws (private mode, some in-app browsers) means "don't show": a popup
 *  that can't remember being closed would come back on every load. */
export function mamaPopupDue(mama, storage) {
  const m = normalizeMamaLive(mama)
  if (m.state !== 'live') return false
  try { return storage.getItem(seenKey(m)) !== '1' } catch { return false }
}

export function markMamaPopupSeen(mama, storage) {
  try { storage.setItem(seenKey(normalizeMamaLive(mama)), '1') } catch { /* nothing to remember with */ }
}
