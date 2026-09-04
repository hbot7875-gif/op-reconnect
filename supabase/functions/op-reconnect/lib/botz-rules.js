/**
 * Pure recent-stream attribution for BOTZ.
 *
 * The caller builds these counters from the real district/Birthday state.
 * This module only spends those remaining counters chronologically; it does
 * not decide which tracks, targets, aliases, or artists are valid.
 */
export function annotateBotzStreams(rows, context = {}) {
  const district = context.district ? structuredClone(context.district) : null
  const birthday = context.birthday ? structuredClone(context.birthday) : null
  const ordered = [...rows].sort((a, b) => a.at - b.at)

  for (const row of ordered) {
    row.attributions = []
    if (!row.eligible) continue

    if (birthday && row.at >= birthday.activeFrom && row.at <= birthday.activeTo) {
      const slot = birthday.slots.find((candidate) =>
        candidate.credited < candidate.limit && candidate.keys.includes(row.key))
      if (slot) {
        slot.credited++
        row.attributions.push({ kind: 'birthday', id: birthday.id, label: birthday.label })
      }
    }

    if (district && row.at >= district.activeFrom) {
      let helped = false
      for (const slot of district.trackSlots || []) {
        if (slot.remaining > 0 && slot.keys.includes(row.key)) {
          slot.remaining--
          helped = true
        }
      }
      for (const album of district.albums || []) {
        const ownPasses = Math.min(...album.slots.map((slot) => slot.have), album.cap)
        if (ownPasses + album.bonus >= album.target) continue
        const slot = album.slots.find((candidate) =>
          candidate.have < album.cap && candidate.keys.includes(row.key))
        if (slot) {
          slot.have++
          helped = true
        }
      }
      if (helped) row.attributions.push({ kind: 'district', id: district.id, label: district.label })
    }
  }

  return rows
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
