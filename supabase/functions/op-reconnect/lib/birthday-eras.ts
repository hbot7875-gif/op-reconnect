import type { EraDef } from './era-timeline.ts'
import { normKeyFull } from './text.ts'

export interface BirthdayEraEvent {
  id: string
  date: string
  // Inclusive last KST calendar day the one-time keepsake can still be
  // lit/claimed on. Defaults to `date` itself (a single-day event) when
  // omitted — see isBirthdayEventDate, the one place that should ever
  // compare a KST date against this window.
  dateEnd?: string
  member: string
  cardName: string
  icon: string
  description: string
  albums: string[]
  tracks: string[]
  /** Additional provider titles accepted for a canonical birthday-card slot. */
  trackAliases?: Record<string, string[]>
  badgeTemplateId: string
  rewardHours: number
  // Optional second, rarer badge for anyone who streams every track on the
  // card at least twice within the same event window — a bonus for players
  // who keep going after their own 13/13, on top of (not instead of) the
  // primary badgeTemplateId. Awarded directly via rc_award_badge, no
  // separate claim RPC (see agent-charge.ts's ENCORE_THRESHOLD).
  encoreBadgeTemplateId?: string
  // Opt-in second reward path (Jimin Day 2026 onward). When set, completing
  // the Era Card gives only rewardHours (rc_claim_birthday_charge), and the
  // badges move into a gift that contributors claim once the shared birthday
  // room reaches its target (rc_claim_birthday_room_gift): roomBadgeTemplateId
  // for anyone who added light, badgeTemplateId as well for card completers.
  // claimDays is how long after the event the gift stays claimable - it only
  // extends claiming; contribution and card completion stay frozen to the
  // event window. Events without it (GOLDEN) keep rc_claim_birthday_era.
  roomGift?: { roomBadgeTemplateId: string; claimDays: number; wings: number; chargeCells: number }
  weeklyEra: EraDef & { startsOn: string }
}

/** Shared with Agent Charge and BOTZ so a birthday track can never be
 * matched through two subtly different title/slot definitions. */
export function birthdayTrackEntries(event: BirthdayEraEvent) {
  return event.tracks.map((title, index) => {
    const canonicalKey = normKeyFull(title)
    const aliases = event.trackAliases?.[canonicalKey] || []
    return {
      id: `${event.id}:${index}`,
      canonicalKey,
      keys: [...new Set([canonicalKey, ...aliases.map(normKeyFull)])],
    }
  })
}

export const BIRTHDAY_LIGHTS_PER_TRACK = 2

/**
 * Birthday Era Cards are intentionally data-driven. A future member birthday
 * needs one entry here (plus its badge artwork/template), not another copy of
 * the progress, claim, charge, and weekly-card code.
 *
 * The dated event is a one-time keepsake. `weeklyEra` is a separate reusable
 * card that starts after the birthday, resets every KST week, and behaves like
 * every other +10h Era Card.
 */
