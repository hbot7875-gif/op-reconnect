// The operations map: the city as a stack of ward tiles.
//
// Three jobs, in order: say how the whole city is doing (the glance strip),
// say which ward you're in the middle of, and keep the 200-odd districts you
// can't reach yet out of the way. Sealed wards are collapsed behind a
// summary — most sessions only ever touch the active ward.
//
// Each ward draws its own skyline from ward-profiles.js: one building per
// district, lit as it's restored, with a silhouette you can recognise
// without reading the name.

import { el, esc, unlockAfter } from './state.js'
import { profileFor, drawCap, drawDecor, n, hashStr, rng } from './ward-profiles.js'

// migrations/011 seeds the starting ward AND its single district both as
// "Relay Zero", so the World screen's hero card rendered the same two words
// stacked on top of each other. "Home Base" is what the place actually is to
// a player — it was already this file's subtitle for it — so it's promoted to
// the name, and everywhere that shows a ward name goes through the helper
// below to keep the two in step.
export const HOME_BASE_WARD = 'relay-zero'

export function wardDisplayName(ward) {
  if (!ward) return ''
  return ward.id === HOME_BASE_WARD ? 'Home Base' : (ward.name || '')
}

// A one-line identity per ward — the map file's own descriptions, shortened.
const SUBTITLE = {
  'relay-zero': 'Where you started',
  mono: 'Rain district',
  happy: 'Carnival quarter',
  dday: 'The foundry',
  hopeworld: 'Sun belt',
  golden: 'Luxury quarter',
  friends: 'Twilight homes',
  muse: 'Fallen sector',
  layover: 'Fallen sector',
  oldgrid: 'Season one relics',
}

const STATE_LABEL = { locked: 'Sealed', active: 'Restoring', restored: 'Online', available: 'Ready' }

const SKY_H = 40
const GROUND = 33

function stateOf(d) {
  if (!d) return 'off'
  if (d.status === 'restored') return 'lit'
  if (d.status === 'active') return 'now'
  if (d.status === 'centerpiece_lit') return 'cp lit'
  if (d.status === 'centerpiece_dark') return 'cp'
  return 'off'
}

function skyline(w, stops, onPeek) {
  const count = Math.max(stops.length, w.totalCount, 1)
  const frac = w.totalCount > 0 ? w.restoredCount / w.totalCount : 0
  const p = profileFor(w.id)
  const r = rng(hashStr(w.id))
  const litCls = frac >= 1 ? 'lit' : ''

  const svg = n('svg', {
    class: 'wt-sky', viewBox: `0 0 100 ${SKY_H}`,
    preserveAspectRatio: 'none', 'aria-hidden': 'true',
  })

  // horizon glow — warms as the ward comes back
  const gid = `wtg-${w.id}`
  const defs = n('defs', {})
  const grad = n('radialGradient', { id: gid, cx: '50%', cy: '100%', r: '85%' })
  grad.appendChild(n('stop', { offset: '0%', 'stop-color': '#d9ad5f', 'stop-opacity': (0.05 + frac * 0.24).toFixed(2) }))
  grad.appendChild(n('stop', { offset: '100%', 'stop-color': '#d9ad5f', 'stop-opacity': '0' }))
  defs.appendChild(grad)
  svg.appendChild(defs)
  svg.appendChild(n('rect', { x: 0, y: 0, width: 100, height: GROUND, fill: `url(#${gid})` }))

  for (let i = 0; i < 8; i++) {
    const star = n('rect', { x: (r() * 97).toFixed(1), y: (r() * 9).toFixed(1), width: 0.5, height: 0.9, class: 'wt-star' })
    star.style.animationDelay = (r() * 4).toFixed(1) + 's'
    svg.appendChild(star)
  }

  // ward scenery sits behind the buildings
  const back = n('g', {})
  if (p.decor) drawDecor(back, p.decor, GROUND, r, litCls)
  svg.appendChild(back)

  const g = n('g', { id: `wtsk-${w.id}` })
  // Slots are the tile width split between districts — fine at 25+, absurd at
  // 1. Home Base has a single district, so the naive `100 / count` handed it a
  // 70-unit-wide, 16-tall block: not a skyline, a progress bar with a mast on
  // it. Cap the slot at one normal building's worth and centre the row, so a
  // tiny ward reads as a lone relay standing in the dark. Wards with 9+
  // districts divide to under MAX_SLOT on their own and are untouched.
  const MAX_SLOT = 11
  const slot = Math.min(100 / count, MAX_SLOT)
  const originX = (100 - slot * count) / 2
  for (let i = 0; i < count; i++) {
    const d = stops[i]
    const cls = stateOf(d)
    const isCp = cls.startsWith('cp')
    const k = r()
    const h = isCp ? GROUND - 4 : p.h(k)
    const bw = slot * (isCp ? 0.5 : p.w(k))
    const bx = originX + i * slot + (slot - bw) / 2
    const y = GROUND - h

    g.appendChild(n('rect', {
      x: bx.toFixed(2), y: y.toFixed(2), width: bw.toFixed(2), height: h.toFixed(2), class: `wtb ${cls}`,
    }))
    if (!isCp && r() < (p.capOdds || 0)) drawCap(g, p.cap, bx, y, bw, cls)
    if (isCp) drawCap(g, 'spire', bx, y, bw, cls)

    // windows only read once a building is lit
    if (cls === 'lit' && bw > 1.5) {
      const cols = bw > 3 ? 2 : 1
      const rows = Math.min(3, Math.floor(h / 6))
      for (let c = 0; c < cols; c++) for (let rr = 0; rr < rows; rr++) {
        g.appendChild(n('rect', {
          x: (bx + bw * (0.24 + c * 0.4)).toFixed(2), y: (y + 1.8 + rr * 4.6).toFixed(2),
          width: (bw * 0.18).toFixed(2), height: 2, class: 'wtw',
        }))
      }
    }
  }
  svg.appendChild(g)

  svg.appendChild(n('use', {
    href: `#wtsk-${w.id}`, transform: `translate(0 ${GROUND * 2}) scale(1 -1)`, class: 'wt-refl',
  }))
  svg.appendChild(n('rect', { x: 0, y: GROUND - 0.4, width: 100, height: 0.7, class: 'wt-ground' }))

  // The far end of the bomb's conduit: the ward currently being restored
  // gets the signal sweeping along its horizon.
  if (w.status === 'active') {
    svg.appendChild(n('rect', { x: -22, y: GROUND - 0.6, width: 22, height: 1.1, class: 'wt-sweep' }))
  }

  // Tap targets, last so they sit above everything. One full-height column
  // per district: the buildings themselves are only a few px wide on a
  // phone, but the column is the whole tile tall, so it's actually hittable.
  // Pointer-only on purpose — 25 focusable rects per ward would wreck
  // keyboard navigation, and the ward list already reaches every district.
  if (onPeek && w.status !== 'locked') {
    for (let i = 0; i < count; i++) {
      const d = stops[i]
      if (!d) continue
      const hit = n('rect', {
        x: (i * slot).toFixed(2), y: 0, width: slot.toFixed(2), height: SKY_H, class: 'wt-hit',
      })
      hit.addEventListener('click', (e) => { e.stopPropagation(); onPeek(d, w) })
      svg.appendChild(hit)
    }
  }
  return svg
}

