// One look for the MAMA popups that open over any screen (team choice,
// certificate not counted): an icon, centred words, full-width buttons.
// Pure markup, so it can be checked in Node; the callers wire the buttons
// (data-vp="primary" / "secondary") and hand the sheet to showOverlay.

import { vIcon as ic } from './voting-icons.js'
import { esc } from './voting-view.js'

const TEAM_TONE = { hooligans: 'is-hoo', aliens: 'is-ali' }

/** Two team tiles with the live score, "vs" between them. */
export function teamTilesHtml(teams) {
  if (!Array.isArray(teams) || teams.length !== 2) return ''
  const tile = (t) => `<div class="vt-pop-team ${TEAM_TONE[t.id] || ''}"><span>${esc(t.label)}</span><b>${Number(t.points) || 0}</b></div>`
  return `<div class="vt-pop-teams">${tile(teams[0])}<span class="vt-pop-vs" aria-hidden="true">vs</span>${tile(teams[1])}</div>`
}

/** tone: 'accent' | 'err' | 'warn' — colours the icon only. */
export function votePopupHtml({ tone = 'accent', icon, eyebrow, title, body, extra = '', primary, secondary }) {
  return `<div class="vt-pop-ico is-${tone}">${ic(icon)}</div>
    ${eyebrow ? `<p class="vt-pop-eyebrow">${esc(eyebrow)}</p>` : ''}
    <h3 class="vt-pop-title">${esc(title)}</h3>
    <p class="vt-pop-body">${esc(body)}</p>
    ${extra}
    <div class="vt-pop-acts">
      <button type="button" class="vt-pop-btn is-primary" data-vp="primary" data-autofocus="true">${esc(primary)}</button>
      ${secondary ? `<button type="button" class="vt-pop-btn is-quiet" data-vp="secondary">${esc(secondary)}</button>` : ''}
    </div>`
}
