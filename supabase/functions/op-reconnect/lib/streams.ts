// Stream-event fetch — a miniature of the platform's counting pipeline
// (arirang-btsbackend buildBotzRowSet, ~L2523): same source resolution, same
// pagination, same dedup, so the game counts exactly what BOTZ counts.

import { isAdScrobble } from './text.ts'
import type { SupabaseDB } from './config.ts'

export interface StreamRow {
  track_name: string
  artist_name: string
  listened_at: number // unix seconds
}

export interface AgentSourceRow {
  agent_no: string
  lb_username: string | null
  stream_source_preference: string | null
  statsfm_username: string | null
  musicat_public_id: string | null
}

const NON_LB_PREFS = new Set(['direct', 'statsfm', 'musicat'])

// stream_source_preference is frequently left at its default 'lb' even for
// agents who only linked stats.fm/musicat — fall back to whatever is linked.
function resolveNonLbSource(pref: string, hasStatsFm: boolean, hasMusicat: boolean): 'direct' | 'statsfm' | 'musicat' {
  if (pref === 'statsfm' && hasStatsFm) return 'statsfm'
  if (pref === 'musicat' && hasMusicat) return 'musicat'
  if (pref === 'direct') return 'direct'
  if (hasStatsFm) return 'statsfm'
  if (hasMusicat) return 'musicat'
  return 'direct'
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchListenBrainz(lbUser: string, fromTs: number, toTs: number, maxPages: number): Promise<StreamRow[]> {
  const rows: StreamRow[] = []
  let cursor = toTs
  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await delay(150)
    const url = `https://api.listenbrainz.org/1/user/${encodeURIComponent(lbUser)}/listens?count=100&max_ts=${cursor}`
    let res = await fetch(url, { headers: { 'User-Agent': 'HopeTracker/1.0' } }).catch(() => null)
    if (res && res.status === 429) {
      await delay(2000)
      res = await fetch(url, { headers: { 'User-Agent': 'HopeTracker/1.0' } }).catch(() => null)
    }
    if (!res || !res.ok) break
    const data = await res.json().catch(() => null)
    const listens: any[] = data?.payload?.listens || []
    if (listens.length === 0) break
    let oldest = cursor
    for (const l of listens) {
      const ts = l.listened_at
      const md = l.track_metadata || {}
      if (!ts || !md.track_name) continue
      if (ts < oldest) oldest = ts
      if (ts < fromTs || ts > toTs) continue
      rows.push({ track_name: md.track_name, artist_name: md.artist_name || '', listened_at: ts })
    }
    if (listens.length < 100) break
    cursor = oldest - 1
    if (cursor < fromTs) break
  }
  return rows
}

