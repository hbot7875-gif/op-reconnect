// Public stats for the landing page — the only action here that runs with no
// agent number and no session.
//
// Counts only. No codenames, no agent numbers, no per-player anything: this
// endpoint is reachable by anyone who finds the URL, so it must never become
// a way to enumerate who plays. The numbers are aggregate or nothing.
//
// A landing page that invents its numbers is worse than one with no numbers,
// so everything below is read from real rows; if a count fails it comes back
// null and the page shows a dash rather than a comforting fake.
//
// The response is deliberately three fields. It used to also carry
// districtsRestored/districtsTotal, charge, multiplier and wards; the
// district pair was counting ROWS of the per-agent rc_player_districts
// table with no agent filter, so it reported 377 restored out of 248
// districts that exist — 76 agents restoring the same 9 districts. Rather
// than fix a number the ticker no longer shows, the query went with it, and
// the other unread fields went at the same time. The Bomb, ward and
// district systems themselves are untouched; only this public projection of
// them is gone.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { getCampaignStreams } from './campaign-streams.ts'

export async function getPublicStats(supabase: SupabaseDB, _params: Record<string, unknown>) {
  const content = await loadContent(supabase)

  const [agentsRes, campaigns] = await Promise.all([
    supabase.from('rc_players').select('agent_no', { count: 'exact', head: true }),
    // Cached (60s) full scan — see campaign-streams.ts. Never a reason to
    // fail the page: the landing renders a dash per missing number.
    getCampaignStreams(supabase, content).catch(() => null),
  ])

  return {
    success: true,
    stats: {
      agents: agentsRes.error ? null : (agentsRes.count ?? 0),
      // ReConnect's own counted streams, not a global Spotify/YouTube
      // figure — the landing page labels them as such and must keep doing
      // so. Full integers; the client compacts them for display.
      arirangStreams: campaigns ? campaigns.arirang : null,
      roadTo1BStreams: campaigns ? campaigns.roadTo1B : null,
    },
  }
}
