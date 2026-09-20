// ARIRANG RE:CELEBRATE — the live Party page.
//
// A party first, with a battle inside it. Two places to look — BATTLE and
// WATCH (the stage) — and Party Chat as a persistent layer over either one,
// never a place of its own. Desktop shows Battle | Stage | Chat (chat
// collapsible); a phone switches BATTLE · WATCH under one live header, with
// chat as a drawer over the lower part of whichever is showing.
//
// The page builds itself once per visit. The 90s state poll only refreshes
// the header and the agent's Bomb charge, and switching Battle ↔ Watch or
// opening/closing chat only toggles classes — so the YouTube player, the
// chat draft and unread state all survive.
//
// Battle is REAL: it reads getRecelebrateBattle (lib/recelebrate-battle.ts),
// whose totals, leaders, differences and final result are all computed on
// the server from accepted scrobbles. Watch is driven by
// recelebrate-watch-program.js via recelebrate-watch.js. Party Chat is the
// event-scoped shared room implemented in recelebrate-chat.js.

import { el, esc } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWorld } from './router.js'
import { fmtLeft } from './countdown.js'
import {
  ARIRANG_RECELEBRATE, getCachedPartyPass, refreshPartyPassState,
  openLoveSongFlow, openMyPartyPass, continueToSides,
} from './arirang-recelebrate.js'
import { createWatchStage } from './recelebrate-watch.js'
import { createPartyChat } from './recelebrate-chat.js'

const SIDES = {
  hooligans: { name: 'HOOLIGANS', icon: '⚡' },
  aliens: { name: 'ALIENS', icon: '🛸' },
}

// Opening on BATTLE: the scoreboard is what the party is for, and it's the
// one thing an agent can act on the moment they arrive. Watch is a tap away
// (and on desktop both are on screen anyway).
let activeTab = 'battle'
let root = null
let watch = null

export function renderRecelebrateParty(container, state) {
  if (root && root.isConnected && container.contains(root)) {
    paintMe()
    watch?.setCharge(state?.agentCharge)
    return
  }
  container.innerHTML = ''
  root = el('div', `rcp is-tab-${activeTab}`)
  root.append(header(), tabs(), room())
  container.appendChild(root)
  paintMe()
  watch.setCharge(state?.agentCharge)
  syncWatchActive()
  refreshPartyPassState().then(paintMe)
  loadBattle()
  watch.el.addEventListener('rcp-stage-event', pingSoon)
  pingPresence()
}

/* ── Presence: who's here, and who's watching with u ─────────────────────
   A real check-in about once a minute while the page is open and visible
   (lib/recelebrate-presence.ts); counts are agents seen in the last ~2.5
   minutes, so closed tabs fall away on their own. "Watching" is sent only
   while the Watch view is actually on screen. */
const PRESENCE_MS = 60_000
let presenceTimer = null
async function pingPresence() {
  clearTimeout(presenceTimer)
  if (!root?.isConnected) return
  if (!document.hidden) {
    const watchOnScreen = window.matchMedia('(min-width: 980px)').matches || activeTab === 'watch'
    const res = await call('pingRecelebratePresence', {
      agentNo: getAgentNo(), watching: watchOnScreen ? watch?.stageEventId() : null,
    })
    if (res?.success && root?.isConnected) {
      const here = root.querySelector('.rcp-here')
      here.hidden = !res.here
      here.textContent = ` · ${Number(res.here).toLocaleString('en-US')} IN THE PARTY`
      watch?.setPresence(res)
    }
  }
  if (root?.isConnected) presenceTimer = setTimeout(pingPresence, PRESENCE_MS)
}
// Tab switch, stage event change, coming back to the page: check in soon.
function pingSoon() {
  clearTimeout(presenceTimer)
  presenceTimer = setTimeout(pingPresence, 2500)
}
document.addEventListener('visibilitychange', () => { if (root?.isConnected && !document.hidden) pingSoon() })

