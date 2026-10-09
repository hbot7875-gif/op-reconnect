// Shared review logic — the timing-flag algorithm and the shared-identity alt
// check, used by BOTH the admin-only Moon Station tools (admin-agent.ts's
// adminGetAgentTracks/adminScanAltAccounts) and the agent-facing self-check
// (signal-log.ts's getMySelfCheck). Pulled out here so the two surfaces can
// never quietly drift apart on what counts as a flag — an agent checking
// themselves and an admin checking that same agent should always see the
// identical verdict.
//
// ── what this can and cannot know ────────────────────────────────────────
//
// This reads scrobbles. It does not read the playlist anybody actually
// played. HopeTracker is not connected to the Spotify or Apple Music queue,
// so a listening history cannot prove anything about the playlist that
// produced it: not its length, not where it started or ended, not how many
// focus songs were requested, not which multiplier was intended, not whether
// the filler schedule was followed, not whether every entry carried a valid
// link. Those are guarantees the playlist GENERATOR makes at build time
// (candy-star-rules.ts's analyzeTracklist, behind "Validate a playlist"),
// where the tracklist is actually in hand.
//
// So this module deliberately checks only what a stream of plays can show on
// its own: when a song came back, and whether it came back immediately. If a
// comment or a label here ever starts describing this as validating "the PL
// rules", it is overclaiming — the playlist validator verifies playlists,
// and this looks at listening patterns.

import type { SupabaseDB } from './config.ts'
import type { StreamRow } from './streams.ts'
import { MIN_GAP_MS } from './spotify-shared.ts'
import { kstDateOf } from './kst.ts'
import { dailyStreamReviewThreshold } from './mode-guard.ts'
import { canonicalStreamRows } from './stream-canonical.ts'
export { countIngestionDuplicates, canonicalStreamResult } from './stream-canonical.ts'

// The `repeat` flag below used to run on a made-up 45-second gap — nowhere
// near the game's actual rule. candy-star-rules.ts's analyzeTracklist (the
// engine behind "Validate a playlist" in candy-star-admin.html) already
// defines the real one: MIN_GAP_MS, 8 minutes, "matches the real observed
// floor" per spotify-shared.ts's own comment. That's the canonical answer
// to "how soon is too soon to repeat a song" in this codebase, so it's the
// one used here too — a repeat flagged by Moon Station and a repeat
// flagged by the playlist validator now mean the same thing.
export const REPEAT_MIN_GAP_SECONDS = MIN_GAP_MS / 1000

export interface FlaggedTrack {
  track: string
  artist: string
  at: string
  /** Seconds since the previous scrobble of ANY song. Context for a reader,
   *  never the repeat evidence — that is sinceSameSong. */
  gapSeconds: number | null
  /** Seconds since this same song last played, or null if this is its first
   *  play in the window. What the 8-minute rule is actually measured on. */
  sinceSameSong: number | null
  /** Observable patterns only, and never a verdict:
   *    repeat        this song returned inside REPEAT_MIN_GAP_SECONDS
   *    back_to_back  the immediately preceding scrobble was this same song
   *  They are separate on purpose and can both apply. A song replayed after
   *  nine minutes with nothing in between breaks no gap rule but is still
   *  consecutive, and a reviewer should be able to see that without the
   *  tool implying the two are the same finding. */
  flags: string[]
}

/** Timing-only flags, since a scrobble carries no play-duration or skip data
 *  to check against: `repeat` (this song returned inside the game's actual
 *  minimum-gap rule) and `back_to_back` (this song was the scrobble
 *  immediately before). Neither decides pass/fail — that stays a human call
 *  (or, for the self-check, the agent's own judgment). Output is
 *  newest-first, same as any activity log.
 *
 *  The repeat rule is measured against the previous play of THE SAME SONG,
 *  which is not the same thing as the previous row. Comparing adjacent rows
 *  meant one unrelated track in between hid the repeat entirely:
 *
 *      12:00  SWIM      12:03  Film out      12:06  SWIM
 *
 *  SWIM came back after six minutes, but the row before it was Film out, so
 *  nothing fired. A last-seen map per song is what makes the window mean
 *  what it says regardless of how much played in between.
 *
 *  Used to also flag `too_fast` — any two consecutive plays, same track or
 *  not, under 45s apart — but that threshold was never ported from
 *  anywhere real (the playlist validator has no equivalent check between
 *  different tracks); removed rather than keep an unofficial heuristic
 *  sitting next to the one rule that actually is canonical. */
