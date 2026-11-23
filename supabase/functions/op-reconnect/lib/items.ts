// Moving things between the shelf and the Pack, and using a ticket.
// Split out from handlers.ts to keep it under the project's ~300-line rule.

import type { SupabaseDB } from './config.ts'

/** Can this go on a district shelf? Backup Passes / utility items can't. */
export function isPlaceableItem(item: { itemId?: string | null; kind?: string | null }) {
  return !!item && item.kind !== 'utility' && item.itemId !== 'backup-pass'
}

export async function placeItem(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const playerItemId = String(params.playerItemId || '')
  const districtId = params.districtId ? String(params.districtId) : null
  if (!playerItemId) return { success: false, error: 'playerItemId required' }

  // Only keepsakes go on a shelf. Backup Passes (utility) are functional and
  // are refused here; taking anything back to the Pack (districtId null) is
  // always allowed, so items placed before this check can still come home.
  // Nothing already placed is moved or deleted.
  if (districtId) {
    const { data: owned } = await supabase.from('rc_player_items')
      .select('item_id, rc_items(kind)').eq('id', playerItemId).eq('agent_no', agentNo).maybeSingle()
    if (!owned) return { success: false, error: 'item_not_found' }
    if (!isPlaceableItem({ itemId: owned.item_id, kind: owned.rc_items?.kind })) return { success: false, error: 'not_placeable' }
  }

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
