// Pure, dependency-free planner helpers for the Candy Star generator.
// Deliberately plain .js (no Deno-only imports, no TypeScript syntax) so
// the exact same module can be imported both by the real Deno edge
// function (candy-star-rules.ts) and by a plain Node test — one
// implementation, not a hand-maintained mirror that can drift from what's
// actually deployed.

export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Interleave songs by primary artist so no more than ~1 consecutive track
// from the same member.
export function artistInterleave(songs) {
  const groups = new Map()
  for (const s of songs) {
    const artist = (s.artists?.[0] || '').toLowerCase() || 'bts'
    if (!groups.has(artist)) groups.set(artist, [])
    groups.get(artist).push(s)
  }
  const keys = [...groups.keys()]
  const result = []
  let changed = true
  while (changed) {
    changed = false
    for (const k of keys) {
      const g = groups.get(k)
      if (g.length) { result.push(g.shift()); changed = true }
    }
  }
  return result
}

/** Plan n gap-track-counts summing to `total` (clamped into the feasible
 *  [n*MIN_G, n*MAX_G] range first — an out-of-range `total` used to make
 *  the balancing loop below exit early at n*MIN_G or n*MAX_G silently,
 *  which didn't match this function's "sums to total" contract), centered
 *  on 3 with 2/4 as common shoulders and 5/6 rare. */
export function planGapCounts(n, total) {
  if (n <= 0) return []
  const MIN_G = 1, MAX_G = 6, MODE = 3
  const clampedTotal = Math.max(n * MIN_G, Math.min(n * MAX_G, total))
  const plan = new Array(n).fill(MODE)
  let sum = plan.reduce((a, b) => a + b, 0)
  const idxOrder = shuffle([...Array(n).keys()])
  let iter = 0
  while (sum !== clampedTotal && iter < n * 100) {
    const idx = idxOrder[iter % n]
    if (sum < clampedTotal && plan[idx] < MAX_G) { plan[idx]++; sum++ } else
    if (sum > clampedTotal && plan[idx] > MIN_G) { plan[idx]--; sum-- }
    iter++
  }
  // Sum-preserving +1/-1 swaps for natural variety around the target sum.
  for (let pass = 0; pass < n * 2; pass++) {
    const a = Math.floor(Math.random() * n), b = Math.floor(Math.random() * n)
    if (a === b) continue
    if (Math.random() < 0.4 && plan[a] < MAX_G && plan[b] > MIN_G) { plan[a]++; plan[b]-- }
  }
  return shuffle(plan)
}

/** Build one candidate near-alternating 'A'/'B' skeleton for m A-plays and
 *  n B-plays: prefers switching songs each step (targetRatio), allows up
 *  to 2 of the busier song in a row but never a direct repeat of the other,
 *  and — critically — when NEITHER preference can be honored (only
 *  possible once one song is exhausted and the other's own no-3-in-a-row
 *  rule is blocking the next slot), drains whichever song still has plays
 *  left rather than assuming it's always B. An earlier version only ever
 *  drained B in that branch, which silently dropped the rest of A's plays
 *  whenever A was the one still holding a remainder — the no-repeat rules
 *  are discretionary shape preferences, not correctness requirements, so
 *  every requested play landing takes priority over their shape. */
export function buildBurstSkeleton(m, n, targetRatio = 0.97) {
  const out = []
  let remA = m, remB = n
  while (remA + remB > 0) {
    const prev = out.length > 0 ? out[out.length - 1] : ''
    const prev2 = out.length > 1 ? out[out.length - 2] : ''
    const canA = remA > 0 && !(prev === 'A' && prev2 === 'A')
    const canB = remB > 0 && prev !== 'B'
    if (!canA && !canB) {
      while (remA > 0) { out.push('A'); remA-- }
      while (remB > 0) { out.push('B'); remB-- }
      break
    }
    if (!canA) { out.push('B'); remB--; continue }
    if (!canB) { out.push('A'); remA--; continue }
    let choice
    if (prev === 'A') choice = Math.random() < targetRatio ? 'B' : 'A'
    else if (prev === 'B') choice = Math.random() < targetRatio ? 'A' : 'B'
    else choice = Math.random() < remA / (remA + remB) ? 'A' : 'B'
    if (choice === 'A') { out.push('A'); remA-- } else { out.push('B'); remB-- }
  }
  return out
}

const altRatio = (arr) =>
  arr.length < 2 ? 0 : arr.filter((k, i) => i > 0 && k !== arr[i - 1]).length / (arr.length - 1)

/** Best-of-8-attempts wrapper around buildBurstSkeleton, picking whichever
 *  candidate's actual alternation ratio lands closest to targetRatio. */
export function buildFocusOrder(m, n, targetRatio = 0.97, attempts = 8) {
  let best = buildBurstSkeleton(m, n, targetRatio)
  let bestDist = Math.abs(altRatio(best) - targetRatio)
  for (let attempt = 1; attempt < attempts; attempt++) {
    const candidate = buildBurstSkeleton(m, n, targetRatio)
    const dist = Math.abs(altRatio(candidate) - targetRatio)
    if (dist < bestDist) { best = candidate; bestDist = dist }
  }
  return best
}
