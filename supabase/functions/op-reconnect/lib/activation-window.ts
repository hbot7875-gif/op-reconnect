// The 148 Protocol's "today" quota (js/playlist.js) resets on the
// district's own activation clock, not KST midnight (site owner: "change
// it to district activation time") — every subsequent "day" for that
// specific district is exactly 24h after the last, whatever time of day
// the agent originally tapped Begin Restoration. rc_daily_activity can't
// answer this on its own: it's bucketed by whole KST calendar day, and an
// activation-anchored window can straddle two of those. Reads raw
// rc_scrobbles instead, precise to the second, same "one bounded query,
// paginate defensively" shape reconnect-missions.ts's contributionTotals
// and bomb.ts's Red Zone read already use.

import type { SupabaseDB } from './config.ts'
import { normKeyFull } from './text.ts'

const DAY_MS = 86_400_000
const PAGE_SIZE = 1_000

/** [fromSec, toSec) of the district's CURRENT rolling day — activatedAt
 *  plus however many whole 24h periods have elapsed since. The very first
 *  window starts exactly at activation, so (unlike the KST-day baseline
 *  the cumulative total still needs) nothing from before activation can
 *  ever land in it — no separate baseline subtraction required. */
export function activationDayBounds(activatedAt: string, nowMs = Date.now()): { fromSec: number; toSec: number } {
  const activatedMs = new Date(activatedAt).getTime()
  const elapsedDays = Math.max(0, Math.floor((nowMs - activatedMs) / DAY_MS))
  const fromMs = activatedMs + elapsedDays * DAY_MS
  return { fromSec: Math.floor(fromMs / 1000), toSec: Math.floor((fromMs + DAY_MS) / 1000) }
}

/** Normalized-key -> count for every real play in that window — what
 *  districts.ts's districtProgress() reads in place of its old KST-day
 *  bucket lookup when this is supplied as todayWindowCounts. */
export async function activationDayCounts(
  supabase: SupabaseDB, agentNo: string, fromSec: number, toSec: number,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.from('rc_scrobbles')
      .select('track_name').eq('agent_no', agentNo)
      .gte('listened_at', fromSec).lt('listened_at', toSec)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error || !data?.length) break
    for (const row of data) {
      const key = normKeyFull(row.track_name)
      if (key) totals.set(key, (totals.get(key) || 0) + 1)
    }
    if (data.length < PAGE_SIZE) break
  }
  return totals
}