export const BIRTHDAY_ERA_EVENTS: BirthdayEraEvent[] = [
  {
    id: 'jk-golden-birthday-2026',
    date: '2026-09-01',
    // Extended one extra KST day (site owner's call, 2026-09-01 evening) —
    // Golden Corner and the card were about to hard-cut off at midnight
    // with real, live participation still climbing.
    dateEnd: '2026-09-02',
    member: 'Jung Kook',
    cardName: 'GOLDEN Birthday',
    icon: '🐰',
    description: 'Jung Kook · September 1, 2026 birthday keepsake.',
    albums: ['GOLDEN'],
    tracks: [
      '3D (feat. Jack Harlow)', 'Closer to You (feat. Major Lazer)',
      'Seven (Explicit Ver.)', 'Standing Next to You', 'Yes or No',
      "Please Don't Change (feat. DJ Snake)", 'Hate You', 'Somebody',
      'Too Sad to Dance', 'Shot Glass of Tears', 'Seven (Clean Ver.)',
      'Euphoria', 'SWIM with Jung Kook (Acoustic Lofi Remix)',
    ],
    badgeTemplateId: 'event_jk_birthday_2026',
    rewardHours: 10,
    encoreBadgeTemplateId: 'event_jk_golden_encore_2026',
    weeklyEra: {
      id: 'golden',
      name: 'GOLDEN',
      icon: '🐰',
      description: 'Jung Kook’s GOLDEN era.',
      albums: ['GOLDEN'],
      tracks: [
        '3D (feat. Jack Harlow)', 'Closer to You (feat. Major Lazer)',
        'Seven (Explicit Ver.)', 'Standing Next to You', 'Yes or No',
        "Please Don't Change (feat. DJ Snake)", 'Hate You', 'Somebody',
        'Too Sad to Dance', 'Shot Glass of Tears', 'Seven (Clean Ver.)',
        'Euphoria', 'SWIM with Jung Kook (Acoustic Lofi Remix)',
      ],
      startsOn: '2026-09-07',
    },
  },
  {
    id: 'jimin-muse-birthday-2026',
    date: '2026-10-13',
    // Extended one KST day (site owner's call, 2026-10-13): the event was
    // released late in the day; Oct 13 plays still count from the start.
    dateEnd: '2026-10-14',
    member: 'Jimin',
    cardName: 'MUSE',
    icon: '🌙',
    description: 'Jimin · October 13, 2026 birthday keepsake.',
    albums: ['MUSE'],
    tracks: [
      'Rebirth (Intro)', 'Interlude : Showtime',
      'Smeraldo Garden Marching Band (feat. Loco)',
      'Slow Dance (feat. Sofia Carson)', 'Be Mine', 'Who',
      'Closer Than This', 'SWIM with Jimin (Slow Jam R&B Remix)',
      'Serendipity (Full Length Edition)',
    ],
    trackAliases: {
      serendipity: ['Intro: Serendipity'],
    },
    badgeTemplateId: 'event_jimin_birthday_2026',
    rewardHours: 10,
    roomGift: { roomBadgeTemplateId: 'event_jimin_day_lightkeeper_2026', claimDays: 7, wings: 1, chargeCells: 1 },
    weeklyEra: {
      id: 'muse',
      name: 'MUSE',
      icon: '🌙',
      description: 'Jimin’s MUSE era.',
      albums: ['MUSE'],
      tracks: [
        'Rebirth (Intro)', 'Interlude : Showtime',
        'Smeraldo Garden Marching Band (feat. Loco)',
        'Slow Dance (feat. Sofia Carson)', 'Be Mine', 'Who',
        'Closer Than This', 'SWIM with Jimin (Slow Jam R&B Remix)',
        'Serendipity (Full Length Edition)',
      ],
      startsOn: '2026-10-19',
    },
  },
]

/** Is this KST calendar date within the event's active window? Plain
 *  string comparison — every kst_date/todayKst() value in this codebase is
 *  already 'YYYY-MM-DD', which sorts identically to a real date compare.
 *  The one place a birthday event's date should ever be checked, so a
 *  future multi-day extension never needs touching more than one line. */
export function isBirthdayEventDate(event: BirthdayEraEvent, kstDate: string): boolean {
  return kstDate >= event.date && kstDate <= (event.dateEnd || event.date)
}

/** The roomGift claim period: the event itself plus claimDays after it. */
export function isBirthdayGiftClaimDate(event: BirthdayEraEvent, kstDate: string): boolean {
  if (!event.roomGift) return false
  const last = new Date(`${event.dateEnd || event.date}T00:00:00Z`)
  last.setUTCDate(last.getUTCDate() + event.roomGift.claimDays)
  return kstDate >= event.date && kstDate <= last.toISOString().slice(0, 10)
}

export function activeWeeklyBirthdayEras(kstDate: string): EraDef[] {
  return BIRTHDAY_ERA_EVENTS
    .filter((event) => kstDate >= event.weeklyEra.startsOn)
    .map((event) => event.weeklyEra)
}

export function isWeeklyBirthdayEraId(eraId: string, kstDate: string): boolean {
  return activeWeeklyBirthdayEras(kstDate).some((era) => era.id === eraId)
}
