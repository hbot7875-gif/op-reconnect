// Signal, Fuel, Intel — what streaming actually earns you.
//
// Three resources, one sentence each, no formulas on screen. They map onto
// the three things the game wants people to do, so the reward for each is
// mechanically distinct instead of everything collapsing into "streams go up":
//
//   ⚡ Signal  track goals   → reconnects districts
//   🔥 Fuel    album goals   → powers the ARMY Bomb
//   📦 Intel   listening wide → unlocks classified files
//
// They only ever go up. Nothing here decays, expires or gets spent away —
// this is a game about a city growing, not a city rotting while you're busy.

import { el, esc, hideOverlay } from './state.js'

export const RESOURCES = [
  {
    key: 'signal', icon: '⚡', name: 'Signal', cls: 'r-signal',
    blurb: 'Earned from your Track Missions.',
    detail: 'Signal is the current that reconnects a district. Every play that counts toward a track goal adds to it, and it\'s what brings a place back online.',
  },
  {
    key: 'fuel', icon: '🔥', name: 'Fuel', cls: 'r-fuel',
    blurb: 'Earned from Album Missions.',
    detail: 'Fuel keeps the ARMY Bomb network powered. Full album passes are the only thing that makes it, which is why a complete listen is worth more than the same plays scattered.',
  },
  {
    key: 'intel', icon: '📦', name: 'Intel', cls: 'r-intel',
    blurb: 'Recovered from exploring the network.',
    detail: 'Intel comes from listening wide — different tracks, not the same one on repeat. It unlocks classified files and the memories of the agents who kept these places.',
  },
]

/**
 * Server-authoritative when the payload carries `resources`; otherwise
 * derived from what the state can honestly account for. The fallback only
 * counts things actually visible in the payload, so it under-reports rather
 * than inventing a lifetime total.
 */
export function getResources(state) {
  const r = state?.resources
  if (r) {
    return {
      signal: Math.max(0, r.signal | 0),
      fuel: Math.max(0, r.fuel | 0),
      intel: Math.max(0, r.intel | 0),
    }
  }

  const d = state?.activeDistrict
  const districts = state?.map?.districts || []
  let signal = 0
  for (const g of d?.trackGoals || []) signal += Math.min(g.progress || 0, g.target || 0)
  let fuel = 0
  for (const a of d?.albums || []) fuel += Math.min(a.passesDone || 0, a.target || 0)
  // Every restored district gave up its memory; revealed files add to that.
  const intel = districts.filter((x) => x.status === 'restored' || x.status === 'centerpiece_lit').length
    + (d?.files || []).filter((f) => f.revealed).length

  return { signal, fuel, intel }
}

/** The three tiles. `onPick` gets the resource definition. */
export function resourceRow(state, onPick) {
  const vals = getResources(state)
  const row = el('div', 'res-row')
  for (const r of RESOURCES) {
    const tile = el('button', `res-tile ${r.cls}`)
    tile.setAttribute('aria-label', `${vals[r.key]} ${r.name}. ${r.blurb}`)
    tile.innerHTML = `
      <span class="rt-icon">${r.icon}</span>
      <span class="rt-val">${vals[r.key].toLocaleString()}</span>
      <span class="rt-name">${esc(r.name)}</span>
    `
    tile.onclick = () => onPick(r, vals[r.key])
    row.appendChild(tile)
  }
  return row
}

/** Tap a resource, get one screen that explains it. No formulas. */
export function resourceSheet(r, value) {
  const sheet = el('div', `sheet res-sheet ${r.cls}`)
  sheet.appendChild(el('div', 'rs-icon', r.icon))
  sheet.appendChild(el('div', 'rs-name', esc(r.name.toUpperCase())))
  sheet.appendChild(el('div', 'rs-val', value.toLocaleString()))
  sheet.appendChild(el('p', 'muted rs-blurb', esc(r.blurb)))
  sheet.appendChild(el('p', 'dim rs-detail', esc(r.detail)))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
