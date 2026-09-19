// node --test js/recelebrate-watch-program.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WATCH_ITEMS, STYLES, WINDOW_MOMENTS, CUE_MOMENTS, LIGHT_VARIANTS, resolveItem, resolveMoment, activeMoments, cuesCrossed, upNext, IDLE_SWAY_BPM, SONG_BOMB_COLORS, PALETTES } from './recelebrate-watch-program.js'

test('playlist keeps the published order: 15 items, Ments where the playlist has them', () => {
  const labels = WATCH_ITEMS.map((it) => it.kind === 'segmented' ? 'Dynamite+Mikrokosmos' : it.title)
  assert.deepEqual(labels, [
    'Body to Body', 'Hooligan', '2.0', 'MENT', 'Butter', 'MENT', 'MIC DROP', 'Aliens', 'FYA', 'MENT',
    'SWIM', 'Like Animals', 'NORMAL', 'MENT', 'Dynamite+Mikrokosmos',
  ])
})

test('given BPMs; fast songs sway at half-time while the light keeps the real tempo', () => {
  const bpm = (i) => resolveMoment(i, 10)
  assert.equal(bpm(0).bpm, 120); assert.equal(bpm(0).swayBpm, 120)
  assert.equal(bpm(1).bpm, 135)
  assert.equal(bpm(6).title, 'MIC DROP'); assert.equal(bpm(6).bpm, 170); assert.equal(bpm(6).swayBpm, 85)
  assert.equal(bpm(10).title, 'SWIM'); assert.equal(bpm(10).bpm, 94)
  assert.equal(bpm(12).bpm, 73)
})

test('Ment: ON STAGE, no song claimed, no tempo sync, idle sway', () => {
  const m = resolveMoment(3, 30)
  assert.equal(m.kind, 'ment'); assert.equal(m.label, 'ON STAGE'); assert.equal(m.title, 'MENT')
  assert.equal(m.bpm, null); assert.equal(m.pulse, false); assert.equal(m.swayBpm, IDLE_SWAY_BPM)
})

test('combined final video switches by its own currentTime', () => {
  const at = (t) => resolveMoment(14, t)
  assert.equal(at(0).title, 'Dynamite'); assert.equal(at(0).bpm, 114)
  assert.equal(at(199.9).title, 'Dynamite')
  assert.equal(at(200).kind, 'transition'); assert.equal(at(200).label, 'ON STAGE'); assert.equal(at(200).pulse, false)
  assert.equal(at(235.9).kind, 'transition')
  assert.equal(at(236).title, 'Mikrokosmos'); assert.equal(at(236).bpm, 174); assert.equal(at(236).swayBpm, 87)
  assert.equal(at(565).title, 'Mikrokosmos')
  assert.notEqual(at(100).key, at(210).key)
})

test('title cross-check: a reordered song slot follows the title, a Ment slot never does', () => {
  assert.equal(resolveItem(0, "[BTS] 'SWIM' Gwanghwamun live").item.title, 'SWIM')
  assert.equal(resolveItem(3, 'Ment after 2.0').item.kind, 'ment')
  assert.equal(resolveItem(10, 'BTS SWIM @ Gwanghwamun').item.title, 'SWIM')
  assert.equal(resolveItem(99, '').item, null)
})

test('cues fire once on the frame their moment is crossed, never on a seek', () => {
  const dyn = resolveMoment(14, 1)
  assert.equal(cuesCrossed(dyn, 1.8, 2.1, 565).length, 1)
  assert.equal(cuesCrossed(dyn, 2.1, 2.4, 565).length, 0)
  assert.equal(cuesCrossed(dyn, 0, 60, 565).length, 0) // seek
  const mk = resolveMoment(14, 500)
  assert.deepEqual(cuesCrossed(mk, 554.9, 555.2, 565).map((c) => c.type), ['confetti']) // -10 from the end
  assert.deepEqual(cuesCrossed(mk, 534.9, 535.2, 565).map((c) => c.type), ['wave'])
  assert.equal(cuesCrossed(mk, 554.9, 555.2, 0).length, 0) // duration unknown: end cues wait
})

