// How a quest-exit quote becomes one screen of UI. Pure: quote in, copy and
// button state out — no DOM, no network — so every free and paid path is
// unit-testable (quest-exit-rules.test.mjs) without a browser or a database.
//
// The server decides WHICH exit applies (rc_quest_skip_quote); this only
// decides how to say it. Both sides agree on one vocabulary:
//   system_stuck | expired | teammate_rescue | cancel_join | skip

export const EXIT_ACTIONS = ['system_stuck', 'expired', 'teammate_rescue', 'cancel_join', 'skip']

const fmt = (n) => Number(n || 0).toLocaleString('en-US')

const COPY = {
  cancel_join: {
    button: 'Cancel Join',
    title: 'Cancel joining this Quest?',
    lede: "You joined recently and haven't streamed toward it yet, so leaving is free.",
    confirm: 'Cancel Join',
  },
  teammate_rescue: {
    button: 'Leave Quest',
    title: 'Leave this Quest?',
    lede: "A teammate has stalled this quest, so leaving it is free.",
    why: "A teammate hasn't answered or played for over 48 hours.",
    confirm: 'Leave this Quest',
  },
  expired: {
    button: 'Exit Expired Quest',
    title: 'Exit this Quest?',
    lede: "This quest has run out of time, so leaving it is free.",
    why: 'This quest has already run out of time.',
    confirm: 'Exit Expired Quest',
  },
  system_stuck: {
    button: 'Exit Quest',
    title: 'Exit this Quest?',
    lede: "This quest can't be finished any more. Its ReConnect requirement will be skipped for this district.",
    why: "This quest is stuck, so there's nothing to pay.",
    confirm: 'Exit Quest',
  },
  skip: {
    button: 'Skip Quest',
    title: 'Skip this Quest?',
    lede: "Skip this ReConnect Quest so you can finish the district without it. This won't count as completing the Quest.",
    confirm: null, // built from the price below
  },
}

/** "in 3 hours" / "in 2 days" — friendly, never a raw timestamp. */
export function untilLabel(iso, now = Date.now()) {
  const ms = new Date(iso).getTime() - now
  if (!Number.isFinite(ms) || ms <= 0) return 'shortly'
  const mins = Math.ceil(ms / 60000)
  if (mins < 60) return `in ${mins} min`
  const hours = Math.ceil(mins / 60)
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  return `in ${Math.ceil(hours / 24)} days`
}

function priceLabel(xp, cells) {
  return `${fmt(xp)} XP + ${fmt(cells)} ${Number(cells) === 1 ? 'Cell' : 'Cells'}`
}

/**
 * @param {object} quote rc_quest_skip_quote's payload
 * @returns {{action,free,button,title,lede,why,confirm,blocked,reason,hold,notes,showPrice}}
 */
export function questExitView(quote, now = Date.now()) {
  const action = EXIT_ACTIONS.includes(quote?.action) ? quote.action : 'skip'
  const copy = COPY[action]
  const free = !!quote.free
  // A free exit is never held back — not by the paid cooldown, not by a
  // balance. The server already zeroes those flags for free paths; this makes
  // the UI independently safe if a stale or partial quote ever arrives.
  const short = !free && !quote.canAfford
  const waiting = !free && !!quote.waitingPeriod
  const cooling = !free && !!quote.onCooldown
  const blocked = waiting || cooling || short

  let hold = null
  let reason = null
  if (waiting) {
    reason = 'waiting'
    hold = `You've already streamed toward this quest, so it can be skipped ${untilLabel(quote.eligibleAt, now)} — once you've been on it for a day.`
  } else if (cooling) {
    reason = 'cooldown'
    hold = `You've skipped a quest recently. The next one is available ${untilLabel(quote.cooldownUntil, now)}.`
  } else if (short) {
    reason = 'insufficient'
    const missing = []
    if (quote.shortXp > 0) missing.push(`${fmt(quote.shortXp)} more XP`)
    if (quote.shortCells > 0) missing.push(`${fmt(quote.shortCells)} more ${Number(quote.shortCells) === 1 ? 'Cell' : 'Cells'}`)
    hold = `You need ${missing.join(' and ')} to skip this one.`
  }

  // Three sections instead of a flat list of near-duplicate lines: what the
  // exit does to the district, what it does to the team, and what it costs.
  // Each one is a heading plus a short body, so the sheet reads as three
  // answers rather than six bullets that all sound alike.
  const waives = !free || action === 'system_stuck'
  const sections = [
    {
      key: 'effect',
      heading: 'What this does',
      lines: [
        waives
          ? "Waives this district's ReConnect requirement. Track and album goals still have to be finished."
          : "Leaves the team only — this district still needs its ReConnect Quest.",
        "It won't count as a completed ReConnect Quest.",
      ],
    },
    {
      key: 'team',
      heading: 'Your team',
      lines: [
        'Streams you already contributed stay counted for them.',
        'Your seat reopens so someone else can take it.',
      ],
    },
    {
      key: 'cost',
      heading: free ? 'Cost' : 'Cost and limits',
      lines: free
        ? ['Free — nothing is deducted.']
        : [
            `${priceLabel(quote.costXp, quote.costCells)}.`,
            'Spending XP never lowers your level, rank or earned rewards.',
            'One paid skip every 7 days.',
          ],
    },
  ]

  // Kept for callers that still want the flat form (and for the tests that
  // assert no free path ever advertises a price or the cooldown).
  const notes = sections.flatMap((sec) => sec.lines)

  return {
    action,
    free,
    button: copy.button,
    title: copy.title,
    lede: copy.lede,
    why: copy.why || null,
    confirm: copy.confirm || `Skip for ${priceLabel(quote.costXp, quote.costCells)}`,
    blocked,
    reason,
    hold,
    sections,
    notes,
    showPrice: !free,
  }
}
