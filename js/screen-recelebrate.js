// ARIRANG RE:CELEBRATE — the live Party page (shell).
//
// A party first, with a battle inside it: the Watch stage is the room's
// centrepiece, Battle and Chat sit either side of it on desktop, and on a
// phone they share one persistent live header with BATTLE · WATCH · CHAT
// switching between them. Watch and Chat are still shells: their programme
// slots and chat lines come from recelebrate-preview-data.js, and nothing
// here writes anywhere.
//
// The 90s state poll re-renders the active screen; this page only builds
// itself once per visit and afterwards just refreshes the header, so a
// playing video, the chosen tab and a half-typed chat line all survive it.
//
// Battle is REAL: it reads getRecelebrateBattle (lib/recelebrate-battle.ts),
// whose totals, leaders, differences and final result are all computed on
// the server from accepted scrobbles. The browser only draws them.

import { el, esc } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWorld } from './router.js'
import { fmtLeft } from './countdown.js'
import {
  ARIRANG_RECELEBRATE, getCachedPartyPass, refreshPartyPassState,
  openLoveSongFlow, openMyPartyPass, continueToSides,
} from './arirang-recelebrate.js'
import { PREVIEW_PROGRAM, PREVIEW_CHAT } from './recelebrate-preview-data.js'

const SIDES = {
  hooligans: { name: 'HOOLIGANS', icon: '⚡' },
  aliens: { name: 'ALIENS', icon: '🛸' },
}

let activeTab = 'watch'
let localChat = []
let root = null

export function renderRecelebrateParty(container, state) {
  lastState = state
  if (root && root.isConnected && container.contains(root)) {
    paintMe()
    paintMyBomb()
    return
  }
  container.innerHTML = ''
  root = el('div', `rcp is-tab-${activeTab}`)
  root.append(header(), tabs(), room())
  container.appendChild(root)
  paintMe()
  paintMyBomb()
  refreshPartyPassState().then(paintMe)
  loadBattle()
}

let lastState = null
let battleTimer = null
const BATTLE_POLL_MS = 60_000

// The server only rescans at most every 20s however many agents are
// watching; a minute here keeps the board fresh without hammering it.
async function loadBattle() {
  clearTimeout(battleTimer)
  const res = await call('getRecelebrateBattle', { agentNo: getAgentNo() })
  const area = root?.querySelector('.rcp-battle')
  if (!area?.isConnected) return
  area.replaceWith(res?.success && res.battle ? battleArea(res.battle) : battleUnavailable())
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
      <div class="rcp-live"><i></i>PARTY LIVE ✦</div>
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
  for (const [key, label] of [['battle', 'BATTLE'], ['watch', 'WATCH'], ['chat', 'CHAT']]) {
    const b = el('button', `rcp-tab${key === activeTab ? ' is-on' : ''}`, label)
    b.type = 'button'
    b.dataset.tab = key
    b.onclick = () => {
      activeTab = key
      root.className = `rcp is-tab-${key}`
      nav.querySelectorAll('.rcp-tab').forEach((x) => x.classList.toggle('is-on', x === b))
    }
    nav.appendChild(b)
  }
  return nav
}

function room() {
  const r = el('div', 'rcp-room')
  r.append(battleLoading(), watchArea(), chatArea())
  return r
}

/* ── BATTLE ─────────────────────────────────────────────────────────────
   17 separate track battles. Live, the headline is tracks CURRENTLY LEADING
   (never "won" until the event has actually ended); once the server freezes
   the result it becomes FINAL · TRACKS WON. Each row shows both stream
   totals and the raw difference — a 5,000-stream win is still one track. */

const fmt = (n) => Number(n || 0).toLocaleString('en-US')

function battleShell(inner) {
  const sec = el('section', 'rcp-area rcp-battle')
  sec.setAttribute('aria-label', 'Hooligans vs Aliens battle')
  sec.innerHTML = `<div class="rcp-area-head"><span class="rcp-area-title">HOOLIGANS vs ALIENS</span></div>${inner}`
  return sec
}

function battleLoading() {
  return battleShell('<div class="rcp-battle-empty">Loading the scoreboard…</div>')
}

function battleUnavailable() {
  return battleShell(`<div class="rcp-battle-empty">Scoreboard unavailable right now — it'll refresh on its own.</div>`)
}

function battleArea(b) {
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
    <div class="rcp-battle-note">${note}</div>
    <ol class="rcp-tracks">${rows}</ol>
  `)
}

function finalNote(b) {
  if (b.winner === 'draw') return 'A perfect draw — even total streams matched'
  const who = b.winner === 'hooligans' ? '⚡ HOOLIGANS' : '🛸 ALIENS'
  return b.decidedBy === 'total_streams'
    ? `${who} WIN RE:CELEBRATE · tracks level, decided on total streams (${fmt(b.totalHooligans)} – ${fmt(b.totalAliens)})`
    : `${who} WIN RE:CELEBRATE ✦`
}

/* ── WATCH — the stage ──────────────────────────────────────────────────
   Framed like the landmark: a white LED frame on a red-lit stage with the
   crowd's ARMY Bombs below. The video is a click-to-load privacy-enhanced
   YouTube embed (the same youtube-nocookie source ambient.js already uses)
   — nothing is downloaded or rehosted. Sync comes later. */

function watchArea() {
  const now = PREVIEW_PROGRAM.find((p) => p.slot === 'now')
  const sec = el('section', 'rcp-area rcp-watch')
  sec.setAttribute('aria-label', 'Watch party stage')
  sec.innerHTML = `
    <div class="rcp-stage">
      <div class="rcp-stage-col is-l" aria-hidden="true"></div>
      <div class="rcp-stage-col is-r" aria-hidden="true"></div>
      <div class="rcp-frame">
        <div class="rcp-screen">
          <button type="button" class="rcp-play" aria-label="Play ${esc(now.title)} ${esc(now.sub)}">
            <img alt="" src="https://i.ytimg.com/vi/${now.youtubeId}/hqdefault.jpg" loading="lazy">
            <span class="rcp-play-btn">▶</span>
          </button>
        </div>
      </div>
      <div class="rcp-uplights" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="rcp-crowd" aria-hidden="true">${crowdBombs()}</div>
    </div>
    <div class="rcp-mybomb"></div>
    <div class="rcp-program">
      ${PREVIEW_PROGRAM.map((p) => `
        <div class="rcp-slot is-${p.slot}">
          <span class="rcp-slot-when">${p.slot === 'now' ? 'NOW PLAYING <i></i>' : p.slot === 'next' ? 'UP NEXT' : 'LATER'}</span>
          <span class="rcp-slot-title">${esc(p.title)}</span>
          <span class="rcp-slot-sub">${esc(p.sub)}</span>
        </div>`).join('')}
    </div>
  `
  sec.querySelector('.rcp-play').onclick = (e) => {
    const frame = document.createElement('iframe')
    frame.className = 'rcp-embed'
    frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(now.youtubeId)}?autoplay=1&playsinline=1&rel=0`
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    frame.allowFullscreen = true
    frame.title = `${now.title} ${now.sub}`
    e.currentTarget.replaceWith(frame)
  }
  return sec
}

