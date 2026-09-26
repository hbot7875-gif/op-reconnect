/**
 * The dated birthday card becomes a permanent keepsake after it is earned.
 * That memory already lives in the badge/collection surfaces; showing it in
 * the weekly +10h Era Card deck beside the reusable GOLDEN card creates two
 * nearly identical GOLDEN entries. Keep active event progress and every
 * reusable weekly card, but leave collected keepsakes out of power decks.
 */
export function powerEraCards(cards) {
  return Array.isArray(cards) ? cards.filter((card) => card?.status !== 'keepsake') : []
}
