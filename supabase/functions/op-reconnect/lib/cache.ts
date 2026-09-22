// Shared, DB-backed cache for network-wide values (migration
// 20260922140000_rc_cache.sql). Why not a module-level Map: every request
// here can land on a fresh edge isolate, so an in-memory cache is cold far
// more often than warm — measured on getGameState, the 60s era-timeline
// cache missed on four consecutive polls. A row in Postgres is seen by
// every isolate, and reading it is one round trip.
//
// Semantics are deliberately loose: a stale row is served until someone
// recomputes it, and two concurrent recomputes just both write (last one
// wins; both values are equally fresh). The values cached this way are
// cumulative/aggregate stats where a few seconds of staleness is invisible.

import type { SupabaseDB } from './config.ts'

export async function cachedJson<T>(
  supabase: SupabaseDB, key: string, ttlMs: number, compute: () => Promise<T>, fresh = false,
): Promise<T> {
  if (!fresh) {
    const { data } = await supabase.from('rc_cache').select('value, updated_at').eq('key', key).maybeSingle()
    if (data && Date.now() - new Date(data.updated_at).getTime() < ttlMs) return data.value as T
  }
  const value = await compute()
  // Fire-and-forget: the caller already has the value; a failed cache write
  // only means the next poll recomputes too.
  supabase.from('rc_cache').upsert({ key, value: value as unknown as Record<string, unknown>, updated_at: new Date().toISOString() })
    .then(() => {}, () => {})
  return value
}
