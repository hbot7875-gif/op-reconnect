// Bulk stream sync — the scheduled equivalent of every agent opening the
// app themselves. Until now ensureDailyRollups (derive.ts) only ever ran
// on-demand: the HUD's manual sync button, or the 90s poll while the app
// happens to be open. An agent who doesn't open the game for a day still
// shows stale/zero counts even if they streamed the whole time — the fetch
// simply never ran. This closes that gap without needing anyone online.
//
// Admin-gated like every other bulk action in this file's siblings
// (admin-agent.ts, goals.ts) — index.ts checks params.adminKey against
// SYNC_ADMIN_KEY centrally before this ever runs. The GitHub Actions
// workflow that calls this on an hourly schedule holds that same key as a
// repo secret, never checked into source.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { ensureDailyRollups } from './derive.ts'
import type { AgentSourceRow } from './streams.ts'

// Small concurrent batches, not all-at-once — this fans out to whatever
// external service (ListenBrainz/stats.fm/musicat) each agent is on, and
// hammering three third-party APIs with 70+ simultaneous requests is a
// good way to start getting 429s from all of them. A short gap between
// batches keeps this a good citizen without making an hourly job slow.
const BATCH_SIZE = 5
const BATCH_DELAY_MS = 400

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function adminSyncAllStreams(supabase: SupabaseDB, _params: Record<string, unknown>) {
  const content = await loadContent(supabase)

  const { data: players, error: playersErr } = await supabase
    .from('rc_players').select('agent_no, mode, joined_at')
  if (playersErr) return { success: false, error: playersErr.message }
  if (!players || players.length === 0) return { success: true, total: 0, synced: 0, failed: 0, errors: [] }

  const agentNos = players.map((p: any) => p.agent_no)
  const { data: agentRows, error: agentsErr } = await supabase
    .from('rc_agents')
    .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
    .in('agent_no', agentNos)
  if (agentsErr) return { success: false, error: agentsErr.message }
  const agentByNo = new Map<string, AgentSourceRow>((agentRows || []).map((a: any) => [a.agent_no, a]))

  let synced = 0
  const errors: { agentNo: string; error: string }[] = []

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (player: any) => {
      const agent = agentByNo.get(player.agent_no)
      if (!agent) { errors.push({ agentNo: player.agent_no, error: 'agent_row_missing' }); return }
      try {
        await ensureDailyRollups(supabase, agent, player, content)
        synced++
      } catch (e) {
        errors.push({ agentNo: player.agent_no, error: e instanceof Error ? e.message : String(e) })
      }
    }))
    if (i + BATCH_SIZE < players.length) await delay(BATCH_DELAY_MS)
  }

  // Capped, not truncated silently — a scheduled job's log is the only
  // place anyone will ever see this, so the first failures (usually the
  // same handful of broken sources) matter more than an exhaustive list.
  return { success: true, total: players.length, synced, failed: errors.length, errors: errors.slice(0, 20) }
}
