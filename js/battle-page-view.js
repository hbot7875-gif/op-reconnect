// Public MAMA Battle page — markup only (battle-page.js fetches and refreshes).
// Shows the public battle summary and nothing about any agent. With
// ?team=hooligans|aliens it is that side's recruit page: the same live
// numbers, led by the side that sent the link.
import { battleView, recruitView, bonusRule, LYRICS, RECRUIT, kstWhen } from './battle-share-rules.js'

export const JOIN_URL = '/game?screen=voting'
/** "Join ALIENS" carries the team into the game, where it only marks the
 *  chooser's button as "Your invite" — the agent still picks. */
export const joinUrl = (team) => (team ? `${JOIN_URL}&team=${team}` : JOIN_URL)

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')

const ICONS = {
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>',
}
const ic = (n) => `<svg class="bp-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[n]}</svg>`

const HEADLINE = { soon: 'The MAMA Battle is back', open: 'The MAMA Battle is live', verifying: 'Voting is closed', final: 'The final score is in' }
function lead(v) {
  if (v.phase === 'soon') return `Round 2 — the Daesang vote — opens ${v.opens || 'soon'}. ARMY, pick your side before it starts.`
  if (v.phase === 'verifying') return `Votes are being verified. The final score lands ${v.finalAt}.`
  if (v.phase === 'final') return 'Every vote went to BTS. Thank you, ARMY.'
  return 'ARMY, pick your side. Vote for BTS. Move the score.'
}

function teamRow(v, team) {
  const soon = v.phase === 'soon'
  const leads = v.leader === team.id && !v.winners
  const won = v.winners?.length === 1 && v.winners[0] === team.id
  const badge = won ? 'WINNER' : leads ? `LEADS +${fmt(v.gap)}` : soon && team.recruits ? `+${fmt(team.recruits)} NEW` : ''
  const bonus = !soon && team.bonus ? `<span class="bp-badge">+${fmt(team.bonus)} RECRUIT BONUS</span>` : ''
  return `<div class="bp-team bp-${team.id}">
    <div class="bp-name">${esc(team.label)}${badge ? `<span class="bp-badge">${badge}</span>` : ''}${bonus}</div>
    <div class="bp-pts" data-bp-score="${team.id}">${fmt(v.shown(team))}${soon ? '<small>agents</small>' : ''}</div>
    <div class="bp-ly">“${esc(LYRICS[team.id] || '')}”</div>
  </div>`
}

function giftBar(summary, v) {
  const next = summary.next
  if (v.phase === 'soon') return next ? `<div class="bp-gift"><div class="bp-gift-k">First Battle Gift · ${fmt(next.target)} votes <span>opens with voting</span></div></div>` : ''
  const prev = [0, ...(summary.milestones || []).filter((m) => m.reached).map((m) => m.target)].pop()
  const pct = next ? Math.max(0, Math.min(100, Math.round(((v.total - prev) / (next.target - prev)) * 100))) : 100
  if (next) {
    return `<div class="bp-gift"><div class="bp-gift-k">Next Battle Gift · ${fmt(next.target)} <span>${fmt(next.remaining)} to go</span></div>
      <div class="bp-bar" role="progressbar" aria-label="Community progress to the next Battle Gift" aria-valuemin="0" aria-valuemax="${next.target}" aria-valuenow="${v.total}"><i style="width:${pct}%"></i></div></div>`
  }
  return (summary.milestones || []).length ? '<div class="bp-gift"><div class="bp-gift-k">All Battle Gifts unlocked</div></div>' : ''
}

function pill(v) {
  const live = v.phase === 'open' || v.phase === 'soon'
  const word = v.phase === 'soon' ? 'RECRUITING' : v.phase === 'open' ? 'LIVE' : v.phase === 'final' ? 'FINAL' : 'CLOSED'
  // RECRUITING is long: its pill drops "updated" so it fits a 320px phone.
  return `<span class="bp-pill${live ? ' is-live' : ''}"><i></i>${word} · ${v.phase === 'soon' ? '' : 'updated '}${esc(v.clock)} KST</span>`
}

const HOW = '<section class="bp-how"><h2>How it works</h2><p>Join ReConnect, pick HOOLIGANS or ALIENS in 7 seconds (Round 1 sides carry over), then vote for BTS on Mnet and X. Every verified vote moves your side — and goes to BTS.</p></section>'

function fine(v) {
  return `<p class="bp-fine">Unofficial ARMY fan project · Scores are verified ReConnect votes · Voting ${v.phase === 'soon' ? `opens ${esc(v.opens || 'soon')}` : `closes ${esc(kstWhen(v.closesAt))}`}.</p>`
}

/** The page body for one public battle summary — or, with a team, that
 *  side's recruit page. */
