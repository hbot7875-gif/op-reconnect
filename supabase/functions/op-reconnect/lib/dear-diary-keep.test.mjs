// Dear Diary: "Keep in Dear Diary" from the big pop-ups, and the special days
// marked in the diary and its calendar.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { importantDatesOn, importantDatesInMonth, nextImportantDate } from './diary-dates.js'
import { keepDearDiaryMoment, storedDiaryKept } from './dear-diary.ts'
import { diaryCalendarMonth, diarySheetPlan } from '../../../../js/dear-diary-rules.js'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

/** Just enough of supabase-js for keepDearDiaryMoment. */
function fakeDb(tables) {
  const upserts = []
  return {
    upserts,
    from(name) {
      let rows = [...(tables[name] || [])]
      const q = {
        select: () => q,
        eq: (c, v) => { rows = rows.filter((r) => r[c] === v); return q },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
        upsert: async (row) => { upserts.push({ table: name, row }); return { error: null } },
      }
      return q
    },
  }
}
const content = { districts: [{ id: 'mono-urmi-terrace', name: 'Urmi Terrace' }] }
const ledgers = (extra = {}) => ({
  rc_badges: [{ agent_no: 'AGENT455', badge_id: 'event_mama_2026', artwork_id: 7, earned_at: '2026-10-21T16:30:00Z' }],
  rc_badge_catalog: [{ id: 'event_mama_2026', name: 'MAMA 2026' }],
  rc_badge_art: [{ id: 7, storage_path: 'vault/mama/a.webp' }],
  rc_player_districts: [{ agent_no: 'AGENT455', district_id: 'mono-urmi-terrace', status: 'restored', completed_at: '2026-10-24T03:00:00Z' }],
  rc_feed_events: [{ agent_no: 'AGENT455', event_type: 'level_up', dedup_key: 'feed:level:AGENT455:12', payload: { name: 'Night Signal' }, created_at: '2026-10-23T10:00:00Z' }],
  rc_dear_diary_entries: [],
  ...extra,
})

test('special days: yearly BTS days and ReConnect event days, on any date', () => {
  assert.deepEqual(importantDatesOn('2026-10-13').map((d) => d.title), ["Jimin's birthday", 'Jimin Birthday Room opened'])
  assert.deepEqual(importantDatesOn('2031-12-04').map((d) => d.title), ["Jin's birthday"]) // yearly, any year
  assert.deepEqual(importantDatesOn('2026-10-25'), [])
  assert.deepEqual(importantDatesOn('not-a-date'), [])
  assert.equal(importantDatesInMonth('2026-10').length, 5)
  assert.equal(nextImportantDate('2026-10-25').title, "Jin's birthday")
})

test('a kept badge lands on the KST day it was earned, with its art, line and title', async () => {
  const db = fakeDb(ledgers())
  const res = await keepDearDiaryMoment(db, content, { agentNo: 'agent455', kind: 'badge', ref: 'event_mama_2026', line: '  so proud   of us  ' })
  assert.deepEqual(res, { success: true, date: '2026-10-22', isToday: false }) // 16:30Z = Oct 22 KST
  const row = db.upserts[0].row
  assert.equal(row.kst_date, '2026-10-22')
  assert.equal(row.kept.length, 1)
  assert.deepEqual({ ...row.kept[0], keptAt: undefined }, {
    kind: 'badge', ref: 'event_mama_2026', title: 'Earned the MAMA 2026 badge.', line: 'so proud of us', artworkPath: 'vault/mama/a.webp', keptAt: undefined,
  })
})

test('districts and levels are checked against the ledgers too', async () => {
  const db = fakeDb(ledgers())
  assert.equal((await keepDearDiaryMoment(db, content, { agentNo: 'AGENT455', kind: 'district', ref: 'mono-urmi-terrace' })).date, '2026-10-24')
  assert.equal(db.upserts[0].row.kept[0].title, 'Restored Urmi Terrace.')
  assert.equal((await keepDearDiaryMoment(db, content, { agentNo: 'AGENT455', kind: 'level', ref: '12' })).date, '2026-10-23')
  assert.equal(db.upserts[1].row.kept[0].title, 'Reached Level 12 · Night Signal.')
})

test('nothing is kept that did not happen, or that the browser made up', async () => {
  const db = fakeDb(ledgers())
  for (const params of [
    { kind: 'badge', ref: 'event_jimin_day_lightkeeper_2026' }, // not earned
    { kind: 'district', ref: 'mono-minimin-court' }, // not restored
    { kind: 'level', ref: '13' }, // not reached
    { kind: 'xp', ref: '9999' }, // not a kind
    { kind: 'badge', ref: '' },
  ]) {
    assert.equal((await keepDearDiaryMoment(db, content, { agentNo: 'AGENT455', ...params })).success, false, JSON.stringify(params))
  }
  assert.equal(db.upserts.length, 0)
})

