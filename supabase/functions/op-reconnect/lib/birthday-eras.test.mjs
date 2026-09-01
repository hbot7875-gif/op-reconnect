import assert from 'node:assert/strict'
import { BIRTHDAY_ERA_EVENTS, activeWeeklyBirthdayEras, isWeeklyBirthdayEraId } from './birthday-eras.ts'

assert.equal(activeWeeklyBirthdayEras('2026-09-01').length, 0,
  'the reusable weekly card must not compete with the one-day keepsake')
assert.deepEqual(activeWeeklyBirthdayEras('2026-09-07').map((era) => era.id), ['golden'],
  'GOLDEN should become a normal weekly Era Card the following Monday')
assert.equal(isWeeklyBirthdayEraId('golden', '2026-09-07'), true)
assert.equal(isWeeklyBirthdayEraId('jk-golden-birthday-2026', '2026-09-07'), false,
  'a permanent keepsake must never be spendable as a weekly card')

const eventIds = BIRTHDAY_ERA_EVENTS.map((event) => event.id)
const weeklyIds = BIRTHDAY_ERA_EVENTS.map((event) => event.weeklyEra.id)
assert.equal(new Set(eventIds).size, eventIds.length, 'birthday event ids must be unique')
assert.equal(new Set(weeklyIds).size, weeklyIds.length, 'weekly birthday Era ids must be unique')

const golden = BIRTHDAY_ERA_EVENTS[0]
assert.equal(golden.tracks.length, 11)
assert.equal(golden.weeklyEra.tracks.length, 11)
assert.equal(golden.tracks.filter((title) => title.startsWith('Seven')).length, 2,
  'both GOLDEN Seven versions remain separate album slots')

console.log('birthday-eras: 9 tests passed')
