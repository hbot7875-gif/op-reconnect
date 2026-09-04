// BOTZ in-game — "now playing" + recent streams, from whatever source the
// agent already has linked. Reuses fetchStreamRows (same source resolution
// startDistrict/getGameState already use) rather than a second ingest path.

import type { SupabaseDB } from './config.ts'
import { loadContent, limits, trackArtistOverrides } from './config.ts'
import { fetchStreamRows } from './streams.ts'
import { normalizeKey, normKeyFull, countedArtistPlays } from './text.ts'
import { todayKst, kstDateOf, kstDayBounds } from './kst.ts'
import { districtProgress } from './districts.ts'
import { getBackupOverlay } from './backup-pass.ts'
import { BIRTHDAY_ERA_EVENTS, BIRTHDAY_LIGHTS_PER_TRACK, birthdayTrackEntries, isBirthdayEventDate } from './birthday-eras.ts'
import { allocateTrackHits } from './era-match.js'
import { annotateBotzStreams, botzSourceSetup, botzTrackingState } from './botz-rules.js'
import { flagStreamRows, findPossibleAlts } from './police-check.ts'

export async function getSignalLog(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: agentRow } = await supabase
    .from('rc_agents')
    .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id, scrobble_pin')
    .eq('agent_no', agentNo).maybeSingle()
  if (!agentRow) return { success: false, error: 'Agent not found' }

  const content = await loadContent(supabase)
  const allowlist: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)
  const now = Math.floor(Date.now() / 1000)
  const from = now - 86400
  const today = todayKst()
  const earliestDate = kstDateOf(from)
  // Fetch from the start of the earliest visible KST day. This small hidden
  // lead-in lets attribution spend streams that happened earlier that day,
  // so a 23-hour-old row cannot be mislabeled as helping a target that had
  // already filled before the rolling 24h feed begins.
  const attributionFrom = kstDayBounds(earliestDate).fromTs

  const [{ rows, ok }, activeRes, rollupRes] = await Promise.all([
    fetchStreamRows(supabase, agentRow, attributionFrom, now, limits(content).lbMaxPages),
    supabase.from('rc_player_districts')
      .select('district_id, goals, baseline, activated_at')
      .eq('agent_no', agentNo).eq('status', 'active').maybeSingle(),
    supabase.from('rc_daily_activity')
      .select('kst_date, track_counts, transmission')
      .eq('agent_no', agentNo).lte('kst_date', today).order('kst_date'),
  ])
  rows.sort((a, b) => b.listened_at - a.listened_at)

  const allStreams: any[] = rows.map((r) => {
    const key = normKeyFull(r.track_name)
    const eligible = countedArtistPlays({ [normalizeKey(r.artist_name || '')]: 1 }, allowlist, key, overrides) > 0
    return {
      track: r.track_name,
      artist: r.artist_name || null,
      album: r.album_name || null,
      at: r.listened_at,
      key,
      eligible,
      reason: eligible ? null : 'artist_not_eligible',
      source: botzSourceSetup(agentRow).source,
    }
  })

  const rollups: any[] = rollupRes.data || []
  const beforeWindow = rollups.filter((r) => r.kst_date < earliestDate)
  const activePd: any = activeRes.data
  let districtContext: any = null
  if (activePd?.goals) {
    const overlay = await getBackupOverlay(supabase, agentNo, activePd.district_id)
    const before = districtProgress(activePd.goals, activePd.baseline || {}, beforeWindow, activePd.activated_at, content, overlay)
    const district = content.districts.find((d) => d.id === activePd.district_id)
    districtContext = {
      id: activePd.district_id,
      label: district?.name || activePd.district_id,
      activeFrom: Math.floor(new Date(activePd.activated_at).getTime() / 1000),
      trackSlots: (activePd.goals.trackGoals || []).map((goal: any) => {
        const progress = before.trackGoals.find((g: any) => g.id === goal.id)
        return { keys: goal.keys, remaining: Math.max(0, (progress?.target || goal.target) - (progress?.progress || 0)) }
      }),
      albums: (activePd.goals.albumGoals || []).map((album: any) => {
        const progress = before.albums.find((a: any) => a.id === album.id)
        return {
          target: progress?.target || album.target,
          cap: album.target,
          bonus: progress?.backup?.bonus || 0,
          slots: album.tracks.map((track: any) => ({
            keys: track.keys,
            have: progress?.tracks?.find((t: any) => t.label === track.label)?.have || 0,
          })),
        }
      }),
    }
  }

  const birthdayEvent = BIRTHDAY_ERA_EVENTS.find((event) => isBirthdayEventDate(event, today))
  let birthdayContext: any = null
  let birthdayProgress = 0
  if (birthdayEvent) {
    const entries = birthdayTrackEntries(birthdayEvent)
    const priorTotals = new Map<string, number>()
    for (const day of beforeWindow.filter((r) => r.kst_date >= birthdayEvent.date)) {
      for (const [key, value] of Object.entries(day.track_counts || {})) {
        priorTotals.set(key, (priorTotals.get(key) || 0) + countedArtistPlays((value as any)?.a, allowlist, key, overrides))
      }
    }
    const priorMatches = allocateTrackHits(entries, priorTotals, BIRTHDAY_LIGHTS_PER_TRACK)
    birthdayContext = {
      id: birthdayEvent.id,
      label: birthdayEvent.cardName,
      activeFrom: kstDayBounds(birthdayEvent.date).fromTs,
      activeTo: kstDayBounds(birthdayEvent.dateEnd || birthdayEvent.date).toTs - 1,
      slots: entries.map((entry: any) => ({
        keys: entry.keys,
        credited: priorMatches.get(entry.id) || 0,
        limit: BIRTHDAY_LIGHTS_PER_TRACK,
      })),
    }
  }

  annotateBotzStreams(allStreams, { district: districtContext, birthday: birthdayContext })
  const visibleStreams = allStreams.filter((stream) => stream.at >= from)
  const streams = visibleStreams.slice(0, 50).map(({ key: _key, ...stream }) => stream)
  const todayStreams = allStreams.filter((stream) => kstDateOf(stream.at) === today)
  const helpedToday = todayStreams.filter((stream) => stream.attributions.length > 0)
  const missions: any[] = []
  if (birthdayEvent) {
    const eventTotals = new Map<string, number>()
    for (const day of rollups.filter((r) => r.kst_date >= birthdayEvent.date)) {
      for (const [key, value] of Object.entries(day.track_counts || {})) {
        eventTotals.set(key, (eventTotals.get(key) || 0) + countedArtistPlays((value as any)?.a, allowlist, key, overrides))
      }
    }
    birthdayProgress = [...allocateTrackHits(birthdayTrackEntries(birthdayEvent), eventTotals, 1).values()].filter((n) => n > 0).length
    missions.push({ kind: 'birthday', id: birthdayEvent.id, label: birthdayEvent.cardName, icon: birthdayEvent.icon, progress: birthdayProgress, total: birthdayEvent.tracks.length })
  }
  if (districtContext) {
    missions.push({
      kind: 'district', id: districtContext.id, label: districtContext.label, icon: '📍',
      today: helpedToday.filter((stream) => stream.attributions.some((a: any) => a.kind === 'district')).length,
    })
  }
  const setup = botzSourceSetup(agentRow)
  const trackingState = botzTrackingState({ setupOk: setup.setupOk, checkOk: ok, hasRecent: visibleStreams.length > 0 })
  const sourceLabels: Record<string, string> = { listenbrainz: 'ListenBrainz', direct: 'Pano / Web Scrobbler', statsfm: 'Stats.fm', musicat: 'Musicat' }

  return {
    success: true,
    tracking: { state: trackingState, source: setup.source, sourceLabel: sourceLabels[setup.source], lastReceivedAt: visibleStreams[0]?.at || null },
    lastPlayed: visibleStreams[0] ? { track: visibleStreams[0].track, artist: visibleStreams[0].artist, at: visibleStreams[0].at, source: setup.source } : null,
    nowPlaying: visibleStreams[0] ? { track: visibleStreams[0].track, artist: visibleStreams[0].artist, at: visibleStreams[0].at } : null,
    today: {
      btsJams: todayStreams.filter((stream) => stream.eligible).length,
      helpedMissions: helpedToday.length,
      trackedOnly: todayStreams.filter((stream) => stream.eligible && stream.attributions.length === 0).length,
    },
    missions,
    streams,
    totals: { streams24h: visibleStreams.length, counted24h: visibleStreams.filter((s) => s.eligible).length },
  }
}

