// Finding a place in a city of 230 districts.
//
// Two surfaces, one idea. The global finder searches every district by name
// or by the guardian who keeps it — which is the search people actually
// want: "where's my district", "where's hopesizeyouknow". The ward filter
// bar is the same filters applied to the list you're already looking at.
//
// Matching is deliberately loose: lowercase, punctuation-insensitive, so
// "tae13" finds tae_13 and "map of seven" finds Map of Seven Crossing.

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { districtIcon } from './landmarks.js'
import { goDistrict } from './router.js'
import { getSession } from './session.js'
import { wardDisplayName } from './ward-tiles.js'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const STATE_LABEL = {
  restored: 'Restored', active: 'Restoring', available: 'Offline',
  locked: 'Sealed', centerpiece_dark: 'Dormant', centerpiece_lit: 'Awake',
}

// Which statuses each chip keeps. `mine` is handled separately.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Restoring', has: (d) => d.status === 'active' },
  { key: 'restored', label: 'Restored', has: (d) => d.status === 'restored' || d.status === 'centerpiece_lit' },
  { key: 'open', label: 'Not started', has: (d) => d.status === 'available' },
  { key: 'locked', label: 'Sealed', has: (d) => d.status === 'locked' || d.status === 'centerpiece_dark' },
]

function matches(d, q) {
  if (!q) return true
  const n = norm(q)
  return norm(d.name).includes(n) || norm(d.echoOf).includes(n)
}

/* ── Global finder (overlay) ──────────────────────────────────────────── */

export function openFinder(state) {
  const districts = state.map?.districts || []
  const wards = state.map?.wards || []
  const wardName = (id) => wardDisplayName(wards.find((w) => w.id === id))

  // "Mine" only appears if this agent's handle actually keeps a district.
  const handle = getSession()?.handle
  const mineIds = handle
    ? new Set(districts.filter((d) => norm(d.echoOf) === norm(handle)).map((d) => d.id))
    : new Set()

  const sheet = el('div', 'sheet finder')
  sheet.appendChild(el('div', 'eyebrow', 'FIND A DISTRICT'))

  const input = el('input', 'ob-input finder-input')
  input.type = 'search'
  input.placeholder = 'Name or guardian…'
  input.autocomplete = 'off'
  sheet.appendChild(input)

  const chipRow = el('div', 'finder-chips')
  const chips = []
  const opts = mineIds.size
    ? [...FILTERS, { key: 'mine', label: '★ Mine', has: (d) => mineIds.has(d.id) }]
    : FILTERS
  let active = 'all'
  for (const f of opts) {
    const c = el('button', 'chip' + (f.key === active ? ' sel' : ''), esc(f.label))
    c.onclick = () => {
      active = f.key
      chips.forEach((x) => x.classList.toggle('sel', x === c))
      paint()
    }
    chips.push(c)
    chipRow.appendChild(c)
  }
  sheet.appendChild(chipRow)

  const count = el('div', 'finder-count')
  sheet.appendChild(count)
  const results = el('div', 'finder-results')
  sheet.appendChild(results)

  function paint() {
    const q = input.value.trim()
    const f = opts.find((x) => x.key === active)
    const hits = districts.filter((d) => matches(d, q) && (!f.has || f.has(d)))

    count.textContent = hits.length === 0
      ? 'Nothing matches'
      : `${hits.length} ${hits.length === 1 ? 'district' : 'districts'}`

    results.innerHTML = ''
    if (!hits.length) {
      results.appendChild(el('div', 'dim', q
        ? `No district or guardian called “${esc(q)}”.`
        : 'Nothing here yet.'))
      return
    }
    // Long result sets get capped — nobody scrolls 200 rows in a sheet.
    for (const d of hits.slice(0, 60)) {
      const row = el('button', `fr-row ${d.status}`)
      row.innerHTML = `
        <span class="fr-icon">${districtIcon(d.name)}</span>
        <span class="fr-main">
          <span class="fr-name">${esc(d.name)}</span>
          <span class="fr-sub">${esc(wardName(d.wardId))}${d.echoOf ? ` &middot; 👤 ${esc(d.echoOf)}` : ''}</span>
        </span>
        <span class="fr-state">${STATE_LABEL[d.status] || ''}</span>
      `
      row.onclick = (e) => {
        hideOverlay()
        goDistrict(d.wardId, d.id, { x: e.clientX, y: e.clientY })
      }
      results.appendChild(row)
    }
    if (hits.length > 60) {
      results.appendChild(el('div', 'dim', `…and ${hits.length - 60} more. Keep typing to narrow it down.`))
    }
  }

  input.oninput = paint
  paint()

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  showOverlay(sheet)
  setTimeout(() => input.focus(), 60)
}

/* ── Ward-screen filter bar ───────────────────────────────────────────── */

/**
 * Filters an already-rendered district list in place — the rows keep their
 * markup and handlers, they just hide.
 * @param listEl the .district-list element
 */
export function wardFilterBar(listEl, districts) {
  const bar = el('div', 'ward-filter')

  const input = el('input', 'ob-input finder-input')
  input.type = 'search'
  input.placeholder = 'Search this ward…'
  input.autocomplete = 'off'
  bar.appendChild(input)

  const chipRow = el('div', 'finder-chips')
  const present = FILTERS.filter((f) => f.key === 'all' || districts.some((d) => f.has(d)))
  const chips = []
  let active = 'all'
  for (const f of present) {
    const c = el('button', 'chip' + (f.key === active ? ' sel' : ''), esc(f.label))
    c.onclick = () => {
      active = f.key
      chips.forEach((x) => x.classList.toggle('sel', x === c))
      apply()
    }
    chips.push(c)
    chipRow.appendChild(c)
  }
  if (present.length > 1) bar.appendChild(chipRow)

  const empty = el('div', 'dim ward-filter-empty', 'Nothing in this ward matches.')
  empty.hidden = true

  function apply() {
    const q = input.value.trim()
    const f = present.find((x) => x.key === active)
    let shown = 0
    const rows = listEl.querySelectorAll('.d-row')
    rows.forEach((row, i) => {
      const d = districts[i]
      const ok = d && matches(d, q) && (!f.has || f.has(d))
      row.hidden = !ok
      if (ok) shown++
    })
    empty.hidden = shown > 0
    listEl.hidden = shown === 0
  }

  input.oninput = apply
  return { bar, empty, apply }
}
