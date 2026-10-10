// What the Moon tab's crimson dot means: the Moon Station screen would show
// at least one thing marked for review. No imports, so it can be tested in
// node and mirrored by botz.html's classic script (bottom-nav.test.mjs runs
// both against the same cases).
//
// It counts exactly the three things screen-moon.js renders as a review —
// and only when that screen would render them:
//   flagged streams   a complete window (no partialHistory) with tracks in it
//   mode review       excess high-volume days, again only on a complete window
//   shared account    possibleAlts, which the screen shows regardless
// A sync problem is deliberately not one of them. Moon Station reports it,
// but it is a connection state, not something the player has to review.
//
// Anything that isn't a successful response counts as zero, so a failed or
// unfinished check reads as "no dot", never as a warning.

export function moonReviewCount(res) {
  if (!res || res.success !== true) return 0
  const complete = !res.partialHistory
  let n = 0
  const flagged = Number(res.flaggedCount)
  if (complete && res.trackCount && Number.isFinite(flagged) && flagged > 0) n += flagged
  if (complete && Array.isArray(res.excessStreamDays) && res.excessStreamDays.length > 0) n += 1
  if (Array.isArray(res.possibleAlts) && res.possibleAlts.length > 0) n += 1
  return n
}