/* The crowd under the stage is ARMY Bombs, one per agent — the same Bomb
   each agent already charges in ReConnect, brought into the venue (no
   second Bomb, no second charge). For now only the agent's own is real:
   its brightness is their actual charge (agentCharge.hoursRemaining on the
   Bomb's same 48h scale). The rest are placeholders shaped for a later
   live-presence feed ("ARMY BOMBS UP ✦"). Charge never affects the battle
   and is never required to be here. */
const CROWD_SIZE = 26
const MY_SEAT = 12

function crowdBombs() {
  let html = ''
  for (let i = 0; i < CROWD_SIZE; i++) {
    html += i === MY_SEAT
      ? '<span class="rcp-bomb is-me" data-agent="me"><i></i></span>'
      : '<span class="rcp-bomb is-placeholder" data-agent=""><i></i></span>'
  }
  return html
}

function paintMyBomb() {
  const me = root?.querySelector('.rcp-bomb.is-me')
  const cap = root?.querySelector('.rcp-mybomb')
  if (!me || !cap) return
  const charge = lastState?.agentCharge || {}
  const hours = Math.max(0, Number(charge.hoursRemaining) || 0)
  const frac = charge.isDark ? 0 : Math.min(1, hours / 48)
  me.style.setProperty('--charge', frac.toFixed(2))
  me.classList.toggle('is-dark', !!charge.isDark || hours <= 0)
  cap.innerHTML = `<i class="rcp-mybomb-dot" style="--charge:${frac.toFixed(2)}"></i> ur ARMY Bomb is in the crowd ✦ <span>${
    charge.isDark ? 'dark' : hours > 0 ? `${Math.round(hours)}H charge` : 'uncharged'}</span>`
}

/* ── CHAT — one room for both sides (local preview only) ────────────────── */

// Preview chat lines only ever render in a local dev build. Production has
// no realtime chat yet, so it shows an honest "opens soon" instead of fake
// messages and a fake head-count that would look live.
const SHOW_PREVIEW_CHAT = import.meta.env.DEV

function chatArea() {
  const sec = el('section', 'rcp-area rcp-chat')
  sec.setAttribute('aria-label', 'Party chat')
  if (!SHOW_PREVIEW_CHAT) {
    sec.innerHTML = `
      <div class="rcp-area-head"><span class="rcp-area-title">PARTY CHAT</span></div>
      <div class="rcp-chat-soon">
        <b>PARTY CHAT OPENS SOON ♡</b>
        <span>One room for Hooligans and Aliens — it's not open yet.</span>
      </div>
    `
    return sec
  }
  sec.innerHTML = `
    <div class="rcp-area-head">
      <span class="rcp-area-title">PARTY CHAT</span>
      <span class="rcp-here"><i></i>${PREVIEW_CHAT.here.toLocaleString('en-US')} here</span>
      <span class="rcp-preview-chip">PREVIEW</span>
    </div>
    <div class="rcp-msgs" role="log" aria-live="polite"></div>
    <form class="rcp-say">
      <input type="text" maxlength="200" placeholder="say something to the party…" aria-label="Chat message">
      <button type="submit">SEND</button>
    </form>
  `
  const list = sec.querySelector('.rcp-msgs')
  const draw = () => {
    list.innerHTML = [...PREVIEW_CHAT.messages, ...localChat].map((m) => `
      <div class="rcp-msg is-${m.side}${m.me ? ' is-me' : ''}">
        <div class="rcp-msg-who"><span class="rcp-msg-side">${SIDES[m.side].icon}</span>
          <b>${esc(m.name)}</b><span class="rcp-msg-no">${esc(m.no)}</span><span class="rcp-msg-at">${esc(m.at)}</span></div>
        <div class="rcp-msg-text">${esc(m.text)}</div>
      </div>`).join('')
    list.scrollTop = list.scrollHeight
  }
  draw()
  sec.querySelector('.rcp-say').onsubmit = (e) => {
    e.preventDefault()
    const input = e.currentTarget.querySelector('input')
    const text = input.value.trim()
    const pass = getCachedPartyPass()
    if (!text || !pass?.team) return
    const d = new Date()
    localChat.push({
      side: pass.team, name: 'you', no: 'not sent · preview', me: true,
      at: `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`, text,
    })
    input.value = ''
    draw()
  }
  return sec
}
