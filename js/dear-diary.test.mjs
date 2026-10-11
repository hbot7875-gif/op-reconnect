import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DIARY_DECORATION_FAMILIES, DIARY_DECORATION_LIMIT, DIARY_THEMES,
  diaryDecorationSlots, diaryProgress, diarySheetPlan, diarySwipeDirection,
  normalizeDiaryDecorations, normalizeDiaryTheme, shiftDiaryDate,
} from './dear-diary-rules.js'

const screenSource = readFileSync(new URL('./screen-diary.js', import.meta.url), 'utf8')
const packSource = readFileSync(new URL('./screen-resources.js', import.meta.url), 'utf8')
const previewSource = readFileSync(new URL('../_dear_diary_preview.html', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../css/reconnect.css', import.meta.url), 'utf8')
const backendSource = readFileSync(new URL('../supabase/functions/op-reconnect/lib/dear-diary.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(new URL('../supabase/migrations/20261004090000_rc_dear_diary.sql', import.meta.url), 'utf8')

test('diary progress gives each district goal equal weight', () => {
  const p = diaryProgress({ name:'Moon Station', trackGoals:[{progress:10,target:20},{progress:20,target:20}], albums:[{passesDone:1,target:2}], reconnect:{done:true} })
  assert.deepEqual(p, { name:'Moon Station', percent:75 })
})

test('diary progress is absent without an active district', () => assert.equal(diaryProgress(null), null))

test('diary dates move across month boundaries without local timezone drift', () => {
  assert.equal(shiftDiaryDate('2026-10-01', -1), '2026-09-30')
  assert.equal(shiftDiaryDate('2026-09-30', 1), '2026-10-01')
})

test('diary swipe requires a deliberate horizontal gesture', () => {
  assert.equal(diarySwipeDirection(-90, 12), 'older')
  assert.equal(diarySwipeDirection(90, 12), 'newer')
  assert.equal(diarySwipeDirection(32, 2), null)
  assert.equal(diarySwipeDirection(-80, 100), null)
})

test('quiet diary days fit on one physical sheet', () => {
  const sheets = diarySheetPlan({ summary:'Dear Diary, today was quiet. I’m choosing peace.', quiet:true })
  assert.equal(sheets.length, 1)
  assert.deepEqual(sheets[0].map((b) => b.kind), ['entry', 'note'])
})

test('busy diary days split by whole section in reading order', () => {
  const sheets = diarySheetPlan({ summary:'Dear Diary, three badges. THREE. Also, 27 streams are on the record. Evidence below.', badges:[{},{},{}], moments:[{},{}] })
  assert.equal(sheets.length, 2)
  assert.deepEqual(sheets[0].map((b) => b.kind), ['entry', 'badges'])
  assert.deepEqual(sheets[1].map((b) => b.kind), ['moments', 'note'])
})

test('badge and moment groups stay intact instead of being height-clipped', () => {
  const sheets = diarySheetPlan({ summary:'A short entry', badges:[{},{},{},{}], moments:[{},{},{}] })
  const blocks = sheets.flat()
  assert.deepEqual(blocks.filter((b) => b.kind === 'badges').map((b) => [b.start,b.end]), [[0,3],[3,4]])
  assert.deepEqual(blocks.filter((b) => b.kind === 'moments').map((b) => [b.start,b.end]), [[0,2],[2,3]])
})

test('all earned badges survive pagination and keep badge priority', () => {
  const badges = Array.from({ length: 7 }, (_, i) => ({ id:i }))
  const sheets = diarySheetPlan({ summary:'Dear Diary, seven badges. This is getting serious.', badges, moments:[{},{}] })
  const badgeBlocks = sheets.flat().filter((b) => b.kind === 'badges')
  assert.deepEqual(badgeBlocks.map((b) => [b.start,b.end]), [[0,3],[3,6],[6,7]])
  assert.equal(badgeBlocks.reduce((sum, b) => sum + b.end - b.start, 0), badges.length)
  const ordered = sheets.flat().map((b) => b.kind)
  assert.ok(ordered.lastIndexOf('badges') < ordered.indexOf('moments'))
  assert.ok(ordered.indexOf('moments') < ordered.indexOf('note'))
})

test('diary themes are curated rather than free-form values', () => {
  assert.deepEqual(DIARY_THEMES.map((theme) => theme.id), ['oldworld', 'school90s', 'y2k', 'modern', 'future'])
  assert.equal(normalizeDiaryTheme('y2k'), 'y2k')
  assert.equal(normalizeDiaryTheme('#ff00ff'), null)
})

test('no-recorded, missing-art, opening, note and Pack fixtures stay available', () => {
  for (const state of ['none','missingart','join','longnote','pack','packopen']) assert.match(previewSource, new RegExp(`(?:state=)?['\"]?${state}`))
  assert.match(screenSource, /No entry recorded for this day\./)
  assert.match(screenSource, /artwork unavailable/i)
  assert.match(screenSource, /Read more/)
  assert.match(packSource, /Personal items/)
  assert.doesNotMatch(packSource, /ql-icon">📓/)
})

test('each diary era changes the physical sheet and closed cover treatment', () => {
  for (const theme of DIARY_THEMES) {
    assert.match(cssSource, new RegExp(`\\.dd-theme-${theme.id} \\.dd-paper`))
    assert.match(cssSource, new RegExp(`closed-diary-object\\.dd-theme-${theme.id}|\\.closed-diary-object\\.dd-theme-${theme.id}`))
  }
})

test('book transitions keep a reduced-motion path', () => {
  assert.match(screenSource, /prefersReducedMotion/)
  assert.match(cssSource, /prefers-reduced-motion:reduce/)
  assert.match(cssSource, /data-reduced-motion="true"/)
})

test('mobile diary geometry reserves the book edge and wraps badges without shrinking handwriting', () => {
  assert.match(cssSource, /\.dd-screen[^}]*width:min\(calc\(100% - 8px\),370px\)/s)
  assert.match(cssSource, /\.dd-screen[^}]*max-width:calc\(100vw - 32px\)/s)
  assert.match(cssSource, /\.dd-book::before[^}]*inset:-5px 0 -5px -4px/s)
  assert.match(cssSource, /@media\(max-width:350px\)[\s\S]*?\.dd-stickers\{grid-template-columns:repeat\(2,minmax\(0,92px\)\)\}/)
  assert.match(cssSource, /\.dd-summary p[^}]*clamp\(21px,6\.2vw,26px\)/s)
  assert.doesNotMatch(cssSource, /\.dd-stickers[^}]*overflow-x\s*:\s*(auto|scroll)/s)
})

