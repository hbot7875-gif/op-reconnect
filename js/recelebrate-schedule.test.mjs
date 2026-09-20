// node --test js/recelebrate-schedule.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WATCH_SCHEDULE, watchScheduleStates, fmtScheduleTime, defaultStageEvent, premiereFor, fmtCountdown } from './recelebrate-schedule.js'

const PARTY_END = '2026-09-21T04:00:00.000Z'
const at = (ist) => new Date(`${ist}+05:30`).getTime()
const states = (ist) => watchScheduleStates(at(ist), { partyEndsAtIso: PARTY_END }).map((s) => `${s.id}:${s.state}`)

test('the day, in order: SWIM, the 10:55 intro, COMEBACK LIVE, then GOYANG', () => {
  assert.deepEqual(WATCH_SCHEDULE.map((s) => [s.title, fmtScheduleTime(s.startsAtIso)]), [
    ['SWIM', '9:30 AM'], ['COMEBACK LIVE INTRO', '10:55 AM'], ['COMEBACK LIVE', '11:00 AM'], ['GOYANG', '6:00 PM'],
  ])
})

test('doors open (9:00): SWIM is up next, the rest later', () => {
  assert.deepEqual(states('2026-09-20T09:00'), ['swim:next', 'comeback-intro:later', 'comeback-live:later', 'goyang:later'])
})

test('each start makes that item NOW and the previous one a REPLAY', () => {
  assert.deepEqual(states('2026-09-20T09:29:59'), ['swim:next', 'comeback-intro:later', 'comeback-live:later', 'goyang:later'])
  assert.deepEqual(states('2026-09-20T09:30'), ['swim:now', 'comeback-intro:next', 'comeback-live:later', 'goyang:later'])
  assert.deepEqual(states('2026-09-20T10:55'), ['swim:replay', 'comeback-intro:now', 'comeback-live:next', 'goyang:later'])
  assert.deepEqual(states('2026-09-20T11:00'), ['swim:replay', 'comeback-intro:replay', 'comeback-live:now', 'goyang:next'])
  assert.deepEqual(states('2026-09-20T18:00'), ['swim:replay', 'comeback-intro:replay', 'comeback-live:replay', 'goyang:now'])
})

test('nothing is ever removed; after the party every item is a REPLAY', () => {
  const end = states('2026-09-21T09:30')
  assert.equal(end.length, 4)
  assert.deepEqual(end, ['swim:replay', 'comeback-intro:replay', 'comeback-live:replay', 'goyang:replay'])
})

test('a known end time is used instead of the next start', () => {
  const items = [{ ...WATCH_SCHEDULE[0], endsAtIso: '2026-09-20T04:45:00.000Z' }, ...WATCH_SCHEDULE.slice(1)]
  const s = watchScheduleStates(at('2026-09-20T10:20'), { items, partyEndsAtIso: PARTY_END })
  assert.deepEqual(s.map((x) => x.state), ['replay', 'next', 'later', 'later'])
})

test('state comes from the timestamp alone, so a refresh gives the same answer', () => {
  const t = at('2026-09-20T12:34:56')
  assert.deepEqual(watchScheduleStates(t, { partyEndsAtIso: PARTY_END }), watchScheduleStates(t, { partyEndsAtIso: PARTY_END }))
})

test('videos: SWIM, the pre-show intro, COMEBACK LIVE and GOYANG use their authored sources', () => {
  const v = Object.fromEntries(WATCH_SCHEDULE.map((s) => [s.id, s.video]))
  assert.deepEqual(v.swim, { kind: 'video', youtubeId: 'b4iVv91Z6lY', track: 'SWIM' })
  assert.deepEqual(v['comeback-intro'], { kind: 'video', youtubeId: 'd5NlnTQ_W_8' })
  assert.deepEqual(v['comeback-live'], { kind: 'playlist' })
  assert.deepEqual(v.goyang, { kind: 'list', listId: 'PLSvbD_xz9XGADdXCKhhpcdvH25SEeUCZ9', firstVideoId: 'BRzkjoWq15g' })
})

test('the stage follows the live event, else the next one, else the latest replay', () => {
  const pick = (ist) => defaultStageEvent(watchScheduleStates(at(ist), { partyEndsAtIso: PARTY_END }), at(ist)).id
  assert.equal(pick('2026-09-20T09:05'), 'swim')
  assert.equal(pick('2026-09-20T10:00'), 'swim')
  assert.equal(pick('2026-09-20T10:55'), 'comeback-intro')
  assert.equal(pick('2026-09-20T10:59:59'), 'comeback-intro')
  assert.equal(pick('2026-09-20T11:00'), 'comeback-live')
  assert.equal(pick('2026-09-20T18:30'), 'goyang')
  assert.equal(pick('2026-09-21T10:00'), 'goyang')
})

test('premiere countdown: the last 15 minutes before each start, from the real clock', () => {
  const p = (ist) => {
    const r = premiereFor(watchScheduleStates(at(ist), { partyEndsAtIso: PARTY_END }), at(ist))
    return r && `${r.item.id} ${fmtCountdown(r.msLeft)}`
  }
  assert.equal(p('2026-09-20T09:00'), null)            // doors open, 30 min out
  assert.equal(p('2026-09-20T09:14:59'), null)
  assert.equal(p('2026-09-20T09:15'), 'swim 15:00')
  assert.equal(p('2026-09-20T09:22:30'), 'swim 07:30')   // arriving mid-countdown
  assert.equal(p('2026-09-20T09:29:59.4'), 'swim 00:01')
  assert.equal(p('2026-09-20T09:30'), null)             // it's on
  assert.equal(p('2026-09-20T10:50'), 'comeback-intro 05:00')
  assert.equal(p('2026-09-20T10:55'), 'comeback-live 05:00')
  assert.equal(p('2026-09-20T17:45'), 'goyang 15:00')
  assert.equal(p('2026-09-20T18:00'), null)
})

test('during a countdown the stage shows the premiering event', () => {
  const pick = (ist) => defaultStageEvent(watchScheduleStates(at(ist), { partyEndsAtIso: PARTY_END }), at(ist)).id
  assert.equal(pick('2026-09-20T10:39'), 'swim')
  assert.equal(pick('2026-09-20T10:40'), 'comeback-intro')
  assert.equal(pick('2026-09-20T10:55'), 'comeback-intro')
})
