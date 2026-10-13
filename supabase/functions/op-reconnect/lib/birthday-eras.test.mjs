import assert from 'node:assert/strict'
import { BIRTHDAY_ERA_EVENTS, activeWeeklyBirthdayEras, isWeeklyBirthdayEraId } from './birthday-eras.ts'

assert.equal(activeWeeklyBirthdayEras('2026-09-01').length, 0,
  'the reusable weekly card must not compete with the one-day keepsake')
assert.deepEqual(activeWeeklyBirthdayEras('2026-09-07').map((era) => era.id), ['golden'],
  'GOLDEN should become a normal weekly Era Card the following Monday')
assert.deepEqual(activeWeeklyBirthdayEras('2026-10-19').map((era) => era.id), ['golden', 'muse'],
  'MUSE should become a normal weekly Era Card the Monday after Jimin’s birthday')
assert.equal(isWeeklyBirthdayEraId('golden', '2026-09-07'), true)
assert.equal(isWeeklyBirthdayEraId('muse', '2026-10-19'), true)
assert.equal(isWeeklyBirthdayEraId('jk-golden-birthday-2026', '2026-09-07'), false,
  'a permanent keepsake must never be spendable as a weekly card')

const eventIds = BIRTHDAY_ERA_EVENTS.map((event) => event.id)
const weeklyIds = BIRTHDAY_ERA_EVENTS.map((event) => event.weeklyEra.id)
assert.equal(new Set(eventIds).size, eventIds.length, 'birthday event ids must be unique')
assert.equal(new Set(weeklyIds).size, weeklyIds.length, 'weekly birthday Era ids must be unique')

const golden = BIRTHDAY_ERA_EVENTS[0]
assert.equal(golden.tracks.length, 13)
assert.equal(golden.weeklyEra.tracks.length, 13)
assert.ok(golden.tracks.includes('Euphoria'))
assert.ok(golden.tracks.includes('SWIM with Jung Kook (Acoustic Lofi Remix)'))
assert.equal(golden.tracks.filter((title) => title.startsWith('Seven')).length, 2,
  'both GOLDEN Seven versions remain separate album slots')

const muse = BIRTHDAY_ERA_EVENTS.find((event) => event.id === 'jimin-muse-birthday-2026')
assert.ok(muse, 'Jimin’s birthday event should be configured')
assert.equal(muse.date, '2026-10-13')
assert.deepEqual(muse.albums, ['MUSE'])
assert.equal(muse.badgeTemplateId, 'event_jimin_birthday_2026')
assert.equal(muse.tracks.length, 9)
assert.ok(muse.tracks.includes('Closer Than This'))
assert.ok(muse.tracks.includes('SWIM with Jimin (Slow Jam R&B Remix)'))
assert.ok(muse.tracks.includes('Serendipity (Full Length Edition)'))
assert.equal(muse.tracks.filter((title) => title === 'Closer Than This').length, 1,
  'Closer Than This is already on MUSE and must not become a duplicate slot')

console.log('birthday-eras: 22 tests passed')
