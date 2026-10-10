// Era Card symbols: one custom mark per era, drawn as a single family.
// Same 24-unit grid and round 1.6 stroke as the Lucide nav set, plus one
// soft duotone shape per symbol (.d, a low-opacity fill of currentColor) so
// they read as collectible marks rather than plain UI icons. Colour is never
// per era: the card's state sets currentColor (neutral, gold when ready,
// purple when activated, muted when used).

export const ERA_SYMBOLS = {
  // notebook with a bound spine: the school years
  school: '<rect class="d" x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18"/><path d="M12.5 8h3.5"/><path d="M12.5 11.5h3.5"/>',
  // pointed crescent crossed by a spare thorn branch
  darkwild: '<path class="d" d="M15.8 3.5C10.7 4.2 7.4 9 8.4 13.9c.8 4 4.4 6.8 8.5 6.6-4.1-1.7-5.8-6.5-3.8-10.4.7-1.5 1.6-2.7 2.7-3.7Z"/><path d="M5.2 19.2 18.8 7.6M8.1 16.7l-3-.2M11.5 13.8l-.2-3M15 10.8l2.8.2"/>',
  // five-petal flower
  hyyh: '<g class="d"><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(72 12 12)"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(144 12 12)"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(216 12 12)"/><path d="M12 10.2C9.6 8.6 9.6 5.1 12 3.2c2.4 1.9 2.4 5.4 0 7Z" transform="rotate(288 12 12)"/></g><circle cx="12" cy="12" r="2"/>',
  // feather
  wings: '<path class="d" d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  // heart
  ly: '<path class="d" d="M12 20s-7.5-4.6-7.5-10.4A4.1 4.1 0 0 1 12 7.2a4.1 4.1 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>',
  // the self reflected in an oval standing mirror
  mots: '<ellipse cx="12" cy="10.5" rx="7" ry="7.5"/><path d="M12 18v3M9 21h6"/><g class="d"><circle cx="12" cy="8.5" r="2.2"/><path d="M7.8 15.1c.7-2.3 2.2-3.5 4.2-3.5s3.5 1.2 4.2 3.5c-1.2 1.8-2.6 2.9-4.2 2.9s-3-1.1-4.2-2.9Z"/></g>',
  // stacked archive
  anthology: '<rect class="d" x="4" y="10" width="16" height="10" rx="2"/><path d="M6.5 6.5h11"/><path d="M9 3.5h6"/><path d="M10 14h4"/>',
  // an abstract ribbon carried in two flowing, song-like phrases
  arirang: '<path class="d" d="M3.5 15.8c3.2-5.8 6.2-7.1 9.2-4.8 2.8 2.1 5 1.2 7.8-3.2-1.7 6.1-4.9 8.6-8.2 6.2-2.7-2-5.2-.8-8.8 2.8Z"/><path d="M4 16c3.2-5.5 6.1-6.8 9-4.6 2.8 2.1 5 1.1 7-2.1M5.5 19c2.7-2.1 4.8-2.4 7.1-1 2 1.2 3.8.9 5.9-.8"/>',
  // faceted gem
  golden: '<path class="d" d="M7 4h10l4 5.5L12 20 3 9.5Z"/><path d="M3 9.5h18"/><path d="M12 20 8.5 9.5 10 4M12 20l3.5-10.5L14 4"/>',
}

// Unknown or future eras get a neutral disc rather than nothing.
const FALLBACK = '<circle class="d" cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>'

export function eraSymbol(id) {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${ERA_SYMBOLS[id] || FALLBACK}</svg>`
}
