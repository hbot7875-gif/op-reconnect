// ARIRANG RE:CELEBRATE — first ReCelebrate pre-event feature: a temporary
// map location, same "appears on the map for the event's duration" idea as
// the VMA marker and Golden Corner (see city-map.js's own comment on that
// pattern). This step only shows WHERE the party is and WHEN it unlocks —
// Love Song, Party Pass, team selection, battle and Watch Party are later
// work. Tapping this marker is just the attachment point that flow will
// hang off of; today it opens a locked teaser with a countdown.

import { el, esc, getState, hideOverlay, showOverlay, toast } from './state.js'
import { getAgentNo } from './session.js'
import { fmtLeft } from './countdown.js'
import { call } from './api.js'
import { goRecelebrate } from './router.js'
import { ARIRANG_TRACKS } from '../supabase/functions/op-reconnect/lib/recelebrate-tracks.js'

export const ARIRANG_RECELEBRATE = {
  id: 'arirang-recelebrate',
  name: 'ARIRANG RE:CELEBRATE',
  whenLabel: 'Sept 20, 2026 · 9:00 AM IST',
  // Doors: Sept 20, 2026, 9:00 AM IST (UTC+5:30) = 2026-09-20T03:30:00Z.
  // The Watch tab opens with them; the battle itself still starts at
  // 9:30 AM IST (its own window, set server-side).
  opensAtIso: '2026-09-20T03:30:00.000Z',
  // 24 hours later: Sept 21, 2026, 9:30 AM IST.
  endsAtIso: '2026-09-21T04:00:00.000Z',
  // Late-sync grace closes at 11:00 AM IST. From here the event remains
  // available as a permanent, read-only archive with its frozen result.
  finalizesAtIso: '2026-09-21T05:30:00.000Z',
}

export function arirangPartyIsLive(nowMs = Date.now()) {
  return nowMs >= new Date(ARIRANG_RECELEBRATE.opensAtIso).getTime()
}

export function arirangPartyIsComplete(nowMs = Date.now()) {
  return nowMs >= new Date(ARIRANG_RECELEBRATE.finalizesAtIso).getTime()
}

export function arirangPartyIsCounting(nowMs = Date.now()) {
  return nowMs >= new Date(ARIRANG_RECELEBRATE.endsAtIso).getTime()
    && nowMs < new Date(ARIRANG_RECELEBRATE.finalizesAtIso).getTime()
}

