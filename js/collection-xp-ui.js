// Weekly collection XP — the words the Pack shows. Pure (no DOM), so the
// tests can check every state and the time zone handling directly.
//
// A tile's chip is always one of:
//   unplaced  — in the Pack: potential XP, earned only once placed
//   unowned   — placed in a district this player hasn't restored
//   duplicate — another copy of the same collectible already counts
//   locked    — placed right, but the week hasn't started / isn't unlocked
//   maxed     — placed right, but this week's cap is already reached
//   live      — placed right and unlocked; pays on the next refresh
//   earned    — paid this week

/**
 * @param weekly     the collectible's weekly XP (0 = never earns)
 * @param where      'pack' | 'unowned' | 'restored'
 * @param isCopy     another copy of the same collectible already counts
 * @param paid       paid this week
 * @param c          state.collection
 */
export function collectionChip(weekly, where, isCopy, paid, c) {
  if (!(weekly > 0)) return null
  if (paid) return { state: 'earned', text: `✓ +${weekly} XP earned` }
  if (isCopy) return { state: 'duplicate', text: 'Copy · no extra XP' }
  if (where === 'pack') return { state: 'unplaced', text: `Place to earn ${weekly}/wk` }
  if (where === 'unowned') return { state: 'unowned', text: 'Restore to earn' }
  if (!c?.started || !c?.qualified) return { state: 'locked', text: `🔒 ${weekly} XP/wk` }
  if (c.earned >= c.cap) return { state: 'maxed', text: `${weekly} XP/wk · max reached` }
  return { state: 'live', text: `Earning ${weekly}/wk` }
}

/** The moment a KST date's midnight happens, in the viewer's own time:
 *  Monday Nov 30 00:00 KST reads "Sun, Nov 29, 8:30 PM" in India. */
export function kstMidnightLabel(dateStr, opts = {}) {
  const d = new Date(`${dateStr}T00:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(opts.locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: opts.timeZone })
}

/** Same, for an ISO moment, without the date: "Sun 8:30 PM". */
export function shortReset(iso, opts = {}) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(opts.locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: opts.timeZone })
}
