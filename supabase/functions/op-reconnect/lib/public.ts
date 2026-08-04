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

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { getBombView } from './bomb.ts'

export async function getPublicStats(supabase: SupabaseDB, _params: Record<string, unknown>) {
  const content = await loadContent(supabase)

  const [agentsRes, restoredRes] = await Promise.all([
    supabase.from('rc_players').select('agent_no', { count: 'exact', head: true }),
    supabase.from('rc_player_districts').select('district_id', { count: 'exact', head: true })
      .eq('status', 'restored'),
  ])

  // The ARMY Bomb's community charge is already the game's own "how alive is
  // the network right now" number — no reason to invent a second one for the
  // landing. Passing an empty agent number is deliberate: there's no caller
  // to attribute, and the per-agent contribution lookup simply finds nothing.
  let charge: number | null = null
  let multiplier: number | null = null
  try {
    const bomb = await getBombView(supabase, content, '')
    charge = bomb.charge
    multiplier = bomb.multiplier
  } catch (_e) {
    // Bomb state is a nice-to-have here, never a reason to fail the page.
  }

  const totalDistricts = content.districts.filter((d) => !d.is_centerpiece).length

  return {
    success: true,
    stats: {
      agents: agentsRes.error ? null : (agentsRes.count ?? 0),
      districtsRestored: restoredRes.error ? null : (restoredRes.count ?? 0),
      districtsTotal: totalDistricts,
      wards: content.wards.length,
      charge,
      multiplier,
    },
  }
}
