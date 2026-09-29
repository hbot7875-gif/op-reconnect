// Stream Check row flags — what the "✓ / not BTS" column on the right of
// each row in signalLogSheet is allowed to say.
//
// Its own pure module for the reason every *-rules.js file here exists: the
// sheet that renders it is DOM-coupled, and the thing worth testing is the
// decision, not the markup.
//
// The bug this replaced: the sheet asked each row for `stream.counted`, a
// field the backend has never sent. getSignalLog calls it `eligible` (see
// lib/signal-log.ts). `undefined` is falsy, so EVERY row took the negative
// branch and was labelled "not BTS" — including the 867 of 879 plays the
// same response counted as BTS in the header totals. The list contradicted
// the number directly above it, and said "not BTS" over rows whose artist
// column read BTS.
//
// So the label is derived from the same field the totals are derived from,
// and from the reason the classifier actually recorded rather than a
// hardcoded string.

/** Reasons getSignalLog really emits. Nothing speculative belongs here: a
 *  label that is not backed by a branch in lib/signal-log.ts would be a
 *  confident-sounding guess about why someone's play did not count. */
export const STREAM_REASON_LABELS = {
  // lib/signal-log.ts: countedArtistPlays() found no allowlisted BTS or
  // member artist in the play's artist credit.
  artist_not_eligible: 'not BTS',
}

/** Neutral fallback. If a future reason reaches the UI before it has a
 *  label, say only what is certain — that it did not count — rather than
 *  attributing it to the wrong cause. */
export const UNKNOWN_REASON_LABEL = 'not counted'

/** The flag for one Stream Check row: whether it counted, and the one
 *  short, truthful thing to print in the right-hand column. */
export function streamFlag(stream) {
  if (stream && stream.eligible) return { counted: true, label: '✓' }
  const reason = stream && stream.reason
  return { counted: false, label: STREAM_REASON_LABELS[reason] || UNKNOWN_REASON_LABEL }
}
