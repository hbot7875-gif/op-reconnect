// Weekly XP each collectible earns while placed in a district the player
// restored. Shared by the server (collectible-rewards.ts, which pays it) and
// the Pack (js/screen-resources.js, which shows it), so the two can't drift.

export const COLLECTION_WEEKLY_CAP = 50

// ARMY's Corner holds at most this many placed collectibles per district (OT7).
// Every placed collectible counts, copies and kinds the illustration doesn't
// draw included. Enforced by placeItem and by a database trigger
// (migration 20261124120000); the district page shows it as n/7.
export const CORNER_LIMIT = 7

/** Weekly XP for one collectible, by what it is. 0 = never earns. */
export function collectibleWeeklyXp(item) {
  const kind = String(item?.kind || '')
  if (kind === 'album') return String(item?.era || '').toLowerCase() === 'media' ? 12 : 15
  if (kind === 'lightstick') return 12
  if (kind === 'apparel') return 10
  if (kind === 'photocard') return 8
  if (kind === 'poster' || kind === 'banner' || kind === 'figure' || kind === 'plush') return 7
  if (kind === 'ticket' || kind === 'utility' || !kind) return 0
  return 5 // mugs, cushions, rugs, light boxes and other decor
}