/** The first name in a credit. "Agust D, RM" and "Agust D" are the same
 *  performer; "Agust D" and "BTS" are not. Scrobble sources disagree about
 *  whether to list featured artists at all, so comparing the whole credit
 *  string would call one play of a song a different song from the next. */
function primaryArtist(name: string | null | undefined): string {
  return String(name || '').split(',')[0].trim().toLowerCase()
}

/**
 * Whether two adjacent plays are the same RECORDING, rather than merely
 * sharing a title.
 *
 * Reported by AGENT000 against their own log: "Life Goes On — Agust D" at
 * 12:40 followed by "Life Goes On — BTS" at 12:43 drew a repeated-play
 * warning. They are two different songs that happen to share a name, and
 * this check compared titles alone.
 *
 * It is not a rare collision. Measured on production: 992 distinct titles
 * are carried by two or more different primary artists, and 473 of the
 * same-title-inside-8-minutes pairs across 48 agents are artist mismatches
 * — every one of them an accusation about something the player never did.
 *
 * Artist is effectively always present (33 rows missing one out of
 * 1,510,754), so requiring it costs nothing. When it genuinely is absent the
 * recording cannot be identified, and two plays are NOT treated as the same
 * song — see songKey. Matching on title alone in that case would rebuild the
 * very false positive this function exists to prevent.
 */
function sameRecording(a: StreamRow, b: StreamRow): boolean {
  const left = songKey(a)
  const right = songKey(b)
  if (left === null || right === null) return false
  return left === right
}

const titleKey = (row: StreamRow) => row.track_name.trim().toLowerCase()

/**
 * This row's song, or null when the source gave no artist and the recording
 * therefore cannot be identified.
 *
 * Null rather than a title-only key on purpose. An earlier version let a row
 * with no artist match any play of the same title, reasoning that there was
 * nothing to tell them apart. That reasoning is backwards for a review tool:
 * "Life Goes On" with no artist beside "Life Goes On — Agust D" could just as
 * easily be the BTS song, and matching them recreates exactly the
 * false-positive class the primary-artist fix removed — accusing a player of
 * a replay on the strength of a shared title.
 *
 * Unknown identity produces no evidence. The play still appears in the log in
 * the ordinary way; it simply cannot be half of a timing flag, and nothing
 * new is raised about the missing metadata itself. It costs almost nothing:
 * 33 rows carry no artist out of 1,510,754.
 */
function songKey(row: StreamRow): string | null {
  const artist = primaryArtist(row.artist_name)
  if (!artist) return null
  // \u0000 cannot occur in either half, so no title/artist pair can collide
  // with a different one by straddling the separator.
  return `${titleKey(row)}\u0000${artist}`
}

/** When each identifiable song was last played. Rows with no usable artist
 *  are never stored and never looked up, so they match nothing — including
 *  each other. */
type LastPlays = Map<string, number>

/** When this row's song was last played before now, or null if never — or if
 *  the row cannot be identified at all. */
function previousPlayOf(seen: LastPlays, row: StreamRow): number | null {
  const key = songKey(row)
  if (key === null) return null
  return seen.get(key) ?? null
}

function rememberPlay(seen: LastPlays, row: StreamRow): void {
  const key = songKey(row)
  if (key === null) return
  seen.set(key, row.listened_at)
}

export function flagStreamRows(rows: StreamRow[], options: { trustSequence?: boolean } = {}): FlaggedTrack[] {
  const trustSequence = options.trustSequence !== false
  // Judge the canonical rows, never the raw ingestion rows. Stats.fm reports
  // one play at two precisions, so the stored pair is the same track 1-56s
  // apart and therefore always adjacent -- which made the gap test below fire
  // on every duplicated play. Measured 2026-10-02: 15,715 of 22,724 repeat
  // flags (69%) were this and nothing else. Collapsing here rather than at
  // each call site is deliberate: this module exists so the admin view and
  // the agent self-check can never disagree about what a flag means, and a
  // duplicate rule living in either caller would break exactly that.
  const canonical = canonicalStreamRows(rows)
  const oldestFirst = [...canonical].sort((a, b) => a.listened_at - b.listened_at)
  const seen: LastPlays = new Map()
  const withFlags = oldestFirst.map((r, i) => {
    const prev = i > 0 ? oldestFirst[i - 1] : null
    const gapSeconds = prev ? r.listened_at - prev.listened_at : null
    // Against the last play of THIS song, not the last scrobble of any song.
    const previousSame = previousPlayOf(seen, r)
    const sinceSameSong = previousSame === null ? null : r.listened_at - previousSame
    const flags: string[] = []
    if (trustSequence) {
      if (sinceSameSong !== null && sinceSameSong < REPEAT_MIN_GAP_SECONDS) flags.push('repeat')
      if (prev && sameRecording(prev, r)) flags.push('back_to_back')
    }
    rememberPlay(seen, r)
    return {
      track: r.track_name,
      artist: r.artist_name,
      at: new Date(r.listened_at * 1000).toISOString(),
      gapSeconds,
      sinceSameSong,
      flags,
    }
  })
  return withFlags.slice().reverse()
}

