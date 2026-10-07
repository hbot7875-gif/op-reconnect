// One Stats.fm play, one row.
//
// This module holds a single classification — "these two rows are the same
// physical play, reported at two precisions" — and two users of it:
//
//   canonicalStreamResult   collapses the artifact for REVIEW surfaces, so
//                           Moon Station and the self-check stop reading it
//                           as evidence about a person.
//   statsFmRowsToSkip       refuses the second representation at INGEST, so
//                           the artifact stops being created at all.
//
// They share the classifier on purpose. A reviewer deciding a case and the
// collector deciding a write have to agree about what a duplicate is, or the
// admin view starts disagreeing with the ledger it is meant to describe.
//
// ── The artifact ──────────────────────────────────────────────────────────
// Stats.fm reports the same physical play two ways: once with a second-level
// endTime, once truncated to the minute. rc_scrobbles keys on
// (agent_no, listened_at, track_name), so the provider's timestamp IS the row
// identity — which is exactly why one play can occupy two of them. Measured on
// production: 27,633 pairs on 2026-10-02, 39,628 on 2026-10-07. About 2,500 a
// day, roughly 41% of the Stats.fm rows written daily.
//
// Moon Station's flagStreamRows walks consecutive rows and flags the same
// track again inside 8 minutes. A precision pair is the same track 1–56
// seconds apart and therefore always adjacent — so every duplicated play
// produced a 'repeat' flag against a player who had done nothing but listen
// once. Measured: 22,724 repeat flags, of which 15,715 (69%) were this.
//
// ── Why the rule is this narrow ───────────────────────────────────────────
// Deliberately NOT "the same song within N seconds is a duplicate". Real
// people really do replay tracks, and a generic rule would quietly erase that
// — including the genuine repeats Moon Station exists to surface. This
// matches only the exact shape the data proved:
//
//     same agent · same source 'statsfm' · same normalised track
//     · same wall-clock minute
//     · exactly one side on the minute boundary, the other not
//
// Anything else is left alone. Two second-precision plays in one minute are
// NOT collapsed — that is a real pattern and belongs in front of a reviewer,
// not hidden by us.
//
// ── Why created_at is not used ────────────────────────────────────────────
// The intuitive rule is "the minute-aligned row is the later artifact". The
// audit disproved it: of 27,746 pairs, 867 (3.1%) had the minute-aligned row
// arrive FIRST, by anything from 13 seconds to 15 hours. Choosing a canonical
// row by arrival order would have discarded the real row in those cases, so
// this picks by PRECISION instead, which is a property of the data rather
// than of when a poll happened to run.

import type { StreamRow } from './streams.ts'

/** Same normalisation flagStreamRows already uses to compare track names, so
 *  a pair it would flag is a pair this can collapse. */
const normTrack = (name: string) => (name || '').trim().toLowerCase()

/** Artist is compared only when BOTH sides carry one. Stats.fm occasionally
 *  returns an empty artist, and treating '' as a mismatch would leave the
 *  artifact in place for exactly the rows most likely to produce a flag. */
function artistCompatible(a: StreamRow, b: StreamRow): boolean {
  const x = (a.artist_name || '').trim().toLowerCase()
  const y = (b.artist_name || '').trim().toLowerCase()
  if (!x || !y) return true
  return x === y
}

const isMinuteAligned = (row: StreamRow) => row.listened_at % 60 === 0
const minuteBucket = (row: StreamRow) => Math.floor(row.listened_at / 60)

/**
 * True when these two rows are the SAME Stats.fm play reported at two
 * precisions — the one artifact this module exists for.
 *
 * Both must be Stats.fm, same track, same minute, and exactly one of them on
 * the minute boundary. Any other shape returns false and both rows survive.
 */
export function isStatsFmPrecisionPair(a: StreamRow, b: StreamRow, sourceOf: (r: StreamRow) => string): boolean {
  if (sourceOf(a) !== 'statsfm' || sourceOf(b) !== 'statsfm') return false
  if (normTrack(a.track_name) !== normTrack(b.track_name)) return false
  if (!artistCompatible(a, b)) return false
  if (minuteBucket(a) !== minuteBucket(b)) return false
  // Exactly one side on the boundary. Two aligned rows, or two second-level
  // rows, are not this artifact — they are either a real repeat or something
  // else worth a human look.
  return isMinuteAligned(a) !== isMinuteAligned(b)
}

