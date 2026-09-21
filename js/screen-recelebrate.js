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

import { el, esc, toast } from './state.js'
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
let afterPartyClaim = null
let afterPartyOpened = new Set()
let afterPartyActiveGift = null
let afterPartyBadgeArt = new Map()

// The server only rescans at most every 20s however many agents are
// watching; a minute here keeps the board fresh without hammering it.
async function loadBattle() {
  clearTimeout(battleTimer)
  const res = await call('getRecelebrateBattle', { agentNo: getAgentNo() })
  const area = root?.querySelector('.rcp-battle')
  if (!area?.isConnected) return
  if (res?.afterParty?.claimed) {
    const returningToClaim = !afterPartyClaim?.claimed
    afterPartyClaim = res.afterParty
    if (returningToClaim && afterPartyOpened.size === 0) {
      afterPartyOpened = new Set(['love', 'badges', 'surprise'])
      afterPartyActiveGift = 'all'
    }
    if (afterPartyBadgeArt.size === 0) await loadAfterPartyBadgeArt(res.afterParty.badgeIds)
  }
  area.replaceWith(res?.success && res.battle ? battleArea(res.battle, res.me, res.afterParty) : battleUnavailable())
  if (res?.success && res.battle) paintEventState(res.battle.status)
  battleTimer = setTimeout(() => { if (root?.isConnected) loadBattle() }, BATTLE_POLL_MS)
}

window.addEventListener('rc-arc-pass', () => { if (root?.isConnected) paintMe() })

/* ── Header: identity, live clock, the agent's own side + pass ─────────── */

function header() {
  const now = Date.now()
  const endsLeft = new Date(ARIRANG_RECELEBRATE.endsAtIso).getTime() - now
  const finalLeft = new Date(ARIRANG_RECELEBRATE.finalizesAtIso).getTime() - now
  const complete = finalLeft <= 0
  const counting = !complete && endsLeft <= 0
  const head = el('header', 'rcp-head')
  head.innerHTML = `
    <div class="rcp-head-bg" aria-hidden="true"></div>
    <button type="button" class="back-btn rcp-back">City</button>
    <div class="rcp-titles">
      <div class="rcp-name">ARIRANG RE:CELEBRATE <span>✦</span></div>
      <div class="rcp-live${complete ? ' is-complete' : counting ? ' is-counting' : ''}">${complete ? '' : '<i></i>'}<span class="rcp-live-label">${complete ? 'RE:CELEBRATE COMPLETE ✦' : counting ? 'COUNTING FINAL STREAMS ✦' : 'PARTY LIVE ✦'}</span><span class="rcp-here" hidden></span></div>
    </div>
    <div class="rcp-clock">
      <span>${complete ? 'FINAL RESULT' : counting ? 'RESULT IN' : 'ENDS IN'}</span>
      <b${complete ? '' : ` data-deadline="${counting ? ARIRANG_RECELEBRATE.finalizesAtIso : ARIRANG_RECELEBRATE.endsAtIso}"`}>${complete ? 'ARCHIVE' : fmtLeft(counting ? finalLeft : endsLeft)}</b>
    </div>
    <div class="rcp-me"></div>
  `
  head.querySelector('.rcp-back').onclick = (e) => goWorld({ x: e.clientX, y: e.clientY })
  return head
}

