import type { EraDef } from './era-timeline.ts'

export interface BirthdayEraEvent {
  id: string
  date: string
  member: string
  cardName: string
  icon: string
  description: string
  albums: string[]
  tracks: string[]
  badgeTemplateId: string
  rewardHours: number
  weeklyEra: EraDef & { startsOn: string }
}

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
]

export function activeWeeklyBirthdayEras(kstDate: string): EraDef[] {
  return BIRTHDAY_ERA_EVENTS
    .filter((event) => kstDate >= event.weeklyEra.startsOn)
    .map((event) => event.weeklyEra)
}

export function isWeeklyBirthdayEraId(eraId: string, kstDate: string): boolean {
  return activeWeeklyBirthdayEras(kstDate).some((era) => era.id === eraId)
}