/**
 * Collapse confirmed Stats.fm precision pairs to one row each, for review
 * surfaces only. Everything else passes through untouched and in order.
 *
 * The surviving row is the second-precision one: it carries the real timing,
 * which is the whole input to a repeat check. This function itself deletes
 * nothing; it only decides what a reviewer is shown. Rows written before the
 * ingest guard below existed are removed by a separate, audited repair.
 */
export function canonicalStreamRows(
  rows: StreamRow[],
  sourceOf: (r: StreamRow) => string = (r) => (r as any).source || '',
): StreamRow[] {
  return canonicalStreamResult(rows, sourceOf).rows
}

export interface CanonicalResult {
  /** The canonical rows, in their original order. */
  rows: StreamRow[]
  /** Survivor -> the rows set aside as the same physical play.
   *
   *  Anything keyed on a row's timestamp has to be able to follow the play
   *  across a collapse. The RE:CELEBRATE battle ledger is the live example:
   *  it keys on (listened_at, track_name), and it holds the minute-aligned
   *  side for some plays and the second-precision side for others, so
   *  checking only the survivor would silently drop the badge from rows that
   *  really are in the ledger. */
  twins: Map<StreamRow, StreamRow[]>
}

/**
 * Same classification as canonicalStreamRows, but it also says which row was
 * set aside for which survivor.
 */
export function canonicalStreamResult(
  rows: StreamRow[],
  sourceOf: (r: StreamRow) => string = (r) => (r as any).source || '',
): CanonicalResult {
  const twins = new Map<StreamRow, StreamRow[]>()
  if (rows.length < 2) return { rows: rows.slice(), twins }

  // Group only the candidates: Stats.fm rows, by minute and normalised track.
  // A non-Stats.fm row never enters a bucket, so it can never be collapsed.
  const buckets = new Map<string, StreamRow[]>()
  for (const row of rows) {
    if (sourceOf(row) !== 'statsfm') continue
    const key = `${minuteBucket(row)}|${normTrack(row.track_name)}`
    const list = buckets.get(key)
    if (list) list.push(row); else buckets.set(key, [row])
  }

  const dropped = new Set<StreamRow>()
  for (const group of buckets.values()) {
    if (group.length < 2) continue
    const aligned = group.filter(isMinuteAligned)
    const precise = group.filter((r) => !isMinuteAligned(r))
    // Ambiguous: more than one of either side in the same minute is not the
    // proven pattern. Leave every row in place and let a reviewer decide —
    // under-collapsing is a worse flag, over-collapsing is a wrong verdict.
    if (aligned.length !== 1 || precise.length !== 1) continue
    if (!isStatsFmPrecisionPair(aligned[0], precise[0], sourceOf)) continue
    dropped.add(aligned[0])
    // The second-precision row survives, so it inherits the aligned row's
    // identity for anything that was keyed on it.
    twins.set(precise[0], [aligned[0]])
  }

  return {
    rows: dropped.size ? rows.filter((r) => !dropped.has(r)) : rows.slice(),
    twins,
  }
}

/**
 * How many rows the canonical view sets aside as confirmed ingestion
 * duplicates. For a reviewer's context line, so a collapsed row set never
 * looks like missing data.
 */
export function countIngestionDuplicates(rows: StreamRow[]): number {
  return rows.length - canonicalStreamRows(rows).length
}

/** The shape persistScrobbles actually has in hand: a provider row about to
 *  be written, or a stored row read back to compare against. Deliberately
 *  narrower than StreamRow so the ingest guard cannot come to depend on
 *  anything the collector does not have. */
export interface StatsFmCandidate {
  track_name: string
  artist_name?: string | null
  listened_at: number
}

/** How many stored rows the guard is willing to reason about. The Stats.fm
 *  recent feed is 50 plays, so the minute range being checked is small and
 *  this is pure headroom. If a lookup ever comes back at the cap, the caller
 *  cannot see the whole picture for those minutes and must not collapse
 *  anything — see the fail-open note in persistScrobbles. */
export const STATSFM_LOOKUP_LIMIT = 2000

