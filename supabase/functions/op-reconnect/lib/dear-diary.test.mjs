import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countedDiaryTracks, diaryBadgeFact, diarySummary, diarySummaryChoice,
  factsFromFrozenSnapshot, isCountedDiaryScrobble, isNoRecordedHistoricalDay,
  validateDiaryDecorations,
} from './dear-diary.ts'

const empty = { xp:0, streams:0, badges:[], completedDistricts:[], moments:[] }

test('mixed diary copy uses supplied facts without motivational filler', () => {
  const text = diarySummary({ ...empty, xp:180, streams:27, badges:[{ badgeId:'b', name:'Moon Badge', reason:'Reason', artworkUrl:null, rarity:'common' }] }, 2)
  assert.match(text, /(Moon Badge|27 streams|180 XP)/)
  assert.doesNotMatch(text, /main-character|productive day|proud of myself|amazing journey/i)
})

test('diary has a deadpan quiet state', () => {
  const text = diarySummary(empty, 0)
  assert.match(text, /^Dear Diary,/)
  assert.match(text.toLowerCase(), /(nothing happened|quiet|no major|not much|day off|0 badges)/)
})

test('category copy names the real badge and agent', () => {
  const badge = diarySummary({ ...empty, badges:[{ badgeId:'b', name:'Recovered Memory', reason:'Reason', artworkUrl:null, rarity:'common' }] }, 1)
  const help = diarySummary({ ...empty, moments:[{ kind:'helped-me', text:'Agent Moon helped me.', agentName:'Moon' }] }, 0)
  assert.match(badge, /Recovered Memory/)
  assert.match(help, /Agent Moon/)
})

test('copy selection is deterministic and avoids a recently used template key', () => {
  const first = diarySummaryChoice({ ...empty, streams:27 }, 0)
  const same = diarySummaryChoice({ ...empty, streams:27 }, 0)
  const next = diarySummaryChoice({ ...empty, streams:27 }, 0, [first.key])
  assert.deepEqual(first, same)
  assert.notEqual(next.key, first.key)
})

test('every authored summary stays short enough for the physical first sheet', () => {
  const facts = { ...empty, xp:180, streams:27, badges:[
    { badgeId:'a', name:'Recovered Memory', reason:'Reason', artworkUrl:null, rarity:'common' },
    { badgeId:'b', name:'Mission Bond', reason:'Reason', artworkUrl:null, rarity:'rare' },
  ], completedDistricts:[{ id:'moon', name:'Moon Station' }], moments:[{ kind:'helped-me', text:'Agent Moon helped.', agentName:'Moon' }] }
  for (let seed = 0; seed < 30; seed++) {
    const text = diarySummary(facts, seed)
    assert.ok(text.length <= 150, `${text.length} chars: ${text}`)
    assert.doesNotMatch(text, /choosing peace|page is still a page|main-character|proud of myself|amazing journey|that is the report|that is the update|new badge acquired/i)
  }
})

test('unsupported historical dates become no-recorded-entry without quiet prose', () => {
  assert.equal(isNoRecordedHistoricalDay('2026-10-03', 'none', '', '2026-10-11'), true)
  assert.equal(isNoRecordedHistoricalDay('2026-10-03', 'none', 'my note', '2026-10-11'), false)
  assert.equal(isNoRecordedHistoricalDay('2026-10-11', 'none', '', '2026-10-11'), false)
})

test('frozen rewrite keeps structured district facts intact', () => {
  const stored = { xp:50, streams:0, badges:[], completedDistricts:[{ id:'moon', name:'Moon Station' }], moments:[] }
  const facts = factsFromFrozenSnapshot(stored)
  const before = JSON.stringify(facts)
  const text = diarySummary(facts, 4)
  assert.match(text, /Moon Station/)
  assert.equal(JSON.stringify(facts), before)
  assert.deepEqual(facts.completedDistricts, stored.completedDistricts)
})

