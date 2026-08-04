// Moving things between the shelf and the Pack, and using a ticket.
// Split out from handlers.ts to keep it under the project's ~300-line rule.

import type { SupabaseDB } from './config.ts'

export async function placeItem(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const playerItemId = String(params.playerItemId || '')
  const districtId = params.districtId ? String(params.districtId) : null
  if (!playerItemId) return { success: false, error: 'playerItemId required' }

  const { data, error } = await supabase.from('rc_player_items')
    .update({ district_id: districtId })
    .eq('id', playerItemId).eq('agent_no', agentNo)
    .select('id').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: 'item_not_found' }
  return { success: true }
}

export async function useItem(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const playerItemId = String(params.playerItemId || '')
  if (!playerItemId) return { success: false, error: 'playerItemId required' }

  // The stub stays on the shelf afterward — this only stamps used_at,
  // never deletes the row.
  const { data, error } = await supabase.from('rc_player_items')
    .update({ used_at: new Date().toISOString() })
    .eq('id', playerItemId).eq('agent_no', agentNo).is('used_at', null)
    .select('id').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: 'item_not_found_or_already_used' }
  return { success: true }
}
