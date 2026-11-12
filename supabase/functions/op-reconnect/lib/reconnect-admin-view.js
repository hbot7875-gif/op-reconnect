// Pure rules behind the admin ReConnect quest view (admin-readonly.ts).
//
// Everything here READS a mission's stored state: status, phase,
// cipher_index / cipher_attempts_left, cards_unlocked_at, completed_at, and the
// participants' rows. It never decides that a quest should move on — that is
// refreshMission's job (reconnect-missions.ts), and it alone writes.
// No database, no clock of its own: `now` is passed in.

import { sharedTracksConfig, memberSharedPlays } from './reconnect-shared-tracks.js'
import { hasWarStage } from './reconnect-war-stage.js'

/** Same 24h rule as reconnect-missions.ts's inviteExpired. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000
export function inviteLapsed(p, now) {
  return !!p && p.status === 'invited' && !!p.joined_at && now - new Date(p.joined_at).getTime() > INVITE_TTL_MS
}

/** The status the dashboard shows. 'open' missions past expires_at are
 *  reported as expired (refreshMission flips them the next time anyone opens
 *  the quest; the admin read never writes). */
export function questDisplayStatus(m, now) {
  if (m.status === 'open' && m.expires_at && new Date(m.expires_at).getTime() <= now) return 'expired'
  if (m.status === 'complete') return 'completed'
  if (m.status === 'open') return 'open'
  return m.status // 'expired' | 'cancelled'
}

/** Which kind of contribution a quest counts, from its frozen config. */
export function questMode(variant, config) {
  if (variant === 'invite') return 'invite'
  if (config?.checklist?.tracks?.length) return 'checklist'
  if (sharedTracksConfig(config)) return 'sharedTracks'
  if (config?.sharedTrack?.keys?.length && Number(config.sharedTrack.target) > 0) return 'sharedTrack'
  return 'ownGoals'
}

/** The quest's stages and where it stands, from stored state only.
 *  state: 'done' | 'current' | 'todo' | 'stopped'. */
export function questStages(m, { variant, config, joinedCount, now }) {
  const status = questDisplayStatus(m, now)
  const required = Number(m.required_agents) || 0
  const phase = m.phase || 'streaming'
  const ciphers = Array.isArray(config?.ciphers) ? config.ciphers.length : 0
  const war = hasWarStage(config)
  const stages = [{ key: 'team', label: variant === 'invite' ? 'Invites accepted' : 'Team formed', detail: `${joinedCount}/${required} joined` }]
  if (variant !== 'invite') {
    const mode = questMode(variant, config)
    const target = mode === 'sharedTrack' ? `${config.sharedTrack.target} plays of ${config.sharedTrack.label || 'the track'}`
      : mode === 'checklist' ? `every teammate plays all ${config.checklist.tracks.length} tracks`
      : mode === 'sharedTracks' ? `${sharedTracksConfig(config).tracks.length} tracks to ${sharedTracksConfig(config).target} plays each`
      : 'every teammate streams their own goal tracks'
    stages.push({ key: 'streaming', label: 'Streaming', detail: target })
  }
  if (ciphers) stages.push({ key: 'cipher', label: 'Cipher', detail: phase === 'cipher'
    ? `${Math.min(ciphers, (Number(m.cipher_index) || 0) + 1)} of ${ciphers} · ${m.cipher_attempts_left ?? '?'} guesses left` : `${ciphers} to solve` })
  if (war) stages.push({ key: 'cards', label: 'War of Cards', detail: 'every teammate finishes one game' })
  stages.push({ key: 'complete', label: 'Completed', detail: m.completed_at || null })

  const order = stages.map((s) => s.key)
  let reached
  if (status === 'completed') reached = order.length // everything done
  else if (phase === 'cipher') reached = order.indexOf('cipher')
  else if (phase === 'cards') reached = order.indexOf('cards')
  else reached = joinedCount >= required ? order.indexOf(variant === 'invite' ? 'complete' : 'streaming') : 0
  if (reached < 0) reached = 0
  const stopped = status === 'expired' || status === 'cancelled'
  return stages.map((s, i) => ({
    ...s,
    state: i < reached ? 'done' : i === reached ? (stopped ? 'stopped' : 'current') : 'todo',
  }))
}

/** End of a participant's counting window for this quest — the same window
 *  refreshMission uses (from joined_at), closed where the quest closed so a
 *  finished quest doesn't keep "earning" plays. null = still running (now). */
export function contributionWindowEnd(m, p, now) {
  if (p.status === 'left') return p.left_at || null
  const status = questDisplayStatus(m, now)
  if (status === 'completed') return m.completed_at || null
  if (status === 'expired') return m.expires_at || null
  return null
}

/** A member's contribution from their play totals (normalized key -> plays),
 *  in the quest's own unit. Mirrors refreshMission's per-mode count. */
export function memberContribution(mode, config, totals, ownKeys = []) {
  if (mode === 'invite') return null
  const sum = (keys) => (keys || []).reduce((n, k) => n + (totals.get(k) || 0), 0)
  if (mode === 'checklist') {
    const perTrack = config.checklist.tracks.map((t) => (t.keys || []).some((k) => (totals.get(k) || 0) > 0))
    return { value: perTrack.filter(Boolean).length, of: perTrack.length, unit: 'tracks', perTrack }
  }
  if (mode === 'sharedTracks') {
    const st = sharedTracksConfig(config)
    return { value: memberSharedPlays(st.tracks, totals, st.target), of: null, unit: 'plays' }
  }
  if (mode === 'sharedTrack') return { value: sum(config.sharedTrack.keys), of: null, unit: 'plays' }
  return { value: sum(ownKeys), of: null, unit: 'plays' }
}
