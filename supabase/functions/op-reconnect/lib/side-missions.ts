// Signal Sweep — the four-track daily signal-recovery loop carried forward
// from Arirang Mission. One play of every track secures the day; each track also
// has a 20-play weekly target. The daily clear replaces the retired Daily
// Transmission reward and pays +10 XP once through the shared XP ledger.
// Clearing the weekly 20x target on all four tracks pays a separate,
// one-time weekly bonus the same way — see awardWeeklySideMissionXp.

import { normKeyFull, countedArtistPlays } from './text.ts'
import { addDaysStr, kstDatesBetween, kstWeekKey } from './kst.ts'
import type { SupabaseDB } from './config.ts'
import type { DayBucket } from './transmission.ts'
import { logFeedEvent } from './feed.ts'

const DAILY_REQUIRED = 1
const WEEKLY_REQUIRED = 20
export const SIDE_MISSION_XP = 10
// Paid once per calendar week, the moment all 4 tracks cross their 20×
// target — previously nothing rewarded this at all (see
// docs/bug-resolution-log.md): the weekly grid was tracked and displayed,
// but only the daily 1× clear ever paid out. Arirang Mission's own
// equivalent (SIDE_MISSION_TEAM_XP) pays a team bonus for the same
// milestone; this game has no team structure to hang that off of (see
// era-timeline.ts's own note on why), so it's a personal bonus instead —
// same shared XP ledger, same dedup-on-conflict pattern as the daily one,
// just keyed to the week instead of the day.
export const SIDE_MISSION_WEEKLY_XP = 30

type SideTrackDefinition = {
  id: string
  name: string
  artist: string
  aliases: string[]
  /** Opt-in per-track artist guard. Off by default, so every track without
   *  it counts exactly as it always has (title only — see countTrack). Set
   *  it only where the title genuinely collides with another artist's
   *  catalog, which is the case for SWIM: BTS's "SWIM" and Chase Atlantic's
   *  "Swim" normalise to the same bucket key. */
  btsOnly?: boolean
}

const TRACKS: SideTrackDefinition[] = [
  {
    id: 'wild-flower', name: 'Wild Flower', artist: 'RM',
    aliases: ['Wild Flower', 'Wild Flower (with Youjeen)', 'Wild Flower (feat. Youjeen)', '야생화', '야생화 Wild Flower'],
  },
  {
    id: 'haegeum', name: 'Haegeum', artist: 'Agust D',
    aliases: ['Haegeum', '해금', '해금 Haegeum'],
  },
  {
    id: 'killin-it-girl', name: "Killin' It Girl", artist: 'j-hope',
    aliases: ["Killin' It Girl", 'Killin It Girl', 'Killing It Girl', "Killin' It Girl (feat. GloRilla)", "Killin' It Girl (Solo Version)"],
  },
  {
    // Replaces Don't Say You Love Me (Jin), which finished the milestone it
    // was here for. These four are the current Rapline + SWIM → 1B focus.
    // Aliases stay deliberately narrow: stripVersionSuffix already maps
    // "SWIM with RM (Chill Hip Hop Remix)" to its own `swim with rm` key, so
    // the remixes never fold into this one and the goal stays about the
    // original track's own streams.
    id: 'swim', name: 'SWIM', artist: 'BTS',
    aliases: ['SWIM'],
    btsOnly: true,
  },
]

function trackKeys(track: SideTrackDefinition): string[] {
  return [...new Set(track.aliases.map(normKeyFull).filter(Boolean))]
}

// Title match only by default, no artist filter — matching Arirang Mission's
// own findDailyTrackScrobbles/findTrackScrobbles (the reference this loop was
// carried forward from) and this file's sibling transmission.ts, whose
// equivalent per-key tally (frozen.keys' `bucket[k]?.n`) also trusts the
// track key alone. This used to additionally require the play's own artist
// tag to word-match a narrow per-track allowlist (just 'RM'/'Rap Monster'
// for Wild Flower, etc.) — stricter than every other counting path in this
// codebase, and it silently dropped real plays: plenty of scrobble sources
// attribute a member's solo track to 'BTS' rather than the member's own
// name, and that combination never matched.
//
// Wild Flower, Haegeum and Killin' It Girl don't collide with any other
// artist's differently-named catalog, so for them there is still no
// collision an artist filter would protect against — only lost plays. They
// keep the untouched title-only path.
//
// SWIM is the exception this guard exists for: BTS's "SWIM" and Chase
// Atlantic's "Swim" (that artist's most-streamed song) normalise to the
// same `swim` bucket key, so without a filter another artist's track would
// satisfy a BTS mission and pay its XP. Tracks marked `btsOnly` therefore
// count through countedArtistPlays against the same admin-editable
// bts_artists allowlist (plus per-track collaborator overrides) that Lit
// Era Cards, the Era Timeline and the ARMY Bomb already use — reusing that
// path rather than adding a second matching system. Note this inherits its
// existing rule that a play with no artist string at all still counts
// ("stats.fm rows carry no artist — trust linked sources", see
// text.ts's artistAllowed); that global behaviour is deliberately unchanged
// here.
function countTrack(
  bucket: DayBucket,
  track: SideTrackDefinition,
  allow: string[],
  overrides: Record<string, string[]>,
): number {
  let total = 0
  for (const key of trackKeys(track)) {
    if (track.btsOnly) total += countedArtistPlays(bucket[key]?.a, allow, key, overrides)
    else total += bucket[key]?.n || 0
  }
  return total
}

