import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DIARY_CORNER_DIRECTION, DIARY_KEY_DIRECTION, clampDiaryMonth, diaryCalendarMonth,
  diaryCornerState, diarySwipeDirection, diaryTurnTarget, shiftDiaryDate, shiftDiaryMonth,
} from './dear-diary-rules.js'
import { DIARY_ARCHIVE_MAX_WINDOWS, createDiaryArchive, createDiaryCalendar } from './dear-diary-archive.js'

const screenSource = readFileSync(new URL('./screen-diary.js', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../css/reconnect.css', import.meta.url), 'utf8')

const TODAY = '2026-10-12'
const JOINED = '2026-08-07'

/** Stand-in for getDearDiaryArchive: same window/nextBefore contract as the
 * Edge route (fromDate = max(join, before - days + 1)). */
function fakeRange({ joinedDate = JOINED, today = TODAY, marks = {} } = {}) {
  const calls = []
  const fetchRange = async ({ before = today, days = 60 } = {}) => {
    calls.push({ before, days })
    const windowStart = shiftDiaryDate(before, -(days - 1))
    const fromDate = windowStart > joinedDate ? windowStart : joinedDate
    const all = { ...marks, [joinedDate]: 'real' }
    const dates = Object.entries(all).filter(([d]) => d >= fromDate && d <= before)
      .sort(([a], [b]) => b.localeCompare(a)).map(([date, state]) => ({ date, state }))
    return { success: true, joinedDate, dates, nextBefore: fromDate > joinedDate ? shiftDiaryDate(fromDate, -1) : null, complete: fromDate === joinedDate }
  }
  return { fetchRange, calls }
}

const everyDay = (from, to, state = 'real') => {
  const out = {}
  for (let d = from; d <= to; d = shiftDiaryDate(d, 1)) out[d] = state
  return out
}

test('left corner, Left Arrow and a right swipe all mean older', () => {
  assert.equal(DIARY_CORNER_DIRECTION.left, 'older')
  assert.equal(DIARY_KEY_DIRECTION.ArrowLeft, 'older')
  assert.equal(diarySwipeDirection(90, 4), 'older')
})

test('right corner, Right Arrow and a left swipe all mean newer', () => {
  assert.equal(DIARY_CORNER_DIRECTION.right, 'newer')
  assert.equal(DIARY_KEY_DIRECTION.ArrowRight, 'newer')
  assert.equal(diarySwipeDirection(-90, 4), 'newer')
})

test('the rendered corners sit on the side their direction names', () => {
  const head = screenSource.slice(screenSource.indexOf('class="dd-book"'), screenSource.indexOf('dd-page-position'))
  assert.ok(head.indexOf('dd-page-older') < head.indexOf('dd-page-newer'), 'older corner is rendered first (left)')
  assert.match(head, /dd-page-older" aria-label="Turn to older diary page">‹/)
  assert.match(head, /dd-page-newer" aria-label="Turn to newer diary page">›/)
  assert.match(cssSource, /\.dd-page-older \{ left:/)
  assert.match(cssSource, /\.dd-page-newer \{ right:/)
  assert.match(screenSource, /DIARY_KEY_DIRECTION\[event\.key\]/)
})

test('Today disables the newer (right) corner on its last sheet', () => {
  assert.deepEqual(diaryCornerState({ index: 0, total: 1, isToday: true, hasOlderDate: true }), { older: true, newer: false })
  assert.equal(diaryCornerState({ index: 0, total: 2, isToday: true }).newer, true, 'today still has its own second sheet')
  assert.equal(diaryCornerState({ index: 1, total: 2, isToday: true }).newer, false)
  assert.equal(diaryCornerState({ index: 0, total: 1, isToday: false }).newer, true)
})

test('the first recorded day disables the older (left) corner', () => {
  assert.equal(diaryCornerState({ index: 0, total: 1, isToday: false, hasOlderDate: false }).older, false)
  assert.equal(diaryCornerState({ index: 1, total: 2, isToday: false, hasOlderDate: false }).older, true, 'its earlier sheet is still reachable')
})

test('multi-sheet dates are finished before moving to another date', () => {
  // Newer reads forward through a date's sheets, then opens the next date at its start.
  assert.deepEqual(diaryTurnTarget({ index: 0, total: 3, direction: 'newer' }), { sheet: 1 })
  assert.deepEqual(diaryTurnTarget({ index: 2, total: 3, direction: 'newer' }), { date: 'newer', land: 'first' })
  // Older reads back through the sheets, then opens the previous date at its end.
  assert.deepEqual(diaryTurnTarget({ index: 2, total: 3, direction: 'older' }), { sheet: 1 })
  assert.deepEqual(diaryTurnTarget({ index: 0, total: 3, direction: 'older' }), { date: 'older', land: 'last' })
  assert.equal(diaryTurnTarget({ index: 0, total: 1, direction: 'sideways' }), null)
})

test('archive adjacency walks recorded dates in both directions and skips gaps', async () => {
  const { fetchRange } = fakeRange({ marks: { '2026-10-12': 'real', '2026-10-10': 'light', '2026-10-01': 'real' } })
  const archive = createDiaryArchive({ fetchRange, today: TODAY })
  await archive.start()
  assert.equal(await archive.adjacent(TODAY, 'older'), '2026-10-10')
  assert.equal(await archive.adjacent('2026-10-10', 'older'), '2026-10-01')
  assert.equal(await archive.adjacent('2026-10-10', 'newer'), TODAY)
  assert.equal(await archive.adjacent(TODAY, 'newer'), null)
})

test('the join date bounds the archive: nothing older than it, and it is the first day', async () => {
  const { fetchRange } = fakeRange({ marks: everyDay('2026-08-07', TODAY) })
  const archive = createDiaryArchive({ fetchRange, today: TODAY })
  await archive.start()
  assert.equal(await archive.adjacent('2026-08-08', 'older'), JOINED)
  assert.equal(await archive.adjacent(JOINED, 'older'), null)
  assert.equal(await archive.firstDay(), JOINED)
  assert.equal(archive.complete, true)
})

test('a sparse 60-day window does not stop older history from loading', async () => {
  // Joined long ago; nothing at all for ~200 days before today except one old page.
  const { fetchRange, calls } = fakeRange({ joinedDate: '2025-12-01', marks: { [TODAY]: 'real', '2026-01-15': 'real' } })
  const archive = createDiaryArchive({ fetchRange, today: TODAY })
  await archive.start()
  assert.equal(calls.length, 1)
  assert.equal(await archive.adjacent(TODAY, 'older'), '2026-01-15')
  assert.ok(calls.length > 2, 'kept paging through empty windows')
  assert.ok(calls.every((call, i) => i === 0 || call.before < calls[i - 1].before), 'each window is strictly older')
})

test('older paging is capped per lookup and resumes on the next lookup', async () => {
  const { fetchRange, calls } = fakeRange({ joinedDate: '2020-01-01', marks: { [TODAY]: 'real' } })
  const archive = createDiaryArchive({ fetchRange, today: TODAY, maxWindows: 3 })
  await archive.start()
  assert.equal(await archive.adjacent(TODAY, 'older'), null, 'join date not reached within this lookup')
  assert.equal(calls.length, 1 + 3)
  await archive.adjacent(TODAY, 'older')
  assert.equal(calls.length, 1 + 6, 'second lookup continues where the first stopped')
  assert.equal(DIARY_ARCHIVE_MAX_WINDOWS >= 10, true)
})

test('a failed archive request ends paging instead of looping', async () => {
  let n = 0
  const archive = createDiaryArchive({ today: TODAY, fetchRange: async () => (++n === 1
    ? { success: true, joinedDate: '2025-01-01', dates: [{ date: TODAY, state: 'real' }], nextBefore: '2026-08-13' }
    : { success: false, error: 'boom' }) })
  await archive.start()
  assert.equal(await archive.adjacent(TODAY, 'older'), null)
  assert.equal(n, 2)
})

test('calendar month marks real and light days, highlights today, and disables the future', () => {
  const marks = { '2026-10-12': 'real', '2026-10-11': 'light', '2026-10-03': 'real' }
  const view = diaryCalendarMonth({ month: '2026-10', today: TODAY, joinedDate: JOINED, stateOf: (d) => marks[d], selected: '2026-10-03' })
  const day = (n) => view.days[n - 1]
  assert.equal(view.days.length, 31)
  assert.equal(view.leading, 4, 'Oct 1 2026 is a Thursday in a Sunday-first grid')
  assert.equal(day(12).isToday, true)
  assert.equal(day(12).selectable, true)
  assert.equal(day(11).state, 'light')
  assert.equal(day(3).state, 'real')
  assert.equal(day(3).isSelected, true)
  assert.equal(day(5).state, null, 'unsupported days are unmarked')
  assert.equal(day(5).selectable, false)
  assert.equal(day(13).isFuture, true)
  assert.equal(day(13).selectable, false)
  assert.equal(view.canNext, false)
  assert.equal(view.canPrev, true)
})

test('calendar respects the join-date lower bound', () => {
  const view = diaryCalendarMonth({ month: '2026-08', today: TODAY, joinedDate: JOINED, stateOf: () => 'real' })
  assert.equal(view.days[5].beforeJoin, true)
  assert.equal(view.days[5].state, null)
  assert.equal(view.days[5].selectable, false)
  assert.equal(view.days[6].isJoin, true)
  assert.equal(view.days[6].selectable, true)
  assert.equal(view.canPrev, false)
  assert.equal(clampDiaryMonth('2026-05', TODAY, JOINED), '2026-08')
  assert.equal(clampDiaryMonth('2027-01', TODAY, JOINED), '2026-10')
  assert.equal(shiftDiaryMonth('2026-01', -1), '2025-12')
})

test('archive calendar opens, closes and pages months within bounds', async () => {
  const { fetchRange } = fakeRange({ marks: everyDay('2026-08-07', TODAY) })
  const archive = createDiaryArchive({ fetchRange, today: TODAY })
  await archive.start()
  const calendar = createDiaryCalendar({ archive, jump: async () => {} })
  assert.equal(calendar.open, false)
  await calendar.openAt('2026-10-05')
  assert.equal(calendar.open, true)
  assert.equal(calendar.month, '2026-10')
  assert.equal(await calendar.showMonth(1), false, 'cannot page past the current month')
  assert.equal(await calendar.showMonth(-1), true)
  assert.equal(calendar.month, '2026-09')
  await calendar.showMonth(-1)
  assert.equal(calendar.month, '2026-08')
  assert.equal(archive.monthReady('2026-08'), true, 'August was loaded month-by-month before drawing')
  assert.equal(await calendar.showMonth(-1), false, 'cannot page before the join month')
  calendar.close()
  assert.equal(calendar.open, false)
})

test('calendar jumps to a historical date, First day and Today', async () => {
  const { fetchRange } = fakeRange({ marks: { ...everyDay('2026-09-01', TODAY), '2026-08-20': 'light' } })
  const archive = createDiaryArchive({ fetchRange, today: TODAY })
  await archive.start()
  const jumps = []
  const calendar = createDiaryCalendar({ archive, jump: async (date) => { jumps.push(date) } })
  await calendar.openAt(TODAY)
  assert.equal(await calendar.choose('2026-09-14'), true)
  assert.equal(calendar.open, false, 'choosing a date closes the sheet')
  await calendar.openAt(TODAY)
  assert.equal(await calendar.choose('2026-10-13'), false, 'future date is refused')
  assert.equal(await calendar.choose('2026-08-01'), false, 'pre-join date is refused')
  assert.equal(await calendar.firstDay(), true)
  await calendar.openAt(JOINED)
  assert.equal(await calendar.today(), true)
  assert.deepEqual(jumps, ['2026-09-14', JOINED, TODAY])
})

test('calendar never fetches per cell: one range request per uncovered window', async () => {
  const { fetchRange, calls } = fakeRange({ marks: everyDay('2026-08-07', TODAY) })
  const archive = createDiaryArchive({ fetchRange, today: TODAY })
  await archive.start()
  await archive.ensureMonth('2026-10')
  await archive.ensureMonth('2026-09')
  assert.equal(calls.length, 1, 'Sep and Oct are already inside the first 60-day window')
  await archive.ensureMonth('2026-08')
  assert.equal(calls.length, 2)
  await Promise.all([archive.ensureMonth('2026-08'), archive.adjacent('2026-08-10', 'older')])
  assert.equal(calls.length, 2, 'overlapping lookups reuse the loaded range')
})

test('header carries the archive calendar icon from the Lucide set, not an emoji', () => {
  assert.match(screenSource, /dd-calendar-open[^`]*\$\{packIcon\('calendar'\)\}/)
  assert.doesNotMatch(screenSource, /📅|🗓/)
  assert.match(screenSource, /class="dd-calendar-first">First day</)
  assert.match(screenSource, /class="dd-calendar-today">Today</)
})

test('a data refresh keeps the open diary instead of reloading it to Today', () => {
  const render = screenSource.slice(screenSource.indexOf('export function renderDearDiary'))
  assert.match(render, /if \(!previewData && container\.querySelector\(':scope > \.dd-screen\[data-live="true"\]'\)\) return null/)
  assert.ok(render.indexOf('return null') < render.indexOf("container.innerHTML = ''"), 'guard runs before the scene is cleared')
  assert.match(render, /root\.dataset\.live = 'true'/)
  assert.doesNotMatch(screenSource, /setInterval\(/)
})
