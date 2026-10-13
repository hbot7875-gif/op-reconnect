// BTS X Vote Pulse collector — a shared, cached running count of tracked
// public vote posts, refreshed on a schedule (about 4 times a day), never by
// a player's page load. See migration 20261013150000 (rc_vote_pulse) and
// 20261013150500 (the schedule).
//
// Display and motivation only. Nothing here touches proofs, XP, the Voting
// Gift, streaks or badges, and nothing there reads this.
//
// How a count is built (Apify, free plan):
//   * each scheduled call first COLLECTS the previous provider run, counting
//     only post ids newer than the cursor, then STARTS the next run asking
//     only for posts newer than the newest id seen (`since_id`). Posts are
//     never paid for twice.
//   * a run capped at max_items_per_run may have missed posts in its window,
//     so the total is always a lower bound — the UI says "+" / tracked, never
//     an official count.
//   * only ids are read back from the dataset (fields=id) and only numbers
//     are stored. No usernames, no post text.
//   * if the provider fails or the free credit runs out, the last count
//     stands; nothing is ever subtracted or reset to zero.
import { pulseQuery, snowflakeAt } from './vote-campaign-rules.js'

const APIFY = 'https://api.apify.com/v2'
const STUCK_AFTER_MS = 3 * 3600_000
const DATASET_PAGE = 1000

function errText(e) { return String(e?.message || e || 'error').slice(0, 200) }

