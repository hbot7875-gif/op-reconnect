// Era Card symbols: one custom mark per era, drawn as a single family.
// Same 24-unit grid and round 1.6 stroke as the Lucide nav set, plus one
// soft duotone shape per symbol (.d, a low-opacity fill of currentColor) so
// they read as collectible marks rather than plain UI icons. Colour is never
// per era: the card's state sets currentColor (neutral, gold when ready,
// purple when activated, muted when used).

export const ERA_SYMBOLS = {
  // notebook with a bound spine: the school years
  school: '<rect class="d" x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18"/><path d="M12.5 8h3.5"/><path d="M12.5 11.5h3.5"/>',
  // crescent with a small dark star
  darkwild: '<path class="d" d="M14.5 3.6a8.5 8.5 0 1 0 5.9 12.9A7 7 0 0 1 14.5 3.6Z"/><path d="M18 5.5v3M16.5 7h3"/>',
  // five-petal flower
  hyyh: '<g class="d"><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(72 12 12)"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(144 12 12)"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(216 12 12)"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(288 12 12)"/></g><circle cx="12" cy="12" r="2"/>',
  // feather
  wings: '<path class="d" d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  // heart
  ly: '<path class="d" d="M12 20s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>',
  // compass
  mots: '<circle cx="12" cy="12" r="9"/><path class="d" d="m15.2 8.8-2.1 4.3-4.3 2.1 2.1-4.3Z"/><path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21"/>',
  // stacked archive
  anthology: '<rect class="d" x="4" y="10" width="16" height="10" rx="2"/><path d="M6.5 6.5h11"/><path d="M9 3.5h6"/><path d="M10 14h4"/>',
  // flowing ribbon
  arirang: '<path class="d" d="M3 8.5c3-3.4 6 3.4 9 0s6 3.4 9 0v7c-3 3.4-6-3.4-9 0s-6-3.4-9 0Z"/>',
  // faceted gem
  golden: '<path class="d" d="M7 4h10l4 5.5L12 20 3 9.5Z"/><path d="M3 9.5h18"/><path d="M12 20 8.5 9.5 10 4M12 20l3.5-10.5L14 4"/>',
}

// Unknown or future eras get a neutral disc rather than nothing.
const FALLBACK = '<circle class="d" cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>'

export function eraSymbol(id) {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${ERA_SYMBOLS[id] || FALLBACK}</svg>`
}