// On a phone showing Battle (or a hidden tab) the stage keeps its player —
// and audio — but stops spending frames on the venue.
function syncWatchActive() {
  const desktop = window.matchMedia('(min-width: 980px)').matches
  watch?.setActive(!document.hidden && (desktop || activeTab === 'watch'))
}
document.addEventListener('visibilitychange', () => { if (root?.isConnected) syncWatchActive() })
window.matchMedia('(min-width: 980px)').addEventListener?.('change', () => { if (root?.isConnected) syncWatchActive() })

let battleTimer = null
const BATTLE_POLL_MS = 60_000

// The server only rescans at most every 20s however many agents are
// watching; a minute here keeps the board fresh without hammering it.
async function loadBattle() {
  clearTimeout(battleTimer)
  const res = await call('getRecelebrateBattle', { agentNo: getAgentNo() })
  const area = root?.querySelector('.rcp-battle')
  if (!area?.isConnected) return
  area.replaceWith(res?.success && res.battle ? battleArea(res.battle, res.me) : battleUnavailable())
  battleTimer = setTimeout(() => { if (root?.isConnected) loadBattle() }, BATTLE_POLL_MS)
}

window.addEventListener('rc-arc-pass', () => { if (root?.isConnected) paintMe() })

/* ── Header: identity, live clock, the agent's own side + pass ─────────── */

function header() {
  const endsLeft = new Date(ARIRANG_RECELEBRATE.endsAtIso).getTime() - Date.now()
  const head = el('header', 'rcp-head')
  head.innerHTML = `
    <div class="rcp-head-bg" aria-hidden="true"></div>
    <button type="button" class="back-btn rcp-back">City</button>
    <div class="rcp-titles">
      <div class="rcp-name">ARIRANG RE:CELEBRATE <span>✦</span></div>
      <div class="rcp-live"><i></i>PARTY LIVE ✦<span class="rcp-here" hidden></span></div>
    </div>
    <div class="rcp-clock">
      <span>ENDS IN</span>
      <b data-deadline="${ARIRANG_RECELEBRATE.endsAtIso}">${fmtLeft(endsLeft)}</b>
    </div>
    <div class="rcp-me"></div>
  `
  head.querySelector('.rcp-back').onclick = (e) => goWorld({ x: e.clientX, y: e.clientY })
  return head
}

// The agent's own corner of the header: side + pass, or the way in if they
// arrived during the party without a pass / before picking a side.
function paintMe() {
  paintBattleMe()
  const me = root?.querySelector('.rcp-me')
  if (!me) return
  const pass = getCachedPartyPass()
  me.innerHTML = ''
  if (pass === undefined) return
  if (!pass) {
    const join = el('button', 'rcp-join', 'U MADE IT ♡ <b>GET UR PARTY PASS →</b>')
    join.type = 'button'
    join.onclick = openLoveSongFlow
    me.appendChild(join)
    return
  }
  if (pass.team) {
    const s = SIDES[pass.team]
    me.appendChild(el('span', `arc-side-tag is-${pass.team}`, `${s.icon} ${s.name}`))
  } else {
    const pick = el('button', 'rcp-join', '<b>CHOOSE UR SIDE →</b>')
    pick.type = 'button'
    pick.onclick = continueToSides
    me.appendChild(pick)
  }
  const passBtn = el('button', 'rcp-pass-btn', 'MY PARTY PASS ♡')
  passBtn.type = 'button'
  passBtn.onclick = openMyPartyPass
  me.appendChild(passBtn)
}

/* ── Mobile switcher ────────────────────────────────────────────────────── */

function tabs() {
  const nav = el('nav', 'rcp-tabs')
  nav.setAttribute('aria-label', 'Party areas')
  for (const [key, label] of [['battle', 'BATTLE'], ['watch', 'WATCH']]) {
    const b = el('button', `rcp-tab${key === activeTab ? ' is-on' : ''}`, label)
    b.type = 'button'
    b.dataset.tab = key
    b.onclick = () => {
      activeTab = key
      root.classList.remove('is-tab-battle', 'is-tab-watch')
      root.classList.add(`is-tab-${key}`)
      nav.querySelectorAll('.rcp-tab').forEach((x) => x.classList.toggle('is-on', x === b))
      syncWatchActive()
      pingSoon()
    }
    nav.appendChild(b)
  }
  return nav
}

