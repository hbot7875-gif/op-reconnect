// Canonical rows for REVIEW ONLY.
//
// This collapses one specific, measured ingestion artifact so that Moon
// Station and the agent-facing self-check stop reading it as evidence about a
// person. It changes nothing a player earns: not a stored row, not a counted
// stream, not XP, not district progress, not a campaign total. Those all keep
// reading rc_scrobbles exactly as they do today.
//
// ── The artifact ──────────────────────────────────────────────────────────
// Stats.fm reports the same physical play two ways: once with a second-level
// endTime, once truncated to the minute. rc_scrobbles keys on
// (agent_no, listened_at, track_name), so the two land as two rows. Measured
// on production 2026-10-02: 27,633 such pairs across 26 agents.
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
 * which is the whole input to a repeat check. Nothing is deleted anywhere —
 * the dropped row stays in rc_scrobbles and keeps counting exactly as it does
 * today, pending a separate decision on historical repair.
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
