import assert from 'node:assert/strict'
import test from 'node:test'
import { redZoneBand, interpolateBombColor, redZonePercent, personalSignalCopy, countdownText,
  corruptionOpacity, sparkOpacity, arcPath, pointOnCircle, tendrilPath,
  redZoneHeadline, redZoneTarget, redZoneGoalCopy, defusedLine,
  redZoneTargetEntries, joinNames, unreadCommsCount, unreadBadgeText } from './red-zone-ui.js'

test('progress bands match the backend thresholds', () => {
  assert.equal(redZoneBand(0, 1000), 'compromised')
  assert.equal(redZoneBand(240, 1000), 'compromised')
  assert.equal(redZoneBand(250, 1000), 'restoring')
  assert.equal(redZoneBand(899, 1000), 'restoring')
  assert.equal(redZoneBand(900, 1000), 'final-push')
  assert.equal(redZoneBand(1000, 1000), 'restored')
})

test('bomb color is pure crimson at 0% and pure purple at 100%', () => {
  assert.equal(interpolateBombColor(0, 1000, '#e5384f', '#8b5cf6'), 'rgb(229, 56, 79)')
  assert.equal(interpolateBombColor(1000, 1000, '#e5384f', '#8b5cf6'), 'rgb(139, 92, 246)')
})

test('percent is clamped and rounded', () => {
  assert.equal(redZonePercent(640, 1000), 64)
  assert.equal(redZonePercent(0, 1000), 0)
  assert.equal(redZonePercent(1200, 1000), 100)
  assert.equal(redZonePercent(5, 0), 0)
})

test('personal signal copy distinguishes qualified from not-yet', () => {
  const notYet = personalSignalCopy(3, 7)
  assert.equal(notYet.qualified, false)
  assert.equal(notYet.value, '3 / 7')
  assert.equal(notYet.full, '3 / 7')
  assert.equal(notYet.hint, 'Stream 4 more to earn XP.')

  const qualified = personalSignalCopy(18, 7)
  assert.equal(qualified.qualified, true)
  assert.equal(qualified.value, '18 ✓')
  assert.equal(qualified.full, '18 / 7 ✓')
  assert.equal(qualified.hint, "You've earned a share of the reward.")

  const exact = personalSignalCopy(7, 7)
  assert.equal(exact.qualified, true)
})

test('every live band leads with the same explanation of the event', () => {
  // Whoever arrives, whenever they arrive, the first line tells them what is
  // happening — a mid-event player never gets only "KEEP DEFUSING".
  for (const band of ['compromised', 'restoring', 'final-push', undefined, 'anything-else']) {
    assert.deepEqual(redZoneHeadline(band), { icon: '🚨', title: 'CITY UNDER ATTACK' })
  }
  // Except once it's over — the attack has ended, so saying otherwise lies.
  assert.deepEqual(redZoneHeadline('restored'), { icon: '💜', title: 'ARMY BOMB SAVED!' })
})

test('the streaming instruction is generated from the event target', () => {
  const track = redZoneTarget({ targetTrack: 'Haegeum' })
  assert.equal(track.name, 'Haegeum')
  assert.equal(track.unit, 'streams')

  const album = redZoneTarget({ targetAlbum: 'ARIRANG' })
  assert.equal(album.name, 'the ARIRANG album')
  assert.equal(album.unit, 'album streams')

  // An album target wins over a track one: the album is the broader ask and
  // showing both would leave "what counts?" ambiguous.
  assert.equal(redZoneTarget({ targetTrack: 'Haegeum', targetAlbum: 'ARIRANG' }).name, 'the ARIRANG album')

  // No target set is the case today (refreshDefuse counts any eligible BTS
  // play) — the copy must say that rather than name a song nobody filtered.
  assert.equal(redZoneTarget({}).name, 'any BTS song')
  assert.equal(redZoneTarget(null).name, 'any BTS song')
})

