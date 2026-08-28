// Pure district-progress helpers shared by the City, ward and district
// screens. Keeping this DOM-free makes the displayed restoration percentage
// testable against the same state object the real UI receives.

function finiteNonNegative(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** True only when every mission that can block restoration is complete. */
export function districtMissionsComplete(d) {
  if (!d) return false
  const tracksDone = (d.trackGoals || []).every((g) => !!g.done)
  const albumsDone = (d.albums || []).every((a) => !!a.done)
  const reconnectDone = !d.reconnect || !!d.reconnect.done
  return tracksDone && albumsDone && reconnectDone
}

/** Overall restoration fraction (0..1) driving the district's lights.
 *
 * Track and album goals keep their existing target-weighted contribution.
 * ReConnect adds its real shared-stream progress when one exists; puzzle,
 * invite and older payloads contribute a single 0/1 completion unit. The
 * final 1% is reserved until EVERY mission is actually complete, preventing
 * both rounding and an unfinished ReConnect phase from looking restored. */
export function districtFraction(d) {
  if (!d) return 0
  let got = 0
  let need = 0

  for (const g of d.trackGoals || []) {
    const target = finiteNonNegative(g.target)
    got += Math.min(finiteNonNegative(g.progress), target)
    need += target
  }
  for (const a of d.albums || []) {
    const target = finiteNonNegative(a.target)
    got += Math.min(finiteNonNegative(a.passesDone), target)
    need += target
  }

  if (d.reconnect) {
    const rp = d.reconnect.restorationProgress
    const target = Math.max(1, finiteNonNegative(rp?.target, 1))
    const progress = d.reconnect.done
      ? target
      : Math.min(finiteNonNegative(rp?.progress), target)
    got += progress
    need += target
  }

  if (need === 0) return 0
  const fraction = Math.max(0, Math.min(1, got / need))
  return districtMissionsComplete(d) ? 1 : Math.min(0.99, fraction)
}

/** Player-facing whole percentage. An unfinished district never says 100%. */
export function districtPercent(d) {
  return Math.round(districtFraction(d) * 100)
}

/** Number of mission rows still blocking restoration, including ReConnect. */
export function districtGoalsLeft(d) {
  if (!d) return 0
  let left = 0
  for (const g of d.trackGoals || []) if (!g.done) left++
  for (const a of d.albums || []) if (!a.done) left++
  if (d.reconnect && !d.reconnect.done) left++
  return left
}
