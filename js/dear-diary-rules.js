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

/** Horizontal page turns must be deliberate, not a vertical scroll wobble. */
export function diarySwipeDirection(deltaX, deltaY, threshold = 58) {
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return null
  return deltaX < 0 ? 'older' : 'newer'
}

/**
 * Pack whole diary sections onto finite sheets. The weights model the mobile
 * book frame; blocks are never cut and the note remains one bounded editor.
 */
export function diarySheetPlan({ summary = '', badges = [], moments = [], quiet = false } = {}) {
  // A short day (entry + one collectible/moment + note) belongs on one
  // physical sheet. Busier days still break before a whole section.
  const capacity = 8.4
  const blocks = [{ kind: 'entry', weight: 3.35 + Math.min(.9, String(summary).length / 200) }]

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
