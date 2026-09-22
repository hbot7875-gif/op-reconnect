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

// Stale-while-revalidate: a row past its ttl is still served immediately,
// and the recompute runs after the response via EdgeRuntime.waitUntil (a
// Supabase Edge Functions background task). Nobody waits on a recompute —
// the district roster's took 4–8s, and one agent a minute was paying it.
// Past HARD_STALE × ttl (the background refresh kept failing, or nothing
// asked for the key in a long while) the value is recomputed inline again.
const HARD_STALE = 10
const inflight = new Set<string>()

function background(task: () => Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(task())
  else task().catch(() => {})
}

async function store(supabase: SupabaseDB, key: string, value: unknown) {
  await supabase.from('rc_cache').upsert({ key, value: value as Record<string, unknown>, updated_at: new Date().toISOString() })
}

export async function cachedJson<T>(
  supabase: SupabaseDB, key: string, ttlMs: number, compute: () => Promise<T>, fresh = false,
): Promise<T> {
  if (!fresh) {
    const { data } = await supabase.from('rc_cache').select('value, updated_at').eq('key', key).maybeSingle()
    if (data) {
      const age = Date.now() - new Date(data.updated_at).getTime()
      if (age < ttlMs) return data.value as T
      if (age < ttlMs * HARD_STALE) {
        if (!inflight.has(key)) {
          inflight.add(key)
          background(() => compute().then((v) => store(supabase, key, v)).finally(() => inflight.delete(key)))
        }
        return data.value as T
      }
    }
  }
  const value = await compute()
  // Fire-and-forget: the caller already has the value; a failed cache write
  // only means the next poll recomputes too.
  background(() => store(supabase, key, value))
  return value
}
