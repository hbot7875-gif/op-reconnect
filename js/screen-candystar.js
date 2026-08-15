// Candy Star Generator screen — thin host around candy-star.js's own
// renderCandyStar(), which does everything from here down (it expects to own
// a #candystarContent element and reaches out to window-scoped handlers the
// way it always has). Reached from the persistent Candy Star tab; playlist
// generation itself still costs Wings.

import { el, esc } from './state.js'
import { goResources } from './router.js'

let mounted = false
// `container` (the shared #scene node) survives untouched across a poll or
// tab-focus refresh as long as the player stays on this screen — nothing
// else writes to it in that case. So if our own wrapper is still there, this
// call is just a background state refresh, not a real navigation: leave the
// in-progress generator (typed songs, picks, tab) alone instead of tearing
// it down and re-fetching getAlpacaOptions out from under the player.
let mountedIn = null

export async function renderCandyStar(container, state) {
  if (mountedIn === container && container.querySelector('.cs-screen')) return
  mountedIn = container
  container.innerHTML = ''
  const wrap = el('div', 'cs-screen')

  const head = el('div', 'screen-head')
  const back = el('button', 'back-btn', 'Agent Pack')
  back.onclick = (e) => goResources({ x: e.clientX, y: e.clientY })
  head.appendChild(back)
  wrap.appendChild(head)

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">🍬 Candy Star Generator</span>
  `))
  wrap.appendChild(el('div', 'cs-screen-sub',
    'Make an alpaca 🦙 — a real Spotify playlist built around the current goals, woven with enough variety to play like a real playlist.'))

  const mount = el('div')
  mount.id = 'candystarContent'
  wrap.appendChild(mount)

  container.appendChild(wrap)

  // candy-star.js is self-contained (own window-scoped handlers for its
  // inline onclick/oninput markup) — import once, then just call its render
  // entry point on every visit to this screen.
  const mod = await import('./candy-star.js')
  if (!mounted) {
    // Expose the handlers candy-star.js's own innerHTML markup calls by name
    // (candySwitchTab, candyGenerate, etc.) — it was built to run as a
    // classic script with these as globals, same pattern app.js used.
    for (const key of Object.keys(mod)) {
      if (key.startsWith('candy')) window[key] = mod[key]
    }
    mounted = true
  }
  mod.renderCandyStar()
}
