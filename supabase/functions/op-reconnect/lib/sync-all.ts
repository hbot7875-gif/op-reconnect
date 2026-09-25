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
import { loadContent, limits } from './config.ts'
import { ensureDailyRollups } from './derive.ts'
import type { GoalXpScope } from './derive.ts'
import { fetchStreamRows, resolvedAgentStreamSource } from './streams.ts'
import type { AgentSourceRow, StreamFetchResult } from './streams.ts'

// Small concurrent batches, not all-at-once — this fans out to whatever
// external service (ListenBrainz/stats.fm/musicat) each agent is on, and
// hammering three third-party APIs with 70+ simultaneous requests is a
// good way to start getting 429s from all of them. A short gap between
// batches keeps this a good citizen without making an hourly job slow.
const BATCH_SIZE = 5
const BATCH_DELAY_MS = 400

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

type ScheduledSource = 'statsfm' | 'musicat' | 'listenbrainz'

interface CoverageInput {
  source: ScheduledSource
  previousSource?: string | null
  previousCoverageFrom?: string | null
  previousProviderAt?: number | null
  attemptedFrom: number
  result: Pick<StreamFetchResult, 'ok' | 'complete' | 'partialReason' | 'providerRowCount' | 'providerOldestAt' | 'providerNewestAt'>
}

/** Pure coverage transition, exported for regression tests. A bounded source
 *  proves continuity by overlapping the newest play saved by the previous
 *  successful run. If 50 newer Stats.fm rows push that checkpoint out of the
 *  response, coverage restarts at the oldest row we can still prove. */
export function nextStreamCoverage(input: CoverageInput) {
  if (!input.result.ok) return null
  const sameSource = input.previousSource === input.source
  const previousAt = sameSource ? Number(input.previousProviderAt) || 0 : 0
  const oldest = Number(input.result.providerOldestAt) || 0
  const newest = Number(input.result.providerNewestAt) || previousAt
  const previousCoverage = sameSource && input.previousCoverageFrom
    ? Math.floor(new Date(input.previousCoverageFrom).getTime() / 1000) : 0

  let coverageFrom: number
  let gapDetected = false
  if (input.source === 'statsfm') {
    const overlaps = previousAt > 0 && (input.result.providerRowCount === 0 || (oldest > 0 && oldest <= previousAt))
    gapDetected = previousAt > 0 && !overlaps
    coverageFrom = overlaps && previousCoverage > 0 ? previousCoverage : (oldest || Math.floor(Date.now() / 1000))
  } else if (input.result.complete) {
    coverageFrom = previousCoverage > 0 ? Math.min(previousCoverage, input.attemptedFrom) : input.attemptedFrom
  } else {
    coverageFrom = oldest || input.attemptedFrom
    gapDetected = previousAt > 0
  }

  return { coverageFrom, newestProviderAt: Math.max(previousAt, newest), gapDetected }
}

/** Lightweight server collector. It only captures provider rows into the
 *  shared rc_scrobbles ledger and advances a per-agent checkpoint; the hourly
 *  job remains responsible for rollups/XP. Direct Pano/Web Scrobbler events
 *  are intentionally absent because they already arrive one-by-one. */
async function captureStreamSource(supabase: SupabaseDB, source: ScheduledSource) {
  const content = await loadContent(supabase)
  const maxPages = limits(content).lbMaxPages
  const now = Math.floor(Date.now() / 1000)
  const initialLookback = 7 * 86400
  const { data: agents, error: agentsError } = await supabase.from('rc_agents')
    .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
  if (agentsError) return { success: false, error: agentsError.message }

  const selected = (agents || []).filter((agent: AgentSourceRow) => resolvedAgentStreamSource(agent) === source)
  if (!selected.length) return { success: true, source, total: 0, synced: 0, failed: 0, gaps: 0, errors: [] }
  const agentNos = selected.map((agent: AgentSourceRow) => agent.agent_no)
  const { data: states, error: statesError } = await supabase.from('rc_stream_sync_state')
    .select('agent_no, source, coverage_from, last_provider_at, consecutive_failures').in('agent_no', agentNos)
  if (statesError) return { success: false, error: statesError.message }
  const stateByAgent = new Map((states || []).map((row: any) => [row.agent_no, row]))

  let synced = 0
  let gaps = 0
  const errors: { agentNo: string; error: string }[] = []
  for (let index = 0; index < selected.length; index += BATCH_SIZE) {
    const batch = selected.slice(index, index + BATCH_SIZE)
    await Promise.all(batch.map(async (agent: AgentSourceRow) => {
      const state: any = stateByAgent.get(agent.agent_no)
      const priorProviderAt = state?.source === source && state?.last_provider_at
        ? Math.floor(new Date(state.last_provider_at).getTime() / 1000) : 0
      // Five minutes of overlap protects same-second plays and clock skew;
      // failed runs never advance the checkpoint, so the next run retries.
      const fromTs = priorProviderAt > 0 ? Math.max(0, priorProviderAt - 300) : now - initialLookback
      try {
        // The collector itself must judge the fresh provider response. It
        // cannot use yesterday's stored coverage to certify today's fetch,
        // otherwise a newly introduced gap could validate itself.
        const result = await fetchStreamRows(supabase, agent, fromTs, now, maxPages, { useStoredCoverage: false })
        const coverage = nextStreamCoverage({
          source, previousSource: state?.source, previousCoverageFrom: state?.coverage_from,
          previousProviderAt: priorProviderAt, attemptedFrom: fromTs, result,
        })
        if (!coverage) {
          errors.push({ agentNo: agent.agent_no, error: result.partialReason || 'provider_error' })
          const failurePatch = {
            agent_no: agent.agent_no, source, last_attempt_at: new Date().toISOString(),
            last_error: result.partialReason || 'provider_error',
            consecutive_failures: (Number(state?.consecutive_failures) || 0) + 1,
          }
          if (state) await supabase.from('rc_stream_sync_state').update(failurePatch).eq('agent_no', agent.agent_no)
          else await supabase.from('rc_stream_sync_state').insert(failurePatch)
          return
        }
        if (coverage.gapDetected) gaps++
        const patch = {
          agent_no: agent.agent_no,
          source,
          last_attempt_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_provider_at: coverage.newestProviderAt > 0 ? new Date(coverage.newestProviderAt * 1000).toISOString() : null,
          coverage_from: new Date(coverage.coverageFrom * 1000).toISOString(),
          last_error: coverage.gapDetected ? 'coverage_gap' : null,
          consecutive_failures: 0,
        }
        const { error } = await supabase.from('rc_stream_sync_state').upsert(patch, { onConflict: 'agent_no' })
        if (error) throw error
        synced++
      } catch (error) {
        errors.push({ agentNo: agent.agent_no, error: error instanceof Error ? error.message : String(error) })
      }
    }))
    if (index + BATCH_SIZE < selected.length) await delay(BATCH_DELAY_MS)
  }
  return { success: true, source, total: selected.length, synced, failed: errors.length, gaps, errors: errors.slice(0, 20) }
}

