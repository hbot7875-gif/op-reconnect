/**
 * Pure recent-stream attribution for BOTZ.
 *
 * The caller builds these counters from the real district/Birthday state.
 * This module only spends those remaining counters chronologically; it does
 * not decide which tracks, targets, aliases, or artists are valid.
 */
export function annotateBotzStreams(rows, context = {}, out = {}) {
  const district = context.district ? structuredClone(context.district) : null
  // The counters after every row is spent, so the caller can say what the
  // district still needs (botzDistrictStillNeeded) without re-allocating.
  out.district = district
  const birthday = context.birthday ? structuredClone(context.birthday) : null
  const ordered = [...rows].sort((a, b) => a.at - b.at)

  for (const row of ordered) {
    row.attributions = []
    row.nonCreditReason = null
    if (!row.eligible) continue

    let matchedFilledGoal = false
    let matchedBeforeStart = false

    // Already decided by the battle ledger server-side (signal-log.ts), so
    // there is nothing to allocate here: the play either counted or it didn't.
    if (row.recelebrate) row.attributions.push({ kind: 'recelebrate', ...row.recelebrate })

    if (birthday && row.at >= birthday.activeFrom && row.at <= birthday.activeTo) {
      const matchingSlots = birthday.slots.filter((candidate) => candidate.keys.includes(row.key))
      const slot = matchingSlots.find((candidate) => candidate.credited < candidate.limit)
      if (slot) {
        slot.credited++
        row.attributions.push({ kind: 'birthday', id: birthday.id, label: birthday.label })
      } else if (matchingSlots.length) matchedFilledGoal = true
    }

    if (district && row.at >= district.activeFrom) {
      let helped = false
      let matchedDistrictGoal = false
      for (const slot of district.trackSlots || []) {
        if (!slot.keys.includes(row.key)) continue
        matchedDistrictGoal = true
        if (slot.remaining > 0) {
          slot.remaining--
          helped = true
        }
      }
      for (const album of district.albums || []) {
        const matchingSlots = album.slots.filter((candidate) => candidate.keys.includes(row.key))
        if (!matchingSlots.length) continue
        matchedDistrictGoal = true
        const ownPasses = Math.min(...album.slots.map((slot) => slot.have), album.cap)
        if (ownPasses + album.bonus >= album.target) continue
        const slot = matchingSlots.find((candidate) => candidate.have < album.cap)
        if (slot) {
          slot.have++
          helped = true
        }
      }
      if (helped) row.attributions.push({ kind: 'district', id: district.id, label: district.label })
      else if (matchedDistrictGoal) matchedFilledGoal = true
    } else if (district) {
      matchedBeforeStart = [...(district.trackSlots || []), ...(district.albums || []).flatMap((album) => album.slots || [])]
        .some((slot) => slot.keys.includes(row.key))
    }

    if (!row.attributions.length) {
      if (matchedFilledGoal) row.nonCreditReason = 'goal_complete'
      else if (matchedBeforeStart) row.nonCreditReason = 'before_mission_started'
      else row.nonCreditReason = 'not_active_goal'
    }
  }

  return rows
}

/**
 * What the active district still needs, read off the counters
 * annotateBotzStreams left behind. Without it an agent whose goals were
 * nearly full saw every jam marked "goal already complete" and read that as
 * BOTZ not counting (AGENT107, 2026-10-24: four SWIM remixes one play short).
 * Album tracks need enough plays for every track to reach the pass target.
 */
export function botzDistrictStillNeeded(district, limit = 6) {
  if (!district) return { items: [], total: 0 }
  const items = []
  for (const slot of district.trackSlots || []) {
    if (slot.remaining > 0) items.push({ label: slot.label || '', plays: slot.remaining })
  }
  for (const album of district.albums || []) {
    const ownPasses = Math.min(...album.slots.map((slot) => slot.have), album.cap)
    if (ownPasses + album.bonus >= album.target) continue
    const perTrack = Math.min(album.cap, album.target - album.bonus)
    for (const slot of album.slots) {
      const plays = perTrack - slot.have
      if (plays > 0) items.push({ label: slot.label || '', plays, album: album.label || null })
    }
  }
  items.sort((a, b) => a.plays - b.plays)
  return { items: items.slice(0, limit), total: items.length }
}

export function botzSourceSetup(agent = {}) {
  const pref = String(agent.stream_source_preference || 'lb').toLowerCase()
  if (pref === 'statsfm') return { source: 'statsfm', setupOk: !!String(agent.statsfm_username || '').trim() }
  if (pref === 'musicat') return { source: 'musicat', setupOk: !!String(agent.musicat_public_id || '').trim() }
  if (pref === 'direct') return { source: 'direct', setupOk: !!String(agent.scrobble_pin || '').trim() }
  if (String(agent.lb_username || '').trim()) return { source: 'listenbrainz', setupOk: true }
  if (String(agent.statsfm_username || '').trim()) return { source: 'statsfm', setupOk: true }
  if (String(agent.musicat_public_id || '').trim()) return { source: 'musicat', setupOk: true }
  return { source: 'listenbrainz', setupOk: false }
}

export function botzTrackingState({ setupOk, checkOk, hasRecent }) {
  if (!setupOk) return 'needs_setup'
  if (!checkOk) return 'check_failed'
  return hasRecent ? 'receiving' : 'connected_no_recent'
}