// Both direct-scrobble protocols (Web Scrobbler's webhook, the
// ListenBrainz-like route Pano Scrobbler uses) land in rc_scrobbles tagged
// 'webhook'/'lb-like' — pull both, this preference doesn't distinguish them.
async function fetchDirectScrobbles(supabase: SupabaseDB, agentNo: string, fromTs: number, toTs: number): Promise<StreamRow[]> {
  const PAGE = 1000
  const MAX_ROWS = 20000
  const rows: StreamRow[] = []
  let offset = 0
  while (offset < MAX_ROWS) {
    const { data, error } = await supabase
      .from('rc_scrobbles')
      .select('track_name, artist_name, listened_at')
      .eq('agent_no', agentNo)
      .gte('listened_at', fromTs)
      .lte('listened_at', toTs)
      .order('listened_at', { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const r of data) {
      rows.push({ track_name: r.track_name || '', artist_name: r.artist_name || '', listened_at: r.listened_at })
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return rows
}

// stats.fm's public API has no date-range filter on /streams/recent — it's
// always "the last 50," client-filtered to the window here. No separate
// sync job (unlike the old site): this fetches live on every rollup, same
// as ListenBrainz does.
async function fetchStatsFm(username: string, fromTs: number, toTs: number): Promise<StreamRow[]> {
  const url = `https://api.stats.fm/api/v1/users/${encodeURIComponent(username)}/streams/recent?limit=50`
  const res = await fetch(url).catch(() => null)
  if (!res || !res.ok) return []
  const data = await res.json().catch(() => null)
  const items: any[] = Array.isArray(data?.items) ? data.items : []
  const rows: StreamRow[] = []
  for (const it of items) {
    const t = it.track || {}
    const trackName = (t.name || '').trim()
    if (!trackName || !it.endTime) continue
    const ts = Math.floor(new Date(it.endTime).getTime() / 1000)
    if (!Number.isFinite(ts) || ts < fromTs || ts > toTs) continue
    rows.push({ track_name: trackName, artist_name: t.artists?.[0]?.name || '', listened_at: ts })
  }
  return rows
}

// Musicat has no date-range filter on listening-history — pages of 50,
// newest first, trimmed to the window client-side. This used to read only
// page 0: fine for "what's new since a poll a minute ago," but a daily
// rollup asking for a whole KST day can need much more than the newest 50
// plays to reach that day at all for anyone reasonably active — it would
// silently undercount rather than error, indistinguishable from "didn't
// stream." Paginates like arirang-btsbackend's own fetch does, stopping at
// whichever comes first: a page already older than fromTs (sorting is DESC,
// so nothing further back matters), a short page (no more history), or the
// page cap. playedAt strings carry no timezone suffix; the API returns UTC,
// so a bare 'Z' has to be appended before Date can parse it correctly.
const MUSICAT_PAGE_SIZE = 50
const MUSICAT_MAX_PAGES = 20
async function fetchMusicat(publicId: string, fromTs: number, toTs: number): Promise<StreamRow[]> {
  const rows: StreamRow[] = []
  for (let page = 0; page < MUSICAT_MAX_PAGES; page++) {
    if (page > 0) await delay(150)
    const res = await fetch('https://api.musicat.fm/v1/users/listening-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer empty' },
      body: JSON.stringify({ publicUserId: publicId, range: { start: null, end: null }, sorting: 'DESC', page }),
    }).catch(() => null)
    if (!res || !res.ok) break
    const items = await res.json().catch(() => null)
    if (!Array.isArray(items) || items.length === 0) break

    let reachedOlder = false
    for (const it of items) {
      const trackName = (it.name || '').trim()
      const raw = String(it.playedAt || '')
      if (!trackName || !raw) continue
      const iso = /[Zz]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z'
      const ts = Math.floor(new Date(iso).getTime() / 1000)
      if (!Number.isFinite(ts)) continue
      if (ts < fromTs) { reachedOlder = true; continue }
      if (ts > toTs) continue
      rows.push({ track_name: trackName, artist_name: it.artists || '', listened_at: ts })
    }
    if (reachedOlder || items.length < MUSICAT_PAGE_SIZE) break
  }
  return rows
}

/**
 * Unified per-agent stream rows for [fromTs, toTs], deduped and ad-filtered.
 * Source resolution mirrors the platform: ListenBrainz when pref is lb/unset
 * and an LB username exists; otherwise the agent's resolved custom source.
 */
export async function fetchStreamRows(
  supabase: SupabaseDB,
  agent: AgentSourceRow,
  fromTs: number,
  toTs: number,
  lbMaxPages: number,
): Promise<StreamRow[]> {
  const pref = agent.stream_source_preference || 'lb'
  const lbUser = NON_LB_PREFS.has(pref) ? null : (agent.lb_username || '').trim() || null

  let rows: StreamRow[]
  if (lbUser) {
    rows = await fetchListenBrainz(lbUser, fromTs, toTs, lbMaxPages)
  } else {
    const source = resolveNonLbSource(pref, !!agent.statsfm_username, !!agent.musicat_public_id)
    if (source === 'statsfm' && agent.statsfm_username) {
      rows = await fetchStatsFm(agent.statsfm_username, fromTs, toTs)
    } else if (source === 'musicat' && agent.musicat_public_id) {
      rows = await fetchMusicat(agent.musicat_public_id, fromTs, toTs)
    } else {
      rows = await fetchDirectScrobbles(supabase, agent.agent_no, fromTs, toTs)
    }
  }

  const seen = new Set<string>()
  const out: StreamRow[] = []
  for (const r of rows) {
    if (!r.track_name || !r.listened_at) continue
    if (isAdScrobble(r.track_name, r.artist_name)) continue
    const key = `${r.listened_at}|${r.track_name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}