test('a real badge survives missing artwork and badge id text never implies retroactivity', () => {
  const fact = diaryBadgeFact(
    { badge_id:'retro_backfill:real', artwork_id:99, earned_at:'2026-10-04T03:00:00Z' },
    { name:'Recovered Memory', rarity:'rare', unlock_hint:'Restored a district.' },
    null,
  )
  assert.equal(fact.badge.artworkUrl, null)
  assert.equal(fact.badge.name, 'Recovered Memory')
  assert.equal(fact.badge.earnedAt, '2026-10-04T03:00:00Z')
  assert.equal(fact.title, 'Earned the Recovered Memory badge.')
  assert.doesNotMatch(fact.badge.reason + fact.title, /retro|earlier|backfill/i)
})

test('non-counted tracks cannot create listening diary facts', () => {
  const bucket = {
    swim: { n:3, a:{ bts:3 } },
    unrelated: { n:40, a:{ 'other artist':40 } },
  }
  assert.deepEqual(countedDiaryTracks(bucket, ['bts']), [{ key:'swim', count:3 }])
  assert.equal(isCountedDiaryScrobble({ track_name:'SWIM', artist_name:'BTS' }, ['bts']), true)
  assert.equal(isCountedDiaryScrobble({ track_name:'Unrelated', artist_name:'Other Artist' }, ['bts']), false)
})

test('decoration persistence accepts semantic metadata only', () => {
  const checked = validateDiaryDecorations({ version:1, items:[
    { sheet:0, decoration_id:'star', slot:'entry-leading', size:'s' },
    { sheet:1, decoration_id:'organic', slot:'moments-heading', size:'m' },
  ] })
  assert.equal(checked.success, true)
  assert.deepEqual(checked.success && checked.decorations.items[1], { sheet:1, decoration_id:'organic', slot:'moments-heading', size:'m' })
})

test('invalid decoration ids, slots, sizes and per-sheet overflow fail closed', () => {
  const base = { sheet:0, decoration_id:'star', slot:'entry-leading', size:'s' }
  assert.equal(validateDiaryDecorations({ version:1, items:[{ ...base, decoration_id:'emoji-heart' }] }).success, false)
  assert.equal(validateDiaryDecorations({ version:1, items:[{ ...base, slot:'x:12,y:40' }] }).success, false)
  assert.equal(validateDiaryDecorations({ version:1, items:[{ ...base, size:'xl' }] }).success, false)
  assert.equal(validateDiaryDecorations({ version:1, items:['entry-leading','entry-trailing','badges-heading','moments-heading','note-heading'].map((slot) => ({ ...base, slot })) }).success, false)
})

test('decorations stay separate from frozen facts and provenance', () => {
  const snapshot = { xp:10, streams:2, badges:[], completedDistricts:[], moments:[], _candidates:[{ source:{ table:'rc_feed_events', id:'1' } }] }
  const before = JSON.stringify(snapshot)
  factsFromFrozenSnapshot(snapshot)
  validateDiaryDecorations({ version:1, items:[{ sheet:0, decoration_id:'star', slot:'entry-leading', size:'s' }] })
  assert.equal(JSON.stringify(snapshot), before)
})

test('join day opens as the first-agent page and self-heals a stale frozen snapshot', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('./dear-diary.ts', import.meta.url), 'utf8')
  const getter = source.slice(source.indexOf('export async function getDearDiary'), source.indexOf('export async function getDearDiaryArchive'))
  assert.match(getter, /sb\.from\('rc_players'\)\.select\('joined_at'\)/)
  assert.match(getter, /const staleJoin = isJoinDay && existing\?\.summary_snapshot\?\._frozen === true/)
  assert.match(getter, /const frozen = existing\?\.summary_snapshot\?\._frozen === true && !staleJoin/)
  assert.match(getter, /const join = isJoinDay \|\| candidates\.some/)
  assert.match(getter, /'Dear Diary, today I became an agent\.'/)
})