export async function adminCaptureStreamSources(supabase: SupabaseDB, params: Record<string, unknown>) {
  const source = String(params.source || '').toLowerCase() as ScheduledSource
  if (!['statsfm', 'musicat', 'listenbrainz'].includes(source)) {
    return { success: false, error: 'invalid_stream_source' }
  }
  const { data: locked, error: lockError } = await supabase.rpc('rc_stream_sync_try_lock', {
    p_source: source, p_lease_seconds: source === 'statsfm' ? 240 : 720,
  })
  if (lockError) return { success: false, error: lockError.message }
  if (!locked) return { success: true, source, skipped: true, reason: 'sync_already_running' }
  try {
    return await captureStreamSource(supabase, source)
  } finally {
    await supabase.rpc('rc_stream_sync_release_lock', { p_source: source })
  }
}

export async function adminSyncAllStreams(supabase: SupabaseDB, _params: Record<string, unknown>) {
  // Backup Passes whose request expired without ever finding a helper: the
  // pass goes back to its owner. A read-time refresh can't do this on its own
  // — it only ever runs for the owner's CURRENT district, so an owner who
  // moved on kept the request open and the pass destroyed (15 of them, and 19
  // agents locked out of the feature, before the repair migration). Cheap,
  // indexed and idempotent, so the hourly job carries it.
  const { data: swept } = await supabase.rpc('rc_backup_sweep_expired')

  const content = await loadContent(supabase)

  const { data: players, error: playersErr } = await supabase
    .from('rc_players').select('agent_no, mode, joined_at, boost_expires_at, boost_multiplier')
  if (playersErr) return { success: false, error: playersErr.message }
  if (!players || players.length === 0) return { success: true, total: 0, synced: 0, failed: 0, errors: [], backupSweep: swept || null }

  const agentNos = players.map((p: any) => p.agent_no)
  const [{ data: agentRows, error: agentsErr }, { data: activeDistricts, error: pdErr }] = await Promise.all([
    supabase.from('rc_agents')
      .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
      .in('agent_no', agentNos),
    // Only the currently-active row per agent — same thing buildState reads
    // to build goalXpScope on a real app-open. Without this, goalXpCountForDate
    // has nothing to count against and silently returns 0 for every agent,
    // every time: rc_daily_activity's raw_streams still fills in correctly
    // (it's scope-free), so this failure mode looks like "syncing fine" right
    // up until someone checks whether any XP actually landed.
    supabase.from('rc_player_districts').select('agent_no, goals, baseline, activated_at')
      .eq('status', 'active').in('agent_no', agentNos),
  ])
  if (agentsErr) return { success: false, error: agentsErr.message }
  if (pdErr) return { success: false, error: pdErr.message }
  const agentByNo = new Map<string, AgentSourceRow>((agentRows || []).map((a: any) => [a.agent_no, a]))
  const scopeByNo = new Map<string, GoalXpScope>((activeDistricts || []).map((r: any) =>
    [r.agent_no, { goals: r.goals, baseline: r.baseline || {}, activatedAt: r.activated_at }]))

  let synced = 0
  const errors: { agentNo: string; error: string }[] = []

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map(async (player: any) => {
      const agent = agentByNo.get(player.agent_no)
      if (!agent) { errors.push({ agentNo: player.agent_no, error: 'agent_row_missing' }); return }
      try {
        const personalBoostMult = player.boost_expires_at && new Date(player.boost_expires_at).getTime() > Date.now()
          ? Number(player.boost_multiplier) || 1
          : 1
        const goalXpScope = scopeByNo.get(player.agent_no) || null
        await ensureDailyRollups(supabase, agent, player, content, personalBoostMult, goalXpScope)
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
  return { success: true, total: players.length, synced, failed: errors.length, errors: errors.slice(0, 20), backupSweep: swept || null }
}
