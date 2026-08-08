// Screen router — World (the network, ARMY Bomb + wards) → Ward (zoomed
// neighborhood of districts) → District (mission page). Nothing fancier than
// a tiny state + subscriber list; main.js re-renders the active screen on change.
// `origin` (optional {x,y} in viewport coords, from the click that triggered
// navigation) lets the zoom transition expand from where the player tapped
// instead of always the screen center.

// botz.html is a separate page (its own <a href> nav, not an in-app click),
// so it can't call goResources()/goCandyStar()/etc. directly the way the
// real in-game tab bar does — every one of its bottom-nav links just pointed
// at bare "game.html" with no way to say which screen, so City/Pack/Candy/
// Ranks/Settings all landed on the same default World screen regardless of
// which was tapped. A ?screen= query param read once at boot is what lets
// those links actually mean what their labels say; goWorld/goResources/etc.
// still work exactly as before for every in-app navigation after that.
const DEEP_LINKABLE = new Set(['world', 'resources', 'settings', 'candystar', 'ranking'])
function initialScreen() {
  const requested = new URLSearchParams(location.search).get('screen')
  return { name: DEEP_LINKABLE.has(requested) ? requested : 'world', wardId: null, districtId: null, origin: null }
}

let screen = initialScreen()
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

export function goRanking(origin = null) {
  set({ name: 'ranking', wardId: null, districtId: null, origin })
}

export function goWard(wardId, origin = null) {
  set({ name: 'ward', wardId, districtId: null, origin })
}

export function goDistrict(wardId, districtId, origin = null) {
  set({ name: 'district', wardId, districtId, origin })
}
