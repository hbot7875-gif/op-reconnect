// ARIRANG RE:CELEBRATE — Hooligans vs Aliens battle scoring.
//
// Nothing is ever submitted to the battle. Plays come from rc_scrobbles —
// the table every ReConnect stream source (ListenBrainz, stats.fm, musicat,
// the Web Scrobbler / Pano webhooks) already writes to, deduped on
// (agent_no, listened_at, track_name) — and qualify under exactly Red Zone's
// rules (bomb.ts refreshDefuse): inside the exact window, from the agent's
// own currently selected source, BTS-artist allowlist (plus that song's own
// featured artists), not an ad. The same play still counts for everything
// else it always did; the battle only adds an attribution of it.
//
// A refresh is incremental: it resumes from a cursor on rc_scrobbles.id and
// only looks at rows added since, re-checking a small overlap in case two
// inserts committed out of id order. Qualifying rows go into the ledger,
// whose primary key is the scrobble's own identity (so re-scans, retries and
// overlapping sweeps can never count a play twice), and a database trigger
// keeps the 34-row read model up to date. The database also re-checks the
// window and the agent's team on every ledger row and assigns the team
// itself; see migration 20260919190000_rc_recelebrate_battle.sql.

import type { SupabaseDB, GameContent } from './config.ts'
import { loadContent, trackArtistOverrides } from './config.ts'
import { countedArtistPlays, isAdScrobble, normKeyFull, normalizeKey } from './text.ts'
import { resolvedAgentStreamSource } from './streams.ts'
import { redZoneSourceAllowed } from './bomb.ts'
import { RECELEBRATE_EVENT_ID } from './recelebrate-tracks.js'

const REFRESH_MIN_SECONDS = 20
const PAGE = 1000
const MAX_PAGES_PER_REFRESH = 40
// Inserts from concurrent syncs can commit slightly out of id order; re-scan
// this many ids behind the cursor. The ledger key makes the overlap free.
const CURSOR_OVERLAP = 5000

export interface BattleTrack { track_id: string; match_keys: string[] }
export interface ScrobbleRow {
  id: number; agent_no: string; track_name: string; artist_name: string | null; listened_at: number; source: string | null
}
export interface QualifyContext {
  fromTs: number
  untilTs: number
  keyToTrack: Map<string, string>
  selectedSource: Map<string, string>
  teamSince: Map<string, number>
  allow: string[]
  overrides: Record<string, string[]>
}

// Keys go through the same normKeyFull as every scrobble title: its NFKD step
// decomposes Hangul, so a stored "해금" only equals a normalized "해금" after
// both sides have been through it.
export function trackKeyMap(tracks: BattleTrack[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of tracks) for (const k of t.match_keys) map.set(normKeyFull(k), t.track_id)
  return map
}

/** Pure: which rows count, and for which of the 17 tracks. Team is NOT
 *  decided here — the database assigns it from the agent's pass. */
export function qualifyBattleRows(rows: ScrobbleRow[], ctx: QualifyContext) {
  const out: { event_id: string; agent_no: string; listened_at: number; track_name: string; scrobble_id: number; track_id: string; team: string }[] = []
  for (const row of rows) {
    if (!row.track_name || !row.listened_at) continue
    if (row.listened_at < ctx.fromTs || row.listened_at >= ctx.untilTs) continue
    const since = ctx.teamSince.get(row.agent_no)
    if (since === undefined || row.listened_at < since) continue
    if (isAdScrobble(row.track_name, row.artist_name)) continue
    if (!redZoneSourceAllowed(ctx.selectedSource.get(row.agent_no), row.source)) continue
    const trackKey = normKeyFull(row.track_name)
    const trackId = ctx.keyToTrack.get(trackKey)
    if (!trackId) continue
    const artist = normalizeKey(row.artist_name || '')
    if (countedArtistPlays({ [artist]: 1 }, ctx.allow, trackKey, ctx.overrides) <= 0) continue
    out.push({
      event_id: RECELEBRATE_EVENT_ID, agent_no: row.agent_no, listened_at: row.listened_at,
      track_name: row.track_name, scrobble_id: row.id, track_id: trackId,
      // Placeholder only: the ledger's guard trigger overwrites this with the
      // team stored on the agent's pass.
      team: 'hooligans',
    })
  }
  return out
}