function room() {
  const r = el('div', 'rcp-room')
  watch = createWatchStage({
    partyEndsAtIso: ARIRANG_RECELEBRATE.endsAtIso,
  })
  const chat = createPartyChat({
    getSide: () => getCachedPartyPass()?.team || null,
    // Phone, Watch tab: the drawer covers the lower screen, so bring the
    // stage to the top — the performance stays visible above the chat.
    onOpen: () => {
      if (activeTab === 'watch' && !window.matchMedia('(min-width: 980px)').matches) {
        watch.el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }
    },
  })
  r.append(battleLoading(), watch.el, chat.el)
  return r
}

// Review aid for local dev builds only (never in production): paint a
// stage moment without playing the video.
if (import.meta.env.DEV) window.__rcpWatch = () => watch

/* ── BATTLE ─────────────────────────────────────────────────────────────
   17 separate track battles. Live, the headline is tracks CURRENTLY LEADING
   (never "won" until the event has actually ended); once the server freezes
   the result it becomes FINAL · TRACKS WON. Each row shows both stream
   totals and the raw difference — a 5,000-stream win is still one track. */

const fmt = (n) => Number(n || 0).toLocaleString('en-US')

// Someone arriving mid-party has never seen the rules, so the explainer
// starts open; once an agent closes it, it stays a one-line header on this
// device. The battle panel is rebuilt on every poll, so the state lives here.
const HOW_KEY = 'rc-rcp-battle-how-closed'
let howOpen = (() => { try { return localStorage.getItem(HOW_KEY) !== '1' } catch { return true } })()
const MINE_KEY = 'rc-rcp-my-streams-open'
let mineOpen = (() => { try { return localStorage.getItem(MINE_KEY) === '1' } catch { return false } })()

// Mirrors the server's rules (lib/recelebrate-battle.ts and the
// rc_recelebrate_battle migration): 17 tracks, plays from the agent's own
// selected source after their side is set, inside the 24h window; most
// tracks wins, tied tracks go to total streams, late syncs until 11:00 IST.
const HOW_IT_WORKS = `
  <details class="rcp-how"${howOpen ? ' open' : ''}>
    <summary>HOW THE BATTLE WORKS</summary>
    <ol class="rcp-how-steps">
      <li><b>Pick a side.</b><br>⚡ Hooligans or 🛸 Aliens.</li>
      <li><b>There are 17 tracks.</b><br>Every stream you make on any of the 17 tracks adds <b>1 stream to ur side</b> for that track.</li>
      <li><b>Win as many tracks as possible.</b><br>Whichever side has more streams on a track <b>wins that track</b>.
        The side that wins <mark>the most tracks out of 17</mark> wins RE:CELEBRATE.</li>
      <li><b>If both sides win the same number of tracks:</b><br>The side with <b>more total streams across all 17 tracks</b> wins.</li>
      <li><b>The battle lasts 24 hours.</b><br>Sept 20, 9:30 AM IST → Sept 21, 9:30 AM IST.
        Late syncs are accepted until <b>11:00 AM IST</b>, then the result is final.</li>
    </ol>
    <p class="rcp-how-note">Only streams from the account/source connected to ReConnect count. Streams made <b>before u picked ur side</b> and ads don't count.</p>
    <p class="rcp-how-foot"><b>Ur streams still count everywhere else in ReConnect ✦</b></p>
  </details>`

