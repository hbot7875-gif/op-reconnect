import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countRedZoneRows, redZoneUnixBounds, isDefender, isQualifiedDefender, redZoneBand,
  interpolateBombColor, blackoutChargeValue, blackoutShouldReset, validateDefuseLaunch,
  redZoneTargetKeySet, redZoneTrackCounts, validateRedZoneTarget, normalizeTargetNames,
} from './red-zone.js'

test('window excludes streams from the launch second that happened before launch', () => {
  const bounds = redZoneUnixBounds('2026-08-30T06:00:00.750Z', '2026-08-30T07:00:00.750Z', Date.parse('2026-08-30T06:30:00Z'))
  assert.equal(bounds.fromInclusive, 1788069601)
  assert.equal(bounds.untilExclusive, 1788071400)
  assert.equal(bounds.expired, false)
})

test('deadline is exclusive and freezes the upper bound after expiry', () => {
  const bounds = redZoneUnixBounds('2026-08-30T06:00:00Z', '2026-08-30T07:00:00Z', Date.parse('2026-08-30T08:00:00Z'))
  assert.equal(bounds.fromInclusive, 1788069600)
  assert.equal(bounds.untilExclusive, 1788073200)
  assert.equal(bounds.expired, true)
})

test('sub-minimum agents stay visible but do not move shared progress', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ agent_no: 'AGENT001', listened_at: i + 1 }))
  const result = countRedZoneRows(rows, 100, 7)
  assert.equal(result.progress, 0)
  assert.equal(result.qualifiedAgents, 0)
  assert.equal(result.perAgent.get('AGENT001'), 6)
})

test('the qualifying stream releases the full minimum', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ agent_no: 'AGENT001', listened_at: i + 1 }))
  const result = countRedZoneRows(rows, 100, 7)
  assert.equal(result.progress, 7)
  assert.equal(result.qualifiedAgents, 1)
})

test('counting stops on the row that reaches the target', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ agent_no: 'AGENT001', listened_at: i + 1 })),
    ...Array.from({ length: 7 }, (_, i) => ({ agent_no: 'AGENT002', listened_at: i + 20 })),
    { agent_no: 'AGENT001', listened_at: 99 },
  ]
  const result = countRedZoneRows(rows, 10, 7)
  assert.equal(result.progress, 10)
  assert.equal(result.rawProgress, 14)
  assert.equal(result.reachedAt, 26)
  assert.equal(result.perAgent.get('AGENT001'), 7)
  assert.equal(result.perAgent.get('AGENT002'), 7)
})

test('ineligible rows never affect personal or shared progress', () => {
  const rows = [
    { agent_no: 'AGENT001', listened_at: 1, allowed: false },
    ...Array.from({ length: 7 }, (_, i) => ({ agent_no: 'AGENT001', listened_at: i + 2, allowed: true })),
  ]
  const result = countRedZoneRows(rows, 100, 7, (row) => row.allowed)
  assert.equal(result.progress, 7)
  assert.equal(result.perAgent.get('AGENT001'), 7)
})

// ── Defender / qualification thresholds ─────────────────────────────────

test('0 streams is not a Defender', () => {
  assert.equal(isDefender(0), false)
  assert.equal(isQualifiedDefender(0, 7), false)
})

test('1-6 streams is a Defender but not XP-qualified', () => {
  for (let n = 1; n <= 6; n++) {
    assert.equal(isDefender(n), true, `${n} should be a Defender`)
    assert.equal(isQualifiedDefender(n, 7), false, `${n} should not qualify yet`)
  }
})

test('7+ streams is a Defender and qualified', () => {
  assert.equal(isDefender(7), true)
  assert.equal(isQualifiedDefender(7, 7), true)
  assert.equal(isQualifiedDefender(18, 7), true)
})

// ── Progress bands ───────────────────────────────────────────────────────

test('progress bands match the visual states', () => {
  assert.equal(redZoneBand(0, 1000), 'compromised')
  assert.equal(redZoneBand(240, 1000), 'compromised')
  assert.equal(redZoneBand(250, 1000), 'restoring')
  assert.equal(redZoneBand(640, 1000), 'restoring')
  assert.equal(redZoneBand(899, 1000), 'restoring')
  assert.equal(redZoneBand(900, 1000), 'final-push')
  assert.equal(redZoneBand(999, 1000), 'final-push')
  assert.equal(redZoneBand(1000, 1000), 'restored')
  assert.equal(redZoneBand(1200, 1000), 'restored')
})

// ── Color interpolation ──────────────────────────────────────────────────

test('bomb color interpolates from crimson to purple with progress', () => {
  const crimson = '#e5384f', purple = '#8b5cf6'
  assert.equal(interpolateBombColor(0, 1000, crimson, purple), 'rgb(229, 56, 79)')
  assert.equal(interpolateBombColor(1000, 1000, crimson, purple), 'rgb(139, 92, 246)')
  const half = interpolateBombColor(500, 1000, crimson, purple)
  assert.match(half, /^rgb\(\d+, \d+, \d+\)$/)
  assert.notEqual(half, 'rgb(229, 56, 79)')
  assert.notEqual(half, 'rgb(139, 92, 246)')
})

// ── Blackout ──────────────────────────────────────────────────────────────

test('blackout charge value is always exactly now, never backdated', () => {
  const now = Date.parse('2026-08-30T12:00:00Z')
  assert.equal(blackoutChargeValue(now), '2026-08-30T12:00:00.000Z')
})

