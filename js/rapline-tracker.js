// Rap Line to 1B — the City card for three solo tracks' Spotify totals.
//
// Informational only: no XP, no rewards, nothing counted from the player, and
// separate from Signal Sweep (the Road to 1B scrobble mission). Data comes
// from the public getRaplineTracker route; see
// supabase/functions/op-reconnect/lib/rapline-rules.js for how missing days,
// repeated totals and Spotify corrections are told apart from real gains.
//
// The City card is deliberately compact: cover, title, abbreviated total,
// thin bar, latest gain. Exact figures, the seven-day history and the
// completed milestones live in the sheets it opens.
//
// Every figure carries the date it was reported for, and its age is always
// worked out here, from that date against today's UTC date, by freshness().
// The card header and both sheets use that one function, so they can never
// disagree about how old a report is — including when a cached response
// outlives the day it was fetched on.
//
// City repaints often, so the response is cached for the page's life and
// refetched at most every REFRESH_MS. Cards rendered while a fetch is in
// flight are filled in place when it lands.

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { call } from './api.js'
import { RAPLINE_STALE_DAYS } from '../supabase/functions/op-reconnect/lib/rapline-rules.js'

const REFRESH_MS = 10 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000

// Spotify's own cover thumbnails (oEmbed thumbnail_url), 64px and 300px
// variants of the same image. A cover that fails to load falls back to a
// lettered tile; nothing else depends on it.
const COVERS = {
  '1AZjCZSGEjlxUufFQwSszF': 'fa60e8a8d5ca09efc6098175',
  '4bjN59DRXFRxBE1g5ne6B1': 'fa9247b68471b82d2125651e',
  '2GzwtXPlI0gZEOS6xFOZ2j': 'a4b6673a8dd10d67163dbfc1',
  '27xkOIER6uDLKALIelHylZ': '89228504f700641956e29f5d',
  '4g5eopb54XIaV2ciooY3St': 'ba4fa604f046ff824331f4f4',
}

let cache = { tracker: null, failed: false, at: 0, pending: null }

const nf = new Intl.NumberFormat('en-US')
const num = (n) => nf.format(n)
const signed = (n) => `${n > 0 ? '+' : '−'}${nf.format(Math.abs(n))}`

export function shortDate(iso) {
  const [, m, d] = String(iso || '').split('-').map(Number)
  return m && d ? `${MONTHS[m - 1]} ${d}` : ''
}

