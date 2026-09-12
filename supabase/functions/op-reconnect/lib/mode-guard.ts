// Mode-volume review. This is deliberately a hint, never an enforcement
// rule. Providers do not give us reliable play duration or device/session
// identity, so a daily play total cannot prove how many devices were used.
// A 3-minute average is useful for finding accounts worth reviewing, but it
// is not a physical limit: shorter tracks can legitimately exceed it.

import type { SupabaseDB } from './config.ts'
import { todayKst, addDaysStr } from './kst.ts'

export const REVIEW_AVG_TRACK_SECONDS = 180
export const SECONDS_PER_DAY = 86_400

// Uses the top of each advertised account range. The result is an estimated
// review threshold, not a claim that a higher total is impossible.
const MODE_DEVICE_COUNT: Record<string, number> = { easy: 1, medium: 4, hard: 6, exam: 1 }

export function dailyStreamReviewThreshold(mode: string): number {
  const devices = MODE_DEVICE_COUNT[mode] ?? 1
  return Math.floor((SECONDS_PER_DAY / REVIEW_AVG_TRACK_SECONDS) * devices)
}

// Avoid interrupting a player for one unusually busy day. Three high-volume
// days in the trailing week are enough to show a gentle mode reminder.
const VIOLATION_WINDOW_DAYS = 7
const VIOLATION_DAYS_TO_TRIGGER = 3

export interface ModeVolumeReview {
  mode: string
  highVolumeDays: number
  reviewThreshold: number
}

export function reviewModeVolume(rawStreams: number[], mode: string): ModeVolumeReview | null {
  const reviewThreshold = dailyStreamReviewThreshold(mode)
  const highVolumeDays = rawStreams.filter((n) => Number(n || 0) > reviewThreshold).length
  return highVolumeDays >= VIOLATION_DAYS_TO_TRIGGER
    ? { mode, highVolumeDays, reviewThreshold }
    : null
}

/** Called after the latest rollup so the reminder uses current totals. */
export async function getModeVolumeReview(
  supabase: SupabaseDB, agentNo: string, mode: string,
): Promise<ModeVolumeReview | null> {
  const since = addDaysStr(todayKst(), -(VIOLATION_WINDOW_DAYS - 1))
  const { data: days } = await supabase.from('rc_daily_activity')
    .select('raw_streams').eq('agent_no', agentNo).gte('kst_date', since)
  return reviewModeVolume((days || []).map((d: any) => Number(d.raw_streams || 0)), mode)
}
