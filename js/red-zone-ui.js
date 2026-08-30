// Red Zone — pure visual-state helpers for the City ARMY Bomb.
//
// Frontend-only mirror of the band/threshold contract the backend's own
// supabase/functions/op-reconnect/lib/red-zone.js keeps (redZoneBand,
// interpolateBombColor) — DB-free by design so it's plain-Node testable,
// same pattern as district-progress.js. Kept in its own small file rather
// than folded into screen-world.js so the exact thresholds/color math have
// one place to change and one place to test, instead of living inline in a
// 600+ line screen file.

/** Same four bands the backend computes from real progress — keep these
 *  thresholds identical to red-zone.js's redZoneBand or the Bomb's visual
 *  state and its own details sheet copy can disagree. */
export function redZoneBand(progress, target) {
  const frac = target > 0 ? Math.max(0, Math.min(1, progress / target)) : 0
  if (frac >= 1) return 'restored'
  if (frac >= 0.9) return 'final-push'
  if (frac >= 0.25) return 'restoring'
  return 'compromised'
}

/** Linear crimson→purple interpolation driving the Bomb's one shared
 *  --bomb custom property (see .army-core in reconnect.css) — every layer
 *  of the existing Bomb visual already reads its color from that single
 *  variable, so this is the whole "red becomes purple" mechanism. */
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

/** Whole-percent progress, clamped — the one number every Red Zone surface
 *  (Bomb readout, details sheet, result sheet) shows. */
export function redZonePercent(progress, target) {
  if (!(target > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((progress / target) * 100)))
}

/** "18 ✓" vs "3 / 7" under a plain "Your streams" label — the one line that
 *  tells a player the difference between "I helped" and "I'm locked in for
 *  the reward", which the brief is explicit these must never be conflated.
 *  The hint says what to do about it in words, not in threshold jargon. */
export function personalSignalCopy(yourStreams, minimumStreams) {
  const qualified = yourStreams >= minimumStreams
  const missing = Math.max(0, minimumStreams - yourStreams)
  return qualified
    ? { qualified: true, value: `${yourStreams} ✓`, full: `${yourStreams} / ${minimumStreams} ✓`,
        hint: "You've earned a share of the reward." }
    : { qualified: false, value: `${yourStreams} / ${minimumStreams}`, full: `${yourStreams} / ${minimumStreams}`,
        hint: `Stream ${missing} more to earn XP.` }
}

/* ── Player-facing wording ──────────────────────────────────────────────
   Fantasy line first, instruction immediately after. A new player should
   never have to decode "signal breach", "compromised" or "stabilized" to
   work out that the city is under attack and that streaming is the answer.
   Lore words (Signal, Red Zone, Defenders) stay as flavor around the edges
   — stream / track or album / goal / time left / your streams are what the
   player reads first. Kept here, next to redZoneBand, so the City screen,
   the details sheet, the result sheets and the sync toast can never drift
   into four slightly different vocabularies for one event. */

/** The headline. Every live band says the same thing — CITY UNDER ATTACK —
 *  because a player's first line has to explain the event, and most people
 *  arrive partway through one. A band-specific headline ("KEEP DEFUSING")
 *  reads fine to someone who watched it start and means nothing to someone
 *  who didn't. Escalation moves to the instruction line below it instead,
 *  where it can be a sentence rather than a status word. Only the resolved
 *  state gets its own headline: the attack is over, so saying it's underway
 *  would be false. */
export function redZoneHeadline(band) {
  if (band === 'restored') return { icon: '💜', title: 'ARMY BOMB SAVED!' }
  return { icon: '🚨', title: 'CITY UNDER ATTACK' }
}

/** What actually counts, named from the event itself rather than hard-coded
 *  in four places. An event can name a single track or a whole album; with
 *  neither set, every eligible BTS play counts and the copy says exactly
 *  that instead of inventing a song the backend isn't filtering on.
 *  See refreshDefuse() in bomb.ts for the eligibility this describes. */
export function redZoneTarget(defuse) {
  const album = defuse?.targetAlbum || defuse?.target_album
  if (album) return { name: `the ${album} album`, short: album, unit: 'album streams' }
  const track = defuse?.targetTrack || defuse?.target_track
  if (track) return { name: track, short: track, unit: 'streams' }
  return { name: 'any BTS song', short: 'any BTS song', unit: 'streams' }
}

/** "Protect the ARMY Bomb by streaming ARIRANG" + "Goal: 1,000 streams" —
 *  the instruction half of every headline, generated from the same target. */
