// Skip Quest's evidence race, and the bounded retry that survives it.
//
// The exit is decided from a snapshot: the service reads rc_scrobbles' current
// high-water mark, counts every joined member's contribution, then hands both
// to rc_quest_skip_v2. The RPC refuses if any roster member received a scrobble
// in that gap, because deciding a free path or freezing a teammate's pooled
// streams from a snapshot already known to be stale is worse than refusing.
//
// That guard is right. What was missing is that nothing retried it. On an ACTIVE
// team the gap is exactly when scrobbles arrive, so Skip became least reliable
// precisely when a stalled quest made it most necessary — measured on a live
// five-person roster taking 18 scrobbles an hour, with the player tapping Skip
// repeatedly and every attempt rejected before the RPC.
//
// So: retry the SNAPSHOT, never the write. The guard, the price, the cooldown,
// the waiting period, the free-reason logic and waives_requirement all stay
// exactly where they are, in SQL, unchanged.
//
// ── Why retrying here cannot double-charge ────────────────────────────────
// rc_quest_skip_v2 calls rc_quest_skip_quote_v2 first and returns immediately
// if it fails — both stale-evidence guards live in the quote, and the INSERT
// into rc_quest_skips comes later in the function body. So a rejection with
// `contribution_changed` or `contribution_unavailable` provably wrote nothing:
// no ledger row, no cell deduction, no skip row, no frozen contribution.
// Those two, and only those two, are re-callable.
//
// Anything else is terminal and returns as-is: a transport error is NOT
// retried, because a lost response cannot be distinguished from a failed call
// and a second attempt could charge twice. Failing visibly beats charging
// twice for one exit.

/** The two RPC rejections that happen before any write, and can be re-tried
 *  against a fresh snapshot. Nothing else belongs here — adding a code that
 *  can return AFTER the insert would make a double charge reachable. */
export const RETRYABLE_RPC_ERRORS = ['contribution_changed', 'contribution_unavailable'] as const

/** Evidence failures that will never resolve by asking again.
 *
 *  The mission points at a goal the content catalog no longer has, so no
 *  contribution can be computed for anyone on it, this second or next. Asking
 *  again just spends the player's time before the same refusal. Everything
 *  else that throws out of the evidence build — the stream cursor read, the
 *  participant read, a content load — is a transient read problem and is worth
 *  one more look. */
export const PERMANENT_EVIDENCE_ERRORS = ['quest_goal_unavailable'] as const

export const SKIP_RETRY_ATTEMPTS = 3
/** Long enough to clear a single ingestion write, short enough that the player
 *  reads it as one tap. Three attempts is ~0.7s of added latency worst case. */
export const SKIP_RETRY_DELAY_MS = 350

export function isRetryableRpcError(code: unknown): boolean {
  return RETRYABLE_RPC_ERRORS.includes(String(code ?? '') as typeof RETRYABLE_RPC_ERRORS[number])
}

export function isPermanentEvidenceError(message: unknown): boolean {
  const text = String(message ?? '')
  return PERMANENT_EVIDENCE_ERRORS.some((code) => text.includes(code))
}

export interface SkipAttemptDeps<E, R> {
  /** Snapshot + count. Throws on an unusable read. Re-run on every attempt. */
  buildEvidence: () => Promise<E>
  /** The authoritative write. Called at most once per attempt, never after a
   *  success, and never after the caller says the window has closed. */
  callRpc: (evidence: E) => Promise<{ data?: R; error?: { message?: string } | null }>
  /** False once the quest can no longer be skipped on the terms the player
   *  agreed to — checked BEFORE each retry so an expiry landing mid-retry
   *  cannot silently turn a paid, waiving Skip into a free Expired Exit the
   *  player never chose. Nothing is written in that case. */
  stillSkippable: () => boolean
  attempts?: number
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type SkipAttemptOutcome<R> =
  | { ok: true; data: R; attempts: number }
  | { ok: false; error: string; data?: R; attempts: number; exhausted: boolean }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run the read/evidence stage up to `attempts` times, calling the write RPC
 * once per attempt, and stop the instant anything terminal happens.
 *
 * Retries exactly two situations, both proven to precede the write:
 *   - the evidence build threw a transient read error
 *   - the RPC rejected with contribution_changed / contribution_unavailable
 *
 * Everything else — success, affordability, cooldown, waiting period, expiry,
 * not_in_mission, a transport error, a permanent evidence failure — returns on
 * the spot.
 */
export async function runSkipWithEvidenceRetry<E, R extends { success?: boolean; error?: string }>(
  deps: SkipAttemptDeps<E, R>,
): Promise<SkipAttemptOutcome<R>> {
  const attempts = deps.attempts ?? SKIP_RETRY_ATTEMPTS
  const delayMs = deps.delayMs ?? SKIP_RETRY_DELAY_MS
  const sleep = deps.sleep ?? wait
  let last = 'contribution_changed'

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Re-checked every attempt, including the first: a quest that expired
    // while the player sat on the confirm sheet must not be written either.
    if (!deps.stillSkippable()) {
      return { ok: false, error: last, attempts: attempt - 1, exhausted: false }
    }

    let evidence: E
    try {
      evidence = await deps.buildEvidence()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (isPermanentEvidenceError(message)) {
        return { ok: false, error: 'contribution_unavailable', attempts: attempt, exhausted: false }
      }
      last = 'contribution_unavailable'
      if (attempt === attempts) return { ok: false, error: last, attempts: attempt, exhausted: true }
      await sleep(delayMs)
      continue
    }

    const { data, error } = await deps.callRpc(evidence)

    // A transport error is terminal on purpose — see the header.
    if (error) return { ok: false, error: error.message || 'skip_failed', attempts: attempt, exhausted: false }

    // The write succeeded. Stop here, unconditionally: no further attempt, no
    // second call, no chance of a second charge.
    if (data?.success) return { ok: true, data: data as R, attempts: attempt }

    const code = data?.error || 'skip_failed'
    if (!isRetryableRpcError(code)) {
      return { ok: false, error: code, data, attempts: attempt, exhausted: false }
    }
    last = code
    if (attempt === attempts) return { ok: false, error: code, data, attempts: attempt, exhausted: true }
    await sleep(delayMs)
  }

  return { ok: false, error: last, attempts, exhausted: true }
}
