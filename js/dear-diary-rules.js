/** Equal-weight district progress, matching the badge/progress language used elsewhere. */
export function diaryProgress(activeDistrict) {
  if (!activeDistrict) return null
  const parts = [
    ...(activeDistrict.trackGoals || []).map((g) => Math.min(1, (Number(g.progress) || 0) / Math.max(1, Number(g.target) || 1))),
    ...(activeDistrict.albums || []).map((a) => Math.min(1, (Number(a.passesDone) || 0) / Math.max(1, Number(a.target) || 1))),
  ]
  if (activeDistrict.reconnect) parts.push(activeDistrict.reconnect.done ? 1 : 0)
  return { name: activeDistrict.name, percent: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100) : 0 }
}

/** Shift an ISO calendar date without depending on the browser's local zone. */
export function shiftDiaryDate(date, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!match) return null
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return value.toISOString().slice(0, 10)
}

/**
 * The diary reads like a physical book in time order: older pages sit to the
 * left, newer pages to the right. Corners, arrow keys and swipes all share
 * this one mapping so they can never disagree.
 */
export const DIARY_CORNER_DIRECTION = Object.freeze({ left: 'older', right: 'newer' })
export const DIARY_KEY_DIRECTION = Object.freeze({ ArrowLeft: 'older', ArrowRight: 'newer' })

/** Horizontal page turns must be deliberate, not a vertical scroll wobble.
 * Swiping left pulls the next (newer) page in, like turning a book forward. */
export function diarySwipeDirection(deltaX, deltaY, threshold = 58) {
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return null
  return deltaX < 0 ? 'newer' : 'older'
}

/**
 * Where one turn lands. A date's sheets are read in order (sheet 1 → 2 is
 * "forward", i.e. newer), so a date is always finished before the book moves
 * to another date: going newer from a date's last sheet opens the next date
 * on its first sheet; going older from a first sheet opens the previous date
 * on its last sheet.
 */
export function diaryTurnTarget({ index = 0, total = 1, direction }) {
  if (direction === 'newer') return index < total - 1 ? { sheet: index + 1 } : { date: 'newer', land: 'first' }
  if (direction === 'older') return index > 0 ? { sheet: index - 1 } : { date: 'older', land: 'last' }
  return null
}

/** Which corners can turn. Today's last sheet is the front of the book;
 * the earliest recorded date's first sheet is the back. */
export function diaryCornerState({ index = 0, total = 1, isToday = false, hasOlderDate = false }) {
  return {
    older: index > 0 || !!hasOlderDate,
    newer: index < total - 1 || !isToday,
  }
}

/** 'YYYY-MM' month arithmetic without local timezone drift. */
export function shiftDiaryMonth(month, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1)).toISOString().slice(0, 7)
}

/**
 * One month of the archive calendar. `stateOf(date)` reports the archive's
 * 'real' / 'light' mark (or nothing for an unsupported day). Only today and
 * marked days between the join date and today can be opened.
 */
