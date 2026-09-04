// Stream-event fetch — a miniature of the platform's counting pipeline
// (arirang-btsbackend buildBotzRowSet, ~L2523): same source resolution, same
// pagination, same dedup, so the game counts exactly what BOTZ counts.

import { isAdScrobble } from './text.ts'
import type { SupabaseDB } from './config.ts'

export interface StreamRow {
  track_name: string
  artist_name: string
  album_name?: string
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

export function resolvedAgentStreamSource(agent: AgentSourceRow): 'listenbrainz' | 'direct' | 'statsfm' | 'musicat' {
  const pref = agent.stream_source_preference || 'lb'
  const lbUser = NON_LB_PREFS.has(pref) ? '' : (agent.lb_username || '').trim()
  if (lbUser) return 'listenbrainz'
  return resolveNonLbSource(pref, !!agent.statsfm_username, !!agent.musicat_public_id)
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ok:false means a page request itself failed (network error, non-429
// non-ok status, or unparseable body) — as opposed to a page that
// succeeded and simply came back with zero listens, which is a real,
// trustworthy "nothing more here" signal and keeps ok:true. This
// distinction is what lets ensureDailyRollups tell "genuinely no streams
// today" apart from "ListenBrainz hiccuped" — collapsing them was a real
// bug: a transient failure produced the same empty bucket as a real zero,
// silently overwriting and erasing whatever real streams that day already
// had recorded from an earlier, successful poll.
async function fetchListenBrainz(lbUser: string, fromTs: number, toTs: number, maxPages: number): Promise<{ rows: StreamRow[]; ok: boolean }> {
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
    if (!res || !res.ok) return { rows, ok: false }
    const data = await res.json().catch(() => null)
    if (data === null) return { rows, ok: false }
    const listens: any[] = data?.payload?.listens || []
    if (listens.length === 0) break
    let oldest = cursor
    for (const l of listens) {
      const ts = l.listened_at
      const md = l.track_metadata || {}
      if (!ts || !md.track_name) continue
      if (ts < oldest) oldest = ts
      if (ts < fromTs || ts > toTs) continue
      rows.push({ track_name: md.track_name, artist_name: md.artist_name || '', album_name: md.release_name || '', listened_at: ts })
    }
    if (listens.length < 100) break
    cursor = oldest - 1
    if (cursor < fromTs) break
  }
  return { rows, ok: true }
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
      .select('track_name, artist_name, album_name, listened_at')
      .eq('agent_no', agentNo)
      .gte('listened_at', fromTs)
      .lte('listened_at', toTs)
      .order('listened_at', { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const r of data) {
      rows.push({ track_name: r.track_name || '', artist_name: r.artist_name || '', album_name: r.album_name || '', listened_at: r.listened_at })
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return rows
}

// stats.fm's public API has no date-range filter on /streams/recent — it's
// always "the last 50," full stop, with no way to page further back. Fetched
// unfiltered (no window here — see fetchStreamRows, which persists whatever
// this returns into rc_scrobbles before ever windowing it). Filtering to
// [fromTs, toTs] at THIS layer used to be the bug: a live day recompute would
// re-derive a day's whole track_counts bucket from just this 50-item snapshot,
// so any track that scrolled out of "last 50" (trivial once someone streams
// more than 50 times in a day) silently vanished from already-counted
// history on the next poll — completed goals un-completing, XP dropping
// mid-day, counts going backwards. See derive.ts ensureDailyRollups.
async function fetchStatsFm(username: string): Promise<StreamRow[]> {
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
    if (!Number.isFinite(ts)) continue
    rows.push({
      track_name: trackName,
      artist_name: t.artists?.[0]?.name || '',
      album_name: t.albums?.[0]?.name || t.album?.name || '',
      listened_at: ts,
    })
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
// page cap (1000 plays/day — still bounded, so this too gets persisted by
// fetchStreamRows rather than trusted as the full picture on every poll).
// playedAt strings carry no timezone suffix; the API returns UTC, so a bare
// 'Z' has to be appended before Date can parse it correctly.
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
      rows.push({
        track_name: trackName,
        artist_name: it.artists || '',
        album_name: it.album?.name || it.albumName || it.releaseName || '',
        listened_at: ts,
      })
    }
    if (reachedOlder || items.length < MUSICAT_PAGE_SIZE) break
  }
  return rows
}

// stats.fm and musicat are both bounded "recent window" APIs (50 items hard
// cap; 1000 items/page-cap respectively) — neither can be trusted as the
// full picture of a day on every poll, only as a live delta. Every row they
// return gets persisted here into rc_scrobbles (same table/dedup key the
// webhook sources already use), so once a play has been SEEN once it can
// never be lost again just because it scrolled out of the provider's
// shrinking "recent" window on a later poll. ignoreDuplicates makes repeated
// polls of the same overlapping window a no-op rather than a double-count.
async function persistScrobbles(supabase: SupabaseDB, agentNo: string, rows: StreamRow[], source: string) {
  if (rows.length === 0) return
  let candidates = rows
  if (source === 'listenbrainz') {
    // LB can return the whole current day on every 90-second player poll.
    // Avoid re-sending hundreds of already-stored rows each time; keep the
    // last second inclusive so two tracks sharing one timestamp are not lost.
    const { data: latest } = await supabase.from('rc_scrobbles')
      .select('listened_at').eq('agent_no', agentNo).eq('source', source)
      .order('listened_at', { ascending: false }).limit(1).maybeSingle()
    const latestTs = Number(latest?.listened_at) || 0
    if (latestTs > 0) candidates = rows.filter((row) => row.listened_at >= latestTs)
  }
  const payload = candidates
    .filter((r) => r.track_name && r.listened_at && !isAdScrobble(r.track_name, r.artist_name))
    .map((r) => ({
      agent_no: agentNo,
      track_name: r.track_name,
      artist_name: r.artist_name || null,
      album_name: r.album_name || null,
      listened_at: r.listened_at,
      source,
    }))
  if (payload.length === 0) return
  await supabase.from('rc_scrobbles').upsert(payload, { onConflict: 'agent_no,listened_at,track_name', ignoreDuplicates: true })
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
): Promise<{ rows: StreamRow[]; ok: boolean }> {
  const source = resolvedAgentStreamSource(agent)

  let rows: StreamRow[]
  let ok = true
  if (source === 'listenbrainz') {
    const lb = await fetchListenBrainz((agent.lb_username || '').trim(), fromTs, toTs, lbMaxPages)
    rows = lb.rows
    ok = lb.ok
    // Keep the same timestamped source-of-truth every other provider uses.
    // Red Zone needs exact launch/deadline boundaries; a KST-day rollup can
    // never tell whether a play happened before launch or after expiry.
    // Persisting the successful LB window makes those exact timestamps
    // available without changing ordinary daily counting.
    if (ok) await persistScrobbles(supabase, agent.agent_no, rows, 'listenbrainz')
  } else {
    if (source === 'statsfm' && agent.statsfm_username) {
      // Persist the live snapshot, then read the return value back from the
      // accumulated table windowed to what was actually asked for — never
      // hand the caller the raw, possibly-truncated live fetch directly.
      await persistScrobbles(supabase, agent.agent_no, await fetchStatsFm(agent.statsfm_username), 'statsfm')
      rows = await fetchDirectScrobbles(supabase, agent.agent_no, fromTs, toTs)
    } else if (source === 'musicat' && agent.musicat_public_id) {
      await persistScrobbles(supabase, agent.agent_no, await fetchMusicat(agent.musicat_public_id, fromTs, toTs), 'musicat')
      rows = await fetchDirectScrobbles(supabase, agent.agent_no, fromTs, toTs)
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
  return { rows: out, ok }
}