test('goal copy pairs the instruction with the number and the unit', () => {
  const goal = redZoneGoalCopy({ progress: 750, target: 1000, targetTrack: 'Haegeum' }, 'restoring')
  assert.equal(goal.instruction, 'Protect the ARMY Bomb by streaming Haegeum')
  // Every live band keeps the "protect the ARMY Bomb" half — only the
  // urgency in front of it changes.
  assert.equal(redZoneGoalCopy({ progress: 0, target: 1000 }, 'compromised').instruction,
    'Protect the ARMY Bomb by streaming any BTS song')
  for (const band of ['compromised', 'restoring', 'final-push']) {
    assert.match(redZoneGoalCopy({ progress: 1, target: 1000 }, band).instruction, /the ARMY Bomb/)
  }
  assert.equal(goal.goal, 'Goal: 1,000 streams')
  assert.equal(goal.progressLine, '750 / 1,000 streams')

  const push = redZoneGoalCopy({ progress: 930, target: 1000 }, 'final-push')
  assert.equal(push.instruction, '⚡ Almost safe — protect the ARMY Bomb by streaming any BTS song')

  // An album event must never describe its total as plain track streams.
  const album = redZoneGoalCopy({ progress: 0, target: 2000, targetAlbum: 'ARIRANG' }, 'compromised')
  assert.equal(album.goal, 'Goal: 2,000 album streams')
  assert.equal(album.progressLine, '0 / 2,000 album streams')

  assert.equal(redZoneGoalCopy({ progress: 1000, target: 1000 }, 'restored').instruction, 'The City is safe again.')
})

test('one verb for the mechanic everywhere the percentage appears', () => {
  assert.equal(defusedLine(750, 1000), '75% DEFUSED')
  assert.equal(defusedLine(0, 1000), '0% DEFUSED')
  assert.equal(defusedLine(1200, 1000), '100% DEFUSED')
})

test('countdown renders hh:mm:ss above an hour, mm:ss below', () => {
  assert.equal(countdownText(0), '00:00:00')
  assert.equal(countdownText(-5000), '00:00:00')
  assert.equal(countdownText((2 * 3600 + 46 * 60 + 48) * 1000), '02:46:48')
  assert.equal(countdownText(45 * 1000), '00:45')
})

test('corruption fragments fade linearly to zero at their own clearAt and stay there', () => {
  assert.equal(corruptionOpacity(0, 0.6), 1)
  assert.equal(corruptionOpacity(0.3, 0.6), 0.5)
  assert.equal(corruptionOpacity(0.6, 0.6), 0)
  assert.equal(corruptionOpacity(0.9, 0.6), 0)
})

test('a spark trace holds near-full brightness then drops out fast at the very end', () => {
  assert.equal(sparkOpacity(0, 0.95), 1)
  assert.equal(sparkOpacity(0.5, 0.95), 1) // well before the hold window starts
  assert.equal(sparkOpacity(0.83, 0.95, 0.12), 1) // right at the hold boundary
  assert.ok(Math.abs(sparkOpacity(0.89, 0.95, 0.12) - 0.5) < 1e-9) // halfway through the final drop
  assert.equal(sparkOpacity(0.95, 0.95, 0.12), 0)
  assert.equal(sparkOpacity(1, 0.95, 0.12), 0)
})

test('arcPath draws a small-arc path starting straight up and sweeping clockwise', () => {
  // 0deg is straight up from center; a short 0->90deg sweep should start
  // directly above the center and end directly to its right.
  const d = arcPath(110, 110, 98, 0, 90)
  assert.match(d, /^M 110\.00 12\.00 A 98 98 0 0 1 208\.00 110\.00$/)
})

test('pointOnCircle: 0deg is straight up, 90deg is straight right', () => {
  const top = pointOnCircle(110, 110, 100, 0)
  assert.ok(Math.abs(top.x - 110) < 1e-9 && Math.abs(top.y - 10) < 1e-9)
  const right = pointOnCircle(110, 110, 100, 90)
  assert.ok(Math.abs(right.x - 210) < 1e-9 && Math.abs(right.y - 110) < 1e-9)
})

test('tendrilPath reaches from the outer radius in to the inner radius at the same base angle', () => {
  const d = tendrilPath(110, 110, 98, 66, 0, 20)
  const [start, , end] = d.match(/-?\d+\.\d+/g).reduce((rows, n, i) => {
    if (i % 2 === 0) rows.push([n]); else rows[rows.length - 1].push(n); return rows
  }, [])
  assert.equal(Number(start[0]), 110) // outer point sits straight above center at deg=0
  assert.ok(Math.abs(Number(start[1]) - 12) < 0.01)
  assert.equal(Number(end[0]), 110) // inner point is back on the same 0deg spoke
  assert.ok(Math.abs(Number(end[1]) - 44) < 0.01)
})

