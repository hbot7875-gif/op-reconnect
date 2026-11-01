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
    const status = await getMissionStatus(supabase, agentNo, districtId, frozenReconnect)
    // A secret-songs quest is named for its clue ("Surprise Songs for
    // Brazil") — without the name the hidden list is unguessable. Other
    // quests keep the generic title they have always shown.
    if (frozenReconnect.config?.sharedTracks) {
      const label = content.goals.find((g: any) => g.id === frozenReconnect.id)?.label
      return label ? { ...status, label } : status
    }
    return status
  }
  return await getPuzzleStatus(supabase, agentNo, districtId, frozenReconnect)
}
