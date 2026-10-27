// A compact global header for one screen — MAMA's Voting hub first.
//
// #hud is global and sticky and repainted for every screen, so nothing here
// may change it anywhere else: the screen calls mountCompactHud() when it
// opens, main.js calls teardownCompactHud() when the player leaves, and every
// rule that compacts the header is written under the body class.
//
// Why not just shrink it (ui-hud.js's own collapse is desktop-only for this
// reason): a sticky header that changes height moves everything below it,
// which moves scrollY back across the threshold and flickers on phones.
// Here the header compacts, and in the same frame a bottom margin takes the
// height it gave up — so the page below never moves, there is nothing for
// the scroll position to react to, and nothing jumps. Thresholds keep a
// hysteresis band too (compact past 120px, full again under 24px).
//
// Compact keeps every control: the dossier, codename eye, streak, sync and
// signals stay tappable, and the ReConnect / leave status stays a button,
// just one slim line ("collapsed" never means fewer things you can do).

const COMPACT_AT = 120
const FULL_AT = 24
const BODY_CLASS = 'hud-compact-screen'

let handler = null
let compact = false
let queued = false

function hud() { return document.getElementById('hud') }

/** Compacts (or restores) the header, keeping its layout height constant. */
function setCompact(on) {
  const el = hud()
  if (!el) return
  if (on) {
    const full = el.offsetHeight
    el.classList.add('is-compact')
    // Same frame: the margin takes exactly the height the header gave up.
    el.style.marginBottom = `${Math.max(0, full - el.offsetHeight)}px`
  } else {
    el.classList.remove('is-compact')
    el.style.marginBottom = ''
  }
  compact = on
}

function apply() {
  queued = false
  const y = window.scrollY || document.documentElement.scrollTop || 0
  if (!compact && y > COMPACT_AT) setCompact(true)
  else if (compact && y < FULL_AT) setCompact(false)
}

export function mountCompactHud() {
  if (handler) return
  document.body.classList.add(BODY_CLASS)
  handler = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(apply)
  }
  window.addEventListener('scroll', handler, { passive: true })
  apply()
}

/** The header was repainted (90s poll): its rows may have changed, so take
 *  the compact measurement again from the full layout. */
export function refreshCompactHud() {
  if (!handler || !compact) return
  const el = hud()
  if (!el) return
  el.classList.remove('is-compact')
  el.style.marginBottom = ''
  compact = false
  apply()
}

export function teardownCompactHud() {
  if (!handler) return
  window.removeEventListener('scroll', handler)
  handler = null
  queued = false
  document.body.classList.remove(BODY_CLASS)
  setCompact(false)
}
