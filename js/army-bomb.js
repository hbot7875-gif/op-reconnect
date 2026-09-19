// The ReConnect ARMY Bomb — one renderer for every place the agent's Bomb
// appears. The City screen (screen-world.js's coreBlock) and the
// RE:CELEBRATE Watch venue both build it from here, so the Bomb an agent
// charges on the City screen is literally the same Bomb they bring into the
// party: same markup, same .army-core/.rc-* styles (reconnect.css), same
// --charge / is-brownout lighting logic.

/** The Bomb's own charge reading: hours on the same 48h visual ceiling the
 *  City screen and the Personal Charge sheet use. */
export function armyBombCharge(agentCharge) {
  const c = agentCharge || { hoursRemaining: 0, isDark: false }
  const hours = Math.max(0, Number(c.hoursRemaining) || 0)
  return {
    hours,
    frac: Math.max(0, Math.min(1, hours / 48)),
    isDark: !!c.isDark,
    neverFed: !c.isDark && hours <= 0,
  }
}

const SPHERE = (defuse) => `
      <div class="rc-sphere">
        <span class="rc-fill"></span>
        ${defuse ? '<span class="rz-liquid" aria-hidden="true"></span>' : ''}
        <span class="rc-shine"></span>
        <span class="rc-shine-2"></span>
        <span class="rc-logo">⟭⟬</span>
      </div>
      <div class="rc-handle"><span class="rc-grip"></span><span class="rc-grip"></span></div>`

/** The full City Bomb contents for an .army-core shell: back-glow, charge
 *  ring and motes (both left out during a Red Zone, same as before), then the
 *  Bomb itself. */
export function armyBombInnerHtml({ chargeFrac = 0, defuse = false } = {}) {
  // Red Zone uses the Bomb itself as the progress display. It starts with
  // one red liquid layer and drains to neutral dark glass as qualified
  // streams arrive. Personal charge remains a separate supporting value;
  // its purple fill, rings and particles are deliberately not rendered in
  // the Red Zone state.
  const CIRC = 2 * Math.PI * 106
  const ringsHtml = `
      <circle class="ring-outer" cx="110" cy="110" r="98"></circle>
      <circle class="ring-inner" cx="110" cy="110" r="90"></circle>
      <circle class="ring-charge-bg" cx="110" cy="110" r="106"></circle>
      <circle class="ring-charge" cx="110" cy="110" r="106" transform="rotate(-90 110 110)"
        stroke-dasharray="${(CIRC * chargeFrac).toFixed(1)} ${CIRC.toFixed(1)}"></circle>
  `
  const normalDecorHtml = defuse ? '' : `
    <svg class="core-rings" viewBox="0 0 220 220" aria-hidden="true">
      ${ringsHtml}
    </svg>
    <div class="core-particles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
  `
  return `
    <div class="core-glow"></div>
    ${normalDecorHtml}
      <div class="rc-bomb">${SPHERE(defuse)}
    </div>
  `
}

/** Just the Bomb (sphere + handle), for many small copies at once — the same
 *  design without the per-Bomb glow, ring and motes. */
export function armyBombBodyHtml() {
  return `<div class="rc-bomb">${SPHERE(false)}</div>`
}
