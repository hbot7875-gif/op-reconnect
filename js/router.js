// Screen router — World (the network, ARMY Bomb + wards) → Ward (zoomed
// neighborhood of districts) → District (mission page). Nothing fancier than
// a tiny state + subscriber list; main.js re-renders the active screen on change.
// `origin` (optional {x,y} in viewport coords, from the click that triggered
// navigation) lets the zoom transition expand from where the player tapped
// instead of always the screen center.

let screen = { name: 'world', wardId: null, districtId: null, origin: null }
const subs = []

export function getScreen() {
  return screen
}

export function onScreenChange(fn) {
  subs.push(fn)
}

function set(next) {
  screen = next
  for (const fn of subs) fn(screen)
}

export function goWorld(origin = null) {
  set({ name: 'world', wardId: null, districtId: null, origin })
}

export function goResources(origin = null) {
  set({ name: 'resources', wardId: null, districtId: null, origin })
}

export function goSettings(origin = null) {
  set({ name: 'settings', wardId: null, districtId: null, origin })
}

export function goCandyStar(origin = null) {
  set({ name: 'candystar', wardId: null, districtId: null, origin })
}

export function goWard(wardId, origin = null) {
  set({ name: 'ward', wardId, districtId: null, origin })
}

export function goDistrict(wardId, districtId, origin = null) {
  set({ name: 'district', wardId, districtId, origin })
}