test('keeping again replaces the line instead of duplicating; a page holds twelve; other columns survive', async () => {
  const existing = { agent_no: 'AGENT455', kst_date: '2026-10-22', note: 'my note', summary_text: 'Dear Diary…', summary_version: 2, summary_snapshot: { _frozen: true },
    kept: [{ kind: 'badge', ref: 'event_mama_2026', title: 'x', line: 'old', keptAt: '' }] }
  const db = fakeDb(ledgers({ rc_dear_diary_entries: [existing] }))
  await keepDearDiaryMoment(db, content, { agentNo: 'AGENT455', kind: 'badge', ref: 'event_mama_2026', line: 'new' })
  const row = db.upserts[0].row
  assert.deepEqual(row.kept.map((k) => k.line), ['new'])
  assert.equal(row.note, 'my note')
  assert.equal(row.summary_text, 'Dear Diary…')
  assert.deepEqual(row.summary_snapshot, { _frozen: true })
  const full = fakeDb(ledgers({ rc_dear_diary_entries: [{ ...existing, kept: Array.from({ length: 12 }, (_, i) => ({ kind: 'level', ref: String(i), title: 't' })) }] }))
  assert.equal((await keepDearDiaryMoment(full, content, { agentNo: 'AGENT455', kind: 'badge', ref: 'event_mama_2026' })).success, false)
})

test('stored kept items are re-checked on the way out', () => {
  const out = storedDiaryKept([{ kind: 'badge', ref: 'a', title: 'T', line: 'x'.repeat(300), artworkPath: null }, { kind: 'evil', ref: 'b', title: 'T' }, null, 'str'])
  assert.equal(out.length, 1)
  assert.equal(out[0].line.length, 140)
  assert.deepEqual(storedDiaryKept('nope'), [])
})

test('pages: kept cards follow the entry, "on this day" leads, and a past special day opens without an entry', () => {
  const sheets = diarySheetPlan({ summary: 'Dear Diary, hi.', kept: [{}, {}, {}], important: [{}] })
  assert.deepEqual(sheets.flat().map((b) => b.kind).slice(0, 4), ['important', 'entry', 'kept', 'kept'])
  const oct = diaryCalendarMonth({ month: '2026-10', today: '2026-10-25', joinedDate: '2026-08-10', importantOf: importantDatesOn })
  const day = (d) => oct.days.find((x) => x.date === d)
  assert.equal(day('2026-10-13').selectable, true) // no entry, but Jimin's birthday
  assert.equal(day('2026-10-13').important.length, 2)
  assert.equal(day('2026-10-12').selectable, true)
  assert.equal(day('2026-10-11').selectable, false) // ordinary empty day stays closed
  const dec = diaryCalendarMonth({ month: '2026-12', today: '2026-12-01', joinedDate: '2026-08-10', importantOf: importantDatesOn })
  assert.equal(dec.days.find((x) => x.date === '2026-12-04').selectable, false) // future: marked, not openable
  assert.equal(dec.days.find((x) => x.date === '2026-12-04').important[0].title, "Jin's birthday")
})

test('wiring: the action, the three pop-ups, the diary opening on the kept page, the Pack status', () => {
  assert.match(read('../index.ts'), /keepDearDiaryMoment: \{ auth: 'agent', handler: async \(sb, p\) => keepDearDiaryMoment\(sb, await loadContent\(sb\), p\) \}/)
  assert.match(read('../../../../js/badge-reveal.js'), /keepInDiaryControl\(\{ kind: 'badge', ref: badge\.badgeId/)
  const celebrate = read('../../../../js/celebrate.js')
  assert.match(celebrate, /keepInDiaryControl\(\{ kind: 'district', ref: d\.id/)
  assert.match(celebrate, /keepInDiaryControl\(\{ kind: 'level', ref: String\(levelUp\.level\)/)
  assert.match(read('../../../../js/screen-diary.js'), /const target = takeDiaryTarget\(\)\n    const \[res\] = await Promise\.all\(\[fetchPage\(target \|\| today\)/)
  assert.match(read('../../../../js/screen-resources.js'), /status: diaryStatus/)
  assert.match(read('../../../migrations/20261025150000_rc_dear_diary_kept.sql'), /add column if not exists kept jsonb not null default '\[\]'::jsonb/)
})
