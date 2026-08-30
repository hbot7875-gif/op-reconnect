// Pure Red Zone lifecycle helpers. Kept free of Deno/Supabase imports so the
// exact boundary and stop-at-target rules can be exercised by Node tests.

/** Convert millisecond timestamps into the inclusive/exclusive unix-second
 * bounds used by rc_scrobbles. A listen is valid when:
 *   activeFrom <= listenedAt < min(now, activeUntil)
 * rc_scrobbles stores whole seconds, hence ceil() on both boundaries. */
export function redZoneUnixBounds(activeFrom, activeUntil, nowMs = Date.now()) {
  const fromMs = new Date(activeFrom).getTime()
  const untilMs = new Date(activeUntil).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) {
    throw new Error('Invalid Red Zone time window')
  }
  const upperMs = Math.min(nowMs, untilMs)
  return {
    fromInclusive: Math.ceil(fromMs / 1000),
    untilExclusive: Math.ceil(upperMs / 1000),
    expired: nowMs >= untilMs,
  }
}

/** Count an already chronological list of eligible stream rows.
 *
 * An agent's first `minimumStreams - 1` plays remain visible as personal
 * progress but do not move the shared bar. Their qualifying play releases
 * the whole minimum into shared progress, matching the existing Red Zone
 * promise. Processing stops on the exact row that reaches the target, so
 * later plays never leak into this event.
 *
 * @param {any[]} rows
 * @param {number} target
 * @param {number} minimumStreams
 * @param {(row: any) => boolean} [isEligible]
 */
export function countRedZoneRows(rows, target, minimumStreams, isEligible = () => true) {
  const safeTarget = Math.max(1, Number(target) || 1)
  const safeMinimum = Math.max(1, Number(minimumStreams) || 1)
  const perAgent = new Map()
  let rawProgress = 0
  let reachedAt = null

  for (const row of rows || []) {
    if (!row?.agent_no || !isEligible(row)) continue
    const agent = String(row.agent_no)
    const previous = perAgent.get(agent) || 0
    const next = previous + 1
    perAgent.set(agent, next)

    if (next === safeMinimum) rawProgress += safeMinimum
    else if (next > safeMinimum) rawProgress += 1

    if (rawProgress >= safeTarget) {
      reachedAt = Number(row.listened_at) || null
      break
    }
  }

  let qualifiedAgents = 0
  for (const streams of perAgent.values()) {
    if (streams >= safeMinimum) qualifiedAgents++
  }
  return {
    progress: Math.min(safeTarget, rawProgress),
    rawProgress,
    qualifiedAgents,
    perAgent,
    reachedAt,
  }
}

/** A Defender is anyone who has landed at least one valid Red Zone stream
 *  this event — separate from, and always a superset of, qualifying for the
 *  XP pool. Both read the same rc_defuse_contrib.streams value; this just
 *  names the two thresholds once so the UI and the backend gate can never
 *  quietly disagree on what "Defender" vs "Qualified" means. */
export function isDefender(streams) {
  return (Number(streams) || 0) >= 1
}
export function isQualifiedDefender(streams, minimumStreams) {
  return (Number(streams) || 0) >= Math.max(1, Number(minimumStreams) || 1)
}

/** Named progress bands for the Bomb's visual state — one place both the
 *  frontend (which class/copy to show) and its own tests agree on where
 *  each threshold actually sits, instead of magic percentages scattered
 *  across CSS/JS. finalPush intentionally overlaps the top of "restoring"
 *  (90-99%) since it's a copy/urgency change, not a different color state. */
export function redZoneBand(progress, target) {
  const frac = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0
  if (frac >= 1) return 'restored'
  if (frac >= 0.9) return 'final-push'
  if (frac >= 0.25) return 'restoring'
  return 'compromised'
}

/** Linear interpolation from crimson (0% — corrupted) to the Bomb's normal
 *  purple (100% — stable), driving the one `--bomb` CSS custom property
 *  every layer of the existing Bomb (glow/rings/liquid fill) already reads
 *  its color from. Real Red Zone hex values (css/reconnect.css's
 *  --crimson/--purple) are passed in rather than hardcoded here, so this
 *  stays a pure function with no styling opinion of its own — the visual
 *  design lives in one place (CSS), this just does the arithmetic. */