/* ── the city at a glance ─────────────────────────────────────────────── */

function glanceStrip(wards, districts) {
  const total = wards.reduce((a, w) => a + (w.totalCount || 0), 0)
  const done = wards.reduce((a, w) => a + (w.restoredCount || 0), 0)
  const pct = total ? Math.round((done / total) * 100) : 0

  const box = el('div', 'glance')
  const dots = wards.map((w) => `<i class="gd ${w.status}" title="${esc(wardDisplayName(w))}"></i>`).join('')
  box.innerHTML = `
    <div class="glance-top">
      <span class="glance-label">City recovery</span>
      <span class="glance-pct">${pct}<i>%</i></span>
    </div>
    <div class="glance-bar"><i style="width:${pct}%"></i></div>
    <div class="glance-foot">
      <span class="glance-dots">${dots}</span>
      <span class="glance-count">${done} of ${total} districts back online</span>
    </div>
  `
  return box
}

/* ── one ward ─────────────────────────────────────────────────────────── */

function tile(w, stops, onSelect, onPeek, wards) {
  const locked = w.status === 'locked'
  const gate = locked ? unlockAfter(wards, w.id) : null
  const t = el('button', `wt-tile ${w.status}`)
  t.disabled = locked
  const name = wardDisplayName(w)
  t.setAttribute('aria-label', locked
    ? `${name} — sealed${gate ? `, unlocks after ${wardDisplayName(gate)}` : ''}`
    : `${name} — ${w.restoredCount} of ${w.totalCount} districts restored`)

  const left = w.totalCount - w.restoredCount
  t.appendChild(el('span', 'wt-head', `
    <span class="wt-id">
      <span class="wt-name">${locked ? '<span class="wt-lock">🔒</span>' : ''}${esc(name)}</span>
      <span class="wt-sub">${esc(SUBTITLE[w.id] || '')}</span>
    </span>
    <span class="wt-right">
      <span class="wt-state">${STATE_LABEL[w.status] || ''}</span>
      <span class="wt-count">${locked ? `<i>${w.totalCount} dark</i>`
        : w.restoredCount === w.totalCount ? 'all clear'
        : `${left} <i>left</i>`}</span>
    </span>
  `))
  t.appendChild(skyline(w, stops, onPeek))

  // A sealed ward shouldn't just say "sealed" — say what opens it.
  if (locked) {
    t.appendChild(el('span', 'wt-gate', gate
      ? `Opens when <b>${esc(wardDisplayName(gate))}</b> is whole`
      : 'Opens later in the operation'))
  }
  if (!locked) t.onclick = (e) => onSelect(w, { x: e.clientX, y: e.clientY })
  return t
}

/* ── the stack ────────────────────────────────────────────────────────── */

const GROUPS = [
  { key: 'active', title: 'Restoring' },
  { key: 'available', title: 'Ready' },
  { key: 'restored', title: 'Online' },
]

export function renderWardTiles(wards, districts, onSelect, onPeek) {
  const wrap = el('div', 'ward-tiles')
  const stopsFor = (w) => districts.filter((d) => d.wardId === w.id)

  wrap.appendChild(glanceStrip(wards, districts))

  for (const g of GROUPS) {
    const list = wards.filter((w) => w.status === g.key)
    if (!list.length) continue
    wrap.appendChild(el('div', 'wt-group', `${esc(g.title)} <i>${list.length}</i>`))
    for (const w of list) wrap.appendChild(tile(w, stopsFor(w), onSelect, onPeek, wards))
  }

  // Sealed wards are the long tail — folded away so the active ward stays
  // near the top of the screen instead of 7 tiles down.
  const sealed = wards.filter((w) => w.status === 'locked')
  if (sealed.length) {
    const fold = el('details', 'wt-fold')
    const sum = document.createElement('summary')
    sum.className = 'wt-group is-fold'
    sum.innerHTML = `Sealed <i>${sealed.length}</i><span class="wt-fold-hint">still dark</span>`
    fold.appendChild(sum)
    for (const w of sealed) fold.appendChild(tile(w, stopsFor(w), onSelect, onPeek, wards))
    wrap.appendChild(fold)
  }

  return wrap
}
