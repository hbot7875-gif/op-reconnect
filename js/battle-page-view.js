// Public MAMA Battle page — markup only (battle-page.js fetches and refreshes).
// Shows the public battle summary and nothing about any agent.
import { battleView, LYRICS } from './battle-share-rules.js'

export const JOIN_URL = '/game?screen=voting'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')

const ICONS = {
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
}
const ic = (n) => `<svg class="bp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[n]}</svg>`

const HEADLINE = { open: 'The MAMA Battle is live', verifying: 'Voting is closed', final: 'The final score is in' }
const LEAD = {
  open: 'ARMY, pick your side. Vote for BTS. Move the score.',
  verifying: 'Votes are being verified. The final score lands Oct 23, 12:00 KST.',
  final: 'Every vote went to BTS. Thank you, ARMY.',
}

function teamRow(v, team) {
  const leads = v.leader === team.id && !v.winners
  const won = v.winners?.length === 1 && v.winners[0] === team.id
  const badge = won ? 'WINNER' : leads ? `LEADS +${fmt(v.gap)}` : ''
  return `<div class="bp-team bp-${team.id}">
    <div class="bp-name">${esc(team.label)}${badge ? `<span class="bp-badge">${badge}</span>` : ''}</div>
    <div class="bp-pts" data-bp-score="${team.id}">${fmt(team.points)}</div>
    <div class="bp-ly">“${esc(LYRICS[team.id] || '')}”</div>
  </div>`
}

/** The page body for one public battle summary. */
export function battlePageHtml(summary, now = new Date()) {
  const v = battleView(summary, now)
  const next = summary.next
  const prev = [0, ...(summary.milestones || []).filter((m) => m.reached).map((m) => m.target)].pop()
  const pct = next ? Math.max(0, Math.min(100, Math.round(((v.total - prev) / (next.target - prev)) * 100))) : 100
  const live = v.phase === 'open'
  return `<header class="bp-nav"><a class="bp-brand" href="/">RECONNECT</a>
      <span class="bp-pill${live ? ' is-live' : ''}"><i></i>${live ? 'LIVE' : v.phase === 'final' ? 'FINAL' : 'CLOSED'} · updated ${esc(v.clock)} KST</span></header>
    <h1>${HEADLINE[v.phase] || HEADLINE.open}</h1>
    <p class="bp-lead">${LEAD[v.phase] || LEAD.open}</p>
    <section class="bp-card" aria-label="Score">${teamRow(v, v.h)}${teamRow(v, v.a)}</section>
    <p class="bp-status" data-bp-leader="${v.leader || 'tied'}">${esc(v.status)}</p>
    <div class="bp-facts">
      <div>Community votes<b>${fmt(v.total)}</b></div>
      <div>${live ? 'Time left' : 'Final score'}<b>${live ? esc((v.left || '').replace(' left', '')) : v.phase === 'final' ? 'In' : 'Oct 23, 12:00 KST'}</b></div>
    </div>
    ${next ? `<div class="bp-gift"><div class="bp-gift-k">Next Battle Gift · ${fmt(next.target)} <span>${fmt(next.remaining)} to go</span></div>
      <div class="bp-bar" role="progressbar" aria-label="Community progress to the next Battle Gift" aria-valuemin="0" aria-valuemax="${next.target}" aria-valuenow="${v.total}"><i style="width:${pct}%"></i></div></div>`
      : (summary.milestones || []).length ? '<div class="bp-gift"><div class="bp-gift-k">All Battle Gifts unlocked</div></div>' : ''}
    ${live ? `<a class="bp-btn bp-pri" href="${JOIN_URL}">${ic('swords')}Join the Battle</a>` : `<a class="bp-btn bp-pri" href="/game">${ic('swords')}Open ReConnect</a>`}
    <button class="bp-btn bp-sec" type="button" data-bp-share>${ic('share')}Share battle</button>
    <section class="bp-how"><h2>How it works</h2><p>Join ReConnect, pick HOOLIGANS or ALIENS in 7 seconds, then vote for BTS on Mnet and X. Every verified vote moves your side.</p></section>
    <p class="bp-fine">Unofficial ARMY fan project · Scores are verified ReConnect votes · Voting closes Oct 22, 23:59 KST.</p>`
}

export function battleUnavailableHtml(kind) {
  const msg = kind === 'none' ? 'There’s no MAMA Battle running right now.' : 'The battle score couldn’t load. Refresh to try again.'
  return `<header class="bp-nav"><a class="bp-brand" href="/">RECONNECT</a></header>
    <h1>MAMA Battle</h1><p class="bp-lead">${msg}</p><a class="bp-btn bp-pri" href="/">Open ReConnect</a>`
}
