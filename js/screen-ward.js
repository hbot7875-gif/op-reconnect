// Ward screen — the districts inside one ward, as a list.
//
// The district's NAME is the headline and the agent it echoes sits right under
// it. That pairing is the whole point of the game and it used to be 9px of
// rotated text on a canvas. No drawn skyline here; when the illustrated ward
// map exists it slots in above this list, and these rows stay as they are.

import { el, esc, unlockAfter, joinNames } from './state.js'
import { goWorld, goDistrict } from './router.js'
import { districtFraction } from './ui-district.js'
import { districtDisplayName } from './ward-tiles.js'
// The district's name decides what kind of place it is (landmarks.js reads it
// to draw the scene) — the same lookup gives the list its icons, so a row is
// scannable without reading a word.
import { districtIcon as iconFor } from './landmarks.js'
import { wardFilterBar } from './search.js'
import { wardDisplayName } from './ward-tiles.js'

const D_STATE = {
  locked:            { label: 'Sealed' },
  available:         { label: 'Offline' },
  active:            { label: 'Restoring' },
  restored:          { label: 'Online' },
  centerpiece_dark:  { label: 'Dormant' },
  centerpiece_lit:   { label: 'Awake' },
}

export function renderWard(container, state, wardId) {
  const ward = (state.map?.wards || []).find((w) => w.id === wardId)
  if (!ward) { goWorld(); return }

  const districts = (state.map.districts || []).filter((d) => d.wardId === ward.id)
  const pct = ward.totalCount > 0 ? Math.round((ward.restoredCount / ward.totalCount) * 100) : 0

  container.innerHTML = ''
  const wrap = el('div', 'ward-screen')

  const head = el('div', 'screen-head')
  const back = el('button', 'back-btn', 'Ops Map')
  back.onclick = (e) => goWorld({ x: e.clientX, y: e.clientY })
  head.appendChild(back)
  wrap.appendChild(head)

  wrap.appendChild(el('div', 'screen-title', esc(wardDisplayName(ward))))

  if (ward.status === 'locked') {
    const gate = unlockAfter(state.map?.wards || [], ward.id)
    wrap.appendChild(el('div', 'sealed-note', `
      <span class="sn-lock">🔒</span>
      <div class="sn-title">This ward is still dark</div>
      <p class="sn-body">${gate
        ? `Every one of its ${ward.totalCount} districts stays sealed until <b>${esc(wardDisplayName(gate))}</b> is whole. Finish there and the grid opens through to here.`
        : `All ${ward.totalCount} of its districts are sealed. HT opens this part of the grid later in the operation.`}</p>
    `))
  } else {
    wrap.appendChild(el('div', 'ward-progress', `
      <div class="wp-top">
        <span class="wp-label">Districts back online</span>
        <span class="wp-count">${ward.restoredCount}<i>/${ward.totalCount}</i></span>
      </div>
      <div class="wp-bar"><i style="width:${pct}%"></i></div>`))
  }

  const list = districtList(state, ward, districts)
  // Search + filters only earn their space once the list is long enough to
  // be annoying; a five-district ward doesn't need them.
  if (districts.length > 8) {
    const { bar, empty } = wardFilterBar(list, districts)
    wrap.appendChild(bar)
    wrap.appendChild(list)
    wrap.appendChild(empty)
  } else {
    wrap.appendChild(list)
  }

  // Almost always one centerpiece; Echo Quarter has four (one per season-one
  // team), so this is written for a list rather than a single name — see
  // joinNames. "is/are" agrees with the count either way.
  if (ward.centerpieces?.length) {
    const names = joinNames(ward.centerpieces.map((c) => c.name))
    const verb = ward.centerpieces.length > 1 ? 'are' : 'is'
    const lit = ward.centerpieces[0].lit
    wrap.appendChild(el('div', 'ward-foot', lit
      ? `${esc(names)} ${verb} awake`
      : `${esc(names)} ${verb === 'are' ? 'wake' : 'wakes'} up when every district here is back`))
  }

  container.appendChild(wrap)
}

function districtList(state, ward, districts) {
  const list = el('div', 'district-list')

  for (const d of districts) {
    const st = D_STATE[d.status] || D_STATE.available
    const locked = d.status === 'locked' || d.status === 'centerpiece_dark'
    const live = state.activeDistrict?.id === d.id ? state.activeDistrict : null

    const power = d.status === 'restored' || d.status === 'centerpiece_lit' ? 100
      : d.status === 'active' ? Math.round(districtFraction(live) * 100)
      : 0

    const row = el('button', `d-row ${d.status}`)
    row.disabled = locked
    row.setAttribute('aria-label', `${districtDisplayName(d)} — ${st.label}${power ? `, ${power}% restored` : ''}`)
    row.innerHTML = `
      <span class="d-icon">${iconFor(d.name)}</span>
      <span class="d-main">
        <span class="d-name">${esc(districtDisplayName(d))}</span>
        <span class="d-sub">${d.echoOf ? `👤 ${esc(d.echoOf)}` : st.label}</span>
      </span>
      <span class="d-right">
        ${locked ? '<span class="d-lock">Sealed</span>'
          : power === 100 ? '<span class="d-power done">Restored</span>'
          : `<span class="d-power">${power}<i>%</i></span>`}
      </span>
      <span class="d-bar"><i style="width:${power}%"></i></span>
    `
    row.onclick = (e) => goDistrict(ward.id, d.id, { x: e.clientX, y: e.clientY })
    list.appendChild(row)
  }
  return list
}

export function teardownWard() {}
