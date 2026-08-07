// Signal Sweep — the four-track daily signal-recovery loop carried forward
// from Arirang Mission. One play of every track secures the day; each track also
// has a 20-play weekly target. The daily clear replaces the retired Daily
// Transmission reward and pays +10 XP once through the shared XP ledger.

import { artistAllowed, normKeyFull, normalizeKey } from './text.ts'
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
  artistAliases: string[]
}

const TRACKS: SideTrackDefinition[] = [
  {
    id: 'wild-flower', name: 'Wild Flower', artist: 'RM',
    aliases: ['Wild Flower', 'Wild Flower (with Youjeen)', 'Wild Flower (feat. Youjeen)', '야생화', '야생화 Wild Flower'],
    artistAliases: ['RM', 'Rap Monster'],
  },
  {
    id: 'dont-say-you-love-me', name: "Don't Say You Love Me", artist: 'Jin',
    aliases: ["Don't Say You Love Me", 'Dont Say You Love Me', 'DSYLM'],
    artistAliases: ['Jin'],
  },
  {
    id: 'haegeum', name: 'Haegeum', artist: 'Agust D',
    aliases: ['Haegeum', '해금', '해금 Haegeum'],
    artistAliases: ['Agust D', 'Suga'],
  },
  {
    id: 'killin-it-girl', name: "Killin' It Girl", artist: 'j-hope',
    aliases: ["Killin' It Girl", 'Killin It Girl', 'Killing It Girl', "Killin' It Girl (feat. GloRilla)", "Killin' It Girl (Solo Version)"],
    artistAliases: ['j-hope', 'j hope', 'J-Hope'],
  },
]

function trackKeys(track: SideTrackDefinition): string[] {
  return [...new Set(track.aliases.map(normKeyFull).filter(Boolean))]
}

function countTrack(bucket: DayBucket, track: SideTrackDefinition): number {
  const artists = track.artistAliases.map(normalizeKey).filter(Boolean)
  let total = 0
  for (const key of trackKeys(track)) {
    const entry = bucket[key]
    if (!entry) continue
    total += Object.entries(entry.a || {}).reduce(
      (sum, [artist, count]) => sum + (artistAllowed(artist, artists) ? Number(count) || 0 : 0), 0)
  }
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