export function redZoneGoalCopy(defuse, band) {
  const target = redZoneTarget(defuse)
  const total = Number(defuse?.target || 0)
  // The band's urgency lives here now that the headline is constant, but
  // "protect the ARMY Bomb" stays in every live band: it's the sentence
  // that says what the player is actually for, and dropping it at 25% left
  // a mid-event arrival with a status word and a song title.
  const instruction = band === 'final-push'
    ? `⚡ Almost safe — protect the ARMY Bomb by streaming ${target.name}`
    : band === 'restored'
      ? 'The City is safe again.'
      : `Protect the ARMY Bomb by streaming ${target.name}`
  return {
    ...target,
    instruction,
    goal: `Goal: ${total.toLocaleString()} ${target.unit}`,
    // "750 / 1,000 streams" — the same unit as the goal, so an album event
    // never reads as if single tracks were being counted.
    progressLine: `${Number(defuse?.progress || 0).toLocaleString()} / ${total.toLocaleString()} ${target.unit}`,
  }
}

/** "75% DEFUSED" — one verb for the whole mechanic. Defusing is what the
 *  player's streams are doing; "stabilized" made them work that out. */
export function defusedLine(progress, target) {
  return `${redZonePercent(progress, target)}% DEFUSED`
}

/** How visible one fragment of the red containment field still is, given
 *  real progress `frac` (0..1) and the fraction at which THIS fragment is
 *  fully broken apart. 1 at frac=0, fading linearly to 0 exactly at
 *  clearAt, staying 0 past it. Several fragments with different clearAt
 *  values is what turns one uniform percentage into "the attack structure
 *  breaking apart piece by piece" instead of one shape uniformly fading. */
export function corruptionOpacity(frac, clearAt) {
  return Math.max(0, Math.min(1, (clearAt - frac) / clearAt))
}

/** The very last trace behaves differently on purpose: it stays fully lit
 *  right up until close to the end, then drops out fast over the final
 *  stretch before clearAt — "one or two weak traces remain" at 90% should
 *  read as a real ember still glowing, not something the linear
 *  corruptionOpacity() curve has already faded to nothing by then. */
export function sparkOpacity(frac, clearAt, holdWidth = 0.12) {
  const holdUntil = clearAt - holdWidth
  if (frac <= holdUntil) return 1
  return Math.max(0, Math.min(1, (clearAt - frac) / holdWidth))
}

/** A point on a circle centered at (cx, cy), radius r, at `deg` degrees
 *  (0deg = straight up, clockwise) — shared trig behind arcPath/
 *  tendrilPath and reused directly for placing the small spark fragments. */
export function pointOnCircle(cx, cy, r, deg) {
  const rad = (deg - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

/** One SVG arc `d` path around a circle centered at (cx, cy) with radius r,
 *  from startDeg to endDeg (0deg = straight up, clockwise) — the shape the
 *  red containment field's broken ring fragments are drawn from. Plain
 *  trig, no DOM, so the exact fragment shapes are unit-testable like
 *  everything else in this file. */
export function arcPath(cx, cy, r, startDeg, endDeg) {
  const p1 = pointOnCircle(cx, cy, r, startDeg)
  const p2 = pointOnCircle(cx, cy, r, endDeg)
  const large = ((endDeg - startDeg) % 360 + 360) % 360 > 180 ? 1 : 0
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
}

/** One SVG path for a short "tendril" reaching from rOuter in toward
 *  rInner at a given angle, bent partway through by bendDeg for an organic
 *  curl instead of a straight spoke — the brief's own allowance for "a
 *  tiny amount of red interference crossing the glass at very low
 *  progress", not another containment-ring fragment. */
export function tendrilPath(cx, cy, rOuter, rInner, deg, bendDeg) {
  const outer = pointOnCircle(cx, cy, rOuter, deg)
  const mid = pointOnCircle(cx, cy, (rOuter + rInner) / 2, deg + bendDeg)
  const inner = pointOnCircle(cx, cy, rInner, deg)
  return `M ${outer.x.toFixed(2)} ${outer.y.toFixed(2)} Q ${mid.x.toFixed(2)} ${mid.y.toFixed(2)} ${inner.x.toFixed(2)} ${inner.y.toFixed(2)}`
}

/** mm:ss / hh:mm:ss countdown text — same rendering rule countdown.js's
 *  tickCountdowns already uses elsewhere, kept local so this module has no
 *  DOM dependency at all (fully unit-testable). */
export function countdownText(msLeft) {
  if (msLeft <= 0) return '00:00:00'
  const totalSeconds = Math.floor(msLeft / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