export function diaryCalendarMonth({ month, today, joinedDate, stateOf = () => null, selected = null, importantOf = () => [] }) {
  const [year, monthNo] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year, monthNo - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, monthNo, 0)).getUTCDate()
  const joinMonth = joinedDate ? joinedDate.slice(0, 7) : null
  const days = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`
    const isFuture = date > today
    const beforeJoin = !!joinedDate && date < joinedDate
    const state = isFuture || beforeJoin ? null : (stateOf(date) || null)
    // Important days (diary-dates.js) are marked even in the future, and a
    // past one opens even without an entry — it's a page worth writing on.
    const important = importantOf(date) || []
    days.push({
      date, day, state, isFuture, beforeJoin, important,
      isToday: date === today, isJoin: date === joinedDate, isSelected: date === selected,
      selectable: !isFuture && !beforeJoin && (!!state || date === today || important.length > 0),
    })
  }
  return {
    month, year, monthNo,
    leading: first.getUTCDay(), // Sunday-first grid
    days,
    canPrev: !joinMonth || month > joinMonth,
    canNext: month < today.slice(0, 7),
  }
}

/** Clamp a requested calendar month into [join month, current month]. */
export function clampDiaryMonth(month, today, joinedDate) {
  const max = today.slice(0, 7)
  const min = joinedDate ? joinedDate.slice(0, 7) : null
  if (month > max) return max
  if (min && month < min) return min
  return month
}

/**
 * Pack whole diary sections onto finite sheets. The weights model the mobile
 * book frame; blocks are never cut and the note remains one bounded editor.
 */
export function diarySheetPlan({ summary = '', badges = [], moments = [], quiet = false, kept = [], important = [], entry = true } = {}) {
  // A short day (entry + one collectible/moment + note) belongs on one
  // physical sheet. Busier days still break before a whole section.
  const capacity = 8.4
  const blocks = []
  // "On this day" heads the page; kept moments come right after the entry,
  // because the player chose them.
  if (important.length) blocks.push({ kind: 'important', weight: .55 + important.length * .35 })
  if (entry) blocks.push({ kind: 'entry', weight: 3.35 + Math.min(.9, String(summary).length / 200) })
  for (let start = 0; start < kept.length; start += 2) {
    const count = Math.min(2, kept.length - start)
    blocks.push({ kind: 'kept', start, end: start + count, weight: .7 + count * 1.3 })
  }

  for (let start = 0; start < badges.length; start += 3) {
    const count = Math.min(3, badges.length - start)
    blocks.push({ kind: 'badges', start, end: start + count, weight: count === 1 ? 2.15 : 2.85 })
  }
  for (let start = 0; start < moments.length; start += 2) {
    const count = Math.min(2, moments.length - start)
    blocks.push({ kind: 'moments', start, end: start + count, weight: .65 + count * .9 })
  }
  blocks.push({ kind: 'note', weight: quiet ? 2.5 : 2.35 })

  const sheets = []
  let sheet = []
  let used = 0
  for (const block of blocks) {
    if (sheet.length && used + block.weight > capacity) {
      sheets.push(sheet)
      sheet = []
      used = 0
    }
    sheet.push(block)
    used += block.weight
  }
  if (sheet.length) sheets.push(sheet)
  return sheets
}

export const DIARY_THEMES = [
  { id: 'oldworld', name: '1800s · Old World', note: 'leather · parchment' },
  { id: 'school90s', name: '1990s · School Diary', note: 'ruled paper · blue pen' },
  { id: 'y2k', name: '2000s · Y2K Diary', note: 'gel pen · shiny stickers' },
  { id: 'modern', name: '2020s · Modern Journal', note: 'scrapbook · muted mauve' },
  { id: 'future', name: 'Future · ReConnect', note: 'agent archive · signal ink' },
]

export function normalizeDiaryTheme(value) {
  return DIARY_THEMES.some((theme) => theme.id === value) ? value : null
}

export const DIARY_DECORATION_FAMILIES = [
  { id: 'organic', label: 'Nature' },
  { id: 'keepsake', label: 'Keepsake' },
  { id: 'star', label: 'Star' },
  { id: 'mark', label: 'Little mark' },
  { id: 'fastener', label: 'Paper detail' },
  { id: 'accent', label: 'Accent' },
]

export const DIARY_DECORATION_SLOTS = [
  'entry-leading', 'entry-trailing', 'badges-heading',
  'moments-heading', 'note-heading', 'footer-center',
]

export const DIARY_DECORATION_LIMIT = 4

/** Slots are tied to whole rendered blocks, never pixel coordinates. */
export function diaryDecorationSlots(blocks = []) {
  const kinds = new Set(blocks.map((block) => block?.kind))
  if (kinds.has('no-recorded')) return []
  const slots = []
  if (kinds.has('entry')) slots.push('entry-leading', 'entry-trailing')
  if (kinds.has('badges')) slots.push('badges-heading')
  if (kinds.has('moments')) slots.push('moments-heading')
  if (kinds.has('note')) slots.push('note-heading')
  slots.push('footer-center')
  return slots
}

export function normalizeDiaryDecorations(value) {
  const source = value && typeof value === 'object' && Array.isArray(value.items) ? value.items : []
  const validFamilies = new Set(DIARY_DECORATION_FAMILIES.map((item) => item.id))
  const seen = new Set(), perSheet = new Map(), items = []
  for (const raw of source) {
    const sheet = Number(raw?.sheet)
    const decorationId = String(raw?.decoration_id || '')
    const slot = String(raw?.slot || '')
    const size = raw?.size === 'm' ? 'm' : raw?.size === 's' ? 's' : null
    const key = `${sheet}:${slot}`
    const count = perSheet.get(sheet) || 0
    if (!Number.isInteger(sheet) || sheet < 0 || sheet > 19 || !validFamilies.has(decorationId) || !DIARY_DECORATION_SLOTS.includes(slot) || !size || seen.has(key) || count >= DIARY_DECORATION_LIMIT) continue
    seen.add(key); perSheet.set(sheet, count + 1)
    items.push({ sheet, decoration_id: decorationId, slot, size })
  }
  return { version: 1, items }
}