// The page itself stays mounted. Polls only update these small labels and
// the battle panel, so crossing 9:30 or 11:00 never flashes/rebuilds the
// stage, chat, scroll position or mobile tab state.
function paintEventState(status) {
  const live = root?.querySelector('.rcp-live')
  const label = root?.querySelector('.rcp-live-label')
  const clockLabel = root?.querySelector('.rcp-clock span')
  const clock = root?.querySelector('.rcp-clock b')
  if (!live || !label || !clockLabel || !clock) return
  const final = status === 'final'
  const counting = status === 'counting'
  live.classList.toggle('is-complete', final)
  live.classList.toggle('is-counting', counting)
  let dot = live.querySelector('i')
  if (final) dot?.remove()
  else if (!dot) { dot = document.createElement('i'); live.prepend(dot) }
  label.textContent = final ? 'RE:CELEBRATE COMPLETE ✦' : counting ? 'COUNTING FINAL STREAMS ✦' : 'PARTY LIVE ✦'
  clockLabel.textContent = final ? 'FINAL RESULT' : counting ? 'RESULT IN' : 'ENDS IN'
  if (final) {
    delete clock.dataset.deadline
    clock.textContent = 'ARCHIVE'
  } else {
    const deadline = counting ? ARIRANG_RECELEBRATE.finalizesAtIso : ARIRANG_RECELEBRATE.endsAtIso
    clock.dataset.deadline = deadline
    clock.textContent = fmtLeft(new Date(deadline).getTime() - Date.now())
  }
  root?.classList.toggle('is-complete', final)
  const watchTab = root?.querySelector('.rcp-tab[data-tab="watch"]')
  if (watchTab) watchTab.textContent = final ? 'REPLAYS' : 'WATCH'
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
  sec.querySelectorAll('.rcp-gift').forEach((gift) => {
    gift.onclick = () => takeAfterPartyGift(gift.dataset.gift, gift)
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

function battleArea(b, me, afterParty) {
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

  const totalPulled = (b.tracks || []).reduce((sum, t) => sum + Number(t.hooligans || 0) + Number(t.aliens || 0), 0)
  const rows = (b.tracks || []).map((t) => {
    const lead = t.leader
    const side = lead === 'hooligans' ? 'HOOLIGANS' : lead === 'aliens' ? 'ALIENS' : null
    const state = !side ? 'TIED' : final ? `${side} WIN +${fmt(t.difference)}` : `${side} +${fmt(t.difference)}`
    return `
      <li class="rcp-track lead-${lead}${final ? ' is-final' : ''}">
        <span class="rcp-track-no">${String(t.position).padStart(2, '0')}</span>
        <span class="rcp-track-title">${esc(t.title)}</span>
        <span class="rcp-track-state">${state}</span>
        ${final ? `<span class="rcp-track-finalstats">
          <span class="is-h"><small>⚡ HOOLIGANS</small><b>${fmt(t.hooligans)}</b></span>
          <span class="is-a"><small>🛸 ALIENS</small><b>${fmt(t.aliens)}</b></span>
          <span class="is-total"><small>✦ TOGETHER</small><b>${fmt(Number(t.hooligans || 0) + Number(t.aliens || 0))}</b></span>
        </span>` : `<span class="rcp-track-n is-h">⚡ ${fmt(t.hooligans)}</span><span class="rcp-track-n is-a">🛸 ${fmt(t.aliens)}</span>`}
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
      ${final ? `<div class="rcp-total-pulled"><span>TOTAL STREAMS PULLED ✦</span><b>${fmt(totalPulled)}</b></div>` : ''}
    </div>
    <div class="rcp-strip" aria-hidden="true">
      ${(b.tracks || []).map((t) => `<i class="is-${t.leader}"></i>`).join('')}
    </div>
    ${myStreamsBlock(b, me)}
    ${nextMoveBlock(b)}
    ${final ? afterPartyBlock(afterParty) : ''}
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

const AFTER_PARTY_BADGES = {
  event_rc26_after_party: 'AFTER PARTY ♡',
  event_rc26_party_crasher: 'PARTY CRASHER ✦',
  event_rc26_arirang_cult: 'ARIRANG CULT MEMBER ♡',
  event_rc26_side_quest_hooligans: 'SIDE QUEST ⚡',
  event_rc26_side_quest_aliens: 'SIDE QUEST 🛸',
  event_arirang_recelebrate_2026: "RE:CELEBRATE '26 ✦",
}
function giftButtons() {
  const open = (kind) => afterPartyOpened.has(kind) ? ' is-opened' : ''
  return `<div class="rcp-gift-pile" aria-label="After Party return gifts">
    <button type="button" class="rcp-gift rcp-gift-love${open('love')}" data-gift="love" aria-label="Open Love Song keepsake"><i></i><b>LOVE SONG</b></button>
    <button type="button" class="rcp-gift rcp-gift-badges${open('badges')}" data-gift="badges" aria-label="Open badge parcel"><i></i><b>BADGES</b></button>
    <button type="button" class="rcp-gift rcp-gift-surprise${open('surprise')}" data-gift="surprise" aria-label="Open surprise bag"><i></i><b>SURPRISE</b></button>
  </div>`
}

// Curated print inks for the physical Love Song keepsake. They are chosen
// for contrast on the dark sleeve rather than generated from the title, so
// the same song always has the same little identity.
const LOVE_SONG_COLORS = {
  swim: '#22d3ee',
  'body to body': '#ff6b8f',
  hooligan: '#ef4444',
  aliens: '#57d983',
  fya: '#ff7a32',
  'merry go round': '#f5a45d',
  'one more night': '#91a7e8',
  please: '#ca94f1',
  'into the sun': '#f2c96d',
  'no. 29': '#c5a064',
  normal: '#e8c547',
  "they don't know 'bout us": '#dc72e9',
  '2.0': '#68a1f2',
  'like animals': '#d9664f',
  'wild flower': '#c2a5ef',
  haegeum: '#e29a68',
  "killin' it girl": '#ee91c2',
}

function loveSongColor(song) {
  return LOVE_SONG_COLORS[String(song || '').trim().toLowerCase()] || '#f2a8d0'
}

function loveSongKeepsake(gift) {
  const team = gift.team === 'aliens' ? '🛸 ALIENS' : '⚡ HOOLIGANS'
  const song = gift.loveSong || 'ARIRANG'
  return `<div class="rcp-keepsake" style="--love-song-color:${loveSongColor(song)}"><small>ARIRANG<br>RE:CELEBRATE</small><span>♡ UR LOVE SONG</span><strong>${esc(song)}</strong><footer><i>09.20.26<br>${team}</i><i>I WAS THERE ✦</i></footer></div><button type="button" class="rcp-keepsake-view">VIEW KEEPSAKE</button>`
}

function badgeGift(gift) {
  const badges = (gift.badgeIds || []).map((id) => {
    const name = AFTER_PARTY_BADGES[id] || 'EVENT BADGE'
    const art = afterPartyBadgeArt.get(id)
    return `<span class="rcp-after-badge">${art ? `<img src="${esc(art)}" alt="">` : '<i>◇</i>'}<b>${esc(name)}</b></span>`
  }).join('')
  return `<div class="rcp-after-badge-stack">${badges || '<span class="rcp-after-badge"><i>◇</i><b>BADGE SAVED</b></span>'}</div>`
}

function surpriseGift(gift) {
  const reward = gift.reward || {}
  const amount = Number(reward.amount) || 1
  if (reward.kind === 'charge_cells') return `<div class="rcp-surprise"><span>CHARGE CELLS</span><strong>+${amount}</strong><div class="rcp-cell-stack" aria-hidden="true"><i></i><i></i><i></i></div><p>for keeping ur ARMY Bomb glowing ✦</p></div>`
  if (reward.kind === 'deadline_extension') return `<div class="rcp-surprise"><span>DEADLINE EXTENSION</span><strong>+${amount} TICKET${amount === 1 ? '' : 'S'}</strong><div class="rcp-ticket" aria-hidden="true">+3 DAYS</div><p>save it for when u need more time</p></div>`
  return `<div class="rcp-surprise"><span>WINGS</span><strong>+${amount}</strong><div class="rcp-wings" aria-hidden="true">🪽</div><p>straight to ur Pack ✦</p></div>`
}

function openedGiftContent(gift) {
  const showAll = afterPartyActiveGift === 'all'
  return `<div class="rcp-opened-gifts">
    ${(showAll || afterPartyActiveGift === 'love') && afterPartyOpened.has('love') ? loveSongKeepsake(gift) : ''}
    ${(showAll || afterPartyActiveGift === 'badges') && afterPartyOpened.has('badges') ? badgeGift(gift) : ''}
    ${(showAll || afterPartyActiveGift === 'surprise') && afterPartyOpened.has('surprise') ? surpriseGift(gift) : ''}
  </div>`
}

function afterPartyBlock(gift) {
  if (!gift?.available) return '<section class="rcp-after"><div class="rcp-after-title">AFTER PARTY ✦</div><p>Final gifts are getting ready.</p></section>'
  if (!gift.eligible) return `<section class="rcp-after"><div class="rcp-after-title">AFTER PARTY ✦</div><p>Your Party Pass stays with you. Return gifts were for agents who streamed or joined the Watch Party.</p></section>`
  const opened = gift.claimed ? afterPartyOpened.size : 0
  const allOpen = opened === 3
  return `<section class="rcp-after">
    <div class="rcp-after-title">AFTER PARTY ✦</div>
    <div class="rcp-after-kicker">${allOpen ? 'UR RETURN GIFTS' : `${3 - opened} RETURN GIFT${3 - opened === 1 ? '' : 'S'} WAITING`}</div>
    ${giftButtons()}
    ${gift.claimed ? openedGiftContent(gift) : ''}
    <p class="rcp-after-hint">${allOpen ? 'ALL UR GIFTS ARE IN UR PACK ✦' : 'tap a gift to open it ♡'}</p>
  </section>`
}

async function loadAfterPartyBadgeArt(ids = []) {
  if (!ids.length) return
  const res = await call('getBadgeCollection', { agentNo: getAgentNo() })
  if (!res?.success) return
  afterPartyBadgeArt = new Map((res.earned || []).filter((b) => ids.includes(b.badgeId)).map((b) => [b.badgeId, b.artworkUrl]))
}

function repaintAfterParty() {
  const current = root?.querySelector('.rcp-after')
  if (!current || !afterPartyClaim) return
  const wrapper = document.createElement('div')
  wrapper.innerHTML = afterPartyBlock(afterPartyClaim)
  const next = wrapper.firstElementChild
  current.replaceWith(next)
  next.querySelectorAll('.rcp-gift').forEach((gift) => { gift.onclick = () => takeAfterPartyGift(gift.dataset.gift, gift) })
}

async function takeAfterPartyGift(kind, button) {
  if (button.disabled) return
  if (afterPartyOpened.has(kind)) { afterPartyActiveGift = kind; repaintAfterParty(); return }
  button.disabled = true
  button.classList.add('is-opening')
  if (!afterPartyClaim?.claimed) {
    const res = await call('claimRecelebrateAfterParty', { agentNo: getAgentNo() })
    if (!res?.success) {
      button.disabled = false
      button.classList.remove('is-opening')
      toast(res?.error === 'gifts_not_ready' ? 'The return gifts are not ready yet.' : "Couldn't open that gift — try again.")
      return
    }
    afterPartyClaim = res.afterParty
    await loadAfterPartyBadgeArt(afterPartyClaim.badgeIds)
  }
  afterPartyOpened.add(kind)
  afterPartyActiveGift = afterPartyOpened.size === 3 ? 'all' : kind
  repaintAfterParty()
  if (afterPartyOpened.size === 3) toast('All ur After Party gifts are in ur Pack ✦')
}

// One useful decision from the existing scoreboard, without inventing a new
// goal system. It answers “what should I stream next?” at a glance and stays
// deliberately smaller than the actual battle score.
function nextMoveBlock(b) {
  if (!['active', 'live'].includes(b.status)) return ''
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
