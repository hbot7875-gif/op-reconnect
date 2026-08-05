// Thin dispatcher: the caller's own frozen reconnect goal (or none) already
// tells us which of the two variant families to resolve against — puzzle
// (sotd/cipher/memory) or co-op (connect/invite). One call site for
// handlers.ts's buildState(), so it never has to branch on variant itself.

import type { GameContent, SupabaseDB } from './config.ts'
import type { FrozenReconnectGoal } from './districts.ts'
import { getPuzzleStatus } from './reconnect-puzzle.ts'
import { getMissionStatus } from './reconnect-missions.ts'

export async function resolveReconnectStatus(
  supabase: SupabaseDB, content: GameContent, agentNo: string, districtId: string,
  frozenReconnect: FrozenReconnectGoal | null,
) {
  if (!frozenReconnect) return null
  if (frozenReconnect.variant === 'connect' || frozenReconnect.variant === 'invite') {
    return await getMissionStatus(supabase, agentNo, districtId, frozenReconnect)
  }
  return await getPuzzleStatus(supabase, agentNo, districtId, frozenReconnect)
}