/** 874,058,865 → "874.1M"; 1,009,292,521 → "1.01B"; 308,007 → "308K". */
export function abbreviate(n) {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(Math.round(n / 1e7) / 100).toFixed(2)}B`
  if (a >= 1e6) return `${(Math.round(n / 1e5) / 10).toFixed(1)}M`
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

/** Age of a report in whole days, from its source date to today's UTC date.
 *  The source dates its readings by UTC day, and so does the server. */
export function freshness(asOfIso, nowMs = Date.now()) {
  if (!asOfIso) return null
  const today = Math.floor(nowMs / DAY_MS)
  const day = Math.round(Date.parse(`${asOfIso}T00:00:00Z`) / DAY_MS)
  const ageDays = Math.max(0, today - day)
  return { ageDays, stale: ageDays > RAPLINE_STALE_DAYS, label: ageDays === 1 ? '1 day old' : `${ageDays} days old` }
}

/** The small gain line under a total: the latest genuine daily gain, dated
 *  only when it isn't the report's own day, or why there isn't one. */
export function gainLabel(summary, abbreviated = false) {
  const newest = summary.days[summary.days.length - 1]
  if (newest?.kind === 'correction') return 'Spotify correction'
  const g = summary.latestGain
  if (!g) return 'Daily gain —'
  const value = abbreviated ? `+${abbreviate(g.streams)}` : signed(g.streams)
  return g.day === summary.asOf ? `${value} / day` : `${value} on ${shortDate(g.day)}`
}

function load() {
  if (cache.pending) return cache.pending
  cache.pending = call('getRaplineTracker').then((res) => {
    cache = { tracker: res?.success ? res.tracker : cache.tracker, failed: !res?.success, at: Date.now(), pending: null }
  }, () => {
    cache = { ...cache, failed: true, at: Date.now(), pending: null }
  }).then(() => {
    for (const node of document.querySelectorAll('section.rapline')) fill(node)
  })
  return cache.pending
}

export function raplineTrackerCard() {
  const section = el('section', 'rapline')
  section.setAttribute('aria-label', 'Rap Line to 1B: Spotify streaming milestones')
  fill(section)
  if (!cache.at || Date.now() - cache.at > REFRESH_MS) load()
  return section
}

function cover(spotifyId, name, size = 'sm') {
  const hash = COVERS[spotifyId]
  const letter = esc(String(name || '?').trim().charAt(0).toUpperCase())
  if (!hash) return `<span class="rapline-art is-${size} is-fallback" aria-hidden="true">${letter}</span>`
  return `<span class="rapline-art is-${size}" aria-hidden="true" data-letter="${letter}"><img alt="" decoding="async"
    src="https://i.scdn.co/image/ab67616d00004851${hash}"
    srcset="https://i.scdn.co/image/ab67616d00004851${hash} 64w, https://i.scdn.co/image/ab67616d00001e02${hash} 300w"
    sizes="${size === 'lg' ? '56px' : '40px'}" onerror="this.parentNode.classList.add('is-fallback');this.parentNode.textContent=this.parentNode.dataset.letter"></span>`
}

function dateChip(asOf) {
  const f = freshness(asOf)
  if (!f) return ''
  return `<span class="rapline-date${f.stale ? ' is-stale' : ''}" title="Reported for ${esc(shortDate(asOf))}${f.ageDays ? ` · ${f.label}` : ''}">${f.stale ? '<i aria-hidden="true"></i>' : ''}As of ${esc(shortDate(asOf))}${f.stale ? ` · ${f.ageDays}d old` : ''}</span>`
}

function fill(section) {
  const t = cache.tracker
  const reported = (t?.tracks || []).filter((x) => x.summary)
  const done = t?.milestones?.length || 0
  section.innerHTML = `
    <button type="button" class="rapline-head">
      <span class="rapline-title"><b>Rap Line to 1B</b><i>Spotify streaming milestones</i></span>
      <span class="rapline-head-side">${dateChip(t?.asOf)}<span class="rapline-chev" aria-hidden="true">›</span></span>
    </button>
    <div class="rapline-rows"></div>
    ${done ? `<button type="button" class="rapline-foot">
      <span class="rapline-foot-done"><i aria-hidden="true">✓</i>${done} milestone${done === 1 ? '' : 's'} completed</span>
      <span class="rapline-foot-more">View details <span aria-hidden="true">›</span></span>
    </button>` : ''}`
  section.querySelector('.rapline-head').onclick = () => t && showOverlay(overviewSheet(t))
  const foot = section.querySelector('.rapline-foot')
  if (foot) foot.onclick = () => t && showOverlay(overviewSheet(t))

  const rows = section.querySelector('.rapline-rows')
  if (!t) {
    rows.innerHTML = `<p class="rapline-empty">${cache.failed ? 'Totals are unavailable right now.' : 'Loading totals…'}</p>`
  } else if (!reported.length) {
    rows.innerHTML = '<p class="rapline-empty">The first report arrives with the next update.</p>'
  } else {
    for (const track of t.tracks) rows.appendChild(trackRow(track, t))
  }
}

function trackRow(track, tracker) {
  const s = track.summary
  const row = el('button', 'rapline-row')
  row.type = 'button'
  if (!s) {
    row.disabled = true
    row.innerHTML = `${cover(track.spotifyId, track.name)}
      <span class="rapline-copy"><b>${esc(track.name)}</b><i>${esc(track.artist)}</i></span>
      <span class="rapline-figs"><b class="is-empty">—</b></span>`
    return row
  }
  const ownDate = s.asOf !== tracker.asOf ? ` &middot; ${esc(shortDate(s.asOf))}` : ''
  row.setAttribute('aria-label', `${track.name} by ${track.artist}. ${num(s.total)} Spotify streams as of ${shortDate(s.asOf)}. ${s.percent}% of 1 billion. Open history.`)
  row.innerHTML = `${cover(track.spotifyId, track.name)}
    <span class="rapline-copy"><b>${esc(track.name)}</b><i>${esc(track.artist)}${ownDate}</i></span>
    <span class="rapline-figs"><b>${abbreviate(s.total)}</b><i>${esc(gainLabel(s, true))}</i></span>
    <span class="rapline-bar" aria-hidden="true"><i style="width:${s.percent}%"></i></span>`
  row.onclick = () => showOverlay(trackSheet(track, tracker))
  return row
}

function progressBlock(s) {
  return `
    <div class="rapline-progress" aria-hidden="true"><i style="width:${s.percent}%"></i></div>
    <div class="rapline-progress-meta"><span><b>${s.percent}%</b> of 1B</span><span>${s.reached ? 'Reached' : `<b>${num(s.remaining)}</b> to go`}</span></div>`
}

const KIND_LABEL = {
  missing: 'No report',
  gap: '—',
  repeat: 'Unchanged',
  spans_repeat: '—',
}

function trackSheet(track, tracker) {
  const s = track.summary
  const f = freshness(s.asOf)
  const sheet = el('div', 'sheet rapline-sheet')
  sheet.innerHTML = `
    <div class="eyebrow">RAP LINE TO 1B</div>
    <div class="rapline-sheet-id">${cover(track.spotifyId, track.name, 'lg')}
      <span class="rapline-copy"><b>${esc(track.name)}</b><i>${esc(track.artist)}${track.feature ? ` ${esc(track.feature)}` : ''}</i></span>
    </div>
    <div class="rapline-hero">
      <b>${num(s.total)}</b>
      <span>Spotify streams &middot; reported ${esc(shortDate(s.asOf))}${f.ageDays ? ` &middot; <em class="${f.stale ? 'is-stale' : ''}">${f.label}</em>` : ''}</span>
    </div>
    ${progressBlock(s)}
    <div class="rapline-section-label">Last 7 days</div>
    <div class="rapline-days">${[...s.days].reverse().map((d) => {
      const value = d.kind === 'gain' ? signed(d.gain)
        : d.kind === 'correction' ? `Correction ${signed(d.gain)}`
        : KIND_LABEL[d.kind] || '—'
      return `<div class="rapline-day is-${d.kind}"><span>${esc(shortDate(d.day))}</span><b>${d.streams == null ? '—' : num(d.streams)}</b><i>${esc(value)}</i></div>`
    }).join('')}</div>
    <p class="rapline-fine">Each figure is the Spotify total shown on that date, refreshed every 3 days. A daily gain appears only between two consecutive reported days; missing days, repeated figures and Spotify corrections show none. Unofficial &middot; no XP.</p>
    <div class="rapline-actions"></div>`
  const actions = sheet.querySelector('.rapline-actions')
  const open = el('a', 'btn btn-ghost', 'Open in Spotify')
  open.href = `https://open.spotify.com/track/${track.spotifyId}`
  open.target = '_blank'
  open.rel = 'noopener'
  const back = el('button', 'btn btn-ghost', 'All songs')
  back.onclick = () => showOverlay(overviewSheet(tracker))
  actions.append(open, back)
  return sheet
}

