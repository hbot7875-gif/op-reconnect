// Signal Sweep — the four-track daily signal-recovery loop carried forward
// from Arirang Mission. One play of every track secures the day; each track also
// has a 20-play weekly target. The daily clear replaces the retired Daily
// Transmission reward and pays +10 XP once through the shared XP ledger.

import { normKeyFull } from './text.ts'
import { addDaysStr, kstDatesBetween, kstWeekKey } from './kst.ts'
import type { SupabaseDB } from './config.ts'
import type { DayBucket } from './transmission.ts'

const DAILY_REQUIRED = 1
const WEEKLY_REQUIRED = 20
export const SIDE_MISSION_XP = 10

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
