// Dear Diary — the days worth remembering, shared by the diary page, its
// archive calendar and the Pack's closed diary (plain JS so the browser and
// the Edge Function read one list).
//
// Two kinds:
//   yearly — BTS days that come round every year (MM-DD).
//   once   — ReConnect's own dated events, by their KST calendar dates. A
//            multi-day event marks the day it opened and the day it closed.
//
// Add a ReConnect event here when it ships; the calendar picks it up.

export const DIARY_YEARLY_DATES = Object.freeze([
  { md: '02-18', title: "j-hope's birthday", icon: '☀️' },
  { md: '03-09', title: "SUGA's birthday", icon: '🐱' },
  { md: '06-13', title: 'BTS debut anniversary', icon: '💜' },
  { md: '07-09', title: 'ARMY Day', icon: '💜' },
  { md: '09-01', title: "Jung Kook's birthday", icon: '🐰' },
  { md: '09-12', title: "RM's birthday", icon: '🐨' },
  { md: '10-13', title: "Jimin's birthday", icon: '🌙' },
  { md: '12-04', title: "Jin's birthday", icon: '🐹' },
  { md: '12-30', title: "V's birthday", icon: '🐻' },
])

export const DIARY_EVENT_DATES = Object.freeze([
  { date: '2026-08-18', title: 'VMA voting opened', icon: '🗳️' },
  { date: '2026-09-01', title: 'GOLDEN Corner opened', icon: '🐰' },
  { date: '2026-09-02', title: 'GOLDEN Corner closed', icon: '🐰' },
  { date: '2026-09-20', title: "RE:CELEBRATE '26 Watch Party", icon: '🎉' },
  { date: '2026-09-26', title: 'VMA voting closed', icon: '🗳️' },
  { date: '2026-10-12', title: 'MAMA voting opened', icon: '🗳️' },
  { date: '2026-10-13', title: 'Jimin Birthday Room opened', icon: '🌙' },
  { date: '2026-10-14', title: 'Jimin Birthday Room closed', icon: '🌙' },
  { date: '2026-10-22', title: 'MAMA voting closed', icon: '🗳️' },
])

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Every important day on one KST date, yearly ones first. */
export function importantDatesOn(date) {
  if (!DATE_RE.test(String(date || ''))) return []
  const md = date.slice(5)
  return [
    ...DIARY_YEARLY_DATES.filter((d) => d.md === md).map((d) => ({ date, title: d.title, icon: d.icon, kind: 'yearly' })),
    ...DIARY_EVENT_DATES.filter((d) => d.date === date).map((d) => ({ date, title: d.title, icon: d.icon, kind: 'event' })),
  ]
}

/** All important days in a 'YYYY-MM' month, in date order. */
export function importantDatesInMonth(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!match) return []
  const days = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()
  const out = []
  for (let d = 1; d <= days; d++) out.push(...importantDatesOn(`${month}-${String(d).padStart(2, '0')}`))
  return out
}

/** The next important day strictly after `date` (within two years). */
export function nextImportantDate(date) {
  if (!DATE_RE.test(String(date || ''))) return null
  const start = new Date(`${date}T00:00:00Z`).getTime()
  for (let i = 1; i <= 731; i++) {
    const day = new Date(start + i * 86400000).toISOString().slice(0, 10)
    const hits = importantDatesOn(day)
    if (hits.length) return hits[0]
  }
  return null
}
