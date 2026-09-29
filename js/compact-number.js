// Compact display formatting for the landing page's stream totals.
//
// Its own module, not a helper inside landing.js, because landing.js is an
// entry point with side effects on import — it starts the crowd canvas,
// renders the map and calls the API the moment it loads. A test that wanted
// to check this formatting would have to boot all of that first.
//
// The rule that matters: FLOOR, never round. These numbers appear on a
// public page as a claim about how much this community has streamed, so the
// displayed figure must always be one the real total has actually reached.
// Rounding 440,499 up to "440K" is fine; rounding 440,501 up to "441K" is
// claiming 500 streams that have not happened.

/** 440012 → "440K"; 1284844 → "1.2M"; 950 → "950". */
export function compact(n) {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return String(Math.floor(n))
  if (n < 1e6) return `${Math.floor(n / 1000)}K`
  // One decimal, floored: 1,284,844 → 1.2M, never 1.3M.
  return `${Math.floor(n / 1e5) / 10}M`
}