// Same stage as the map's own partyVenue (city-map.js) — the gate inside a
// nested white LED frame, light columns either side, pink ARMY Bombs below —
// just bigger. A simplified ReConnect recreation of the comeback stage, not
// a traced photo.
function partyScene(live) {
  const stage = el('div', `stage arc-scene${live ? ' is-live' : ''}`)
  stage.setAttribute('role', 'img')
  stage.setAttribute('aria-label', `${ARIRANG_RECELEBRATE.name} — ${live ? 'open now' : 'locked until it opens'}`)
  stage.innerHTML = `
    <div class="arc-props" aria-hidden="true">
      <div class="arc-sky"></div>
      <svg class="arc-gate" viewBox="0 0 100 46" preserveAspectRatio="xMidYMid meet">
        <!-- The comeback stage: a nested white LED frame on a raised stage,
             flanked by two light columns, with the gate standing in the
             black opening. The frame and columns are the light source —
             no halo or bloom around anything. -->
        <defs>
          <linearGradient id="arcStone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#6e4d59"/><stop offset="1" stop-color="#c69daa"/>
          </linearGradient>
        </defs>
        <rect class="arc-column" x="4" y="1.5" width="2" height="38"></rect>
        <rect class="arc-column" x="94" y="1.5" width="2" height="38"></rect>
        <rect class="arc-void" x="16" y="3" width="68" height="36"></rect>
        <rect class="arc-gate-wall" x="28" y="27" width="44" height="12"></rect>
        <path class="arc-gate-arch" d="M35.5,39 L35.5,32 A2.5 2.5 0 0 1 40.5,32 L40.5,39 Z"></path>
        <path class="arc-gate-arch" d="M47.5,39 L47.5,32 A2.5 2.5 0 0 1 52.5,32 L52.5,39 Z"></path>
        <path class="arc-gate-arch" d="M59.5,39 L59.5,32 A2.5 2.5 0 0 1 64.5,32 L64.5,39 Z"></path>
        <path class="arc-gate-roof" d="M22,25 Q26,26.6 30,27 L70,27 Q74,26.6 78,25 L72,22.6 L28,22.6 Z"></path>
        <rect class="arc-gate-band" x="34" y="19.5" width="32" height="3.1"></rect>
        <rect class="arc-gate-sign" x="45.5" y="20.1" width="9" height="1.9"></rect>
        <path class="arc-gate-roof" d="M26,18 Q30,19.4 34,19.6 L66,19.6 Q70,19.4 74,18 L67,15.2 L33,15.2 Z"></path>
        <rect class="arc-gate-ridge" x="33" y="14.6" width="34" height="0.7"></rect>
        <rect class="arc-frame" x="16" y="3" width="68" height="36"></rect>
        <rect class="arc-frame-in" x="19" y="6" width="62" height="33"></rect>
        <rect class="arc-frame-in arc-frame-in2" x="21.5" y="8.5" width="57" height="30.5"></rect>
        <rect class="arc-truss" x="14" y="1.2" width="72" height="1.8"></rect>
        <rect class="arc-stage" x="6" y="39" width="88" height="2.4"></rect>
        <rect class="arc-stage" x="3" y="41.4" width="94" height="2"></rect>
      </svg>
      <div class="arc-crowd"></div>
      <div class="arc-shadow"></div>
    </div>
    <div class="stage-overlay arc-stage-overlay">
      <div class="stage-top">
        <div class="stage-eyebrow">${live ? 'PARTY OPEN' : 'PARTY LOCATION · LOCKED'}</div>
        <div class="stage-name">${esc(ARIRANG_RECELEBRATE.name)}</div>
      </div>
    </div>
  `
  // A loose scatter filling the square below the gate, denser toward the
  // middle — a crowd, not a tidy row of dots the way the old fairy-light
  // string read.
  const CROWD = [
    [8, 88], [14, 92], [20, 85], [27, 94], [33, 86], [40, 91], [46, 84], [52, 93], [58, 87], [64, 90],
    [70, 85], [76, 92], [82, 86], [88, 90], [18, 78], [26, 80], [35, 76], [44, 79], [53, 75], [62, 78],
    [71, 76], [80, 79], [24, 70], [38, 68], [50, 71], [62, 68], [76, 70],
  ]
  const crowd = stage.querySelector('.arc-crowd')
  CROWD.forEach(([x, y], i) => {
    const dot = el('i')
    dot.style.left = `${x}%`
    dot.style.top = `${89 + (y - 68) * 0.3}%`
    dot.style.setProperty('--i', String(i % 6))
    crowd.appendChild(dot)
  })
  return stage
}

