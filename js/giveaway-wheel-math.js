// Wheel geometry for the PC Giveaway recording view, kept pure for tests.
//
// Entry i's slice is centred at angle i × slice, measured clockwise from the
// pointer at 12 o'clock when the wheel's rotation is 0. To put entry i under
// the pointer the wheel must rotate by −i × slice (mod a full turn).

export const TAU = Math.PI * 2

/** Index of the entry under the pointer for a wheel rotated by `angle`. */
export function indexUnderPointer(angle, n) {
  const slice = TAU / n
  const a = (((-angle) % TAU) + TAU) % TAU
  return Math.round(a / slice) % n
}

/**
 * Total rotation to add so the spin ends on `index`, after `turns` full
 * turns. `jitter` (−0.5…0.5) moves the stop point inside the slice so it
 * doesn't always land dead centre; it is capped at 30% of the slice either
 * way, so the pointer can never sit on a border.
 */
export function spinDelta(currentAngle, index, n, turns = 9, jitter = 0) {
  const slice = TAU / n
  const j = Math.max(-0.5, Math.min(0.5, jitter)) * slice * 0.6
  const target = -index * slice + j
  const base = ((currentAngle % TAU) + TAU) % TAU
  const delta = (((target - base) % TAU) + TAU) % TAU
  return delta + TAU * turns
}

/** Ease-out: fast start, long gradual slowdown. */
export const easeOut = (t) => 1 - Math.pow(1 - t, 4)

/** Three alternating colours; the last slice never matches the first. */
export function sliceColorIndex(i, n) {
  const k = i % 3
  return i === n - 1 && k === 0 ? 1 : k
}