function overviewSheet(tracker) {
  const sheet = el('div', 'sheet rapline-sheet')
  const f = freshness(tracker.asOf)
  sheet.innerHTML = `
    <div class="eyebrow">RAP LINE TO 1B</div>
    <h3>Spotify streaming milestones</h3>
    ${f ? `<p class="rapline-sub">Reported ${esc(shortDate(tracker.asOf))}${f.ageDays ? ` &middot; <em class="${f.stale ? 'is-stale' : ''}">${f.label}</em>` : ''}</p>` : ''}
    <div class="rapline-list"></div>
    <div class="rapline-section-label is-gold">Completed</div>
    <div class="rapline-done-list">${(tracker.milestones || []).map((m) => `
      <a class="rapline-done-row" href="https://open.spotify.com/track/${esc(m.spotifyId)}" target="_blank" rel="noopener">
        ${cover(m.spotifyId, m.name)}
        <span class="rapline-copy"><b>${esc(m.name)}</b><i>${esc(m.artist)}${m.group ? ' &middot; group' : ''}</i></span>
        <span class="rapline-done-tag">1B+ ✓</span>
      </a>`).join('')}</div>
    <p class="rapline-fine">Unofficial Spotify totals, each shown with the date it was reported for, refreshed every 3 days. Informational only &middot; no XP.</p>
    <div class="rapline-actions"></div>`
  const list = sheet.querySelector('.rapline-list')
  for (const track of tracker.tracks) {
    const s = track.summary
    const row = el('button', 'rapline-list-row')
    row.type = 'button'
    row.disabled = !s
    row.innerHTML = `${cover(track.spotifyId, track.name)}
      <span class="rapline-copy"><b>${esc(track.name)}</b><i>${esc(track.artist)}</i></span>
      <span class="rapline-figs"><b>${s ? num(s.total) : '—'}</b><i>${s ? `${s.percent}% &middot; ${abbreviate(s.remaining)} to go` : ''}</i></span>
      ${s ? `<span class="rapline-bar" aria-hidden="true"><i style="width:${s.percent}%"></i></span>` : ''}`
    if (s) row.onclick = () => showOverlay(trackSheet(track, tracker))
    list.appendChild(row)
  }
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.querySelector('.rapline-actions').append(close)
  return sheet
}
