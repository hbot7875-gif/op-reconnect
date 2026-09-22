// Leave / pause — see migrations/20260922100000_rc_player_leave.sql for the
// rules. Everything that changes state happens inside the two RPCs (one
// advisory lock per agent, all clocks shifted in one transaction); this
// file is the thin auth'd surface plus the read used by buildState.

import type { SupabaseDB } from './config.ts'

export const LEAVE_MIN_DAYS = 3
export const LEAVE_MAX_DAYS = 14
export const LEAVE_COOLDOWN_DAYS = 14

export type LeaveView = {
  startsAt: string
  endsAt: string
  daysLeft: number
  districtPaused: boolean
}

type LeaveRow = { starts_at: string; ends_at: string; ended_at: string | null; district_id: string | null }

function endOf(r: LeaveRow): number { return new Date(r.ended_at || r.ends_at).getTime() }

/** One read for everything buildState needs: the leave in force (if any)
 *  and when the next one may start (null = right now). Recent rows only —
 *  the cooldown is 14 days, so nothing older can matter. */
export async function leaveStatus(supabase: SupabaseDB, agentNo: string): Promise<{ leave: LeaveView | null; availableAt: string | null }> {
  const now = Date.now()
  const { data } = await supabase.from('rc_player_leaves')
    .select('starts_at, ends_at, ended_at, district_id').eq('agent_no', agentNo)
    .order('starts_at', { ascending: false }).limit(3)
  const rows = (data || []) as LeaveRow[]
  const current = rows.find((r) => new Date(r.starts_at).getTime() <= now && endOf(r) > now) || null
  const leave: LeaveView | null = current ? {
    startsAt: current.starts_at,
    endsAt: current.ended_at || current.ends_at,
    daysLeft: Math.max(0, Math.ceil((endOf(current) - now) / 86_400_000)),
    districtPaused: !!current.district_id,
  } : null
  const latestEnd = rows.reduce((m, r) => Math.max(m, endOf(r)), 0)
  const cooldownEnds = latestEnd ? latestEnd + LEAVE_COOLDOWN_DAYS * 86_400_000 : 0
  return { leave, availableAt: !leave && cooldownEnds > now ? new Date(cooldownEnds).toISOString() : null }
}

export async function activeLeave(supabase: SupabaseDB, agentNo: string): Promise<LeaveView | null> {
  return (await leaveStatus(supabase, agentNo)).leave
}

/** Every leave window overlapping [fromMs, toMs], summed — used to keep leave
 *  time out of the "days since the Bomb was fed" health meter, matching the
 *  SQL cleanup rule. */
export async function leaveOverlapMs(supabase: SupabaseDB, agentNo: string, fromMs: number, toMs: number): Promise<number> {
  const { data } = await supabase.from('rc_player_leaves')
    .select('starts_at, ends_at, ended_at').eq('agent_no', agentNo)
    .gte('ends_at', new Date(fromMs).toISOString())
  let total = 0
  for (const r of data || []) {
    const s = Math.max(fromMs, new Date(r.starts_at).getTime())
    const e = Math.min(toMs, new Date(r.ended_at || r.ends_at).getTime())
    if (e > s) total += e - s
  }
  return total
}

export async function startLeave(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const days = Math.round(Number(params.days))
  if (!Number.isFinite(days) || days < LEAVE_MIN_DAYS || days > LEAVE_MAX_DAYS) {
    return { success: false, error: 'leave_days_out_of_range' }
  }
  const { data, error } = await supabase.rpc('rc_leave_start', { p_agent: agentNo, p_days: days })
  if (error) return { success: false, error: error.message }
  if (!data?.success) return { success: false, error: data?.error || 'leave_failed', availableAt: data?.availableAt || null }
  return { success: true, leave: await activeLeave(supabase, agentNo) }
}

export async function endLeave(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data, error } = await supabase.rpc('rc_leave_end', { p_agent: agentNo })
  if (error) return { success: false, error: error.message }
  if (!data?.success) return { success: false, error: data?.error || 'leave_end_failed' }
  return { success: true, endedAt: data.endedAt, leaveAvailableAt: (await leaveStatus(supabase, agentNo)).availableAt }
}
