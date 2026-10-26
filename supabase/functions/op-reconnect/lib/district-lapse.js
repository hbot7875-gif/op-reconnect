/**
 * Pure helpers for a lapsed district attempt's snapshot (rc_district_lapses).
 *
 * The snapshot keeps the same goal shape getGameState sends for the active
 * district (trackGoals / albums / reconnect.restorationProgress), so the
 * percent shown afterwards is computed by the same districtPercent the live
 * meter used, and can't disagree with what the player last saw.
 */
import { districtPercent } from '../../../../js/district-progress.js'

const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * @param progress   districtProgress() result for the attempt
 * @param reconnect  resolveReconnectStatus() result, or null when the
 *                   district has no team quest
 * @param reconnectInfo { label, trackLabel } for the team quest, if any
 */
export function buildLapseSummary(progress, reconnect, reconnectInfo = {}) {
  const trackGoals = (progress?.trackGoals || []).map((g) => ({
    label: g.label, artist: g.artist || null,
    progress: Math.min(num(g.progress), num(g.target)), target: num(g.target), done: !!g.done,
  }))
  const albums = (progress?.albums || []).map((a) => ({
    label: a.label,
    passesDone: Math.min(num(a.passesDone), num(a.target)), target: num(a.target), done: !!a.done,
    // Only the tracks that held the album back, fewest plays first.
    shortTracks: (a.nextPassTracks || []).map((t) => ({ label: t.label, have: num(t.have), need: num(t.need) })),
  }))
  const rp = reconnect?.restorationProgress
  const team = reconnect ? {
    label: reconnectInfo.label || 'ReConnect Quest',
    trackLabel: reconnectInfo.trackLabel || null,
    done: !!reconnect.done,
    progress: reconnect.done ? num(rp?.target) || 1 : Math.min(num(rp?.progress), Math.max(1, num(rp?.target))),
    target: Math.max(1, num(rp?.target)),
  } : null
  const percent = districtPercent({
    trackGoals, albums,
    reconnect: team ? { done: team.done, restorationProgress: { progress: team.progress, target: team.target } } : null,
  })
  return { percent, trackGoals, albums, reconnect: team }
}

/**
 * What the district screen needs: the dates, how far it got, and every goal
 * that was NOT achieved. `row` is an rc_district_lapses row.
 */
export function lapseView(row) {
  const summary = row?.summary || {}
  const tracks = summary.trackGoals || []
  const albums = summary.albums || []
  const team = summary.reconnect || null
  const missed = [
    ...tracks.filter((g) => !g.done).map((g) => ({
      kind: 'track', label: g.label, progress: g.progress, target: g.target,
    })),
    ...albums.filter((a) => !a.done).map((a) => ({
      kind: 'album', label: a.label, progress: a.passesDone, target: a.target,
      shortTracks: (a.shortTracks || []).slice(0, 4), moreTracks: Math.max(0, (a.shortTracks || []).length - 4),
    })),
    ...(team && !team.done ? [{
      kind: 'team', label: team.trackLabel || team.label, progress: team.progress, target: team.target,
    }] : []),
  ]
  return {
    districtId: row?.district_id,
    reason: row?.reason || 'deadline',
    activatedAt: row?.activated_at || null,
    deadlineAt: row?.deadline_at || null,
    lapsedAt: row?.lapsed_at || null,
    percent: num(summary.percent),
    done: {
      tracks: tracks.filter((g) => g.done).length, tracksTotal: tracks.length,
      albums: albums.filter((a) => a.done).length, albumsTotal: albums.length,
      team: team ? team.done : null,
    },
    missed,
  }
}

/**
 * Newest lapse per district, kept only for districts the agent isn't on now
 * (an active retry or a later restore makes the old attempt moot).
 */
export function latestLapsesByDistrict(rows, activeOrRestored = new Set()) {
  const out = {}
  for (const row of rows || []) {
    if (activeOrRestored.has(row.district_id)) continue
    const prev = out[row.district_id]
    if (!prev || Date.parse(row.lapsed_at) > Date.parse(prev.lapsedAt)) out[row.district_id] = lapseView(row)
  }
  return out
}