const asRow = (c: StatsFmCandidate): StreamRow =>
  ({ track_name: c.track_name, artist_name: c.artist_name || '', listened_at: c.listened_at })

/**
 * Which of these incoming Stats.fm rows are the SECOND representation of a
 * play that is already present — either stored, or accepted earlier in this
 * same batch. Returns the indexes to skip; everything else is written.
 *
 * The rule, and only this rule: a row is skipped when its own minute already
 * holds exactly one row of the OPPOSITE precision and none of its own, and
 * the two pass isStatsFmPrecisionPair. That makes it order-independent — if
 * the second-precision row arrives first the minute-aligned one is refused,
 * and if the minute-aligned row arrives first the second-precision one is,
 * so either way the play ends up as one row rather than two.
 *
 * Which of the two survives is therefore whichever the provider happened to
 * report first. That is a deliberate trade. Keeping the second-precision row
 * instead would mean DELETING a stored row during a collection poll, and a
 * collector that deletes is a collector that can lose a play to a bad
 * comparison. Writing nothing is recoverable; deleting is not. Measured, the
 * second-precision row arrives first 96.9% of the time anyway.
 *
 * Everything ambiguous is written. Two second-precision plays in one minute
 * then a minute-aligned row is NOT this artifact, so all three are kept —
 * under-collapsing leaves a duplicate that the repair can still find, while
 * over-collapsing silently destroys a play nobody can get back.
 *
 * Known and accepted: a play whose real end time lands exactly on :00 is
 * indistinguishable from the truncated representation, so a genuine replay of
 * a sub-60-second track inside that same minute could be refused. It needs a
 * 1-in-60 timestamp and a same-minute repeat of the same track together, and
 * the review path has always had the identical blind spot.
 */
export function statsFmRowsToSkip(incoming: StatsFmCandidate[], stored: StatsFmCandidate[]): Set<number> {
  const skip = new Set<number>()
  if (!incoming.length) return skip

  const statsFm = () => 'statsfm'
  const bucketKey = (c: StatsFmCandidate) => `${Math.floor(c.listened_at / 60)}|${normTrack(c.track_name)}`

  // Only the minutes this batch actually touches need a bucket; a stored row
  // outside them can never pair with anything here.
  const wanted = new Set(incoming.map(bucketKey))

  interface Entry { row: StreamRow; stored: boolean; index: number }
  const buckets = new Map<string, Entry[]>()
  // rc_scrobbles' own identity, so a row listed twice cannot inflate a bucket
  // and block a collapse that should have happened.
  const seen = new Set<string>()
  const add = (c: StatsFmCandidate, isStored: boolean, index: number) => {
    const identity = `${c.listened_at}|${c.track_name}`
    if (seen.has(identity)) return
    seen.add(identity)
    const key = bucketKey(c)
    const entry: Entry = { row: asRow(c), stored: isStored, index }
    const list = buckets.get(key)
    if (list) list.push(entry); else buckets.set(key, [entry])
  }
  for (const row of stored) if (wanted.has(bucketKey(row))) add(row, true, -1)
  incoming.forEach((row, index) => add(row, false, index))

  for (const bucket of buckets.values()) {
    const aligned = bucket.filter((e) => isMinuteAligned(e.row))
    const precise = bucket.filter((e) => !isMinuteAligned(e.row))
    // Exactly one of each, and nothing else in the minute. Anything else is
    // left entirely alone -- see the ambiguity note above.
    if (aligned.length !== 1 || precise.length !== 1) continue
    if (!isStatsFmPrecisionPair(aligned[0].row, precise[0].row, statsFm)) continue

    const pair = [aligned[0], precise[0]]
    const fresh = pair.filter((e) => !e.stored)
    // Both already stored: a historical pair this guard arrived too late for.
    // It is the repair's problem, not a write to decline.
    if (!fresh.length) continue
    // One side stored: the stored row stands and the new one is declined, so
    // the collector never has to delete anything to keep the ledger at one
    // row per play.
    if (fresh.length === 1) skip.add(fresh[0].index)
    // Both new, in one batch: keep whichever the provider listed first.
    else skip.add(Math.max(fresh[0].index, fresh[1].index))
  }

  return skip
}
