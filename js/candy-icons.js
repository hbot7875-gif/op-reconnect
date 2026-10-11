// Candy Star icons, in three deliberate layers:
//   Lucide (https://lucide.dev, ISC)   generic utility actions -- search, add,
//                                      remove, check, chevrons, external, etc.
//   Solar Line Duotone (480 Design,    Candy's own features -- albums (vinyl),
//   CC BY 4.0, credited on Credits)    playlists, the district guide map, songs,
//                                      and the star motif on the Quick card.
//   the custom alpaca mark             Candy's identity.
// Everything draws in currentColor so state sets the colour.

import { NAV_ICON_PATHS } from './nav-icons.js'

// Solar Line Duotone bodies, verbatim from @iconify-json/solar 1.2.13
// (each carries its own currentColor stroke and the .5-opacity second tone).
export const SOLAR = {
  disc: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M21.9506 13.0004C21.4489 18.0538 17.1853 22.0004 12 22.0004C6.47715 22.0004 2 17.5233 2 12.0004C2 6.81508 5.94668 2.55153 11 2.0498" opacity=".5"/><path d="M15 2.45703C18.1101 3.43385 20.5654 5.88916 21.5422 8.99923"/><path d="M15 11.9992V2.45703"/></g>', // solar:vinyl-line-duotone
  library: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M15 6L3 6" opacity=".5"/><path d="M13 10L3 10" opacity=".5"/><path d="M9 14H3" opacity=".5"/><path d="M8 18H3" opacity=".5"/><path d="M17 16.5V12.5V8"/><circle cx="14.5" cy="16.5" r="2.5"/><path d="M21 12C18.7909 12 17 10.2091 17 8"/></g>', // solar:playlist-minimalistic-2-line-duotone
  map: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M3 8.70938C3 7.23584 3 6.49907 3.39264 6.06935C3.53204 5.91678 3.70147 5.79466 3.89029 5.71066C4.42213 5.47406 5.12109 5.70705 6.51901 6.17302C7.58626 6.52877 8.11989 6.70665 8.6591 6.68823C8.85714 6.68147 9.05401 6.65511 9.24685 6.60952C9.77191 6.48541 10.2399 6.1734 11.176 5.54937L12.5583 4.62778C13.7574 3.82843 14.3569 3.42876 15.0451 3.3366C15.7333 3.24444 16.4168 3.47229 17.7839 3.92799L18.9487 4.31624C19.9387 4.64625 20.4337 4.81126 20.7169 5.20409C21 5.59692 21 6.11871 21 7.16229V15.2907C21 16.7642 21 17.501 20.6074 17.9307C20.468 18.0833 20.2985 18.2054 20.1097 18.2894C19.5779 18.526 18.8789 18.293 17.481 17.827C16.4137 17.4713 15.8801 17.2934 15.3409 17.3118C15.1429 17.3186 14.946 17.3449 14.7532 17.3905C14.2281 17.5146 13.7601 17.8266 12.824 18.4507L11.4417 19.3722C10.2426 20.1716 9.64311 20.5713 8.95493 20.6634C8.26674 20.7556 7.58319 20.5277 6.21609 20.072L5.05132 19.6838C4.06129 19.3538 3.56627 19.1888 3.28314 18.7959C3 18.4031 3 17.8813 3 16.8377V8.70938Z"/><path d="M9 6.65723V20.6569" opacity=".5"/><path d="M15 3.34277V17.3425" opacity=".5"/></g>', // solar:map-line-duotone
  music: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M13 18V10V2" opacity=".5"/><circle cx="9" cy="18" r="4"/><path d="M19 8C15.6863 8 13 5.31371 13 2"/></g>', // solar:music-note-2-line-duotone
  stars: '<g fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.5" d="M10.0802 7.89712C11.1568 5.96571 11.6952 5 12.5 5C13.3048 5 13.8432 5.96571 14.9198 7.89712L15.1984 8.3968C15.5043 8.94564 15.6573 9.22007 15.8958 9.40114C16.1343 9.5822 16.4314 9.64942 17.0255 9.78384L17.5664 9.90622C19.6571 10.3793 20.7025 10.6158 20.9512 11.4156C21.1999 12.2153 20.4872 13.0487 19.0619 14.7154L18.6932 15.1466C18.2881 15.6203 18.0856 15.8571 17.9945 16.1501C17.9034 16.443 17.934 16.759 17.9953 17.3909L18.051 17.9662C18.2665 20.19 18.3742 21.3019 17.7231 21.7962C17.072 22.2905 16.0932 21.8398 14.1357 20.9385L13.6292 20.7053C13.073 20.4492 12.7948 20.3211 12.5 20.3211C12.2052 20.3211 11.927 20.4492 11.3708 20.7053L10.8643 20.9385C8.90677 21.8398 7.928 22.2905 7.27688 21.7962C6.62575 21.3019 6.7335 20.19 6.94899 17.9662L7.00474 17.3909C7.06597 16.759 7.09659 16.443 7.00548 16.1501C6.91438 15.8571 6.71186 15.6203 6.30683 15.1466L5.93808 14.7154C4.51276 13.0487 3.8001 12.2153 4.04881 11.4156C4.29751 10.6158 5.34288 10.3793 7.43361 9.90622L7.9745 9.78384C8.56862 9.64942 8.86568 9.5822 9.1042 9.40114C9.34272 9.22007 9.4957 8.94565 9.80165 8.3968L10.0802 7.89712Z"/><path stroke-linejoin="round" d="M4.98987 2C4.98987 2 5.2778 3.45771 5.90909 4.08475C6.54037 4.71179 8 4.98987 8 4.98987C8 4.98987 6.54229 5.2778 5.91525 5.90909C5.28821 6.54037 5.01013 8 5.01013 8C5.01013 8 4.7222 6.54229 4.09091 5.91525C3.45963 5.28821 2 5.01013 2 5.01013C2 5.01013 3.45771 4.7222 4.08475 4.09091C4.71179 3.45963 4.98987 2 4.98987 2Z" opacity=".5"/><path stroke-width="1.5" d="M18 5H20M19 6L19 4" opacity=".5"/></g>', // solar:stars-minimalistic-line-duotone
}

export const CANDY_ICON_PATHS = {
  stars: SOLAR.stars,
  candy: NAV_ICON_PATHS.candy,
  alpaca: '<path d="M7 4V2"/><path d="M10 4V2"/><path d="M6 4h4a1 1 0 0 1 1 1v7h6a3 3 0 0 1 3 3 1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1z"/><path d="M9.5 16v5"/><path d="M12 16v5"/><path d="M16 16v5"/><path d="M18.5 16v5"/>',
  map: SOLAR.map,
  music: SOLAR.music,
  disc: SOLAR.disc,
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  library: SOLAR.library,
  feather: '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
}

export function csIcon(key) {
  return `<svg class="cs-i" viewBox="0 0 24 24" focusable="false" aria-hidden="true">${CANDY_ICON_PATHS[key] || ''}</svg>`
}