test('window moments are states: on inside their stretch, off outside, fine after a seek', () => {
  const mk = resolveMoment(14, 240)
  assert.deepEqual(activeMoments(mk, 240, 565).map((m) => m.variant), ['spot']) // lights up at 3:56
  assert.equal(activeMoments(mk, 245, 565).length, 0)
  assert.deepEqual(activeMoments(mk, 540, 565).map((m) => m.type).sort(), ['bombsUp', 'color'])
  assert.equal(activeMoments(mk, 540, 0).length, 0)
})

test('every item has a known style; every moment is well-formed', () => {
  const segs = WATCH_ITEMS.flatMap((it) => it.kind === 'segmented' ? it.segments : [it])
  for (const s of segs) {
    assert.ok(STYLES.includes(s.style), `${s.title} style`)
    if (s.kind !== 'performance') assert.equal(s.moments.length, 0, 'Ments stay calm: no moments')
    for (const m of s.moments) {
      const isWindow = WINDOW_MOMENTS.includes(m.type)
      assert.ok(isWindow || CUE_MOMENTS.includes(m.type), `${s.title} ${m.type}`)
      assert.equal(typeof m.at, 'number')
      if (isWindow) assert.ok(m.to !== undefined, `${s.title} ${m.type} needs to`)
      if (m.type === 'light') assert.ok(LIGHT_VARIANTS.includes(m.variant))
    }
  }
})

test('base styles give tracks different personalities; Ments are idle', () => {
  assert.equal(resolveMoment(10, 5).style, 'ocean') // SWIM
  assert.equal(resolveMoment(1, 5).style, 'bounce') // Hooligan
  assert.equal(resolveMoment(7, 5).style, 'drift') // Aliens
  assert.equal(resolveMoment(3, 5).style, 'idle') // Ment
  assert.equal(resolveMoment(14, 210).style, 'idle') // between songs
})

test('Launch the Voyage double-time light reactions do not change physical sway BPM', () => {
  const two = resolveMoment(2, 5)
  const aliens = resolveMoment(7, 5)
  const normal = resolveMoment(12, 5)
  assert.equal(two.doubleTime, true); assert.equal(two.swayBpm, 130)
  assert.equal(aliens.doubleTime, true); assert.equal(aliens.swayBpm, 98)
  assert.equal(normal.doubleTime, true); assert.equal(normal.swayBpm, 73)
  assert.equal(resolveMoment(3, 5).doubleTime, false)
})

test('UP NEXT names the next playlist item', () => {
  assert.equal(upNext(0).title, 'Hooligan')
  assert.equal(upNext(2).kind, 'ment')
  assert.equal(upNext(13).title, 'Dynamite + Mikrokosmos')
  assert.equal(upNext(14, 0).title, 'Mikrokosmos') // Dynamite → Mikrokosmos, same video
  assert.equal(upNext(14, 1).title, 'Mikrokosmos') // between songs
  assert.equal(upNext(14, 2), null) // Mikrokosmos is the last thing
})

test('every song concert colour is offered for the ARMY Bomb, in playlist order', () => {
  assert.deepEqual(SONG_BOMB_COLORS.map((c) => c.label), [
    'Body to Body', 'Hooligan', '2.0', 'Butter', 'MIC DROP', 'Aliens', 'FYA',
    'SWIM', 'Like Animals', 'NORMAL', 'Dynamite', 'Mikrokosmos',
  ])
  const perfs = WATCH_ITEMS.flatMap((it) => it.segments || [it]).filter((it) => it.kind === 'performance')
  for (const p of perfs) {
    assert.ok(SONG_BOMB_COLORS.some((c) => c.label === p.title && c.color === PALETTES[p.palette].glow), p.title)
  }
  for (const c of SONG_BOMB_COLORS) assert.match(c.color, /^#[0-9a-f]{6}$/i)
})
