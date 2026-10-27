// The MAMA City banner's live countdown and lifecycle — the words, and a
// ticker that keeps them current without repainting the City.
//
// Everything is recomputed from the event's own timestamps (opens_at,
// closes_at) and the current clock on every tick — never a local counter
// that is decremented — so a background tab, a sleeping phone or a refresh
// always lands on the right value. The server stays the authority on
// results: "Battle ended" only ever comes from its final phase (cityPhase +
// a known winner); the clock alone can only move a banner from "opens in"
// to live to "Voting closed · Results pending".

const DAY = 86_400
const HOUR = 3_600
// After voting opens, the countdown reads LIVE NOW this long before it
// starts counting down to the close.
export const LIVE_NOW_MS = 10_000

const pad = (n) => String(n).padStart(2, '0')

/** Remaining time in the banner's format, or null at (or past) zero:
 *    more than 24h → '1d 4h' · 1–24h → '05:04:00' · under 1h → '04:03'.
 *  Whole seconds are rounded up, so the final ten read 00:10 … 00:01. */
export function cityCountdown(ms) {
  const s = Math.ceil(Number(ms) / 1000)
  if (!Number.isFinite(s) || s <= 0) return null
  if (s > DAY) return `${Math.floor(s / DAY)}d ${Math.floor((s % DAY) / HOUR)}h`
  if (s >= HOUR) return `${pad(Math.floor(s / HOUR))}:${pad(Math.floor((s % HOUR) / 60))}:${pad(s % 60)}`
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/**
 * Where the banner stands now. `v` is the server's City summary
 * (getVotingBanner: phase, opensAt, closesAt, battle); `resultText` is the
 * server-backed result line (cityResultText), or null.
 *   soon   → 'Voting opens in' + countdown to opensAt
 *   live   → LIVE · 'Voting closes in' + countdown to closesAt
 *            (LIVE NOW for the first moments after opening)
 *   closed → 'Voting closed' · 'Results pending' (never a negative time)
 *   final  → 'Battle ended' · 'View results' (server phase only)
 */
export function cityBannerState(v, nowMs, resultText = null) {
  const opens = Date.parse(v?.opensAt)
  const closes = Date.parse(v?.closesAt)
  if (v?.phase === 'final' && resultText) return { state: 'final', label: 'Battle ended', value: 'View results', live: false }
  if (v?.phase === 'final' || v?.phase === 'verifying' || !(nowMs < closes)) {
    return { state: 'closed', label: 'Voting closed', value: 'Results pending', live: false }
  }
  if (Number.isFinite(opens) && nowMs < opens) {
    return { state: 'soon', label: 'Voting opens in', value: cityCountdown(opens - nowMs) || 'LIVE NOW', live: false, timer: true }
  }
  if (Number.isFinite(opens) && nowMs - opens < LIVE_NOW_MS) {
    return { state: 'live', label: 'Voting is open', value: 'LIVE NOW', live: true, timer: true }
  }
  return { state: 'live', label: 'Voting closes in', value: cityCountdown(closes - nowMs) || 'LIVE NOW', live: true, timer: true }
}

// ── the ticker (browser only) ──────────────────────────────────────────

let timer = null

/** One tick: refresh every City banner from its own data attributes. Only
 *  text and a state attribute change — the elements stay, so the layout
 *  never moves and the button keeps its click handler and focus. */
export function tickCityClocks(root = globalThis.document, nowMs = Date.now()) {
  const cards = root?.querySelectorAll?.('[data-vt-cd]') || []
  for (const card of cards) {
    const s = cityBannerState({ phase: card.dataset.phase, opensAt: card.dataset.opens, closesAt: card.dataset.closes }, nowMs, card.dataset.result || null)
    if (card.dataset.vtCity !== s.state) card.dataset.vtCity = s.state
    const live = card.querySelector('.vt-city-live')
    if (live && live.hidden === s.live) live.hidden = !s.live
    const l = card.querySelector('.vt-city-cl')
    const val = card.querySelector('.vt-city-cv')
    if (l && l.textContent !== s.label) l.textContent = s.label
    if (val && val.textContent !== s.value) val.textContent = s.value
    if (val) val.classList.toggle('is-word', !s.timer || !/\d/.test(s.value))
    const aria = `${card.dataset.title}. ${s.label} ${s.value}. Open the event.`
    if (card.getAttribute('aria-label') !== aria) card.setAttribute('aria-label', aria)
  }
  return cards.length
}

/** Starts the once-a-second ticker (idempotent). It runs on the second
 *  boundary, catches up straight away when the tab comes back, and stops
 *  by itself when no banner is on screen. */
export function startCityClock() {
  if (timer || typeof window === 'undefined') return
  const schedule = () => { timer = setTimeout(run, 1000 - (Date.now() % 1000) + 15) }
  const run = () => {
    timer = null
    if (!tickCityClocks()) return
    schedule()
  }
  if (!startCityClock.wired) {
    startCityClock.wired = true
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return
      clearTimeout(timer)
      timer = null
      tickCityClocks() // back from the background: correct at once
      startCityClock()
    })
  }
  // The card is rendered correct for "now" already; the first tick lands on
  // the next second, by when the City has put the card on the page.
  schedule()
}