export interface ExcessStreamDay {
  date: string
  streams: number
  ceiling: number
  impliedHours: number
}

/** High-volume review days. This uses a 3-minute average only to identify
 * totals worth checking. It is not proof of device count or wrongdoing;
 * short tracks can legitimately produce a higher total. */
export function flagExcessStreamDays(rows: StreamRow[], mode: string): ExcessStreamDay[] {
  const ceiling = dailyStreamReviewThreshold(mode)
  const counts = new Map<string, number>()
  // Same canonical set as flagStreamRows, for the same reason: a duplicated
  // ingestion row inflated the day's total without anyone having listened
  // twice, which is how an ordinary listening day crossed a review ceiling.
  // This is a review threshold only -- the counted totals behind XP, goals
  // and the leaderboard keep reading rc_scrobbles untouched.
  for (const r of canonicalStreamRows(rows)) {
    const date = kstDateOf(r.listened_at)
    counts.set(date, (counts.get(date) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, streams]) => streams > ceiling)
    .map(([date, streams]) => ({ date, streams, ceiling, impliedHours: Math.round(streams * 180 / 3600 * 10) / 10 }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

// Each of these is a real listening-service identity, not a game account —
// it belongs to one person's actual library, not to whichever agent_no they
// typed at sign-up. Two different agent_no rows pointing at the SAME one is
// a much stronger multi-account signal than a similar handle or a shared
// email ever could be (email is already unique per agent, checked at
// registerAgent), since it takes real effort to fake, not just retyping a
// slightly different name.
export const IDENTITY_FIELDS: { col: 'lb_username' | 'statsfm_username' | 'musicat_public_id'; label: string }[] = [
  { col: 'lb_username', label: 'ListenBrainz' },
  { col: 'statsfm_username', label: 'stats.fm' },
  { col: 'musicat_public_id', label: 'Musicat' },
]

/** mode lives on rc_players (joined-in-game state), not rc_agents (the
 *  account row alt-detection actually keys off) — a small second query to
 *  attach it. An agent who registered but never finished onboarding has no
 *  rc_players row at all, so a missing entry here just means "hasn't
 *  picked one," not an error. */
export async function modesByAgentNo(supabase: SupabaseDB, agentNos: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!agentNos.length) return map
  const { data } = await supabase.from('rc_players').select('agent_no, mode').in('agent_no', agentNos)
  for (const row of data || []) map.set(row.agent_no, row.mode)
  return map
}

/** Other agents whose configured stream source is the exact same external
 *  identity as this one's. `mode` rides along on each match purely as
 *  corroborating evidence — matching easy/medium/hard proves nothing on its
 *  own, but next to an already-confirmed shared identity it's one more
 *  thing that reads as "set up the same way."
 *
 *  Deliberately callable from the self-check too, not just admin tools: an
 *  agent can only ever learn about accounts sharing THEIR OWN identity this
 *  way, never go look up anyone else's — see getMySelfCheck's own comment
 *  on why that's a bounded, acceptable exposure rather than a general
 *  lookup tool. */
export async function findPossibleAlts(supabase: SupabaseDB, agent: any): Promise<{ agentNo: string; handle: string; via: string; mode: string | null }[]> {
  const alts: { agentNo: string; handle: string; via: string }[] = []
  for (const f of IDENTITY_FIELDS) {
    const value = agent[f.col]
    if (!value) continue
    const { data } = await supabase.from('rc_agents')
      .select('agent_no, handle')
      .eq(f.col, value)
      .neq('agent_no', agent.agent_no)
    for (const row of data || []) alts.push({ agentNo: row.agent_no, handle: row.handle, via: f.label })
  }
  const modes = await modesByAgentNo(supabase, alts.map((a) => a.agentNo))
  return alts.map((a) => ({ ...a, mode: modes.get(a.agentNo) || null }))
}