async function refreshBattle(supabase: SupabaseDB, content: GameContent, eventId: string, state: any) {
  const { data: cursor, error: claimErr } = await supabase.rpc('rc_recelebrate_battle_claim', {
    p_event: eventId, p_min_seconds: REFRESH_MIN_SECONDS,
  })
  if (claimErr) { console.error('battle claim failed:', claimErr.message); return }
  if (cursor === null || cursor === undefined) return

  const fromTs = Math.floor(new Date(state.opens_at).getTime() / 1000)
  const untilTs = Math.floor(new Date(state.ends_at).getTime() / 1000)

  const [{ data: tracks }, { data: passes }, { data: agents }, { data: top }] = await Promise.all([
    supabase.from('rc_recelebrate_battle_tracks').select('track_id, match_keys').eq('event_id', eventId),
    supabase.from('rc_recelebrate_passes').select('agent_no, team, team_chosen_at')
      .eq('event_id', eventId).not('team', 'is', null),
    supabase.from('rc_agents').select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id'),
    supabase.from('rc_scrobbles').select('id').order('id', { ascending: false }).limit(1).maybeSingle(),
  ])
  const maxId = Number(top?.id) || 0
  const teamSince = new Map<string, number>()
  for (const p of passes || []) teamSince.set(p.agent_no, Math.floor(new Date(p.team_chosen_at).getTime() / 1000))
  const ctx: QualifyContext = {
    fromTs, untilTs,
    keyToTrack: trackKeyMap(tracks || []),
    selectedSource: new Map((agents || []).map((a: any) => [String(a.agent_no), String(resolvedAgentStreamSource(a))])),
    teamSince,
    allow: content.config.bts_artists || [],
    overrides: trackArtistOverrides(content),
  }

  let after = Math.max(0, Number(cursor) - CURSOR_OVERLAP)
  let reachedEnd = false
  let lastSeen = Number(cursor)
  for (let page = 0; page < MAX_PAGES_PER_REFRESH; page++) {
    const { data, error } = await supabase.from('rc_scrobbles')
      .select('id, agent_no, track_name, artist_name, listened_at, source')
      .gt('id', after).lte('id', maxId)
      .gte('listened_at', fromTs).lt('listened_at', untilTs)
      .order('id', { ascending: true }).limit(PAGE)
    if (error) { console.error('battle scan failed:', error.message); return }
    const rows = (data || []) as ScrobbleRow[]
    const ledger = qualifyBattleRows(rows, ctx)
    if (ledger.length) {
      const { error: insErr } = await supabase.from('rc_recelebrate_battle_streams')
        .upsert(ledger, { onConflict: 'event_id,agent_no,listened_at,track_name', ignoreDuplicates: true })
      if (insErr) { console.error('battle ledger insert failed:', insErr.message); return }
    }
    if (rows.length < PAGE) { reachedEnd = true; break }
    after = rows[rows.length - 1].id
    lastSeen = Math.max(lastSeen, after)
  }
  await supabase.rpc('rc_recelebrate_battle_advance', { p_event: eventId, p_cursor: reachedEnd ? maxId : lastSeen })
}

/** The Party page's Battle read. Refreshes at most every 20s (one sweeper at
 *  a time, claimed in SQL), freezes the result once the post-event sync
 *  grace has passed, and always answers from the server's own board. */
export async function getRecelebrateBattle(supabase: SupabaseDB, _params: any) {
  const eventId = RECELEBRATE_EVENT_ID
  const { data: state } = await supabase.from('rc_recelebrate_battle_state')
    .select('opens_at, ends_at, finalize_after, finalized_at').eq('event_id', eventId).maybeSingle()
  if (!state) return { success: false, error: 'battle_not_configured' }

  if (!state.finalized_at) {
    const now = Date.now()
    if (now >= new Date(state.opens_at).getTime()) {
      await refreshBattle(supabase, await loadContent(supabase), eventId, state)
      if (now >= new Date(state.finalize_after).getTime()) {
        await supabase.rpc('rc_recelebrate_battle_finalize', { p_event: eventId })
      }
    }
  }
  const { data: board, error } = await supabase.rpc('rc_recelebrate_battle_board', { p_event: eventId })
  if (error) return { success: false, error: error.message }
  return { success: true, battle: board }
}