test('decorations are capped at four per physical sheet and survive on other sheets', () => {
  const item = (sheet, slot, decoration_id = 'star') => ({ sheet, slot, decoration_id, size:'s' })
  const normalized = normalizeDiaryDecorations({ version:1, items:[
    item(0,'entry-leading'), item(0,'entry-trailing'), item(0,'badges-heading'), item(0,'footer-center'),
    item(0,'note-heading'), item(1,'moments-heading','organic'),
  ] })
  assert.equal(DIARY_DECORATION_LIMIT, 4)
  assert.equal(normalized.items.filter((entry) => entry.sheet === 0).length, 4)
  assert.deepEqual(normalized.items.filter((entry) => entry.sheet === 1), [item(1,'moments-heading','organic')])
})

test('invalid decoration ids, slots and duplicate placements are discarded', () => {
  const normalized = normalizeDiaryDecorations({ version:1, items:[
    { sheet:0, decoration_id:'not-real', slot:'entry-leading', size:'s' },
    { sheet:0, decoration_id:'star', slot:'raw-x-y', size:'s' },
    { sheet:0, decoration_id:'star', slot:'entry-leading', size:'m' },
    { sheet:0, decoration_id:'accent', slot:'entry-leading', size:'s' },
  ] })
  assert.deepEqual(normalized.items, [{ sheet:0, decoration_id:'star', slot:'entry-leading', size:'m' }])
})

test('safe slots are section-aware and no-entry sheets never accept decorations', () => {
  assert.deepEqual(diaryDecorationSlots([{ kind:'no-recorded' }]), [])
  assert.deepEqual(diaryDecorationSlots([{ kind:'entry' }, { kind:'badges' }]), ['entry-leading','entry-trailing','badges-heading','footer-center'])
  assert.ok(diaryDecorationSlots([{ kind:'moments' }, { kind:'note' }]).every((slot) => !/date|page-number|x|y/.test(slot)))
})

test('all five themes author the same stable decoration families', () => {
  assert.deepEqual(DIARY_DECORATION_FAMILIES.map((item) => item.id), ['organic','keepsake','star','mark','fastener','accent'])
  for (const theme of DIARY_THEMES) assert.match(screenSource, new RegExp(`${theme.id}: \\[`))
})

test('decoration controls preserve content systems and reduced motion', () => {
  assert.match(screenSource, /saveDearDiaryDecorations/)
  assert.match(screenSource, /data-decoration-slot/)
  assert.doesNotMatch(screenSource, /decoration[^\n]*(clientX|clientY|translate\([^)]*px)/i)
  assert.match(cssSource, /prefers-reduced-motion:reduce[\s\S]*?\.dd-decoration/)
})

test('Rewrite leaves decoration presentation metadata and provenance separate', () => {
  assert.match(migrationSource, /summary_snapshot jsonb[^\n]*\n\s*decorations jsonb/)
  assert.match(backendSource, /return \{ success: true, date,[^\n]*decorations: storedDiaryDecorations\(existing\?\.decorations\)/)
  const saver = backendSource.slice(backendSource.indexOf('export async function saveDearDiaryDecorations'), backendSource.indexOf('export async function getDearDiaryPreference'))
  assert.match(saver, /\.update\(\{ decorations: checked\.decorations, updated_at:/)
  assert.doesNotMatch(saver, /summary_snapshot|summary_text|_candidates|provenance/)
})
