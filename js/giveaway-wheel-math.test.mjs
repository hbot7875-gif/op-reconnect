import test from 'node:test'
import assert from 'node:assert/strict'
import { TAU, spinDelta, indexUnderPointer, easeOut, sliceColorIndex } from './giveaway-wheel-math.js'

test('every spin lands on the chosen entry, from any starting angle and jitter', () => {
  for (const n of [2, 3, 38, 41, 97]) {
    for (let start = -20; start <= 20; start += 3.7) {
      for (const jitter of [-0.5, -0.2, 0, 0.3, 0.5]) {
        for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 7))) {
          const d = spinDelta(start, i, n, 9, jitter)
          assert.ok(d >= TAU * 9 && d < TAU * 10, 'nine full turns plus less than one')
          assert.equal(indexUnderPointer(start + d, n), i, `n=${n} i=${i} start=${start} jitter=${jitter}`)
        }
      }
    }
  }
})

test('the stop point stays well inside the slice (never on a border)', () => {
  const n = 41, slice = TAU / n
  for (const jitter of [-0.5, 0.5, -9, 9]) {
    const end = spinDelta(0, 5, n, 9, jitter)
    const off = (((-end) % TAU) + TAU) % TAU - 5 * slice
    assert.ok(Math.abs(off) <= slice * 0.3 + 1e-9)
  }
})

test('ease-out starts fast and ends at rest', () => {
  assert.equal(easeOut(0), 0); assert.equal(easeOut(1), 1)
  assert.ok(easeOut(0.1) > 0.3, 'fast start'); assert.ok(easeOut(0.9) > 0.999, 'long slowdown')
})

test('neighbouring slices never share a colour, including last → first', () => {
  for (const n of [38, 40, 41, 43]) {
    for (let i = 0; i < n; i++) assert.notEqual(sliceColorIndex(i, n), sliceColorIndex((i + 1) % n, n), `n=${n} i=${i}`)
  }
})