export function interpolateBombColor(progress, target, fromHex, toHex) {
  const frac = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0
  const from = hexToRgb(fromHex)
  const to = hexToRgb(toHex)
  const mix = (a, b) => Math.round(a + (b - a) * frac)
  return `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`
}
function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0')
  const n = parseInt(full, 16) || 0
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Blackout must set charged_until to the exact current moment, never a
 *  backdated or future value — see agent-charge.ts's blackout_started_at,
 *  which is anchored to whatever charged_until value it first finds in the
 *  past. Anything other than "now" here would either grant free hours
 *  (future) or make the 7/14-day inactivity clock look partially elapsed
 *  the instant Blackout lands (past). This function exists purely so that
 *  invariant has one named, tested guard instead of being trusted silently
 *  at each call site. */
export function blackoutChargeValue(nowMs = Date.now()) {
  return new Date(nowMs).toISOString()
}

/** Only agents who actually had charge to lose get reset — an agent already
 *  dark (charged_until in the past) or who has never fed at all
 *  (charged_until null) must be left completely alone, so Blackout can never
 *  rewind an existing blackout clock forward to "now" and accidentally
 *  shorten it. */
export function blackoutShouldReset(chargedUntilIso, nowMs = Date.now()) {
  if (!chargedUntilIso) return false
  const chargedUntilMs = new Date(chargedUntilIso).getTime()
  return Number.isFinite(chargedUntilMs) && chargedUntilMs > nowMs
}

/** Strict launch-input validation — reject, never silently clamp. A typo'd
 *  admin target of "0" or a negative reward should fail loudly, not launch
 *  a Red Zone nobody can complete or that pays out nothing. */
/* ── What counts for this event ─────────────────────────────────────────
   A Red Zone can name one track or one album to stream. The event carries
   a FROZEN copy of that goal's match keys (see the migration's own note):
   renaming, re-aliasing or deleting the goal mid-event must never change
   which plays count. No target at all — the original behavior, and still
   the default — means every eligible BTS play counts. */

/** The frozen key list as a fast lookup, or null for "everything counts".
 *  Null and an empty array deliberately mean the same thing: an event that
 *  counted nothing would be unwinnable, which is never what an admin meant. */
export function redZoneTargetKeySet(targetKeys) {
  if (!Array.isArray(targetKeys)) return null
  const keys = targetKeys.map((k) => String(k || '').trim()).filter(Boolean)
  return keys.length ? new Set(keys) : null
}

/** Does this play count toward the event's named target? Always true when
 *  the event has no target — the artist/cap/source checks in refreshDefuse
 *  still apply either way, this only ever narrows further. */
export function redZoneTrackCounts(keySet, trackKey) {
  if (!keySet) return true
  return keySet.has(String(trackKey || ''))
}

/** A target is all-or-nothing (the same check the DB constraint enforces):
 *  a kind with no keys silently counts nothing, and keys with no label
 *  leave the player UI with no name to show. Returns the normalized triple
 *  to store, or an error to refuse the launch with. */
export function validateRedZoneTarget(target) {
  if (!target || (!target.kind && !target.label && !target.keys)) {
    return { valid: true, value: { kind: null, label: null, keys: null } }
  }
  const kind = String(target.kind || '')
  const label = String(target.label || '').trim()
  const keys = redZoneTargetKeySet(target.keys)
  if (kind !== 'track' && kind !== 'album') return { valid: false, error: 'target must be a track or an album' }
  if (!label) return { valid: false, error: 'target needs a display name' }
  if (label.length > 120) return { valid: false, error: 'target name must be 120 characters or fewer' }
  if (!keys) return { valid: false, error: 'target has no matchable track names' }
  return { valid: true, value: { kind, label, keys: [...keys] } }
}

export function validateDefuseLaunch(params) {
  const errors = []
  const target = Number(params?.target)
  const hours = Number(params?.hours)
  const rewardXp = Number(params?.rewardXp)
  const title = String(params?.title || '').trim()
  const message = String(params?.message || '').trim()

  if (!Number.isFinite(target) || !Number.isInteger(target) || target < 1 || target > 1_000_000) {
    errors.push('target must be a whole number between 1 and 1,000,000')
  }
  if (!Number.isFinite(hours) || hours < 1 || hours > 72) {
    errors.push('hours must be between 1 and 72')
  }
  if (!Number.isFinite(rewardXp) || !Number.isInteger(rewardXp) || rewardXp < 1 || rewardXp > 1_000_000) {
    errors.push('rewardXp must be a whole number between 1 and 1,000,000')
  }
  if (title.length > 120) errors.push('title must be 120 characters or fewer')
  if (message.length > 400) errors.push('message must be 400 characters or fewer')

  return { valid: errors.length === 0, errors }
}