async function apify(fetchImpl, token, path, init = {}) {
  const res = await fetchImpl(`${APIFY}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  })
  let body = null
  try { body = await res.json() } catch { /* empty or non-JSON body */ }
  return { status: res.status, ok: res.ok, body }
}

/** Collect every id in a finished run's dataset, newest-cursor filtered. */
async function collectIds(fetchImpl, token, datasetId, cursor) {
  const ids = new Set()
  let fetched = 0
  for (let offset = 0; offset < 100_000; offset += DATASET_PAGE) {
    const r = await apify(fetchImpl, token, `/datasets/${encodeURIComponent(datasetId)}/items?fields=id&clean=true&format=json&limit=${DATASET_PAGE}&offset=${offset}`)
    if (!r.ok || !Array.isArray(r.body)) throw new Error(`dataset_${r.status}`)
    fetched += r.body.length
    for (const item of r.body) {
      const id = String(item?.id ?? item?.id_str ?? '')
      if (/^\d{5,25}$/.test(id) && BigInt(id) > cursor) ids.add(id)
    }
    if (r.body.length < DATASET_PAGE) break
  }
  let newest = cursor
  for (const id of ids) if (BigInt(id) > newest) newest = BigInt(id)
  return { counted: ids.size, fetched, newest }
}

function isCreditError(r) {
  if (r.status === 402) return true
  const t = JSON.stringify(r.body || '').toLowerCase()
  return (r.status === 400 || r.status === 403) && /usage|credit|limit|not-enough|payment/.test(t)
}

/**
 * One scheduled tick for every campaign whose Pulse is enabled and inside
 * its collection window. Never throws; returns what it did per campaign.
 */
export async function runVotePulse(db, { fetchImpl = globalThis.fetch, token = '', now = new Date() } = {}) {
  const out = []
  const { data: campaigns } = await db.from('rc_vote_campaigns').select('*').eq('active', true)
  for (const c of campaigns || []) {
    const p = c.pulse || {}
    if (!p.enabled || p.provider !== 'apify') continue
    const opens = new Date(c.opens_at).getTime()
    const closes = new Date(c.closes_at).getTime()
    const graceMs = (Number(p.collect_until_hours_after_close) || 12) * 3600_000
    const t = now.getTime()
    if (t < opens || t > closes + graceMs) { out.push({ campaignId: c.id, skipped: 'outside_window' }); continue }
    if (!token) { out.push({ campaignId: c.id, skipped: 'no_token' }); continue }
    try {
      out.push({ campaignId: c.id, ...(await tick(db, c, p, { fetchImpl, token, now })) })
    } catch (e) {
      out.push({ campaignId: c.id, error: errText(e) })
    }
  }
  return { success: true, results: out }
}

async function finish(db, campaignId, runRef, status, extra = {}) {
  const { data } = await db.rpc('rc_vote_pulse_finish', {
    p_campaign_id: campaignId, p_run_ref: runRef, p_status: status,
    p_counted: extra.counted ?? 0, p_newest_post_id: extra.newest != null ? extra.newest.toString() : null,
    p_complete: extra.complete ?? false, p_fetched: extra.fetched ?? 0, p_cost_usd: extra.cost ?? 0,
    p_note: extra.note ?? null,
  })
  return data
}

async function tick(db, c, p, { fetchImpl, token, now }) {
  const maxItems = Math.max(20, Math.min(5000, Number(p.max_items_per_run) || 600))
  const price = Number(p.price_per_1000_usd) || 0.15
  const { data: state } = await db.from('rc_vote_pulse').select('*').eq('campaign_id', c.id).maybeSingle()
  const cursor = BigInt(state?.cursor_post_id ? String(state.cursor_post_id).split('.')[0] : snowflakeAt(c.opens_at))
  const report = {}

  // ── 1. Collect the previous run, if there is one.
  if (state?.pending_run_id) {
    const run = await apify(fetchImpl, token, `/actor-runs/${encodeURIComponent(state.pending_run_id)}`)
    const r = run.body?.data
    const st = r?.status
    if (!run.ok || !st) {
      report.collected = 'unknown'
    } else if (st === 'READY' || st === 'RUNNING') {
      if (now.getTime() - new Date(state.pending_started_at).getTime() < STUCK_AFTER_MS) return { waiting: state.pending_run_id }
      await apify(fetchImpl, token, `/actor-runs/${encodeURIComponent(state.pending_run_id)}/abort`, { method: 'POST' })
      await finish(db, c.id, state.pending_run_id, 'failed', { note: 'stuck_run_aborted' })
      report.collected = 'aborted'
    } else if (st === 'SUCCEEDED') {
      const { counted, fetched, newest } = await collectIds(fetchImpl, token, r.defaultDatasetId, cursor)
      const complete = fetched < maxItems
      const cost = Number(r.usageTotalUsd) || (fetched * price) / 1000
      await finish(db, c.id, state.pending_run_id, complete ? 'ok' : 'partial', { counted, newest, complete, fetched, cost })
      report.collected = { counted, fetched, complete }
    } else {
      await finish(db, c.id, state.pending_run_id, 'failed', { note: `run_${String(st).toLowerCase()}`, cost: Number(r.usageTotalUsd) || 0 })
      report.collected = 'failed'
    }
  }

  // ── 2. Start the next run — only while voting is open, and only within
  //       the free-credit budget.
  if (now.getTime() > new Date(c.closes_at).getTime()) return { ...report, started: false, reason: 'voting_closed' }
  const { data: fresh } = await db.from('rc_vote_pulse').select('spent_usd, cursor_post_id, pending_run_id').eq('campaign_id', c.id).maybeSingle()
  if (fresh?.pending_run_id) return { ...report, started: false, reason: 'run_pending' }
  const spent = Number(fresh?.spent_usd) || 0
  const runCap = (maxItems * price) / 1000
  if (spent + runCap > (Number(p.budget_usd) || 0)) {
    await finish(db, c.id, null, 'exhausted', { note: 'budget_reached' })
    return { ...report, started: false, reason: 'budget_reached' }
  }
  const since = fresh?.cursor_post_id ? String(fresh.cursor_post_id).split('.')[0] : snowflakeAt(c.opens_at)
  const xMission = (c.missions || []).find((m) => m.kind === 'x_post')
  const input = {
    twitterContent: pulseQuery(xMission?.hashtags || [], { excludeRetweets: p.exclude_retweets !== false }),
    queryType: 'Latest',
    maxItems,
    since_id: since,
  }
  const started = await apify(fetchImpl, token,
    `/acts/${encodeURIComponent(p.actor)}/runs?maxItems=${maxItems}&maxTotalChargeUsd=${runCap.toFixed(4)}`,
    { method: 'POST', body: JSON.stringify(input) })
  if (!started.ok || !started.body?.data?.id) {
    const status = isCreditError(started) ? 'exhausted' : 'failed'
    await finish(db, c.id, null, status, { note: `start_${started.status}` })
    return { ...report, started: false, reason: status }
  }
  const runId = started.body.data.id
  const { data: claimed } = await db.rpc('rc_vote_pulse_begin', { p_campaign_id: c.id, p_run_ref: runId })
  if (!claimed?.success) {
    await apify(fetchImpl, token, `/actor-runs/${encodeURIComponent(runId)}/abort`, { method: 'POST' })
    return { ...report, started: false, reason: 'run_pending' }
  }
  return { ...report, started: runId, query: input.twitterContent }
}
