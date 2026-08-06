// The ARMY Bomb, opened up.
//
// Tapping the core used to show one bar and a sentence. It's the thing every
// agent on the network feeds, so it gets a real panel: how charged it is,
// what that's worth, what the network did today, whether anything is
// attacking it, and what you personally have restored.
//
// Deliberately circular rather than another horizontal bar — the world
// screen already has four of those, and the core deserves its own shape.

import { el, esc, hideOverlay } from './state.js'
import { tickCountdowns } from './countdown.js'
import { districtDisplayName } from './ward-tiles.js'

const R = 54
const CIRC = 2 * Math.PI * R

function gauge(frac, danger) {
  const pct = Math.round(frac * 100)
  const g = el('div', 'bg-gauge' + (danger ? ' danger' : ''))
  g.innerHTML = `
    <svg viewBox="0 0 130 130" aria-hidden="true">
      <circle class="bg-track" cx="65" cy="65" r="${R}"></circle>
      <circle class="bg-fill" cx="65" cy="65" r="${R}" transform="rotate(-90 65 65)"
        stroke-dasharray="${(CIRC * Math.max(0, Math.min(1, frac))).toFixed(1)} ${CIRC.toFixed(1)}"></circle>
    </svg>
    <div class="bg-read">
      <div class="bg-pct">${pct}<i>%</i></div>
      <div class="bg-lbl">charged</div>
    </div>
  `
  return g
}

function statRow(items) {
  const row = el('div', 'bg-stats')
  for (const [label, value] of items) {
    row.appendChild(el('div', 'bg-stat', `<span class="bs-v">${value}</span><span class="bs-l">${esc(label)}</span>`))
  }
  return row
}

export function bombSheet(state) {
  const b = state.bomb || { charge: 0 }
  const d = b.defuse
  const underAttack = !!d
  const wards = state.map?.wards || []

  const sheet = el('div', 'sheet bomb-dash')

  sheet.appendChild(el('div', 'eyebrow' + (underAttack ? ' alert' : ''), 'ARMY BOMB'))
  sheet.appendChild(el('div', 'bd-status' + (underAttack ? ' alert' : b.brownout ? ' warn' : ''),
    underAttack ? 'Under attack'
    : b.brownout ? 'Brownout — grid recovering'
    : 'Network stable'))

  // ── power ──
  const frac = underAttack ? Math.min(1, d.progress / Math.max(1, d.target)) : (b.charge || 0)
  sheet.appendChild(gauge(frac, underAttack))
  sheet.appendChild(el('p', 'muted bd-note', underAttack
    ? 'This is how far the defuse has come. Everyone streaming right now pushes it up.'
    : b.brownout
      ? 'The grid took a hit. Power is down while it recovers — you didn\'t lose anything you earned.'
      : "Everyone streaming right now feeds this — the network's shared vitality signal. It doesn't change your own XP or survival anymore; that's what your Personal Charge (Pack) runs on."))

  // ── what it's worth ──
  // No "Boost ×N" line anymore — the shared multiplier was retired from XP
  // (see derive.ts). This panel is network vitality + Red Zone status only.
  const stats = []
  if (Number.isFinite(b.communityStreams)) stats.push(['Streams today', b.communityStreams.toLocaleString()])
  // Grows by a day per Era Timeline era the network has fully unlocked
  // (bomb.ts's chargeWindowDays) — the visible payoff for finishing one.
  if (Number.isFinite(b.chargeWindowDays)) stats.push(['Charge window', `${b.chargeWindowDays}d`])
  const totalD = wards.reduce((a, w) => a + (w.totalCount || 0), 0)
  const doneD = wards.reduce((a, w) => a + (w.restoredCount || 0), 0)
  if (totalD) stats.push(['City recovery', `${Math.round((doneD / totalD) * 100)}%`])
  if (stats.length) sheet.appendChild(statRow(stats))

  // ── red zone ──
  if (underAttack) {
    const rz = el('div', 'bd-block alert')
    const deadline = d.activeUntil || d.active_until
    rz.innerHTML = `
      <div class="bd-block-head">Red Zone</div>
      <div class="bd-line"><span>Global target</span><b>${d.progress.toLocaleString()} / ${d.target.toLocaleString()}</b></div>
      ${deadline ? `<div class="bd-line"><span>Time left</span><b class="bd-clock" data-deadline="${esc(deadline)}">--:--:--</b></div>` : ''}
      <div class="bd-line"><span>You've routed</span><b>${(d.yourStreams || 0).toLocaleString()}</b></div>
      <div class="bd-line"><span>Reward</span><b>+${d.rewardXp} XP</b></div>
    `
    sheet.appendChild(rz)
  } else {
    sheet.appendChild(el('div', 'bd-block', `
      <div class="bd-block-head">Red Zone</div>
      <div class="dim">No active threats. If the network is attacked, it shows up here and on the home screen.</div>
    `))
  }

  // ── your network ──
  const active = (state.map?.districts || []).find((x) => x.status === 'active')
  const wardsOnline = wards.filter((w) => w.status === 'restored').length
  const yours = el('div', 'bd-block')
  yours.innerHTML = `
    <div class="bd-block-head">Your network</div>
    <div class="bd-line"><span>Districts restored</span><b>${doneD} / ${totalD}</b></div>
    <div class="bd-line"><span>Wards online</span><b>${wardsOnline} / ${wards.length}</b></div>
    <div class="bd-line"><span>Working on</span><b>${active ? esc(districtDisplayName(active)) : '—'}</b></div>
  `
  sheet.appendChild(yours)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  if (underAttack) tickCountdowns()
  return sheet
}
