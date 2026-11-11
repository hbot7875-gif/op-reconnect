// One listen, reported more than once.
//
// A player's listening reaches rc_scrobbles through several feeds at once:
// Web Scrobbler (webhook), Pano Scrobbler (lb-like), a polled provider, and,
// inside ListenBrainz, every app that writes to that account (the Last.fm
// importer, LB's own Spotify reader, Pano, Web Scrobbler, LB Android). Some
// pairs of feeds MIRROR each other — both report every listen, with
// timestamps 0 s to one track length apart (one stamps the start, the other
// the end) — and counting each report as a play double counted those listens.
// Other pairs are simply two devices, and the same song turning up on both
// within a few minutes is two real plays.
//
// So a report is a copy only when all of this holds:
//  - same song (game key), different feed, within COPY_WINDOW_SEC;
//  - those two feeds mirror each other that KST day: at least
//    MIRROR_MIN_SHARE of the smaller feed's reports pair up one-to-one with
//    the other's, AND the pairs keep a steady offset per song (a copy is the
//    same listen stamped by two apps, so its offset is fixed by the track —
//    e.g. start vs. scrobble point); at least MIRROR_MIN_CONSISTENT of pairs
//    sit within OFFSET_TOLERANCE_SEC of their song's median offset. With
//    fewer than MIRROR_MIN_PAIRS pairs that day, only reports at most
//    TINY_DAY_GAP_SEC apart count as copies. Measured on every agent-day
//    Aug 3 - Nov 10 2026: 150k pairs pass both tests (copies); 21k fail one
//    and are kept — two devices that happen to play the same song;
//  - one report per feed per listen, so a song played twice is reported
//    twice by each mirror and still counts twice.
// The same song reported again at most SAME_LISTEN_GAP_SEC later is one
// listen, from any feed (the same one included): nothing can be played twice
// a second apart. Measured over a week: Web Scrobbler 183 same-song pairs at
// exactly 1 s vs 8 at 2 s for one agent, the LB Last.fm importer 88 at 1 s
// (it re-imports listens with a 1 s jitter). Beyond that gap, within ONE feed
// nothing collapses: same-song gaps of 2-29 s are as common there as gaps of
// 30-120 s, so a gap alone proves nothing.
//
// Musicat and Stats.fm are one feed each: Musicat merges Apple Music and
// Spotify, and two services playing at once are two real plays.
//
// Pure, shared by the daily rollup and the recount scripts, so the two can
// never disagree about what a copy is.

import { normKeyFull } from './text.ts'
import { kstDateOf } from './kst.ts'

export const COPY_WINDOW_SEC = 600
export const MIRROR_MIN_SHARE = 0.5
export const MIRROR_MIN_CONSISTENT = 0.5
export const OFFSET_TOLERANCE_SEC = 15
export const MIRROR_MIN_PAIRS = 4
export const TINY_DAY_GAP_SEC = 5
export const SAME_LISTEN_GAP_SEC = 1

/** Whether two feeds' paired reports that day are copies of each other. */
export function feedsMirror(pairs: { key: string; offset: number }[], smallerFeed: number): boolean {
  if (!pairs.length || pairs.length < MIRROR_MIN_SHARE * smallerFeed) return false
  if (pairs.length < MIRROR_MIN_PAIRS) return pairs.every((p) => Math.abs(p.offset) <= TINY_DAY_GAP_SEC)
  const bySong = new Map<string, number[]>()
  for (const p of pairs) {
    const list = bySong.get(p.key)
    if (list) list.push(p.offset)
    else bySong.set(p.key, [p.offset])
  }
  let steady = 0
  for (const offsets of bySong.values()) {
    const sorted = offsets.slice().sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    steady += offsets.filter((o) => Math.abs(o - median) <= OFFSET_TOLERANCE_SEC).length
  }
  return steady >= MIRROR_MIN_CONSISTENT * pairs.length
}

/** The feed a row was reported through. ListenBrainz rows are split by the
 *  app that submitted them. A ListenBrainz row whose app is unknown (stored
 *  before 2026-11-10 and not backfilled) gets UNKNOWN_FEED — see below. */
export function feedOf(row: { source?: string | null; source_client?: string | null }): string {
  const source = row.source || 'live'
  if (source === 'listenbrainz') return `listenbrainz:${row.source_client || ''}`
  return source
}

export interface CopyCandidate {
  track_name: string
  listened_at: number
  source?: string | null
  source_client?: string | null
}

/** ListenBrainz rows with no recorded app. These are NOT one feed: they mix
 *  every app that wrote to the account, so treating them as one broke both
 *  "one report per feed" and the mirror share (v402, 2026-11-11: copies
 *  stored, genuine late listens dropped). They take no part in the mirror
 *  test; a report from a known feed within TINY_DAY_GAP_SEC of one is the
 *  same listen, and two unknown rows never collapse. */
export const UNKNOWN_FEED = 'listenbrainz:'

interface Item { index: number; ts: number; key: string; feed: string; keep: boolean }

/** One-to-one pairing of two feeds' reports of the same song within the
 *  window, nearest first. Returns the pairs as [a, b] items. */
