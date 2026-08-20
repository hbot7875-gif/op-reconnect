// Group Supply Chest — unlocks for every agent at once when the WHOLE
// fandom's cumulative verified VMA vote count crosses a milestone, not
// something any one agent fills alone (contrast supply-chest.ts, which is
// a personal meter). The point is to make players root for everyone's
// votes, not just their own. See migration 20260820140000 for the
// schema/RPC this calls into.
import type { GameContent, SupabaseDB } from './config.ts'

/** Milestone thresholds — explicit spec: 150, then 250, then 400 votes
 *  above the baseline (see below), with each next gap 50 bigger than the
 *  last (100, 150, 200, 250, ...) so it's easy to hit early (building the
 *  check-in habit) and harder later once there's real momentum behind it.
 *  Closed form of that gap sequence, index 0-based: threshold(0)=150,
 *  threshold(1)=250, threshold(2)=400, threshold(3)=600, threshold(4)=850,
 *  ... */
export function communityChestThreshold(index: number): number {
  return 150 + 25 * index * (index + 3)
}

/** Votes logged before this feature shipped don't count toward the first
 *  milestone — see migration 20260820140000's comment on baseline_votes.
 *  Without this, launching mid-campaign would hand every agent several
 *  chests at once instead of the intended "vote together, unlock
 *  together" pacing. */
function communityChestBaseline(content: GameContent): number {
  return Number(content.config.vma_community_chest?.baseline_votes) || 0
}

async function cumulativeCommunityVotes(supabase: SupabaseDB, eventId: string): Promise<number> {
  const { data } = await supabase.from('rc_vma_votes')
    .select('votes_logged').eq('event_id', eventId).eq('verify_status', 'verified')
  return (data || []).reduce((s: number, r: any) => s + r.votes_logged, 0)
}

function milestonesReached(cumulative: number): number {
  let k = 0
  while (cumulative >= communityChestThreshold(k)) k++
  return k
}

/** Cheap, agent-independent summary — folded into the World-screen banner
 *  (getVmaBanner) so the progress bar toward the next Group Chest shows up
 *  on the same poll every other banner stat already uses. cumulative here
 *  is already baseline-adjusted — what the player sees is "votes toward
 *  the next chest," not the campaign's raw historical total. */
export async function getCommunityChestSummary(supabase: SupabaseDB, content: GameContent, eventId: string) {
  const raw = await cumulativeCommunityVotes(supabase, eventId)
  const cumulative = Math.max(0, raw - communityChestBaseline(content))
  const reached = milestonesReached(cumulative)
  const nextThreshold = communityChestThreshold(reached)
  return { cumulative, reached, nextThreshold, nextRemaining: Math.max(0, nextThreshold - cumulative) }
}

/** Full per-agent status — which already-reached milestones THIS agent
 *  hasn't claimed yet (there can be more than one if they haven't opened
 *  the mission in a while; each is claimed, and rewarded, separately). */
export async function getCommunityChestStatus(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const summary = await getCommunityChestSummary(supabase, content, eventId)

  const { data: claimedRows } = await supabase.from('rc_vma_community_chest_claims')
    .select('milestone_index').eq('agent_no', agentNo).eq('event_id', eventId)
  const claimed = new Set((claimedRows || []).map((r: any) => r.milestone_index))
  const claimableIndices: number[] = []
  for (let i = 0; i < summary.reached; i++) if (!claimed.has(i)) claimableIndices.push(i)

  return {
    success: true,
    cumulativeVotes: summary.cumulative,
    nextThreshold: summary.nextThreshold,
    nextRemaining: summary.nextRemaining,
    claimableIndices,
    claimedCount: claimed.size,
  }
}

export async function openCommunityChest(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const milestoneIndex = Number(params.milestoneIndex)
  if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0) return { success: false, error: 'bad_milestone' }
  const threshold = communityChestThreshold(milestoneIndex) + communityChestBaseline(content)

  const { data: result, error } = await supabase.rpc('rc_vma_community_chest_open', {
    p_agent_no: agentNo, p_event_id: eventId, p_milestone_index: milestoneIndex, p_threshold: threshold,
  })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'open_failed' }

  const rewards = (result.rewards || []).map((r: any) => ({ kind: r.kind, ...(r.detail || {}) }))
  return { success: true, rewards, milestoneIndex, threshold }
}
