// ARIRANG RE:CELEBRATE — the Watch schedule for Sept 20 (IST).
//
// The source schedule is IST; each start is stored as an exact UTC instant,
// so every state below is computed from the real clock and a refresh can
// never restart anything.
//
// Durations are NOT known yet, so none are guessed: an event is NOW from its
// start until the next event starts, and the last one until the party ends.
// When real durations exist, set `endsAtIso` on an item and it is used
// instead. A finished event is never removed — it becomes a REPLAY.
//
// `video` is what the stage plays for the event:
//   { kind: 'video', youtubeId, track }  one YouTube video; `track` names the
//                                         WATCH_ITEMS song whose concert
//                                         colour/tempo the venue uses
//   { kind: 'playlist' }                 the Gwanghwamun playlist, with the
//                                         full song-by-song programme
//                                         (recelebrate-watch-program.js)
//   { kind: 'list', listId, firstVideoId } any other YouTube playlist, played
//                                         in order under the warm house light
//                                         (no per-song programme)
//   null                                 no link yet — listed, not playable

export const WATCH_SCHEDULE_TZ = 'Asia/Kolkata'
export const WATCH_SCHEDULE_DAY = 'SEPT 20'

export const WATCH_SCHEDULE = [
  // 9:30 AM IST
  { id: 'swim', title: 'SWIM', startsAtIso: '2026-09-20T04:00:00.000Z',
    video: { kind: 'video', youtubeId: 'b4iVv91Z6lY', track: 'SWIM' } },
  // 11:00 AM IST
  { id: 'comeback-live', title: 'COMEBACK LIVE', startsAtIso: '2026-09-20T05:30:00.000Z',
    video: { kind: 'playlist' } },
  // 6:00 PM IST
  // Goyang Day 1 (260409), K-PLANET's full-concert 4K fancam playlist.
  { id: 'goyang', title: 'GOYANG', startsAtIso: '2026-09-20T12:30:00.000Z',
    video: { kind: 'list', listId: 'PLW2azHF4TGkE_xDKcIJ0dzehxk7BFGrO9', firstVideoId: 'FnS_t3uLNk4' } },
]

/** "9:30 AM", always in the schedule's own timezone (IST), whatever the
 *  device's timezone is. */
export function fmtScheduleTime(iso) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: WATCH_SCHEDULE_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso))
}

/** Pure: each item's state at `nowMs`.
 *   'now'      started, not yet ended
 *   'next'     the first item that hasn't started
 *   'later'    hasn't started, after the next one
 *   'replay'   ended — still listed, opens as a replay
 *  `partyEndsAtIso` bounds the last item when no durations are known. */
export function watchScheduleStates(nowMs, { items = WATCH_SCHEDULE, partyEndsAtIso } = {}) {
  const partyEnd = partyEndsAtIso ? new Date(partyEndsAtIso).getTime() : Infinity
  let nextTaken = false
  return items.map((item, i) => {
    const start = new Date(item.startsAtIso).getTime()
    const end = item.endsAtIso ? new Date(item.endsAtIso).getTime()
      : items[i + 1] ? new Date(items[i + 1].startsAtIso).getTime()
      : partyEnd
    let state
    if (nowMs >= end) state = 'replay'
    else if (nowMs >= start) state = 'now'
    else if (!nextTaken) { state = 'next'; nextTaken = true }
    else state = 'later'
    return { ...item, state, startsAt: start, endsAt: end, timeLabel: fmtScheduleTime(item.startsAtIso) }
  })
}

// Local review only: `?rcNow=2026-09-20T11:15+05:30` starts the clock at that
// moment and lets it run on, so each state can be seen. Never in production.
const devStart = (() => {
  try {
    if (!import.meta.env?.DEV) return null
    const v = new URLSearchParams(window.location.search).get('rcNow')
    const t = v ? new Date(v).getTime() : NaN
    return Number.isFinite(t) ? { at: t, loaded: Date.now() } : null
  } catch { return null }
})()
// Like an MV premiere: for the last 15 minutes before an event starts, the
// stage becomes its countdown.
export const PREMIERE_LEAD_MS = 15 * 60 * 1000

/** The event counting down right now (the next one, within the lead), or
 *  null. `msLeft` is from the real clock, so arriving mid-countdown shows the
 *  true time left. */
export function premiereFor(items, nowMs, leadMs = PREMIERE_LEAD_MS) {
  const next = items.find((s) => s.state === 'next')
  if (!next) return null
  const msLeft = next.startsAt - nowMs
  return msLeft > 0 && msLeft <= leadMs ? { item: next, msLeft } : null
}

/** "14:59" — whole seconds left, rounded up so it reads 00:01 until the
 *  very last moment. */
export function fmtCountdown(msLeft) {
  const total = Math.max(0, Math.ceil(msLeft / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Which event the stage shows when the agent hasn't picked one: an event in
 *  its premiere countdown, else the live one, else the next to start, else
 *  the most recent replay. */
export function defaultStageEvent(items, nowMs) {
  const premiere = nowMs == null ? null : premiereFor(items, nowMs)
  return premiere?.item || items.find((s) => s.state === 'now') || items.find((s) => s.state === 'next')
    || [...items].reverse().find((s) => s.state === 'replay') || items[0]
}

export const scheduleNow = () => devStart ? devStart.at + (Date.now() - devStart.loaded) : Date.now()
