// Dear Diary archive index — the client's view of getDearDiaryArchive.
// The endpoint returns reconstructable dates for a contiguous window ending
// at `before`; this keeps one contiguous covered range [coveredFrom, today]
// and extends it backwards window by window. No raw history is fetched here:
// page turns and the archive calendar both read this one date index.

import { clampDiaryMonth, shiftDiaryDate } from './dear-diary-rules.js'

export const DIARY_ARCHIVE_WINDOW_DAYS = 60
/** Most windows one lookup may request (~2 years at 60 days). A later lookup
 * continues from where this one stopped, so a cap never loses history. */
export const DIARY_ARCHIVE_MAX_WINDOWS = 12

export function createDiaryArchive({ fetchRange, today, windowDays = DIARY_ARCHIVE_WINDOW_DAYS, maxWindows = DIARY_ARCHIVE_MAX_WINDOWS }) {
  const states = new Map()
  let joinedDate = null
  let nextBefore = null
  let coveredFrom = today
  let started = false
  let queue = Promise.resolve()

  async function loadWindow(before) {
    const res = await fetchRange(before ? { before, days: windowDays } : { days: windowDays })
    if (!res?.success) return false
    if (res.joinedDate) joinedDate = res.joinedDate
    for (const item of res.dates || []) {
      if (item?.date && item.date <= today) states.set(item.date, item.state === 'real' ? 'real' : 'light')
    }
    nextBefore = res.nextBefore || null
    coveredFrom = nextBefore ? shiftDiaryDate(nextBefore, 1) : (joinedDate || coveredFrom)
    return true
  }

  /** Serialised so overlapping lookups (corner refresh + calendar) never
   * fetch the same window twice. Stops when `done()` holds, when the join
   * date has been reached, on a failed request, or at the window cap. */
  function extendUntil(done) {
    const run = async () => {
      if (!started) { started = true; if (!(await loadWindow(null))) { started = false; return } }
      let windows = 0
      while (!done() && nextBefore && windows < maxWindows) {
        if (!(await loadWindow(nextBefore))) break
        windows++
      }
    }
    queue = queue.then(run, run)
    return queue
  }

  const dates = () => [...new Set([...states.keys(), today])].sort()

  return {
    start: () => extendUntil(() => true),
    get joinedDate() { return joinedDate },
    get coveredFrom() { return coveredFrom },
    get complete() { return started && !nextBefore },
    today,
    stateOf: (date) => states.get(date) || null,
    dates,
    async adjacent(date, direction) {
      if (direction === 'newer') {
        // Coverage is contiguous, so once `date` is covered the next loaded
        // date after it is the true next page.
        await extendUntil(() => coveredFrom <= date)
        return dates().find((d) => d > date) || null
      }
      // A sparse window can hold no dates while earlier history still
      // exists; keep paging until one is found or the join date is reached.
      await extendUntil(() => dates().some((d) => d < date))
      return dates().filter((d) => d < date).at(-1) || null
    },
    /** Make every date of a 'YYYY-MM' month known before it is drawn. */
    async ensureMonth(month) {
      await extendUntil(() => coveredFrom <= `${month}-01`)
    },
    monthReady(month) {
      return started && (!nextBefore || coveredFrom <= `${month}-01`)
    },
    /** The join date opens the first agent page; reaching it also covers
     * everything newer, so page turns from there stay correct. */
    async firstDay() {
      await extendUntil(() => false)
      return joinedDate
    },
    clampMonth: (month) => clampDiaryMonth(month, today, joinedDate),
  }
}

/**
 * Archive calendar sheet state, kept free of the DOM so open/close, month
 * paging and jumps are testable. `jump(date)` opens a diary page.
 */
export function createDiaryCalendar({ archive, jump }) {
  let open = false
  let month = archive.today.slice(0, 7)
  return {
    get open() { return open },
    get month() { return month },
    async openAt(date) {
      open = true
      month = archive.clampMonth((date || archive.today).slice(0, 7))
      await archive.ensureMonth(month)
    },
    close() { open = false },
    async showMonth(delta) {
      const next = archive.clampMonth(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1)).toISOString().slice(0, 7))
      if (next === month) return false
      month = next
      await archive.ensureMonth(month)
      return true
    },
    async choose(date) {
      if (!date || date > archive.today || (archive.joinedDate && date < archive.joinedDate)) return false
      if (date !== archive.today && !archive.stateOf(date)) return false
      open = false
      await jump(date)
      return true
    },
    async firstDay() {
      const date = await archive.firstDay()
      if (!date) return false
      open = false
      await jump(date)
      return true
    },
    async today() {
      open = false
      await jump(archive.today)
      return true
    },
  }
}
