// Skip Quest's bounded evidence retry.
//
// The bug being pinned: on an ACTIVE roster, rc_quest_skip_v2 rejects with
// contribution_changed whenever a teammate's scrobble lands between the
// high-water snapshot and the RPC — and nothing retried it, so the player got
// refused over and over with no way through. Reproduced from a real five-person
// roster taking ~18 scrobbles an hour. No production row is used here; the
// fixtures carry the same shape.
//
// The thing these tests exist to protect is not "it retries". It is that the
// retry can never reach the write twice.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  RETRYABLE_RPC_ERRORS,
  PERMANENT_EVIDENCE_ERRORS,
  SKIP_RETRY_ATTEMPTS,
  isRetryableRpcError,
  isPermanentEvidenceError,
  runSkipWithEvidenceRetry,
} from './quest-skip-retry.ts'

/** The quote AGENT050's state actually produces, minus her identity. */
const PAID_SKIP_OK = {
  success: true, free: false, freeReason: null,
  costXp: 75, costCells: 2, waivesRequirement: true,
}

/** A harness that records every call, so "was the write reached twice?" is a
 *  fact rather than an inference. */
function harness({ evidence = [], rpc = [], skippable = () => true } = {}) {
  const calls = { buildEvidence: 0, callRpc: 0, sleeps: [] }
  const next = (script, i, fallback) => (i < script.length ? script[i] : fallback)
  return {
    calls,
    deps: {
      buildEvidence: async () => {
        const step = next(evidence, calls.buildEvidence++, { ok: true })
        if (step.throws) throw new Error(step.throws)
        return { contributions: { A1: 5, A2: 5 }, highWater: 1000 + calls.buildEvidence }
      },
      callRpc: async () => {
        const step = next(rpc, calls.callRpc++, { data: PAID_SKIP_OK })
        return step
      },
      stillSkippable: skippable,
      delayMs: 0,
      sleep: async (ms) => { calls.sleeps.push(ms) },
    },
  }
}

const changed = { data: { success: false, error: 'contribution_changed' } }
const unavailable = { data: { success: false, error: 'contribution_unavailable' } }
const ok = { data: PAID_SKIP_OK }

/* ── the classifiers ───────────────────────────────────────────────────── */

test('only the two pre-write rejections are retryable', () => {
  assert.deepEqual([...RETRYABLE_RPC_ERRORS], ['contribution_changed', 'contribution_unavailable'])
  // Everything that can return AFTER the insert must stay terminal, or a
  // second attempt could charge twice for one exit.
  for (const code of ['insufficient', 'on_cooldown', 'too_soon', 'not_in_mission',
                      'already_completed', 'already_skipped', 'joined_mode_unavailable', 'use_quest_exit']) {
    assert.equal(isRetryableRpcError(code), false, `${code} must not be retried`)
  }
  assert.equal(isRetryableRpcError(undefined), false)
})

test('a missing goal is permanent; a failed read is not', () => {
  assert.deepEqual([...PERMANENT_EVIDENCE_ERRORS], ['quest_goal_unavailable'])
  assert.equal(isPermanentEvidenceError('quest_goal_unavailable'), true)
  for (const transient of ['quest_stream_cursor_unavailable', 'participant_evidence_unavailable:timeout', 'fetch failed']) {
    assert.equal(isPermanentEvidenceError(transient), false, transient)
  }
})

/* ── A–H, the scenarios ────────────────────────────────────────────────── */

test('A · a stable first attempt succeeds immediately and writes once', async () => {
  const h = harness({ rpc: [ok] })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, true)
  assert.equal(res.data.waivesRequirement, true)
  assert.equal(res.attempts, 1)
  assert.equal(h.calls.callRpc, 1)
  assert.deepEqual(h.calls.sleeps, [], 'no delay on the happy path')
})

test('B · a teammate scrobble on the first attempt, second one lands', async () => {
  // This is AGENT050's exact failure, now survivable.
  const h = harness({ rpc: [changed, ok] })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, true)
  assert.equal(res.attempts, 2)
  assert.equal(h.calls.buildEvidence, 2, 'the snapshot must be rebuilt, not reused')
  assert.equal(h.calls.callRpc, 2)
})

test('C · changing on every attempt fails transiently, and charges nothing', async () => {
  const h = harness({ rpc: [changed, changed, changed] })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, false)
  assert.equal(res.error, 'contribution_changed')
  assert.equal(res.exhausted, true)
  assert.equal(h.calls.callRpc, SKIP_RETRY_ATTEMPTS)
  assert.equal(h.calls.callRpc, 3, 'bounded — never a fourth')
})

