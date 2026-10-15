import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { districtDeadline, lapseChoiceOpen, LAPSE_CHOICE_DAYS } from './districts.ts'

const DAY = 86400000
const startedDaysAgo = (days) => new Date(Date.now() - days * DAY).toISOString()

test('a live attempt is never held for a lapse choice', () => {
  assert.equal(lapseChoiceOpen(districtDeadline(startedDaysAgo(6), 7), false, 5), false)
})

test('a lapsed attempt waits for the choice while a charge can rescue it', () => {
  assert.equal(lapseChoiceOpen(districtDeadline(startedDaysAgo(7.5), 7), false, 1), true)
})

test('no charge, an extension already used, or the choice window gone all reset', () => {
  const lapsed = districtDeadline(startedDaysAgo(7.5), 7)
  assert.equal(lapseChoiceOpen(lapsed, false, 0), false)
  assert.equal(lapseChoiceOpen(lapsed, true, 3), false)
  assert.equal(lapseChoiceOpen(districtDeadline(startedDaysAgo(7 + LAPSE_CHOICE_DAYS + 0.1), 7), false, 3), false)
})

test('extending a lapsed attempt gives 3 days from the tap, via support hours', () => {
  const src = readFileSync(new URL('./handlers.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function extendDistrictDeadline'), src.indexOf('export async function resetLapsedDistrict'))
  assert.match(fn, /deadline_extension_hours: supportHours \+ lateHours/)
  assert.match(fn, /lateHours > LAPSE_CHOICE_DAYS \* 24\) return \{ success: false, error: 'already_expired' \}/)
  // The deadline that maths produces: original 7 days + 3 + hours spent lapsed.
  const activatedAt = startedDaysAgo(8)
  const lateHours = 24
  const extended = districtDeadline(activatedAt, 7, 3 + lateHours / 24)
  assert.ok(Math.abs(extended.msLeft - 3 * DAY) < 60000)
})

test('reset refuses an attempt still inside its deadline', () => {
  const src = readFileSync(new URL('./handlers.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function resetLapsedDistrict'))
  assert.match(fn, /if \(!deadline\.expired\) return \{ success: false, error: 'not_expired' \}/)
})
