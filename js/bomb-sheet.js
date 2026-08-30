// The ARMY Bomb, opened up — Red Zone details, ARMY Comms, and the
// success/failure result.
//
// The old general "network vitality" dashboard (bombSheet) is gone: it was
// only ever reachable while a Red Zone was active in the first place (the
// old redZoneCard's "View Red Zone" button was its one entry point), so
// this is a faithful, redesigned replacement of that same reachable
// surface — not a removal of something that was otherwise always visible.
// Personal charge now has its own always-available entry (the ARMY Bomb
// itself when no Red Zone is active, or the small "Personal charge" pill
// screen-world.js keeps showing during one) via agent-charge.js's own
// sheet, untouched by any of this.

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { tickCountdowns } from './countdown.js'
import { chatThread } from './chat-thread.js'
import { personalSignalCopy, interpolateBombColor,
  redZoneBand, redZoneHeadline, redZoneGoalCopy } from './red-zone-ui.js'

/* ── unread ARMY Comms ───────────────────────────────────────────────────
   Per-event, per-device, in localStorage: the number of lines the thread
   held when this agent last had it open. Kept here beside the sheet that
   does the marking rather than in red-zone-ui.js, which stays DOM- and
   storage-free so it can be unit tested in plain Node. */
const COMMS_SEEN_KEY = 'rc_comms_seen'

function commsSeenMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(COMMS_SEEN_KEY) || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch { return {} }
}

export function getCommsSeen(eventId) {
  return Number(commsSeenMap()[String(eventId)]) || 0
}

/** Only ever moves forward. Opening an older archived thread must not make
 *  a newer, busier one look unread again. */
export function markCommsSeen(eventId, count) {
  const id = String(eventId || '')
  if (!id) return
  const total = Math.max(0, Number(count) || 0)
  try {
    const map = commsSeenMap()
    if ((Number(map[id]) || 0) >= total) return
    map[id] = total
    // One event at a time in practice; keep the last few so a resolved
    // event's thread doesn't light up again if it's reopened.
    const ids = Object.keys(map)
    if (ids.length > 8) for (const stale of ids.slice(0, ids.length - 8)) delete map[stale]
    localStorage.setItem(COMMS_SEEN_KEY, JSON.stringify(map))
  } catch { /* private mode — the badge just stays visible */ }
}

function statLine(label, value) {
  return el('div', 'rz-stat-line', `<span>${esc(label)}</span><b>${value}</b>`)
}

