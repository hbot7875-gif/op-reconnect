// "Your Contributions" on a restored district: what this agent personally
// streamed there — Tracks, Albums, ReConnect — from recorded plays
// (lib/district-contributions.ts). A personal record, not a mission board:
// no targets, no "still need", no XP. Each line opens its detail underneath.

import { el, esc } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { rcIcon } from './reconnect-icons.js'

const cache = new Map() // districtId -> server reply (records don't change once restored)
const fmt = (n) => Number(n || 0).toLocaleString()
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

export function contributionsSection(districtId, districtName) {
  const box = el('section', 'yc')
  box.innerHTML = `
    <div class="yc-head"><h3 class="yc-title">Your Contributions</h3><span class="yc-when"></span></div>
    <div class="yc-body"><p class="yc-note">Loading your record…</p></div>`
  const load = async () => {
    let res = cache.get(districtId)
    if (!res) {
      res = await call('getDistrictContributions', { agentNo: getAgentNo(), districtId })
      if (res?.success) cache.set(districtId, res)
    }
    if (!box.isConnected && !box.parentNode) return
    paint(box, res, districtName, load)
  }
  load()
  return box
}

function paint(box, res, districtName, retry) {
  const body = box.querySelector('.yc-body')
  if (!res?.success) {
    body.innerHTML = '<p class="yc-note">Couldn\'t load your record right now.</p>'
    const again = el('button', 'yc-retry', 'Try again')
    again.type = 'button'
    again.onclick = () => { body.innerHTML = '<p class="yc-note">Loading your record…</p>'; retry() }
    body.appendChild(again)
    return
  }
  box.querySelector('.yc-when').textContent = `${day(res.activatedAt)} – ${day(res.completedAt)}`
  body.innerHTML = ''
  body.appendChild(el('p', 'yc-lede', `What you streamed while restoring ${esc(districtName)}.`))

  // Tracks
  const tracks = res.tracks || []
  const trackPlays = tracks.reduce((s, t) => s + t.plays, 0)
  body.appendChild(line({
    icon: 'music', name: 'Tracks',
    value: tracks.length ? `${fmt(trackPlays)} plays` : '—',
    sub: tracks.length ? `${tracks.length} song${tracks.length === 1 ? '' : 's'}` : 'No track songs in this district',
    detail: tracks.length && trackPlays
      ? `<ul class="yc-list">${[...tracks].sort((a, b) => b.plays - a.plays).map((t) => `<li><span>${esc(t.label)}</span><b>${fmt(t.plays)}</b></li>`).join('')}</ul>`
      : tracks.length ? '<p class="yc-note">No plays of these songs were recorded while you restored it.</p>' : '',
  }))

  // Albums
  const albums = res.albums || []
  const passes = albums.reduce((s, a) => s + a.passes, 0)
  body.appendChild(line({
    icon: 'disc', name: 'Albums',
    value: albums.length ? `${fmt(passes)} pass${passes === 1 ? '' : 'es'}` : '—',
    sub: albums.length ? `${albums.length} album${albums.length === 1 ? '' : 's'}` : 'No albums in this district',
    detail: albums.length ? albums.map((a) => `
      <div class="yc-album">
        <div class="yc-album-head"><span>${esc(a.label)}</span><b>${fmt(a.passes)} pass${a.passes === 1 ? '' : 'es'}</b></div>
        <p class="yc-songs">${a.songs.map((s) => `${esc(s.label)} <i>${fmt(s.plays)}</i>`).join(' · ')}</p>
      </div>`).join('') : '',
  }))

  // ReConnect
  const r = res.reconnect
  const rc = !r ? { value: '—', sub: 'No ReConnect quest in this district', detail: '' }
    : r.state === 'played' && r.plays != null ? {
      value: `${fmt(r.plays)} plays`,
      sub: `Your plays · team of ${r.teamSize || '?'}`,
      detail: `<p class="yc-note">You played the quest songs <b>${fmt(r.plays)}</b> time${r.plays === 1 ? '' : 's'} while on the team. Together, the team's goal was ${esc(r.teamGoal)}${r.completedAt ? `, completed ${esc(day(r.completedAt))}` : ''}.</p>`,
    }
    : r.state === 'played' ? { value: 'Done', sub: `Team of ${r.teamSize || '?'}`, detail: `<p class="yc-note">You helped ${esc(r.teamGoal)}. This quest has no plays to count.</p>` }
    : r.state === 'skipped' ? { value: 'Skipped', sub: 'Quest skipped', detail: '<p class="yc-note">You skipped this district\'s ReConnect quest, so there are no team plays to show.</p>' }
    : r.state === 'solo' ? { value: 'Solved', sub: 'Solo puzzle', detail: '<p class="yc-note">This district\'s ReConnect quest was a solo puzzle, with no team plays.</p>' }
    : { value: '—', sub: 'No team plays recorded', detail: '<p class="yc-note">There\'s no completed ReConnect team for you in this district.</p>' }
  body.appendChild(line({ icon: 'handshake', name: 'ReConnect', ...rc }))
}

/** One overview line; tapping it opens its detail right underneath. */
function line({ icon, name, value, sub, detail }) {
  const row = el('div', 'yc-line')
  const head = el('button', 'yc-line-head')
  head.type = 'button'
  head.innerHTML = `
    <span class="yc-ico">${rcIcon(icon)}</span>
    <span class="yc-name"><b>${esc(name)}</b><small>${esc(sub)}</small></span>
    <span class="yc-value">${esc(value)}</span>
    ${detail ? '<span class="yc-chev" aria-hidden="true">›</span>' : '<span></span>'}`
  row.appendChild(head)
  if (!detail) { head.disabled = true; return row }
  const more = el('div', 'yc-more', detail)
  more.hidden = true
  head.setAttribute('aria-expanded', 'false')
  head.onclick = () => {
    more.hidden = !more.hidden
    head.setAttribute('aria-expanded', String(!more.hidden))
    row.classList.toggle('is-open', !more.hidden)
  }
  row.appendChild(more)
  return row
}
