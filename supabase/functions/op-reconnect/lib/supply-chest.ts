// Supply Chest — a personal reward meter filled by credited VMA votes. See
// migration 20260819120000 for schema/config and rc_supply_chest_open for
// why the reward grant happens inside that one atomic SQL function rather
// than as a JS step after. addChestFill is called from vma-voting.ts right
// after a vote is credited; everything else here is the open flow.
import type { GameContent, SupabaseDB } from './config.ts'

interface RewardDef { kind: string; weight: number; amount?: number; templateId?: string }
interface ChestConfig { threshold: number; daily_open_cap: number; rewards: RewardDef[] }

function chestConfig(content: GameContent): ChestConfig | null {
  return content.config.supply_chest || null
}

export async function addChestFill(supabase: SupabaseDB, agentNo: string, eventId: string, amount: number) {
  if (amount <= 0) return
  await supabase.rpc('rc_supply_chest_add_fill', { p_agent_no: agentNo, p_event_id: eventId, p_amount: amount })
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

function pickReward(rewards: RewardDef[], ownedBadgeIds: Set<string>): RewardDef {
  // (dup-badge protection) Excluding an already-owned badge template and
  // weighted-picking from what's left IS the "redistribute its probability
  // across the others" — no separate renormalization math needed, that's
  // just what weighted random over a smaller pool already does.
  const pool = rewards.filter((r) => r.kind !== 'badge' || !ownedBadgeIds.has(r.templateId || ''))
  const total = pool.reduce((s, r) => s + r.weight, 0)
  let roll = Math.random() * total
  for (const r of pool) {
    roll -= r.weight
    if (roll <= 0) return r
  }
  return pool[pool.length - 1]
}

export async function openChest(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = chestConfig(content)
  if (!cfg) return { success: false, error: 'not_configured' }

  const badgeTemplateIds = cfg.rewards.filter((r) => r.kind === 'badge' && r.templateId).map((r) => r.templateId as string)
  const { data: owned } = badgeTemplateIds.length
    ? await supabase.from('rc_badges').select('badge_id').eq('agent_no', agentNo).in('badge_id', badgeTemplateIds)
    : { data: [] }
  const ownedBadgeIds = new Set((owned || []).map((b: any) => b.badge_id as string))

  const reward = pickReward(cfg.rewards, ownedBadgeIds)
  const detail = reward.kind === 'xp' ? { amount: reward.amount ?? 10 }
    : reward.kind === 'badge' ? { templateId: reward.templateId }
    : {}

  const { data: result, error } = await supabase.rpc('rc_supply_chest_open', {
    p_agent_no: agentNo, p_event_id: eventId, p_threshold: cfg.threshold, p_daily_cap: cfg.daily_open_cap,
    p_reward_kind: reward.kind, p_reward_detail: detail,
  })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'open_failed' }

  return { success: true, reward: { kind: reward.kind, ...detail }, fillRemaining: result.fillRemaining, threshold: cfg.threshold }
}
