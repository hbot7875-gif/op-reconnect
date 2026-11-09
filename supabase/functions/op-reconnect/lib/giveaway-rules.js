// PC Giveaway rules shared by the server and its tests.
//
// The eligibility thresholds are fixed here (approved 2026-11-09) and stored
// with the giveaway when its review list is prepared, so a draw always carries
// the exact rules it was made under.

export const GIVEAWAY_ID = 'mama_2026_r2_pc'
export const GIVEAWAY_CAMPAIGN = 'mama_2026_r2'

export const GIVEAWAY_RULES = Object.freeze({
  // Verified Mnet certificate screenshots on ≥ 8/12 of the member's days.
  vote_mission: 'mnet', vote_num: 8, vote_den: 12,
  // Any recorded streaming on ≥ 6/12 of the member's days.
  stream_num: 6, stream_den: 12,
  // The same song from a different source within 10 minutes is one play.
  dup_window_s: 600,
  exclude_agents: ['AGENT000'],
})

const RANGE = 2 ** 32

/**
 * An equal-odds index in [0, n) from a cryptographic RNG. Rejection sampling
 * throws away the top sliver of the 32-bit range that doesn't divide evenly by
 * n, so no entry is ever favoured (plain `% n` would be).
 * `fill` is injectable for tests; it must behave like crypto.getRandomValues.
 */
export function securePick(n, fill = (a) => crypto.getRandomValues(a)) {
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new Error('bad_entry_count')
  const limit = RANGE - (RANGE % n)
  const buf = new Uint32Array(1)
  for (let i = 0; i < 1000; i++) {
    fill(buf)
    if (buf[0] < limit) return { index: buf[0] % n, random: buf[0] }
  }
  throw new Error('rng_failed')
}
