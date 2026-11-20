// MAMA 2026 live voting banner + popup — routes. The rules are
// mama-live-rules.js; the state is one rc_config row ('mama_live') that only
// the admin dashboard changes. Nothing here switches state on its own.

import type { SupabaseDB } from './config.ts'
import { loadContent, invalidateContentCache } from './config.ts'
import { normalizeMamaLive, nextMamaLive } from './mama-live-rules.js'

const KEY = 'mama_live'

/** Public (landing page, no session): the current state only. */
export async function getMamaLive(supabase: SupabaseDB, _params: Record<string, unknown>) {
  const content = await loadContent(supabase)
  return { success: true, mamaLive: normalizeMamaLive(content.config[KEY]) }
}

/** Admin key only: Upcoming / Live / Hidden, and the ceremony start. Read
 *  fresh (not from the content cache) so liveSince is never lost. */
export async function adminSetMamaLive(supabase: SupabaseDB, params: Record<string, unknown>) {
  const { data: row, error: readError } = await supabase.from('rc_config').select('value').eq('key', KEY).maybeSingle()
  if (readError) return { success: false, error: 'server_error' }
  const next = nextMamaLive(row?.value || null, {
    state: String(params.state || ''),
    startsAt: params.startsAt === undefined ? undefined : (params.startsAt as string | null),
    voteUrl: params.voteUrl === undefined ? undefined : (params.voteUrl as string | null),
  })
  if ('error' in next) return { success: false, error: next.error }
  const { error } = await supabase.from('rc_config').upsert({ key: KEY, value: next.value }, { onConflict: 'key' })
  if (error) return { success: false, error: 'server_error' }
  invalidateContentCache()
  return { success: true, mamaLive: normalizeMamaLive(next.value) }
}
