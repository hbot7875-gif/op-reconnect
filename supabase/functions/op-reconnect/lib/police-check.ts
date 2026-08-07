// Shared "PL rules" logic — the timing-flag algorithm and the shared-
// identity alt check, used by BOTH the admin-only Moon Station tools
// (admin-agent.ts's adminGetAgentTracks/adminScanAltAccounts) and the
// agent-facing self-check (signal-log.ts's getMySelfCheck). Pulled out here
// so the two surfaces can never quietly drift apart on what counts as a
// flag — an agent checking themselves and an admin checking that same
// agent should always see the identical verdict.

import type { SupabaseDB } from './config.ts'
import type { StreamRow } from './streams.ts'
import { MIN_GAP_MS } from './spotify-shared.ts'

// The `repeat` flag below used to run on a made-up 45-second gap — nowhere
// near the game's actual rule. candy-star-rules.ts's analyzeTracklist (the
// engine behind "Validate a playlist" in candy-star-admin.html) already
// defines the real one: MIN_GAP_MS, 8 minutes, "matches the real observed
// floor" per spotify-shared.ts's own comment. That's the canonical answer
// to "how soon is too soon to repeat a song" in this codebase, so it's the
// one used here too — a repeat flagged by Moon Station and a repeat
// flagged by the playlist validator now mean the same thing.
export const REPEAT_MIN_GAP_SECONDS = MIN_GAP_MS / 1000

// A second, genuinely different check: not "the same song too soon" but
// "ANY play too soon after the one before it to have been a real, un-
// skipped listen." The playlist validator has no equivalent — it checks
// gaps between repeats of one song within a submitted tracklist, never
// between two different consecutive tracks — so this threshold isn't
// ported from anywhere; it's Moon Station's own, much shorter than
// REPEAT_MIN_GAP_SECONDS on purpose (most songs run well over a minute).
export const TOO_FAST_MAX_GAP_SECONDS = 45

export interface FlaggedTrack {
  track: string
  artist: string
  at: string
  gapSeconds: number | null
  flags: string[]
}

/** Two timing-only flags per row, since a scrobble carries no play-duration
 *  or skip data to check against: `repeat` (the same track again inside the
 *  game's actual minimum-gap rule) and `too_fast` (a gap to the previous
 *  play — any track — too short for any real, un-skipped listen). Neither
 *  decides pass/fail — that stays a human call (or, for the self-check, the
 *  agent's own judgment). Output is newest-first, same as any activity log. */
export function flagStreamRows(rows: StreamRow[]): FlaggedTrack[] {
  const oldestFirst = [...rows].sort((a, b) => a.listened_at - b.listened_at)
  const withFlags = oldestFirst.map((r, i) => {
    const prev = i > 0 ? oldestFirst[i - 1] : null
    const gapSeconds = prev ? r.listened_at - prev.listened_at : null
    const flags: string[] = []
    if (prev) {
      if (gapSeconds! < TOO_FAST_MAX_GAP_SECONDS) flags.push('too_fast')
      if (gapSeconds! < REPEAT_MIN_GAP_SECONDS
        && prev.track_name.trim().toLowerCase() === r.track_name.trim().toLowerCase()) flags.push('repeat')
    }
    return {
      track: r.track_name,
      artist: r.artist_name,
      at: new Date(r.listened_at * 1000).toISOString(),
      gapSeconds,
      flags,
    }
  })
  return withFlags.slice().reverse()
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