function battleShell(inner) {
  const sec = el('section', 'rcp-area rcp-battle')
  sec.setAttribute('aria-label', 'Hooligans vs Aliens battle')
  sec.innerHTML = `<div class="rcp-area-head"><span class="rcp-area-title">HOOLIGANS vs ALIENS</span></div>
    <div class="rcp-battle-me" aria-live="polite"></div>${HOW_IT_WORKS}${inner}`
  sec.querySelector('.rcp-how').addEventListener('toggle', (e) => {
    howOpen = e.currentTarget.open
    try { localStorage.setItem(HOW_KEY, howOpen ? '0' : '1') } catch { /* per-visit only */ }
  })
  sec.querySelector('.rcp-mine')?.addEventListener('toggle', (e) => {
    mineOpen = e.currentTarget.open
    try { localStorage.setItem(MINE_KEY, mineOpen ? '1' : '0') } catch { /* per-visit only */ }
  })
  queueMicrotask(paintBattleMe)
  return sec
}

// The agent's own place in the battle: whether their streams are counting,
// and for whom — or the one step they're missing.
function paintBattleMe() {
  const slot = root?.querySelector('.rcp-battle-me')
  if (!slot) return
  const pass = getCachedPartyPass()
  slot.innerHTML = ''
  slot.className = 'rcp-battle-me'
  if (pass === undefined) return
  if (pass?.team) {
    const s = SIDES[pass.team]
    slot.classList.add(`is-${pass.team}`)
    slot.innerHTML = `Ur streams count for <b>${s.icon} ${s.name}</b> ✦`
    return
  }
  const b = el('button', 'rcp-battle-me-cta', pass
    ? "Ur streams aren't counting yet — <b>pick ur side →</b>"
    : "U're not in the battle yet — <b>get ur Party Pass &amp; pick a side →</b>")
  b.type = 'button'
  b.onclick = pass ? continueToSides : openLoveSongFlow
  slot.appendChild(b)
}

function battleLoading() {
  return battleShell('<div class="rcp-battle-empty">Loading the scoreboard…</div>')
}

function battleUnavailable() {
  return battleShell(`<div class="rcp-battle-empty">Scoreboard unavailable right now — it'll refresh on its own.</div>`)
}

function battleArea(b, me) {
  const final = b.status === 'final'
  const h = final ? b.hooligansWon : b.hooligansLeading
  const a = final ? b.aliensWon : b.aliensLeading
  const label = final ? 'FINAL · TRACKS WON'
    : b.status === 'counting' ? 'COUNTING FINAL STREAMS'
    : b.status === 'upcoming' ? 'STARTS 9:30 AM IST'
    : 'CURRENTLY LEADING'
  const note = final
    ? finalNote(b)
    : b.status === 'counting'
      ? 'The 24 hours are up · late syncs are still landing · result freezes soon'
      : b.status === 'upcoming'
        ? '17 track battles · every qualifying stream counts for ur side'
        : `17 track battles · ends 9:30 AM IST, Sept 21${b.tiedTracks ? ` · ${b.tiedTracks} tied` : ''}`

  const rows = (b.tracks || []).map((t) => {
    const lead = t.leader
    const side = lead === 'hooligans' ? 'HOOLIGANS' : lead === 'aliens' ? 'ALIENS' : null
    const state = !side ? 'TIED' : final ? `${side} WIN +${fmt(t.difference)}` : `${side} +${fmt(t.difference)}`
    return `
      <li class="rcp-track lead-${lead}">
        <span class="rcp-track-no">${String(t.position).padStart(2, '0')}</span>
        <span class="rcp-track-title">${esc(t.title)}</span>
        <span class="rcp-track-n is-h">⚡ ${fmt(t.hooligans)}</span>
        <span class="rcp-track-n is-a">🛸 ${fmt(t.aliens)}</span>
        <span class="rcp-track-state">${state}</span>
      </li>`
  }).join('')

  return battleShell(`
    <div class="rcp-score${final ? ' is-final' : ''}">
      <div class="rcp-score-label">${label}</div>
      <div class="rcp-score-line">
        <span class="rcp-score-side is-hooligans">⚡ <b>${h}</b></span>
        <span class="rcp-score-dash">—</span>
        <span class="rcp-score-side is-aliens"><b>${a}</b> 🛸</span>
      </div>
      <div class="rcp-score-names"><span>HOOLIGANS</span><span>ALIENS</span></div>
    </div>
    <div class="rcp-strip" aria-hidden="true">
      ${(b.tracks || []).map((t) => `<i class="is-${t.leader}"></i>`).join('')}
    </div>
    ${myStreamsBlock(b, me)}
    ${nextMoveBlock(b)}
    <div class="rcp-battle-note">${note}</div>
    <ol class="rcp-tracks">${rows}</ol>
  `)
}