function pairUp(a: Item[], b: Item[]): [Item, Item][] {
  const byKey = new Map<string, Item[]>()
  for (const item of b) {
    const list = byKey.get(item.key)
    if (list) list.push(item)
    else byKey.set(item.key, [item])
  }
  const candidates: [number, Item, Item][] = []
  for (const x of a) {
    for (const y of byKey.get(x.key) || []) {
      const gap = Math.abs(y.ts - x.ts)
      if (gap <= COPY_WINDOW_SEC) candidates.push([gap, x, y])
    }
  }
  candidates.sort((p, q) => p[0] - q[0] || p[1].ts - q[1].ts || p[1].index - q[1].index)
  const usedA = new Set<Item>(), usedB = new Set<Item>()
  const pairs: [Item, Item][] = []
  for (const [, x, y] of candidates) {
    if (usedA.has(x) || usedB.has(y)) continue
    usedA.add(x); usedB.add(y); pairs.push([x, y])
  }
  return pairs
}

/** Indexes of rows that are a second report of a listen already kept. When
 *  `keepFirst` marks rows that must be the kept report (already stored or
 *  already counted), the copy dropped is always the other one. */
/** `loose` (audits only, never live counting): treat ANY two feeds as
 *  mirrors, i.e. the lower bound of how many listens the rows can be. */
export function copyIndexes<T extends CopyCandidate>(rows: T[], keepFirst?: (row: T) => boolean, opts: { loose?: boolean } = {}): Set<number> {
  const copies = new Set<number>()
  const byDay = new Map<string, Item[]>()
  rows.forEach((row, index) => {
    const key = normKeyFull(row.track_name || '')
    if (!key || !Number.isFinite(row.listened_at)) return
    const item = { index, ts: row.listened_at, key, feed: feedOf(row), keep: !!keepFirst?.(row) }
    const day = kstDateOf(row.listened_at)
    const list = byDay.get(day)
    if (list) list.push(item)
    else byDay.set(day, [item])
  })
  for (const items of byDay.values()) {
    // Same song again within SAME_LISTEN_GAP_SEC: one listen, any feed.
    const lastBySong = new Map<string, Item>()
    const live: Item[] = []
    for (const item of items.slice().sort((x, y) => x.ts - y.ts || Number(y.keep) - Number(x.keep) || x.index - y.index)) {
      const prev = lastBySong.get(item.key)
      if (prev && item.ts - prev.ts <= SAME_LISTEN_GAP_SEC) {
        if (item.keep && !prev.keep) {
          copies.add(prev.index)
          live[live.indexOf(prev)] = item
          lastBySong.set(item.key, item)
        } else copies.add(item.index)
        continue
      }
      lastBySong.set(item.key, item)
      live.push(item)
    }
    // Copies across mirrored feeds.
    const byFeed = new Map<string, Item[]>()
    for (const item of live) {
      const list = byFeed.get(item.feed)
      if (list) list.push(item)
      else byFeed.set(item.feed, [item])
    }
    const feeds = [...byFeed.keys()].filter((f) => f !== UNKNOWN_FEED).sort()
    // Largest feed first, so each listen keeps the report of the fullest feed
    // unless keepFirst says otherwise.
    feeds.sort((x, y) => byFeed.get(y)!.length - byFeed.get(x)!.length || (x < y ? -1 : 1))
    const dropped = new Set<Item>()
    for (let i = 0; i < feeds.length; i++) {
      for (let j = i + 1; j < feeds.length; j++) {
        const a = byFeed.get(feeds[i])!.filter((x) => !dropped.has(x))
        const b = byFeed.get(feeds[j])!.filter((x) => !dropped.has(x))
        if (!a.length || !b.length) continue
        const pairs = pairUp(a, b)
        if (!opts.loose && !feedsMirror(pairs.map(([x, y]) => ({ key: x.key, offset: y.ts - x.ts })), Math.min(a.length, b.length))) continue
        for (const [x, y] of pairs) {
          const drop = y.keep && !x.keep ? x : y
          dropped.add(drop)
          copies.add(drop.index)
        }
      }
    }
    // Rows whose app is unknown: only a near-simultaneous report from a known
    // feed is the same listen (one-to-one, nearest first).
    const unknown = (byFeed.get(UNKNOWN_FEED) || []).filter((x) => !dropped.has(x))
    if (unknown.length) {
      const known = live.filter((x) => x.feed !== UNKNOWN_FEED && !dropped.has(x))
      const near = pairUp(unknown, known).filter(([u, k]) => Math.abs(k.ts - u.ts) <= TINY_DAY_GAP_SEC)
      for (const [u, k] of near) {
        const drop = u.keep && !k.keep ? k : k.keep && !u.keep ? u : k
        dropped.add(drop)
        copies.add(drop.index)
      }
    }
  }
  return copies
}

/** The rows with every second report of a listen removed. */
export function withoutCopies<T extends CopyCandidate>(rows: T[], keepFirst?: (row: T) => boolean, opts: { loose?: boolean } = {}): T[] {
  const copies = copyIndexes(rows, keepFirst, opts)
  return copies.size ? rows.filter((_, index) => !copies.has(index)) : rows
}