test('D · a transient evidence read failure recovers on the next attempt', async () => {
  const h = harness({
    evidence: [{ throws: 'quest_stream_cursor_unavailable' }, { ok: true }],
    rpc: [ok],
  })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, true)
  assert.equal(h.calls.buildEvidence, 2)
  assert.equal(h.calls.callRpc, 1, 'the RPC is not called on an attempt whose evidence threw')
})

test('E · a permanent evidence failure fails closed on the first attempt', async () => {
  const h = harness({ evidence: [{ throws: 'quest_goal_unavailable' }] })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, false)
  assert.equal(res.error, 'contribution_unavailable')
  assert.equal(res.exhausted, false, 'not exhaustion — it will never succeed')
  assert.equal(h.calls.buildEvidence, 1, 'no point asking again')
  assert.equal(h.calls.callRpc, 0)
})

test('F · a quest that expires between retries is never written', async () => {
  let open = true
  const h = harness({ rpc: [changed, ok], skippable: () => open })
  h.deps.buildEvidence = (orig => async () => { const r = await orig(); open = false; return r })(h.deps.buildEvidence)
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, false)
  assert.equal(h.calls.callRpc, 1, 'the second attempt must not reach the RPC after expiry')
})

test('F2 · an already-expired quest never reaches the RPC at all', async () => {
  const h = harness({ rpc: [ok], skippable: () => false })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, false)
  assert.equal(h.calls.callRpc, 0)
  assert.equal(h.calls.buildEvidence, 0)
})

test('G · affordability, cooldown and waiting-period failures are never retried', async () => {
  for (const code of ['insufficient', 'on_cooldown', 'too_soon', 'not_in_mission', 'already_completed']) {
    const h = harness({ rpc: [{ data: { success: false, error: code } }, ok] })
    const res = await runSkipWithEvidenceRetry(h.deps)
    assert.equal(res.ok, false, code)
    assert.equal(res.error, code)
    assert.equal(h.calls.callRpc, 1, `${code} must stop after one call`)
    assert.deepEqual(h.calls.sleeps, [], `${code} must not sleep`)
  }
})

test('H · the write happens at most once, whatever the script', async () => {
  // Success on the first, middle and last attempt: the RPC count must never
  // exceed the attempt that succeeded.
  for (const [script, expected] of [[[ok], 1], [[changed, ok], 2], [[changed, changed, ok], 3]]) {
    const h = harness({ rpc: script })
    const res = await runSkipWithEvidenceRetry(h.deps)
    assert.equal(res.ok, true)
    assert.equal(h.calls.callRpc, expected)
  }
})

test('a transport error is terminal — a lost response must not be re-sent', async () => {
  // The one case where the write may ALREADY have committed. Retrying could
  // charge twice, so it returns instead.
  const h = harness({ rpc: [{ error: { message: 'network unreachable' } }, ok] })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, false)
  assert.equal(res.error, 'network unreachable')
  assert.equal(h.calls.callRpc, 1, 'never re-send a call whose outcome is unknown')
})

test('success is never followed by another attempt', async () => {
  const h = harness({ rpc: [ok, ok, ok] })
  const res = await runSkipWithEvidenceRetry(h.deps)
  assert.equal(res.ok, true)
  assert.equal(h.calls.callRpc, 1)
})

test('the retry is bounded and its latency stays small', async () => {
  assert.equal(SKIP_RETRY_ATTEMPTS, 3)
  const h = harness({ rpc: [changed, changed, changed] })
  h.deps.delayMs = undefined // use the real configured delay
  await runSkipWithEvidenceRetry(h.deps)
  assert.equal(h.calls.sleeps.length, 2, 'n attempts means n-1 waits')
  assert.ok(h.calls.sleeps.every((ms) => ms <= 500), 'a tap must still feel like one tap')
})

/* ── the write path is untouched ───────────────────────────────────────── */

test('the retry never reaches into pricing, waivers or the RPC contract', () => {
  // Executable lines only — the file explains the pricing and waiver rules at
  // length in prose, and matching that prose would pass while the code did
  // something else entirely.
  const src = readFileSync(new URL('./quest-skip-retry.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

  // It decides only WHETHER to ask again, never what the answer is: no
  // database handle, no query, no price, no waiver.
  assert.doesNotMatch(src, /supabase|\.rpc\(|\.from\(|rc_quest_skips/)
  assert.doesNotMatch(src, /costXp\s*[:=]|costCells\s*[:=]|waivesRequirement\s*[:=]|free_reason/)
  // The one thing it must name is the pair of codes it is allowed to re-ask.
  assert.match(src, /contribution_changed/)
  assert.match(src, /contribution_unavailable/)
})
