// Whether this agent has been told about their unclaimed Group Supply Chests.
//
// Its own module, not part of vma.js, on purpose: vma.js statically imports
// tesseract.js for vote-proof OCR, and the bell lives in ui-hud.js, which is
// imported by main, the district screen, settings and more. Pulling vma.js
// into that graph put the whole OCR engine in a widely-shared chunk and the
// production build ran out of memory outright. These three functions touch
// nothing but localStorage, so they can be imported from anywhere; the
// mission sheet itself is loaded lazily at the moment it is opened.

const SEEN_KEY = 'rc_group_chest_seen'

export function unclaimedGroupChests(vma) {
  return Number(vma?.communityChestClaimableCount) || 0
}

/** The VMA event is over, so unclaimed Group Chests are the last rewards
 *  anyone can still collect — worth a personal nudge. Announced once per
 *  event, not every poll: a permanently-lit bell stops meaning anything
 *  (the Pack dot makes the same argument about itself). Dismissing records
 *  the event, not the count, so claiming a few doesn't re-announce the
 *  rest. */
export function hasUnseenGroupChests(vma) {
  if (!vma?.eventId || unclaimedGroupChests(vma) < 1) return false
  try { return localStorage.getItem(SEEN_KEY) !== vma.eventId } catch { return true }
}

export function markGroupChestsSeen(vma) {
  try { if (vma?.eventId) localStorage.setItem(SEEN_KEY, vma.eventId) } catch { /* private mode */ }
}
