// A teammate who stops counting is told WHY: only a lapse is "ran out of
// time". A Home Base helper who finished Home Base was told they'd run out of
// time (AGENT298, AGENT294, Nov 2026).
import assert from 'node:assert/strict'
import test from 'node:test'
import { leftReasonFor } from './reconnect-missions.ts'

test('finished the district they joined from', () => {
  assert.deepEqual(leftReasonFor('mono-urmi-terrace', ['relay-zero-hq'], [{ district_id: 'relay-zero-hq' }]), { reason: 'finished', from: 'relay-zero-hq' })
})
test('finished this district', () => {
  assert.deepEqual(leftReasonFor('mono-urmi-terrace', ['relay-zero-hq'], [{ district_id: 'mono-urmi-terrace' }]), { reason: 'restored_here', from: 'mono-urmi-terrace' })
})
test('any-district team, nothing active', () => {
  assert.deepEqual(leftReasonFor('relay-zero-hq', ['*'], []), { reason: 'no_district', from: null })
})
test('otherwise it really lapsed', () => {
  assert.deepEqual(leftReasonFor('mono-urmi-terrace', ['relay-zero-hq'], []), { reason: 'lapsed', from: null })
  assert.deepEqual(leftReasonFor('mono-hopesize-station', [], [{ district_id: 'relay-zero-hq' }]), { reason: 'lapsed', from: null })
})
