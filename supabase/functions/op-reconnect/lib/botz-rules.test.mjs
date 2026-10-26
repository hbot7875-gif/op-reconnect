import assert from 'node:assert/strict'
import test from 'node:test'
import { annotateBotzStreams, botzDistrictStillNeeded, botzSourceSetup, botzTrackingState } from './botz-rules.js'

const jam = (track, at = 100) => ({ track, key: track.toLowerCase(), at, eligible: true })

test('district credit stops when the real remaining target is filled', () => {
  const rows = [jam('SWIM', 1), jam('SWIM', 2)]
  annotateBotzStreams(rows, { district: { id: 'map7', label: 'Map of Seven Crossing', activeFrom: 0, trackSlots: [{ keys: ['swim'], remaining: 1 }], albums: [] } })
  assert.equal(rows[0].attributions[0].kind, 'district')
  assert.deepEqual(rows[1].attributions, [])
  assert.equal(rows[1].nonCreditReason, 'goal_complete')
})

test('birthday credit uses the configured per-track light limit', () => {
  const rows = [jam('Euphoria', 1), jam('Euphoria', 2), jam('Euphoria', 3)]
  annotateBotzStreams(rows, { birthday: { id: 'jk', label: 'GOLDEN Birthday', activeFrom: 0, activeTo: 10, slots: [{ keys: ['euphoria'], credited: 0, limit: 2 }] } })
  assert.equal(rows[0].attributions[0].kind, 'birthday')
  assert.equal(rows[1].attributions[0].kind, 'birthday')
  assert.deepEqual(rows[2].attributions, [])
  assert.equal(rows[2].nonCreditReason, 'goal_complete')
})

test('one jam may truthfully help both active systems', () => {
  const rows = [jam('SWIM', 5)]
  annotateBotzStreams(rows, {
    district: { id: 'd', label: 'District', activeFrom: 0, trackSlots: [{ keys: ['swim'], remaining: 1 }], albums: [] },
    birthday: { id: 'b', label: 'Birthday', activeFrom: 0, activeTo: 10, slots: [{ keys: ['swim'], credited: 0, limit: 1 }] },
  })
  assert.deepEqual(rows[0].attributions.map((item) => item.kind), ['birthday', 'district'])
})

test('eligible no-mission and ineligible jams are never mislabeled as helped', () => {
  const eligible = jam('Not assigned')
  const ineligible = { ...jam('Other artist'), eligible: false }
  annotateBotzStreams([eligible, ineligible], {})
  assert.deepEqual(eligible.attributions, [])
  assert.equal(eligible.nonCreditReason, 'not_active_goal')
  assert.deepEqual(ineligible.attributions, [])
  assert.equal(ineligible.nonCreditReason, null)
})

test('a matching jam before district activation explains why it was not credited', () => {
  const row = jam('Haegeum', 5)
  annotateBotzStreams([row], { district: { id: 'map7', label: 'Map of Seven Crossing', activeFrom: 10, trackSlots: [{ keys: ['haegeum'], remaining: 3 }], albums: [] } })
  assert.deepEqual(row.attributions, [])
  assert.equal(row.nonCreditReason, 'before_mission_started')
})

test('all four providers and incomplete setup resolve truthfully', () => {
  assert.deepEqual(botzSourceSetup({ stream_source_preference: 'lb', lb_username: 'army' }), { source: 'listenbrainz', setupOk: true })
  assert.deepEqual(botzSourceSetup({ stream_source_preference: 'direct', scrobble_pin: '1234' }), { source: 'direct', setupOk: true })
  assert.deepEqual(botzSourceSetup({ stream_source_preference: 'statsfm', statsfm_username: 'army' }), { source: 'statsfm', setupOk: true })
  assert.deepEqual(botzSourceSetup({ stream_source_preference: 'musicat', musicat_public_id: 'abc' }), { source: 'musicat', setupOk: true })
  assert.equal(botzSourceSetup({ stream_source_preference: 'lb' }).setupOk, false)
})

test('tracking state separates quiet accounts from failed checks', () => {
  assert.equal(botzTrackingState({ setupOk: true, checkOk: true, hasRecent: true }), 'receiving')
  assert.equal(botzTrackingState({ setupOk: true, checkOk: true, hasRecent: false }), 'connected_no_recent')
  assert.equal(botzTrackingState({ setupOk: true, checkOk: false, hasRecent: false }), 'check_failed')
  assert.equal(botzTrackingState({ setupOk: false, checkOk: true, hasRecent: false }), 'needs_setup')
})

test('still-needed lists what is left after the jams are spent', () => {
  const district = {
    id: 'zeal', label: 'Zeal Arcade', activeFrom: 0,
    trackSlots: [{ keys: ['swim'], label: 'SWIM', remaining: 1 }, { keys: ['normal'], label: 'Normal', remaining: 3 }],
    albums: [{
      label: 'Keep Swimming', target: 7, cap: 7, bonus: 0,
      slots: [{ keys: ['swim with jin'], label: 'SWIM with Jin', have: 6 }, { keys: ['swim with v'], label: 'SWIM with V', have: 8 }],
    }],
  }
  const out = {}
  annotateBotzStreams([jam('SWIM', 1), jam('Normal', 2)], { district }, out)
  assert.deepEqual(botzDistrictStillNeeded(out.district), {
    items: [{ label: 'SWIM with Jin', plays: 1, album: 'Keep Swimming' }, { label: 'Normal', plays: 2 }],
    total: 2,
  })
  // The caller's context is never mutated.
  assert.equal(district.trackSlots[0].remaining, 1)
})

test('still-needed is empty once every goal is filled', () => {
  const district = { trackSlots: [{ keys: ['swim'], label: 'SWIM', remaining: 0 }], albums: [{ label: 'A', target: 3, cap: 3, bonus: 1, slots: [{ label: 'x', have: 2 }] }] }
  assert.deepEqual(botzDistrictStillNeeded(district), { items: [], total: 0 })
  assert.deepEqual(botzDistrictStillNeeded(null), { items: [], total: 0 })
})