function partySheet() {
  const live = arirangPartyIsLive()
  const sheet = el('div', 'sheet arc-sheet')
  sheet.appendChild(partyScene(live))
  sheet.appendChild(el('p', 'muted arc-when', esc(ARIRANG_RECELEBRATE.whenLabel)))
  if (live) {
    sheet.appendChild(el('p', 'muted', "Doors are open — more to come here soon."))
  } else {
    const cd = el('div', 'arc-countdown')
    cd.innerHTML = `<span>Opens in</span><b data-deadline="${ARIRANG_RECELEBRATE.opensAtIso}">${fmtLeft(new Date(ARIRANG_RECELEBRATE.opensAtIso).getTime() - Date.now())}</b>`
    sheet.appendChild(cd)
    sheet.appendChild(partyInvite())
    sheet.appendChild(el('p', 'arc-bomb-hint', 'charge ur ARMY Bomb for the party 👀'))
  }
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

// Before doors open the landmark opens the pre-party sheet; once the party
// is live it goes to the full Party page instead (screen-recelebrate.js).
export function openArirangRecelebrate() {
  if (arirangPartyIsLive()) {
    hideOverlay()
    goRecelebrate()
    return
  }
  showOverlay(partySheet())
  refreshPartyPass()
}

/* Entry points the live Party page uses — the same frozen sheets, reached
   from the page instead of the pre-party venue. */
export const getCachedPartyPass = () => readCache()
export async function refreshPartyPassState() {
  await refreshPartyPass()
  return readCache()
}
export const openLoveSongFlow = () => showOverlay(loveSongSheet())
export const openMyPartyPass = () => { const p = readCache(); if (p) showOverlay(passSheet(p, false)) }
export const continueToSides = () => continueAfterPass(null)

/* ── Party Pass ─────────────────────────────────────────────────────────
   Pre-party only: the party itself is still locked behind the countdown,
   but an agent can get ready now. Flow: venue → GET UR PARTY PASS → pick
   ur ARIRANG Love Song → Party Pass reveal → CONTINUE (team step, next).
   The server (rc_recelebrate_passes via getRecelebrateState/issuePartyPass)
   is the source of truth. The local copy is only a cache so the venue can
   render instantly before the server answers. */

const cacheKey = () => `rc_arc_pass:${getAgentNo() || 'anon'}`
let passCache

// undefined = not known yet on this device (never offer GET UR PARTY PASS
// before the server has answered); null = server says no pass yet.
function readCache() {
  if (passCache !== undefined) return passCache
  try {
    const raw = localStorage.getItem(cacheKey())
    if (raw !== null) passCache = JSON.parse(raw)
  } catch {}
  return passCache
}

function writeCache(pass) {
  passCache = pass || null
  try { localStorage.setItem(cacheKey(), JSON.stringify(passCache)) } catch {}
  window.dispatchEvent(new CustomEvent('rc-arc-pass'))
}

async function refreshPartyPass() {
  const res = await call('getRecelebrateState', { agentNo: getAgentNo() })
  if (!res?.success) return
  writeCache(res.pass)
  const current = document.querySelector('#overlay .arc-invite')
  if (current) current.replaceWith(partyInvite())
}

function partyInvite() {
  const pass = readCache()
  const box = el('div', 'arc-invite')
  if (pass === undefined) {
    box.appendChild(el('div', 'arc-invite-eyebrow', 'BEFORE THE PARTY ♡'))
    box.appendChild(el('div', 'arc-invite-q muted', 'Checking for ur Party Pass…'))
  } else if (pass) {
    box.appendChild(el('div', 'arc-invite-eyebrow', 'UR PARTY PASS ♡'))
    box.appendChild(el('div', 'arc-invite-q', `Love Song · <b>${esc(pass.loveSong)}</b>` +
      (pass.team ? ` <span class="arc-side-tag is-${pass.team}">${TEAMS[pass.team].icon} ${TEAMS[pass.team].name}</span>` : '')))
    const btn = el('button', 'btn arc-pass-btn', 'VIEW UR PARTY PASS →')
    btn.onclick = () => showOverlay(passSheet(pass, false))
    box.appendChild(btn)
  } else {
    box.appendChild(el('div', 'arc-invite-eyebrow', 'BEFORE THE PARTY ♡'))
    box.appendChild(el('div', 'arc-invite-q', "What's ur Love Song?"))
    const btn = el('button', 'btn arc-pass-btn', 'GET UR PARTY PASS →')
    btn.onclick = () => showOverlay(loveSongSheet())
    box.appendChild(btn)
  }
  return box
}

function loveSongSheet() {
  const sheet = el('div', 'sheet arc-sheet arc-lovesong')
  sheet.appendChild(el('div', 'eyebrow arc-invite-eyebrow', 'BEFORE THE PARTY ♡'))
  sheet.appendChild(el('h3', '', "What's ur Love Song?"))
  sheet.appendChild(el('p', 'muted', "Pick the one that's going on ur Party Pass ♡"))

  let picked = null
  const confirm = el('button', 'btn btn-primary arc-pass-confirm', 'GET UR PARTY PASS →')
  confirm.disabled = true

  const list = el('div', 'arc-song-list')
  list.setAttribute('role', 'radiogroup')
  list.setAttribute('aria-label', 'ARIRANG tracks')
  ARIRANG_TRACKS.forEach((title, i) => {
    const opt = el('button', 'arc-song',
      `<span class="arc-song-no">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="arc-song-title">${esc(title)}</span><span class="arc-song-heart" aria-hidden="true">♡</span>`)
    opt.type = 'button'
    opt.setAttribute('role', 'radio')
    opt.setAttribute('aria-checked', 'false')
    opt.onclick = () => {
      picked = title
      list.querySelectorAll('.arc-song').forEach((b) => {
        const on = b === opt
        b.classList.toggle('is-picked', on)
        b.setAttribute('aria-checked', String(on))
      })
      confirm.disabled = false
    }
    list.appendChild(opt)
  })
  sheet.appendChild(list)

  confirm.onclick = async () => {
    if (!picked) return
    confirm.disabled = true
    confirm.textContent = 'ISSUING UR PASS…'
    const res = await call('issuePartyPass', { agentNo: getAgentNo(), loveSong: picked })
    if (!res?.success || !res.pass) {
      confirm.disabled = false
      confirm.textContent = 'GET UR PARTY PASS →'
      toast("Couldn't issue ur Party Pass — try again")
      return
    }
    writeCache(res.pass)
    showOverlay(passSheet(res.pass, !res.alreadyIssued))
  }
  sheet.appendChild(confirm)
  const back = el('button', 'btn btn-ghost', 'Back to the venue')
  back.onclick = openArirangRecelebrate
  sheet.appendChild(back)
  return sheet
}

function passSheet(pass, fresh) {
  const state = getState() || {}
  const name = state.player?.codename || getSessionHandle() || 'Agent'
  const agentNo = getAgentNo() || ''
  const sheet = el('div', 'sheet arc-sheet arc-pass-sheet')
  sheet.setAttribute('aria-label', 'ARIRANG RE:CELEBRATE Party Pass')
  const card = el('div', `arc-pass${fresh ? ' is-fresh' : ''}`)
  card.innerHTML = `
    <div class="arc-pass-bg" aria-hidden="true"></div>
    <div class="arc-pass-top"><span>ARIRANG RE:CELEBRATE</span><span>PARTY PASS ✦</span></div>
    <div class="arc-pass-body">
      <div class="arc-pass-label">♡ UR LOVE SONG</div>
      <div class="arc-pass-song">${esc(pass.loveSong)}</div>
      <div class="arc-pass-agent"><span class="arc-pass-name">${esc(name)}</span><span class="arc-pass-no">${esc(agentNo)}</span></div>
      <div class="arc-pass-row"><span>DOORS</span><b>${esc(ARIRANG_RECELEBRATE.whenLabel)}</b></div>
      ${pass.team ? `<div class="arc-pass-row"><span>UR SIDE</span><b class="arc-side-tag is-${pass.team}">${TEAMS[pass.team].icon} ${TEAMS[pass.team].name}</b></div>` : ''}
    </div>
    <div class="arc-pass-stub"><span>PARTY READY</span><span class="arc-pass-star">✦</span></div>
  `
  sheet.appendChild(card)
  sheet.appendChild(el('p', 'arc-pass-note', 'ur in ♡ see u at the party'))
  const next = el('button', 'btn arc-pass-continue', pass.team ? 'CLOSE' : 'CONTINUE →')
  next.onclick = pass.team ? hideOverlay : () => continueAfterPass(next)
  sheet.appendChild(next)
  return sheet
}

/* ── Surprise side choice ───────────────────────────────────────────────
   Revealed the first time CONTINUE is pressed after the pass. The 30s
   window is the SERVER's: startTeamChoice stamps the start once (only while
   empty) and returns the deadline plus the server's clock, so a refresh,
   another tab or another device all count down to the same moment. The
   client only draws what's left; picks and timeouts are decided in SQL. */

const TEAMS = {
  hooligans: { name: 'HOOLIGANS', icon: '⚡', you: "YOU'RE A HOOLIGAN" },
  aliens: { name: 'ALIENS', icon: '🛸', you: "YOU'RE AN ALIEN" },
}

async function continueAfterPass(btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…' }
  const res = await call('startTeamChoice', { agentNo: getAgentNo() })
  if (!res?.success || !res.pass) {
    if (btn) { btn.disabled = false; btn.textContent = 'CONTINUE →' }
    toast("Couldn't continue — try again")
    return
  }
  writeCache(res.pass)
  if (res.pass.team) showOverlay(teamResultSheet(res.pass))
  else showOverlay(teamChoiceSheet(res.pass, res.serverNow))
}

function teamChoiceSheet(pass, serverNow) {
  const offset = new Date(serverNow).getTime() - Date.now()
  const deadline = new Date(pass.teamDeadline).getTime()
  const msLeft = () => Math.max(0, deadline - (Date.now() + offset))

  const sheet = el('div', 'sheet arc-sheet arc-sides')
  sheet.setAttribute('aria-label', 'Choose ur side')
  sheet.innerHTML = `
    <div class="arc-sides-head">
      <div class="arc-sides-title">CHOOSE UR SIDE <span>✦</span></div>
      <div class="arc-sides-timer" aria-live="off">00:30</div>
    </div>
    <div class="arc-sides-bar"><i></i></div>
    <div class="arc-sides-row">
      <button type="button" class="arc-side is-hooligans" data-team="hooligans">
        <span class="arc-side-icon">⚡</span><span class="arc-side-name">HOOLIGANS</span>
      </button>
      <div class="arc-sides-vs">vs</div>
      <button type="button" class="arc-side is-aliens" data-team="aliens">
        <span class="arc-side-icon">🛸</span><span class="arc-side-name">ALIENS</span>
      </button>
    </div>
  `
  const timerEl = sheet.querySelector('.arc-sides-timer')
  const barEl = sheet.querySelector('.arc-sides-bar i')
  const buttons = [...sheet.querySelectorAll('.arc-side')]
  let done = false

  const paint = () => {
    const left = msLeft()
    const secs = Math.ceil(left / 1000)
    timerEl.textContent = `00:${String(secs).padStart(2, '0')}`
    barEl.style.transform = `scaleX(${(left / 30000).toFixed(3)})`
    sheet.classList.toggle('is-hurry', secs <= 10)
    return left
  }
  paint()
  const tick = setInterval(() => {
    if (!sheet.isConnected) { clearInterval(tick); return }
    if (done) return
    if (paint() <= 0) {
      done = true
      clearInterval(tick)
      buttons.forEach((b) => { b.disabled = true })
      timeUp(sheet)
    }
  }, 100)

  buttons.forEach((b) => {
    b.onclick = async () => {
      if (done) return
      done = true
      clearInterval(tick)
      buttons.forEach((x) => { x.disabled = true; x.classList.toggle('is-picked', x === b) })
      const res = await call('chooseTeam', { agentNo: getAgentNo(), team: b.dataset.team })
      if (!res?.success || !res.pass?.team) {
        toast("Couldn't lock ur side — try again")
        showOverlay(teamChoiceSheet(pass, res?.serverNow || serverNow))
        return
      }
      writeCache(res.pass)
      showOverlay(teamResultSheet(res.pass))
    }
  })
  return sheet
}

// The window closed with no pick: HT assigns the side server-side on the next
// state read. A clock a beat ahead of the server just retries briefly.
async function timeUp(sheet) {
  sheet.classList.add('is-timeup')
  const head = sheet.querySelector('.arc-sides-title')
  if (head) head.innerHTML = "TIME'S UP <span>✦</span>"
  for (let i = 0; i < 8; i++) {
    const res = await call('getRecelebrateState', { agentNo: getAgentNo() })
    if (res?.success && res.pass?.team) {
      writeCache(res.pass)
      showOverlay(teamResultSheet(res.pass, true))
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  toast('Still picking ur side — check back in a sec')
}

function teamResultSheet(pass, justTimedOut = false) {
  const t = TEAMS[pass.team]
  const byHt = pass.teamAssignedBy === 'ht'
  const sheet = el('div', `sheet arc-sheet arc-side-result is-${pass.team}`)
  sheet.setAttribute('aria-label', byHt ? `HT picked ur side: ${t.name}` : `${t.you}`)
  sheet.innerHTML = byHt ? `
      ${justTimedOut ? `<div class="arc-result-eyebrow">TIME'S UP ✦</div>` : ''}
      <div class="arc-result-ht">HT PICKED UR SIDE</div>
      <div class="arc-result-icon">${t.icon}</div>
      <div class="arc-result-team">${t.name}</div>
      <div class="arc-result-see">SEE U AT THE PARTY ✦</div>
    ` : `
      <div class="arc-result-icon">${t.icon}</div>
      <div class="arc-result-team">${t.you} ${t.icon}</div>
      <div class="arc-result-see">SEE U AT THE PARTY ✦</div>
    `
  const back = el('button', 'btn arc-pass-continue', 'BACK TO THE VENUE')
  back.onclick = openArirangRecelebrate
  sheet.appendChild(back)
  return sheet
}

/* ── Agent Pack keepsake ─────────────────────────────────────────────────
   A permanent memory of taking part — shown before, during and after the
   party, and only if the server says this agent actually has a pass (no
   locked/fake placeholder). Tapping it opens the real pass. */
export function recelebrateKeepsake() {
  const slot = el('div', 'arc-keepsake-slot')
  const render = () => {
    slot.innerHTML = ''
    const pass = readCache()
    if (!pass) return
    slot.appendChild(el('div', 'pack-section', `
      <span class="ps-title">Event Keepsakes</span>
      <span class="ps-count">1</span>
    `))
    const card = el('button', 'arc-keepsake', `
      <span class="arc-keepsake-eyebrow">EVENT KEEPSAKE</span>
      <span class="arc-keepsake-name">ARIRANG RE:CELEBRATE</span>
      <span class="arc-keepsake-song">♡ ${esc(pass.loveSong)}</span>
      <span class="arc-keepsake-foot">
        <span class="arc-keepsake-date">SEPT 20, 2026</span>
        ${pass.team ? `<span class="arc-side-tag is-${pass.team}">${TEAMS[pass.team].icon} ${TEAMS[pass.team].name}</span>` : ''}
      </span>
      <span class="arc-keepsake-go" aria-hidden="true">›</span>
    `)
    card.type = 'button'
    card.onclick = () => showOverlay(passSheet(readCache(), false))
    slot.appendChild(card)
  }
  render()
  call('getRecelebrateState', { agentNo: getAgentNo() }).then((res) => {
    if (!res?.success) return
    writeCache(res.pass)
    render()
  })
  return slot
}

function getSessionHandle() {
  try { return JSON.parse(localStorage.getItem('rc_agent') || 'null')?.handle || null } catch { return null }
}
