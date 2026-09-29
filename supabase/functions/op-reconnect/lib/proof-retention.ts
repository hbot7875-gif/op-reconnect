// Deleting a file is two writes to two systems. This is the half that talks
// to Storage.
//
// A vote proof is a screenshot of somebody's own streaming or voting account.
// It exists to verify one entry, and 30 days after its event ends there is no
// reason left to hold it — so the Privacy Policy promises it goes, and this
// keeps that promise.
//
// THE ORDER MATTERS, and the first draft of this file got it wrong. It asked
// the database to clear the reference and hand back the path in one statement,
// then deleted the file. Two things were wrong with that: UPDATE ... RETURNING
// hands back the NEW value, so every path came back NULL; and even with the
// right path, a crash between the two steps would have left a file nothing
// points at — unreachable and impossible to find again. The bucket already
// holds 92 such files from the existing purge, which is what that looks like.
//
// So: the path is queued in the database FIRST, the file is deleted SECOND,
// and the row is cleared only THIRD, once Storage has confirmed. A crash at
// any point leaves the work queued. Every step is safe to re-run.
//
// This rides the hourly stream sync, so nothing here may throw.

import type { SupabaseDB } from './config.ts'

// Storage removes in batches. 100 keeps a single call well inside the
// function's budget even on the first real sweep, which is the big one.
const REMOVE_BATCH = 100

// Ceiling per sweep. The queue is drained across runs rather than in one go,
// so an outage that backs up thousands of files cannot turn one hourly sync
// into a 150-second timeout.
const SWEEP_LIMIT = 500

export type StorageSweep = {
  queued: number
  claimed: number
  deleted: number
  failed: number
  refsCleared: number
  /** Rows this worker deleted from Storage but no longer owned by the time it
   *  tried to record that. Non-zero means a lease lapsed mid-sweep — the work
   *  is not lost (another worker re-does it, harmlessly) but it is worth
   *  seeing in the log, because a persistent count means the lease is too
   *  short for how long Storage is taking. */
  lost: number
  errors: string[]
}

const empty = (): StorageSweep => ({ queued: 0, claimed: 0, deleted: 0, failed: 0, refsCleared: 0, lost: 0, errors: [] })

/** Every event that has taken a proof. Reading the ids from the votes
 *  themselves means a future event needs no code change here.
 *  Paginated: `limit` on a 1,852-row table would otherwise silently cap the
 *  event list the day that table grows past it. */
async function eventsWithProofs(supabase: SupabaseDB, errors: string[]): Promise<string[]> {
  const seen = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('rc_vma_votes').select('event_id')
      .not('proof_path', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { errors.push(`event scan: ${error.message}`); break }
    if (!data?.length) break
    for (const row of data) {
      const id = String((row as any)?.event_id || '')
      if (id) seen.add(id)
    }
    if (data.length < PAGE) break
  }
  return [...seen]
}

/** Queue → delete → clear. Returns what it did; never throws. */
export async function sweepStorageDeletions(
  supabase: SupabaseDB,
  opts: { days?: number; limit?: number; reason?: string } = {},
): Promise<StorageSweep> {
  const out = empty()
  const days = opts.days ?? 30
  const limit = opts.limit ?? SWEEP_LIMIT

  try {
    // ── 1. Queue anything newly due. Writes to the queue only; the vote rows
    //       keep pointing at their files until the files are actually gone.
    //       Skipped entirely for a rehearsal: a `reason`-scoped sweep drains
    //       exactly the rows it was pointed at and queues nothing new.
    for (const eventId of opts.reason ? [] : await eventsWithProofs(supabase, out.errors)) {
      const { data, error } = await supabase
        .rpc('rc_queue_expired_vote_proofs', { p_event_id: eventId, p_days: days })
      if (error) out.errors.push(`queue ${eventId}: ${error.message}`)
      else out.queued += Number(data) || 0
    }

    // ── 2. Claim under a lease, then delete.
    //
    //       The lease is what makes this safe to run twice at once. An RPC is
    //       its own transaction, so row locks are gone the moment the claim
    //       returns; without a durable marker a second sweep starting a second
    //       later would take the identical rows. The claim writes an owner and
    //       an expiry that outlive the transaction, and every completion call
    //       below is checked against that owner.
    const owner = crypto.randomUUID()
    const { data: claimed, error: claimErr } = await supabase
      .rpc('rc_next_storage_deletions', { p_limit: limit, p_owner: owner, p_reason: opts.reason ?? null })
    if (claimErr) { out.errors.push(`claim: ${claimErr.message}`); return out }

    const rows = (claimed || []) as Array<{ id: number; bucket: string; path: string }>
    out.claimed = rows.length

    // Group by bucket: one queue serves every bucket, and Storage removes
    // per bucket.
    const byBucket = new Map<string, Array<{ id: number; path: string }>>()
    for (const r of rows) {
      const bucket = String(r?.bucket || '')
      const path = String(r?.path || '')
      if (!bucket || !path) continue
      if (!byBucket.has(bucket)) byBucket.set(bucket, [])
      byBucket.get(bucket)!.push({ id: Number(r.id), path })
    }

    for (const [bucket, items] of byBucket) {
      for (let i = 0; i < items.length; i += REMOVE_BATCH) {
        const batch = items.slice(i, i + REMOVE_BATCH)
        const ids = batch.map((b) => b.id)
        const { error } = await supabase.storage.from(bucket).remove(batch.map((b) => b.path))

        if (error) {
          // Left pending with attempts+1. A file that was already gone is not
          // an error Storage reports — remove() succeeds for missing keys — so
          // this really is a failure worth retrying.
          out.failed += batch.length
          out.errors.push(`${bucket}: ${batch.length} file(s): ${error.message}`)
          const { error: markErr } = await supabase
            .rpc('rc_mark_storage_failed', { p_ids: ids, p_error: error.message, p_owner: owner })
          if (markErr) out.errors.push(`mark failed: ${markErr.message}`)
          continue
        }

        const { data: n, error: markErr } = await supabase
          .rpc('rc_mark_storage_deleted', { p_ids: ids, p_owner: owner })
        if (markErr) {
          // The files ARE gone; we simply could not record it. The rows stay
          // pending and the next sweep re-deletes them, which is a no-op.
          out.errors.push(`mark deleted: ${markErr.message}`)
          continue
        }
        const recorded = Number(n) || 0
        out.deleted += recorded
        // Fewer rows recorded than we deleted means the lease lapsed and
        // somebody else owns them now. Harmless — they will be deleted again,
        // which Storage treats as a no-op — but worth surfacing.
        if (recorded < batch.length) out.lost += batch.length - recorded
      }
    }

    // ── 3. Only now: clear the references, and only to files Storage has
    //       confirmed are gone. Safe to run even when step 2 did nothing —
    //       it picks up anything a previous crash left half-finished.
    const { data: cleared, error: clearErr } = await supabase
      .rpc('rc_clear_expired_proof_refs', { p_limit: 5000 })
    if (clearErr) out.errors.push(`clear refs: ${clearErr.message}`)
    else out.refsCleared = Number(cleared) || 0
  } catch (e) {
    // Belt and braces: this rides the hourly sync and must never take it down.
    out.errors.push(String((e as Error)?.message || e))
  }

  return out
}