test('several picks read as one sentence, each phrased by its own kind', () => {
  // The real launch this was built for: one album plus one loose track.
  const mixed = redZoneTarget({
    targetKind: 'track',
    targetNames: [{ name: 'ARIRANG', kind: 'album' }, { name: 'Keep Swimming', kind: 'track' }],
  })
  assert.equal(mixed.name, 'the ARIRANG album and Keep Swimming')
  assert.equal(mixed.short, 'ARIRANG and Keep Swimming')
  // Mixed picks are never "album streams" — that would misdescribe the track.
  assert.equal(mixed.unit, 'streams')

  const albumsOnly = redZoneTarget({
    targetNames: [{ name: 'ARIRANG', kind: 'album' }, { name: 'Proof', kind: 'album' }],
  })
  assert.equal(albumsOnly.name, 'the ARIRANG album and the Proof album')
  assert.equal(albumsOnly.unit, 'album streams')

  const three = redZoneTarget({
    targetNames: [{ name: 'A', kind: 'track' }, { name: 'B', kind: 'track' }, { name: 'C', kind: 'track' }],
  })
  assert.equal(three.name, 'A, B and C')

  assert.equal(joinNames([]), '')
  assert.equal(joinNames(['A']), 'A')
  assert.equal(joinNames(['A', 'B']), 'A and B')
})

test('the single-target shape still works, and junk entries are dropped', () => {
  // An event launched before multi-target (or by an older backend) carries
  // only targetAlbum/targetTrack — it must keep reading exactly as it did.
  assert.equal(redZoneTarget({ targetAlbum: 'ARIRANG' }).name, 'the ARIRANG album')
  assert.equal(redZoneTarget({ targetTrack: 'Haegeum' }).name, 'Haegeum')
  assert.equal(redZoneTarget({}).name, 'any BTS song')

  // A nameless entry must never render as "the  album".
  assert.deepEqual(redZoneTargetEntries({ targetNames: [{ name: '  ', kind: 'album' }] }), [])
  assert.equal(redZoneTarget({ targetNames: [{ name: '', kind: 'album' }] }).name, 'any BTS song')
  // An unknown kind falls back to track rather than inventing album grammar.
  assert.deepEqual(redZoneTargetEntries({ targetNames: [{ name: 'X', kind: 'ep' }] }), [{ name: 'X', kind: 'track' }])
})

test('goal copy carries a multi-target instruction end to end', () => {
  const goal = redZoneGoalCopy({
    progress: 1200, target: 5000,
    targetNames: [{ name: 'ARIRANG', kind: 'album' }, { name: 'Keep Swimming', kind: 'track' }],
  }, 'restoring')
  assert.equal(goal.instruction, 'Protect the ARMY Bomb by streaming the ARIRANG album and Keep Swimming')
  assert.equal(goal.goal, 'Goal: 5,000 streams')
  assert.equal(goal.progressLine, '1,200 / 5,000 streams')
})

test('unread ARMY Comms count and badge text', () => {
  assert.equal(unreadCommsCount(12, 9), 3)
  assert.equal(unreadCommsCount(9, 9), 0)
  // A resolved event's thread can shrink; a negative badge would be nonsense.
  assert.equal(unreadCommsCount(4, 9), 0)
  // Never-opened threads count everything, and missing values are not NaN.
  assert.equal(unreadCommsCount(6, 0), 6)
  assert.equal(unreadCommsCount(undefined, undefined), 0)

  // Empty means "draw nothing" — a bubble showing 0 is worse than no bubble.
  assert.equal(unreadBadgeText(0), '')
  assert.equal(unreadBadgeText(-3), '')
  assert.equal(unreadBadgeText(1), '1')
  assert.equal(unreadBadgeText(9), '9')
  // Capped so one busy thread cannot stretch the button it sits on.
  assert.equal(unreadBadgeText(10), '9+')
  assert.equal(unreadBadgeText(4000), '9+')
})
