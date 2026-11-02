// BTS's MAMA Fans' Choice ranks — fetch and serve.
//
// cronMamaRankCheck (pg_cron rc-mama-rank-check, 20261102120500) reads Mnet
// Plus's public vote endpoint every 15 minutes while a tracked vote is open
// and records BTS's rank in each category (rc_mama_rank_record). It is our
// own collection: no third-party copy of the data is used. getMamaRanking is
// the Voting screen's read, signed-in and limited to MAMA_RANK_VIEWERS.
//
// Ranks only. The endpoint has no vote counts or percentages, and nothing
// here derives any. Not part of gameplay: no XP, rewards or scores.

import { mamaRankUrl, parseMamaRanks, mamaRankView, canSeeMamaRank, MAMA_RANK_HISTORY_HOURS } from './mama-rank-rules.js'

const FETCH_TIMEOUT_MS = 10_000

// deno-lint-ignore no-explicit-any
type Sb = any

/** The source for the campaign whose voting is open now (or closed within
 *  the last hour), if any. */
async function currentSource(sb: Sb, nowMs: number) {
  const { data: sources, error } = await sb.from('rc_mama_rank_source')
    .select('campaign_id, vote_id, artist').eq('active', true)
  if (error) throw new Error(`rank_source: ${error.message}`)
  if (!sources?.length) return null
  const { data: campaigns } = await sb.from('rc_vote_campaigns')
    .select('id, opens_at, closes_at').in('id', sources.map((s: any) => s.campaign_id))
  const open = (campaigns || []).find((c: any) =>
    Date.parse(c.opens_at) <= nowMs && nowMs <= Date.parse(c.closes_at) + 3_600_000)
  return open ? sources.find((s: any) => s.campaign_id === open.id) : null
}

export async function cronMamaRankCheck(sb: Sb, opts: { now?: number } = {}) {
  const nowMs = opts.now ?? Date.now()
  const source = await currentSource(sb, nowMs)
  if (!source) return { success: true, skipped: 'no_open_vote' }

  let status: number | null = null
  let ranks: any = null
  let standings: any = null
  let error: string | null = null
  try {
    const res = await fetch(mamaRankUrl(source.vote_id), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    status = res.status
    if (!res.ok) throw new Error(`http_${res.status}`)
    const parsed = parseMamaRanks(await res.json(), source.artist || 'BTS')
    if (!parsed.ok) throw new Error(parsed.error)
    ranks = parsed.ranks
    standings = parsed.standings
  } catch (e) {
    error = String((e as Error)?.message || e).slice(0, 200)
  }

  const { error: storeError } = await sb.rpc('rc_mama_rank_record', {
    p_campaign: source.campaign_id, p_vote: source.vote_id, p_ok: !error, p_status: status,
    p_error: error, p_ranks: ranks, p_at: new Date(nowMs).toISOString(), p_standings: standings,
  })
  if (storeError) return { success: false, error: `store: ${storeError.message}` }
  return error ? { success: true, ok: false, error } : { success: true, ok: true, ranks }
}

/** The latest successful ranks, when they were read, and the last day of
 *  hourly history, for the newest tracked campaign. Signed-in agents only,
 *  and for now only MAMA_RANK_VIEWERS; anyone else gets no ranking. */
export async function getMamaRanking(sb: Sb, params: any = {}) {
  if (!canSeeMamaRank(params.agentNo)) return { success: true, ranking: null }
  const { data: last, error } = await sb.from('rc_mama_rank_checks')
    .select('campaign_id, checked_at, ranks, standings').eq('ok', true)
    .order('checked_at', { ascending: false }).limit(1)
  if (error) return { success: false, error: 'ranking_unavailable' }
  const latest = last?.[0]
  if (!latest) return { success: true, ranking: null }
  const since = new Date(Date.now() - (MAMA_RANK_HISTORY_HOURS + 1) * 3_600_000).toISOString()
  const { data: hours } = await sb.from('rc_mama_rank_hourly')
    .select('category, hour, last_rank, best_rank, worst_rank')
    .eq('campaign_id', latest.campaign_id).gte('hour', since).order('hour', { ascending: true })
  return {
    success: true,
    ranking: mamaRankView({ checkedAt: latest.checked_at, ranks: latest.ranks, standings: latest.standings }, hours || [], new Date()),
  }
}
