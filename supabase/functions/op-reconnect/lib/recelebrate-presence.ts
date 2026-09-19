// ARIRANG RE:CELEBRATE — live presence ("here" and "watching" counts).
//
// auth: 'agent' (index.ts verifies the session belongs to params.agentNo).
// The Party page calls this about once a minute; the check-in and the counts
// happen in one SQL call (migration 20260920000000_rc_recelebrate_presence).
// `watching` must be one of the Watch schedule's event ids, or empty.

import type { SupabaseDB } from './config.ts'
import { RECELEBRATE_EVENT_ID } from './recelebrate-tracks.js'

// Mirrors js/recelebrate-schedule.js's WATCH_SCHEDULE ids.
const WATCH_EVENT_IDS = new Set(['swim', 'comeback-live', 'goyang'])

export async function pingRecelebratePresence(supabase: SupabaseDB, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const raw = params.watching == null ? '' : String(params.watching)
  const watching = WATCH_EVENT_IDS.has(raw) ? raw : ''
  const { data, error } = await supabase.rpc('rc_recelebrate_presence_ping', {
    p_event: RECELEBRATE_EVENT_ID, p_agent: agentNo, p_watching: watching,
  })
  if (error) return { success: false, error: error.message }
  return {
    success: true,
    here: Number(data?.here) || 0,
    watching: data?.watching || {},
    serverNow: data?.serverNow || new Date().toISOString(),
  }
}