// The agent's own counted streams, from the same ledger the scoreboard adds
// up (getRecelebrateBattle's `me`). Shown once they have a side; a plain 0
// is honest — it means nothing has qualified yet, not that it's broken.
function myStreamsBlock(b, me) {
  const pass = getCachedPartyPass()
  if (!me || !pass?.team) return ''
  const side = SIDES[pass.team]
  const titles = new Map((b.tracks || []).map((t) => [t.trackId, t.title]))
  // Every track they've actually counted on, most played first — not a top
  // three: an agent who streamed all 17 should see all 17.
  const counted = Object.entries(me.byTrack || {}).sort((x, y) => y[1] - x[1])
  const top = counted
    .map(([id, n]) => `<li><span>${esc(titles.get(id) || id)}</span><b>${fmt(n)}</b></li>`).join('')
  return `
    <details class="rcp-mine is-${pass.team}"${mineOpen ? ' open' : ''}>
      <summary>
        <span class="rcp-mine-copy">
          <span class="rcp-mine-label">YOUR STREAMS</span>
          <span class="rcp-mine-sub">${me.total
            ? `${counted.length} of 17 tracks · ${side.icon} ${side.name}`
            : `Nothing counted yet · ${side.icon} ${side.name}`}</span>
        </span>
        <b class="rcp-mine-total">${fmt(me.total)}</b>
        <span class="rcp-mine-toggle"><span class="when-closed">VIEW</span><span class="when-open">HIDE</span></span>
      </summary>
      <div class="rcp-mine-body">
        <div class="rcp-mine-help">Counted track breakdown</div>
        ${top ? `<ul class="rcp-mine-tracks">${top}</ul>` : '<p class="rcp-mine-empty">Stream any battle track to start your list.</p>'}
      </div>
    </details>`
}

// One useful decision from the existing scoreboard, without inventing a new
// goal system. It answers “what should I stream next?” at a glance and stays
// deliberately smaller than the actual battle score.
function nextMoveBlock(b) {
  if (b.status !== 'active') return ''
  const pass = getCachedPartyPass()
  if (!pass?.team || !Array.isArray(b.tracks) || !b.tracks.length) return ''
  const us = pass.team
  const other = us === 'hooligans' ? 'aliens' : 'hooligans'
  const icon = SIDES[us].icon
  const tracks = b.tracks.map((t) => ({ ...t, margin: Number(t[us] || 0) - Number(t[other] || 0) }))
  const needsHelp = tracks.filter((t) => t.margin <= 0).sort((a, z) => z.margin - a.margin)[0]
  if (needsHelp) {
    const needed = 1 - needsHelp.margin
    return `<div class="rcp-next"><span>CLOSEST TRACK TO FLIP</span><b>${esc(needsHelp.title)}</b><small>${fmt(needed)} more ${needed === 1 ? 'stream puts' : 'streams put'} ${icon} ahead</small></div>`
  }
  const narrowest = tracks.sort((a, z) => a.margin - z.margin)[0]
  return `<div class="rcp-next"><span>PROTECT THIS LEAD</span><b>${esc(narrowest.title)}</b><small>${icon} ahead by ${fmt(narrowest.margin)}</small></div>`
}

function finalNote(b) {
  if (b.winner === 'draw') return 'A perfect draw — even total streams matched'
  const who = b.winner === 'hooligans' ? '⚡ HOOLIGANS' : '🛸 ALIENS'
  return b.decidedBy === 'total_streams'
    ? `${who} WIN RE:CELEBRATE · tracks level, decided on total streams (${fmt(b.totalHooligans)} – ${fmt(b.totalAliens)})`
    : `${who} WIN RE:CELEBRATE ✦`
}