function defenderRankingSheet(ranking) {
  const sheet = el('div', 'sheet rz-ranking-sheet')
  sheet.append(
    el('div', 'eyebrow', '🏆 RED ZONE'),
    el('h3', '', 'Defender Ranking'),
    el('p', 'muted', `${Number(ranking?.total || 0).toLocaleString()} ARMY defenders · ranked by counted streams in this event.`),
  )
  const rows = ranking?.leaders || []
  if (!rows.length) {
    sheet.appendChild(el('p', 'dim rz-ranking-empty', 'Rankings appear as streams arrive.'))
  } else {
    const mine = ranking?.yourRank
    if (mine) {
      sheet.appendChild(el('div', 'rz-ranking-mine', `
        <span>Your rank <b>#${Number(mine.rank)}</b></span>
        <strong>${Number(mine.streams).toLocaleString()} streams</strong>
      `))
    }
    const list = el('div', 'rz-ranking-list')
    for (const row of rows) {
      list.appendChild(el('div', `rz-ranking-row${row.isMe ? ' is-me' : ''}`, `
        <b class="rz-rank">#${Number(row.rank)}</b>
        <span>${esc(row.codename)}${row.isMe ? ' <i>YOU</i>' : ''}</span>
        <strong>${Number(row.streams).toLocaleString()} stream${Number(row.streams) === 1 ? '' : 's'}</strong>
      `))
    }
    sheet.appendChild(list)
  }
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/** Player-friendly Red Zone details — no diagnostic/admin terminology, no
 *  event ids, no raw backend state names. Only real data already on
 *  state.bomb.defuse; nothing here is estimated. */
export function redZoneSheet(state) {
  const d = state.bomb?.defuse
  const sheet = el('div', 'sheet redzone-sheet')
  if (!d) {
    // The event resolved between the tap and the sheet opening (a live poll
    // landed in between) — nothing to show as "active" anymore; closing
    // and letting the next render pick up resolvedDefuse is correct, not
    // an error state worth its own copy.
    sheet.append(el('div', 'eyebrow', 'ARMY BOMB'), el('p', 'muted', 'This Red Zone just resolved — closing.'))
    const close0 = el('button', 'btn btn-ghost', 'Close')
    close0.onclick = hideOverlay
    sheet.appendChild(close0)
    return sheet
  }

  // What happened -> what to stream -> how much -> by when -> what it costs
  // if we fail, in that order. The percentage moved out of the title (the
  // Bomb itself is already showing it one tap back) so the title can carry
  // the instruction instead.
  const band = redZoneBand(d.progress, d.target)
  const head = redZoneHeadline(band)
  const goal = redZoneGoalCopy(d, band)
  sheet.append(
    el('div', 'eyebrow alert', `${head.icon} ${head.title}`),
    el('h3', '', 'Protect the ARMY Bomb'),
    el('p', 'muted', `Stream <b>${esc(goal.short)}</b> together before the timer reaches 0.`),
  )
  // The admin's own words for this event, if they wrote any — kept under
  // the generated instruction, never in place of it.
  if (d.message) sheet.appendChild(el('p', 'dim rz-event-note', esc(d.message)))

  const stats = el('div', 'rz-stats')
  stats.appendChild(statLine('CITY STREAMS', esc(goal.progressLine)))
  const signal = personalSignalCopy(d.yourStreams, d.minimumStreams)
  stats.appendChild(statLine('YOUR STREAMS', esc(signal.full)))
  stats.appendChild(el('div', 'rz-stat-line', `<span>TIME LEFT</span><b class="bd-clock" data-deadline="${esc(d.activeUntil)}">--:--:--</b>`))
  // Two different numbers that must never be conflated (see red-zone.js's
  // isDefender vs isQualifiedDefender) — said in words rather than showing
  // one of them and hoping nobody asks about the other.
  const defenders = d.defenderAgents || 0
  const earning = d.qualifiedAgents || 0
  stats.appendChild(statLine('ARMY DEFENDERS', defenders === earning
    ? `${defenders.toLocaleString()} streaming`
    : `${defenders.toLocaleString()} streaming &middot; ${earning.toLocaleString()} earning XP`))
  stats.appendChild(statLine('REWARD', `${d.rewardXp.toLocaleString()} XP shared &middot; Full personal Bomb charge`))
  sheet.appendChild(stats)

  // The one stake worth surfacing without a tap — see the brief's own
  // "make failure visible before it happens" requirement. Deliberately not
  // buried in the collapsed explainer below.
  sheet.appendChild(el('div', 'rz-blackout-warn', `
    <b>IF WE FAIL</b>
    <span>⚫ The City goes into Blackout and every ARMY Bomb loses its charge.</span>
  `))

  const commsBtn = el('button', 'btn btn-ghost rz-comms-btn',
    d.isDefender
      ? `💬 ARMY Comms · ${d.defenderAgents || 0} ARMY defender${d.defenderAgents === 1 ? '' : 's'}`
      : '🔒 ARMY Comms — stream once to unlock')
  commsBtn.disabled = !d.isDefender
  commsBtn.onclick = () => showOverlay(defenderCommsSheet({
    eventId: d.id, progress: d.progress, target: d.target, defenderAgents: d.defenderAgents,
    messageCount: d.messageCount,
  }))
  sheet.appendChild(commsBtn)
  // Same plain-language line the City screen carries — the unlocked state
  // had no explanation at all here. The locked state's own hint below
  // already says both what unlocks it and how that differs from the XP
  // minimum, so it isn't repeated.
  if (d.isDefender) {
    sheet.appendChild(el('p', 'dim rz-comms-sub', 'Chat with other ARMY protecting the Bomb'))
  }
  if (!d.isDefender) {
    sheet.appendChild(el('p', 'dim rz-comms-hint', `Stream once during this Red Zone to join ARMY Comms. Earning a share of the XP takes ${d.minimumStreams} streams — the two are separate.`))
  }

  const rankingBtn = el('button', 'btn btn-ghost rz-ranking-btn',
    `🏆 Defender Ranking · ${Number(d.defenderRanking?.total || 0).toLocaleString()}`)
  rankingBtn.onclick = () => {
    const rankingSheet = defenderRankingSheet(d.defenderRanking)
    showOverlay(rankingSheet)
    // This sheet's only button is Close at the bottom. The shared overlay
    // normally focuses its first button, which would scroll a long ranking
    // straight to the end and hide #1. Keep initial focus and scroll at the
    // top; the list remains independently scrollable.
    requestAnimationFrame(() => {
      rankingSheet.scrollTop = 0
      rankingSheet.focus({ preventScroll: true })
    })
  }
  sheet.appendChild(rankingBtn)

  const how = el('details', 'reconnect-disclosure')
  how.appendChild(el('summary', '', 'How this works ▾'))
  how.appendChild(el('div', 'muted rz-how-body', `
    <p>Stream ${esc(goal.short)}. Everyone's streams add up to one shared goal of ${d.target.toLocaleString()}. Your first ${d.minimumStreams} show as your own progress — hitting ${d.minimumStreams} releases them into the city total and earns you a share of the XP.</p>
    <p>Reach the goal before the timer runs out and the ARMY Bomb is saved: everyone who streamed ${d.minimumStreams} or more shares ${d.rewardXp.toLocaleString()} XP and gets a fully charged personal ARMY Bomb. Run out of time and the City goes dark — every ARMY Bomb charge drops to 0. Nothing else is lost.</p>
  `))
  sheet.appendChild(how)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  tickCountdowns()
  return sheet
}

/** The same red→purple story the Bomb itself tells, reused rather than
 *  reinvented — see this session's own note: no second progress bar, this
 *  is the actual Red Zone progress feeding a soft glow behind the thread
 *  instead of a number. Blackout gets its own dark override rather than
 *  whatever color progress happened to stall at — failure should read as
 *  "the signal is gone", not "68% purple". */
function defenderCommsGlow({ progress, target, blackout }) {
  return blackout ? 'rgb(18, 16, 24)' : interpolateBombColor(progress, target, '#e5384f', '#8b5cf6')
}

/** ARMY Comms — a shared thread scoped to one Red Zone event, opened
 *  from the details sheet above (or from the result sheet, once archived).
 *  Same chat-thread.js component ReConnect's Team Chat uses, in its
 *  'radio' skin (see chat-thread.js and this file's own CSS): a live
 *  emergency channel inside the compromised network, not another
 *  dashboard card, so the chrome stays minimal and the color does the
 *  talking behind it. */
export function defenderCommsSheet({ eventId, progress, target, defenderAgents, messageCount = null, blackout = false }) {
  const sheet = el('div', 'sheet dc-sheet')
  const glow = el('div', 'dc-glow')
  glow.style.setProperty('--dc-bomb', defenderCommsGlow({ progress, target, blackout }))
  sheet.appendChild(glow)

  const count = defenderAgents || 0
  sheet.appendChild(el('div', 'eyebrow dc-head', `💬 ARMY COMMS &middot; ${count} ARMY DEFENDER${count === 1 ? '' : 'S'}`))
  const body = el('div', 'dc-body', '<p class="muted">Opening comms…</p>')
  sheet.appendChild(body)

  const back = el('button', 'dc-close', 'Close')
  back.onclick = hideOverlay
  sheet.appendChild(back)

  async function load() {
    const res = await call('getDefuseMessages', { agentNo: getAgentNo(), eventId })
    if (!res?.success) {
      body.innerHTML = ''
      body.appendChild(el('p', 'muted', esc(res?.error === 'not_a_defender'
        ? 'Stream at least once during this Red Zone to unlock ARMY Comms.'
        : "Couldn't open comms — try again.")))
      return
    }
    body.innerHTML = ''
    // Mark seen against the server's own total where we have it: the thread
    // itself returns at most the newest 50 lines, so counting what came back
    // would leave a busy room permanently showing unread.
    markCommsSeen(eventId, messageCount == null ? (res.messages || []).length : messageCount)
    body.appendChild(chatThread(res.messages, {
      variant: 'radio',
      placeholder: 'Message ARMY defenders…',
      emptyText: 'No messages yet.',
      readOnly: res.readOnly,
      readOnlyNote: blackout ? 'The signal went dark — archived.' : 'Signal restored — archived.',
      onSend: (message) => call('sendDefuseMessage', { agentNo: getAgentNo(), eventId, message }),
      onSent: load,
    }))
  }
  load()
  return sheet
}

/** One-shot success/failure acknowledgement — see screen-world.js's
 *  maybeShowDefuseResult for the localStorage dedup that ensures this is
 *  only ever shown once per event, never replayed on a later poll. */
export function defuseResultSheet(resolved) {
  const sheet = el('div', 'sheet redzone-result-sheet')
  const success = resolved.status === 'defused'
  sheet.append(
    el('div', 'eyebrow' + (success ? '' : ' alert'), success ? '✦ CITY SAVED' : '⚫ BLACKOUT'),
    el('h3', '', success ? 'We protected the ARMY Bomb! 💜' : "We didn't reach the streaming goal in time."),
  )
  if (success) {
    sheet.appendChild(el('p', 'muted', 'The Red Zone has been cleared.'))
    sheet.appendChild(el('p', 'muted', `Your streams: <b>${resolved.yourStreams.toLocaleString()}</b>`))
    sheet.appendChild(el('p', 'muted', resolved.yourXpAwarded > 0
      ? `Your reward: <b>+${resolved.yourXpAwarded.toLocaleString()} XP</b>`
      : `You needed ${resolved.minimumStreams} streams to earn a share — this time you had ${resolved.yourStreams}.`))
    if (resolved.isQualified) sheet.appendChild(el('p', 'muted', 'Your personal ARMY Bomb is now <b>fully charged</b>.'))
  } else {
    sheet.appendChild(el('p', 'muted', 'The City has gone dark and your ARMY Bomb charge is now <b>0</b>.'))
    sheet.appendChild(el('p', 'dim', 'Feed your Bomb to bring it back online. Nothing else was lost.'))
  }

  const viewComms = el('button', 'dc-link', '💬 View ARMY Comms')
  viewComms.onclick = () => showOverlay(defenderCommsSheet({
    eventId: resolved.id, progress: resolved.progress, target: resolved.target,
    defenderAgents: resolved.defenderAgents, blackout: !success,
  }))
  sheet.appendChild(viewComms)

  const close = el('button', 'btn btn-primary', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