export type SideMissionView = ReturnType<typeof buildSideMissions>

export function buildSideMissions(
  rows: { kst_date: string; track_counts: DayBucket }[],
  today: string,
  // Required rather than defaulted: an omitted allowlist would silently
  // zero every btsOnly track instead of failing loudly, so the compiler
  // catches a missed caller.
  allow: string[],
  overrides: Record<string, string[]>,
) {
  const weekStart = kstWeekKey(today)
  const weekDates = kstDatesBetween(weekStart, addDaysStr(weekStart, 6))
  const byDate = new Map(rows.map((row) => [String(row.kst_date), row.track_counts || {}]))

  const tracks = TRACKS.map((track) => {
    const days = weekDates.map((date) => {
      const count = countTrack(byDate.get(date) || {}, track, allow, overrides)
      return { date, count, done: count >= DAILY_REQUIRED, future: date > today }
    })
    const weeklyTotal = days.reduce((sum, day) => sum + day.count, 0)
    const todayState = days.find((day) => day.date === today) || { count: 0, done: false }
    return {
      id: track.id,
      name: track.name,
      artist: track.artist,
      todayCount: todayState.count,
      todayDone: todayState.done,
      weeklyTotal,
      weeklyRequired: WEEKLY_REQUIRED,
      weeklyDone: weeklyTotal >= WEEKLY_REQUIRED,
      days,
    }
  })

  const todayDoneCount = tracks.filter((track) => track.todayDone).length
  return {
    weekKey: weekStart,
    weekDates,
    dailyRequired: DAILY_REQUIRED,
    weeklyRequired: WEEKLY_REQUIRED,
    xpOnComplete: SIDE_MISSION_XP,
    weeklyXpOnComplete: SIDE_MISSION_WEEKLY_XP,
    todayDoneCount,
    todayDone: todayDoneCount === tracks.length,
    weekDone: tracks.every((track) => track.weeklyDone),
    tracks,
  }
}

export async function awardDailySideMissionXp(
  supabase: SupabaseDB,
  agentNo: string,
  today: string,
  mission: SideMissionView,
) {
  if (!mission.todayDone) return
  await supabase.from('rc_xp_ledger').upsert({
    agent_no: agentNo,
    amount: SIDE_MISSION_XP,
    source: 'side_mission',
    dedup_key: `side-mission:${agentNo}:${today}`,
    meta: { tracks: mission.tracks.map((track) => track.id) },
  }, { onConflict: 'dedup_key', ignoreDuplicates: true })
  await logFeedEvent(supabase, agentNo, 'side_mission_daily', {}, `side-mission:${agentNo}:${today}`)
}

/** The week-level counterpart to awardDailySideMissionXp above — same
 *  upsert-with-dedup shape, just keyed to mission.weekKey (the week's own
 *  Monday date, stable all week) instead of a single day, so it only ever
 *  pays once no matter how many times this poll runs after the 4th track
 *  crosses 20×. Safe to call on every poll same as the daily one: the
 *  dedup_key already existing is what makes every call after the first a
 *  no-op, not a caller-side "did I already pay this" check. */
export async function awardWeeklySideMissionXp(
  supabase: SupabaseDB,
  agentNo: string,
  mission: SideMissionView,
) {
  if (!mission.weekDone) return
  await supabase.from('rc_xp_ledger').upsert({
    agent_no: agentNo,
    amount: SIDE_MISSION_WEEKLY_XP,
    source: 'side_mission_week',
    dedup_key: `side-mission-week:${agentNo}:${mission.weekKey}`,
    meta: { tracks: mission.tracks.map((track) => track.id) },
  }, { onConflict: 'dedup_key', ignoreDuplicates: true })
  await logFeedEvent(supabase, agentNo, 'side_mission_weekly', {}, `side-mission-week:${agentNo}:${mission.weekKey}`)
}
