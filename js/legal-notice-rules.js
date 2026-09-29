// Rules for the one-time legal-pages notice, kept free of the DOM so they
// can be tested directly — same split as ranking-rules.js / badge-rules.js /
// quest-share-rules.js. broadcasts.js does the rendering and owns the
// localStorage reads; everything that decides WHETHER to show lives here.
//
// Eligibility itself is not decided here: the backend compares the agent's
// existing registration timestamp against the release constant and sends
// back the notice id or null (see lib/broadcasts.ts). This file only knows
// "there is a notice with this id" and "this device has dismissed these".

/** Should this state, on a device that already dismissed `seenIds`, show
 *  the notice? */
export function shouldShowLegalNotice(state, seenIds = []) {
  const id = state && state.legalNotice
  if (!id) return false
  return !(Array.isArray(seenIds) ? seenIds : []).includes(id)
}

/** The dismissal list after "Got it". Idempotent, so a double click or a
 *  re-render cannot write the same id twice. */
export function withNoticeDismissed(seenIds, id) {
  const list = Array.isArray(seenIds) ? seenIds : []
  return list.includes(id) ? list : [...list, id]
}