test('blackout only resets an agent whose charge is currently in the future', () => {
  const now = Date.parse('2026-08-30T12:00:00Z')
  assert.equal(blackoutShouldReset('2026-08-30T15:00:00Z', now), true, 'future charge should reset')
  assert.equal(blackoutShouldReset('2026-08-30T09:00:00Z', now), false, 'already-dark agent must be left alone')
  assert.equal(blackoutShouldReset(null, now), false, 'never-fed agent must be left alone')
  assert.equal(blackoutShouldReset('2026-08-30T12:00:00Z', now), false, 'exactly now is not in the future')
})

// ── Launch validation ────────────────────────────────────────────────────

test('valid launch params pass', () => {
  const result = validateDefuseLaunch({ target: 1000, hours: 24, rewardXp: 500, title: 'RED ZONE', message: 'Stream now.' })
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('invalid target/hours/rewardXp are rejected, not clamped', () => {
  assert.equal(validateDefuseLaunch({ target: 0, hours: 24, rewardXp: 500 }).valid, false)
  assert.equal(validateDefuseLaunch({ target: 1.5, hours: 24, rewardXp: 500 }).valid, false)
  assert.equal(validateDefuseLaunch({ target: 1000, hours: 0, rewardXp: 500 }).valid, false)
  assert.equal(validateDefuseLaunch({ target: 1000, hours: 100, rewardXp: 500 }).valid, false)
  assert.equal(validateDefuseLaunch({ target: 1000, hours: 24, rewardXp: -5 }).valid, false)
  assert.equal(validateDefuseLaunch({ target: 1000, hours: 24, rewardXp: 500, title: 'x'.repeat(200) }).valid, false)
})

test('missing params are rejected rather than defaulted', () => {
  const result = validateDefuseLaunch({})
  assert.equal(result.valid, false)
  assert.equal(result.errors.length, 3)
})


test('an event with no streaming target counts every eligible play, as it always did', () => {
  // null (the column's default and every pre-existing row) and an empty
  // array must behave identically: an event counting nothing is unwinnable.
  for (const keys of [null, undefined, [], ['', '   ']]) {
    const set = redZoneTargetKeySet(keys)
    assert.equal(set, null)
    assert.equal(redZoneTrackCounts(set, 'haegeum'), true)
    assert.equal(redZoneTrackCounts(set, 'literally anything'), true)
  }
})

test('a targeted event counts only its own frozen keys', () => {
  const set = redZoneTargetKeySet(['haegeum', 'arirang'])
  assert.equal(redZoneTrackCounts(set, 'haegeum'), true)
  assert.equal(redZoneTrackCounts(set, 'arirang'), true)
  assert.equal(redZoneTrackCounts(set, 'dynamite'), false)
  // A row with no usable track name must never slip through the filter.
  assert.equal(redZoneTrackCounts(set, ''), false)
  assert.equal(redZoneTrackCounts(set, null), false)
})

test('a target is all-or-nothing, matching the DB constraint', () => {
  const none = validateRedZoneTarget(null)
  assert.equal(none.valid, true)
  assert.deepEqual(none.value, { kind: null, label: null, keys: null, names: null })

  const ok = validateRedZoneTarget({ kind: 'album', label: 'ARIRANG', keys: ['arirang', 'track two'] })
  assert.equal(ok.valid, true)
  assert.deepEqual(ok.value, { kind: 'album', label: 'ARIRANG', keys: ['arirang', 'track two'], names: null })

  // Keys that all normalize away would silently count nothing — refuse the
  // launch instead of shipping an unwinnable event.
  assert.equal(validateRedZoneTarget({ kind: 'track', label: 'Haegeum', keys: [] }).valid, false)
  assert.equal(validateRedZoneTarget({ kind: 'track', label: '', keys: ['haegeum'] }).valid, false)
  assert.equal(validateRedZoneTarget({ kind: 'reconnect', label: 'Cipher', keys: ['x'] }).valid, false)
  // The cap is 240 now, not 120: several picks join into one stored label
  // ("ARIRANG + Keep Swimming + …") and 120 cut real combinations off.
  assert.equal(validateRedZoneTarget({ kind: 'track', label: 'x'.repeat(200), keys: ['x'] }).valid, true)
  assert.equal(validateRedZoneTarget({ kind: 'track', label: 'x'.repeat(241), keys: ['x'] }).valid, false)
})

test('several picks roll up into one target, and only all-albums stays "album"', () => {
  const mixed = validateRedZoneTarget({
    label: 'ARIRANG + Keep Swimming',
    keys: ['arirang', 'track two', 'keep swimming'],
    names: [{ name: 'ARIRANG', kind: 'album' }, { name: 'Keep Swimming', kind: 'track' }],
  })
  assert.equal(mixed.valid, true)
  // One track in the set means the event is not counting "album streams".
  assert.equal(mixed.value.kind, 'track')
  assert.deepEqual(mixed.value.names, [{ name: 'ARIRANG', kind: 'album' }, { name: 'Keep Swimming', kind: 'track' }])

  const albums = validateRedZoneTarget({
    label: 'ARIRANG + Proof',
    keys: ['a', 'b'],
    names: [{ name: 'ARIRANG', kind: 'album' }, { name: 'Proof', kind: 'album' }],
  })
  assert.equal(albums.value.kind, 'album')

  // Junk entries never reach the database.
  assert.deepEqual(normalizeTargetNames([{ name: ' X ', kind: 'ep' }, { name: '', kind: 'album' }, null]),
    [{ name: 'X', kind: 'track' }])
  assert.deepEqual(normalizeTargetNames(null), [])

  // Names still cannot stand in for the keys that actually do the counting.
  assert.equal(validateRedZoneTarget({ label: 'X', keys: [], names: [{ name: 'X', kind: 'track' }] }).valid, false)
})