/** Agent-facing self-check — the same "PL rules" flags and alt-identity
 *  check Moon Station gives an admin, but for your own account only. This
 *  is `auth: 'agent'` in index.ts, which verifies params.agentNo against
 *  params.sessionToken before this ever runs — so unlike adminGetAgentTracks
 *  (which can look up ANY agent given the admin key), this can only ever
 *  answer "is my own account clean, and does my own identity show up
 *  anywhere else." An agent can't use this to go looking for other
 *  agents' alts; they can only ever discover accounts that share THEIR
 *  identity specifically, which is a narrower, self-scoped exposure. */
export async function getMySelfCheck(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: agent } = await supabase
    .from('rc_agents')
    .select('agent_no, handle, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
    .eq('agent_no', agentNo).maybeSingle()
  if (!agent) return { success: false, error: 'Agent not found' }

  const days = Math.max(1, Math.min(30, Number(params.days) || 7))
  const toTs = Math.floor(Date.now() / 1000)
  const fromTs = toTs - days * 86400

  const content = await loadContent(supabase)
  const lim = limits(content)
  const [{ rows }, possibleAlts] = await Promise.all([
    fetchStreamRows(supabase, agent, fromTs, toTs, lim.lbMaxPages),
    findPossibleAlts(supabase, agent),
  ])
  const tracks = flagStreamRows(rows)

  return {
    success: true,
    windowDays: days,
    fromDate: new Date(fromTs * 1000).toISOString(),
    toDate: new Date(toTs * 1000).toISOString(),
    trackCount: tracks.length,
    flaggedCount: tracks.filter((t) => t.flags.length > 0).length,
    tracks,
    possibleAlts,
  }
}