export function battlePageHtml(summary, now = new Date(), team = null) {
  if (team) return recruitPageHtml(summary, now, team)
  const v = { ...battleView(summary, now), closesAt: summary.closesAt }
  const join = v.phase === 'open' || v.phase === 'soon'
  return `<header class="bp-nav"><a class="bp-brand" href="/">RECONNECT</a>${pill(v)}</header>
    <h1>${HEADLINE[v.phase] || HEADLINE.open}</h1>
    <p class="bp-lead">${esc(lead(v))}</p>
    <section class="bp-card" aria-label="${v.phase === 'soon' ? 'Agents on each side' : 'Score'}">${teamRow(v, v.h)}${teamRow(v, v.a)}</section>
    <p class="bp-status" data-bp-leader="${v.leader || 'tied'}">${esc(v.status)}</p>
    <div class="bp-facts">
      <div>${v.phase === 'soon' ? 'Agents ready' : 'Community votes'}<b>${fmt(v.phase === 'soon' ? (v.h.agents || 0) + (v.a.agents || 0) : v.total)}</b></div>
      <div>${v.phase === 'soon' ? 'Voting opens in' : join ? 'Time left' : 'Final score'}<b>${v.phase === 'soon' ? esc(v.startsIn || 'soon') : join ? esc((v.left || '').replace(' left', '')) : v.phase === 'final' ? 'In' : esc(v.finalAt)}</b></div>
    </div>
    ${giftBar(summary, v)}
    ${bonusRule(v.recruitBonus) && v.phase !== 'final' ? `<p class="bp-bonus">★ Recruit bonus: ${esc(bonusRule(v.recruitBonus))}.</p>` : ''}
    ${join ? `<div class="bp-pick">${['hooligans', 'aliens'].map((id) => `<a class="bp-btn bp-join bp-${id}" href="${joinUrl(id)}">${ic('swords')}Join ${esc((id === 'aliens' ? v.a : v.h).label)}</a>`).join('')}</div>`
      : `<a class="bp-btn bp-pri" href="/game">${ic('swords')}Open ReConnect</a>`}
    <button class="bp-btn bp-sec" type="button" data-bp-share>${ic('share')}Share battle</button>
    ${HOW}
    ${fine(v)}`
}

/** One side's recruit page: the side that sent the link leads. */
export function recruitPageHtml(summary, now, team) {
  const rv = { ...recruitView(summary, team, now), closesAt: summary.closesAt }
  const me = rv.team
  const join = rv.phase === 'open' || rv.phase === 'soon'
  const words = RECRUIT[me.id]
  const verb = rv.phase === 'open' ? 'need you' : join ? 'are recruiting' : rv.winners?.length === 1 && rv.winners[0] === me.id ? 'won' : ''
  return `<header class="bp-nav"><a class="bp-brand" href="/">RECONNECT</a>${pill(rv)}</header>
    <p class="bp-kicker">MAMA Battle · ${esc(summary.roundLabel || 'Round 2')}</p>
    <h1 class="bp-${me.id}"><span class="bp-tname">${esc(me.label)}</span>${esc(verb)}</h1>
    <p class="bp-lead">${esc(words.pitch)}${rv.phase === 'soon' ? ` Voting opens ${esc(rv.opens || 'soon')}.` : ''}</p>
    <section class="bp-card bp-recruit bp-${me.id}" aria-label="${esc(me.label)}">
      <div class="bp-r-big">${fmt(rv.phase === 'soon' ? me.agents : me.points)}<small>${rv.phase === 'soon' ? 'agents ready' : 'verified votes'}</small></div>
      <div class="bp-r-sub">${esc((rv.phase === 'soon' ? rv.recruitsLine : rv.standing || rv.status).toLowerCase())} · vs ${esc(rv.rival.label)} ${fmt(rv.phase === 'soon' ? rv.rival.agents : rv.rival.points)}</div>
      <p class="bp-r-hype">${rv.hype.map(esc).join(' ')}</p>
    </section>
    ${rv.bonusLine && join ? `<p class="bp-bonus">★ ${esc(rv.bonusLine)}.${rv.bonus?.bonus ? ` ${esc(me.label)} have earned +${fmt(rv.bonus.bonus)} so far.` : ''} ${esc(rv.bonus ? `${rv.bonus.toNext} more for the next point.` : '')}</p>` : ''}
    ${join ? `<a class="bp-btn bp-join bp-${me.id}" href="${joinUrl(me.id)}">${ic('swords')}Join ${esc(me.label)}</a>` : `<a class="bp-btn bp-pri" href="/game">${ic('swords')}Open ReConnect</a>`}
    <button class="bp-btn bp-sec" type="button" data-bp-share>${ic('share')}Share the ${esc(me.label)} link</button>
    <a class="bp-alt" href="/battle">See the whole battle →</a>
    ${HOW}
    ${fine(rv)}`
}

export function battleUnavailableHtml(kind) {
  const msg = kind === 'none' ? 'There’s no MAMA Battle running right now.' : 'The battle score couldn’t load. Refresh to try again.'
  return `<header class="bp-nav"><a class="bp-brand" href="/">RECONNECT</a></header>
    <h1>MAMA Battle</h1><p class="bp-lead">${msg}</p><a class="bp-btn bp-pri" href="/">Open ReConnect</a>`
}
