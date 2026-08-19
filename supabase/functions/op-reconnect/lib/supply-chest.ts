// Supply Chest — a personal reward meter filled by credited VMA votes. See
// migration 20260819120000 for schema/config and rc_supply_chest_open for
// why the reward grant happens inside that one atomic SQL function rather
// than as a JS step after. Vote credit calls addChestFill immediately after
// the atomic vote RPC; badge delivery itself is database-triggered.
import type { GameContent, SupabaseDB } from './config.ts'

interface ChestConfig { threshold: number; daily_open_cap: number }

function chestConfig(content: GameContent): ChestConfig | null {
  return content.config.supply_chest || null
}

export async function addChestFill(supabase: SupabaseDB, agentNo: string, eventId: string, amount: number) {
  if (amount <= 0) return { success: true }
  const { error } = await supabase.rpc('rc_supply_chest_add_fill', {
    p_agent_no: agentNo, p_event_id: eventId, p_amount: amount,
  })
  if (error) console.error(`addChestFill failed for ${agentNo}/${eventId}: ${error.message}`)
  return error ? { success: false, error: error.message } : { success: true }
}

export async function getChestStatus(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = chestConfig(content)
  if (!cfg) return { success: false, error: 'not_configured' }

  const { data: progress } = await supabase.from('rc_supply_chest_progress')
    .select('fill_count').eq('agent_no', agentNo).eq('event_id', eventId).maybeSingle()
  const fillCount = progress?.fill_count || 0

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
  const { count: opensToday } = await supabase.from('rc_supply_chest_opens')
    .select('id', { count: 'exact', head: true })
    .eq('agent_no', agentNo).eq('event_id', eventId).gte('opened_at', todayStart.toISOString())

  return {
    success: true, fillCount, threshold: cfg.threshold,
    ready: fillCount >= cfg.threshold && (opensToday || 0) < cfg.daily_open_cap,
    dailyCap: cfg.daily_open_cap, opensToday: opensToday || 0,
  }
}

export async function openChest(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = chestConfig(content)
  if (!cfg) return { success: false, error: 'not_configured' }

  // Eligibility, weighted selection, fill spend, daily cap and reward grant
  // all happen under one database lock. Selecting here used to let two
  // simultaneous opens both choose the same supposedly one-time badge.
  const { data: result, error } = await supabase.rpc('rc_supply_chest_open', {
    p_agent_no: agentNo, p_event_id: eventId, p_threshold: cfg.threshold, p_daily_cap: cfg.daily_open_cap,
  })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'open_failed' }

  return {
    success: true,
    reward: { kind: result.rewardKind, ...(result.rewardDetail || {}) },
    fillRemaining: result.fillRemaining,
    threshold: cfg.threshold,
  }
}
