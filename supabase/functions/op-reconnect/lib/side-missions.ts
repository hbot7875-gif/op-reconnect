// Signal Sweep — the four-track daily signal-recovery loop carried forward
// from Arirang Mission. One play of every track secures the day; each track also
// has a 20-play weekly target. The daily clear replaces the retired Daily
// Transmission reward and pays +10 XP once through the shared XP ledger.
// Clearing the weekly 20x target on all four tracks pays a separate,
// one-time weekly bonus the same way — see awardWeeklySideMissionXp.

import { normKeyFull } from './text.ts'
import { addDaysStr, kstDatesBetween, kstWeekKey } from './kst.ts'
import type { SupabaseDB } from './config.ts'
import type { DayBucket } from './transmission.ts'

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
}

const TRACKS: SideTrackDefinition[] = [
  {
    id: 'wild-flower', name: 'Wild Flower', artist: 'RM',
    aliases: ['Wild Flower', 'Wild Flower (with Youjeen)', 'Wild Flower (feat. Youjeen)', '야생화', '야생화 Wild Flower'],
  },
  {
    id: 'dont-say-you-love-me', name: "Don't Say You Love Me", artist: 'Jin',
    aliases: ["Don't Say You Love Me", 'Dont Say You Love Me', 'DSYLM'],
  },
  {
    id: 'haegeum', name: 'Haegeum', artist: 'Agust D',
    aliases: ['Haegeum', '해금', '해금 Haegeum'],
  },
  {
    id: 'killin-it-girl', name: "Killin' It Girl", artist: 'j-hope',
    aliases: ["Killin' It Girl", 'Killin It Girl', 'Killing It Girl', "Killin' It Girl (feat. GloRilla)", "Killin' It Girl (Solo Version)"],
  },
]

function trackKeys(track: SideTrackDefinition): string[] {
  return [...new Set(track.aliases.map(normKeyFull).filter(Boolean))]
}

// Title match only, no artist filter — matching Arirang Mission's own
// findDailyTrackScrobbles/findTrackScrobbles (the reference this loop was
// carried forward from) and this file's sibling transmission.ts, whose
// equivalent per-key tally (frozen.keys' `bucket[k]?.n`) also trusts the
// track key alone. This used to additionally require the play's own artist
// tag to word-match a narrow per-track allowlist (just 'RM'/'Rap Monster'
// for Wild Flower, etc.) — stricter than every other counting path in this
// codebase, and it silently dropped real plays: plenty of scrobble sources
// attribute a member's solo track to 'BTS' rather than the member's own
// name, and that combination never matched. These four titles (Wild
// Flower, Don't Say You Love Me, Haegeum, Killin' It Girl) don't collide
// with any other artist's differently-named catalog, so there's no
// collision risk an artist filter would actually be protecting against —
// only lost plays for no benefit.
function countTrack(bucket: DayBucket, track: SideTrackDefinition): number {
  let total = 0
  for (const key of trackKeys(track)) total += bucket[key]?.n || 0
  return total
}

export type SideMissionView = ReturnType<typeof buildSideMissions>

export function buildSideMissions(
  rows: { kst_date: string; track_counts: DayBucket }[],
  today: string,
) {
  const weekStart = kstWeekKey(today)
  const weekDates = kstDatesBetween(weekStart, addDaysStr(weekStart, 6))
  const byDate = new Map(rows.map((row) => [String(row.kst_date), row.track_counts || {}]))

  const tracks = TRACKS.map((track) => {
    const days = weekDates.map((date) => {
      const count = countTrack(byDate.get(date) || {}, track)
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
}
