// Run ARMY — the City's games corner (its marker is in city-map.js).
//
// A place, not a game: it lists what can be played, holds the Album, and
// says what is on the way. Each game decides its own access. RUN AMI, the
// first, opens for the closed-test list (lib/run-ami-access.js) and for
// anyone holding all 15 album covers (lib/album-rules.js) — the same rule
// the server applies in run-ami.ts's allowAgent, which turns everyone else
// away whatever this sheet shows. Every card face carries one era's artwork
// (js/run-ami-art.js ERA_OF), so what's collected is the 15 covers, not the
// 54 different cards.
//
// Progress comes from the game state's `album` summary (handlers.ts), which
// is also where today's cover is awarded; the Album sheet itself asks the
// server for the full view.

import { el, esc, getState, showOverlay, hideOverlay } from './state.js'
import { goRunAmi } from './router.js'
import { getAgentNo } from './session.js'
import { cardHtml } from './run-ami-cards.js'
import { openAlbum } from './album.js'
import { isRunAmiTester } from '../supabase/functions/op-reconnect/lib/run-ami-access.js'
import { ALBUM_SIZE } from '../supabase/functions/op-reconnect/lib/album-rules.js'

// Three cards from three different eras (the artwork follows the card's
// value; see js/run-ami-art.js ERA_OF), fanned on RUN AMI's tile.
const TEASER = [{ c: 'r', k: '1' }, { c: 'y', k: '6' }, { c: null, k: 'wild' }]

const OPENED_KEY = 'rc_run_army_opened:'

/** True until this agent has opened Run ARMY once on this device: the map
 *  marker carries a small "new" dot until then. No storage, no dot. */
export function runArmyIsNew() {
  try { return localStorage.getItem(`${OPENED_KEY}${getAgentNo() || ''}`) !== '1' } catch (_) { return false }
}

function markRunArmyOpened() {
  try { localStorage.setItem(`${OPENED_KEY}${getAgentNo() || ''}`, '1') } catch (_) {}
  document.querySelectorAll('.cm-tool.is-run-army.is-new').forEach((m) => {
    m.classList.remove('is-new')
    m.querySelector('.cm-tool-new')?.remove()
  })
}

export function openRunArmy() {
  markRunArmyOpened()
  const album = getState()?.album || null
  const count = Math.min(ALBUM_SIZE, Number(album?.count) || 0)
  const open = isRunAmiTester(getAgentNo()) || !!album?.complete
  const sheet = el('div', 'sheet ra-sheet rarmy-sheet')
  sheet.innerHTML = `
    <span class="rarmy-eyebrow">🎮 ARMY games</span>
    <h3>Run ARMY</h3>
    <p class="rarmy-lede">Games for agents, between streams.</p>
    <article class="rarmy-game${open ? ' is-open' : ' is-locked'}">
      <div class="rarmy-fan" aria-hidden="true">${TEASER.map((c) => cardHtml(c)).join('')}</div>
      <div class="rarmy-game-text">
        <b>WAR OF CARDS</b>
        <span>Last-card game · 2–4 agents</span>
        ${open ? '' : `<p class="rarmy-lock">🔒 Unlocks once you collect all ${ALBUM_SIZE} BTS album covers: one for each daily Signal Sweep, or as a gift from a friend.</p>`}
      </div>
    </article>
    <article class="rarmy-game rarmy-album">
      <span class="rarmy-album-icon" aria-hidden="true">💿</span>
      <div class="rarmy-game-text">
        <b>Album</b>
        <span>${esc(`${count} / ${ALBUM_SIZE} covers`)}${album?.todayGoalEra ? ' · new one today' : ''}</span>
        <span class="al-bar" aria-hidden="true"><i style="--p:${count / ALBUM_SIZE}"></i></span>
      </div>
    </article>
    <article class="rarmy-game is-soon">
      <span class="rarmy-soon-icon" aria-hidden="true">＋</span>
      <div class="rarmy-game-text"><b>More games</b><span>Coming soon to Run ARMY</span></div>
    </article>`
  if (open) {
    const play = el('button', 'btn btn-primary rarmy-play', 'Play War of Cards')
    play.type = 'button'
    play.onclick = () => { hideOverlay(); goRunAmi() }
    sheet.querySelector('.rarmy-game.is-open').appendChild(play)
  }
  const albumBtn = el('button', 'btn rarmy-play rarmy-album-open', 'Open album')
  albumBtn.type = 'button'
  albumBtn.onclick = () => { hideOverlay(); openAlbum() }
  sheet.querySelector('.rarmy-album').appendChild(albumBtn)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.type = 'button'
  close.onclick = hideOverlay
  sheet.appendChild(close)
  showOverlay(sheet)
}

/* ── Launch pop-up ──────────────────────────────────────────────────────── */

// Once per agent per device, the first City visit after release: RUN AMI is
// here, where to find it, and how covers open it. Waits its turn behind any
// other sheet (the birthday pop-up, a badge) and simply shows on a later
// poll. Remembered on this device only, like the other one-time pop-ups.
const LAUNCH_KEY = 'rc_seen_run_ami_launch:'

export function checkForRunAmiLaunch(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  try {
    if (localStorage.getItem(`${LAUNCH_KEY}${agentNo}`) === '1') return
  } catch (_) {
    return // no way to show it only once: don't show it at all
  }
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  try { localStorage.setItem(`${LAUNCH_KEY}${agentNo}`, '1') } catch (_) {}

  const album = state.album || null
  const open = isRunAmiTester(agentNo) || !!album?.complete
  const count = Math.min(ALBUM_SIZE, Number(album?.count) || 0)
  const sheet = el('div', 'sheet ra-sheet rarmy-sheet rarmy-launch')
  sheet.innerHTML = `
    <span class="rarmy-eyebrow">🎮 New in ReConnect</span>
    <h3 tabindex="-1" data-autofocus="true">War of Cards is live now</h3>
    <div class="rarmy-launch-fan" aria-hidden="true">${TEASER.map((c) => cardHtml(c)).join('')}</div>
    <p class="rarmy-launch-lede">A last-card game for 2–4 agents, with BTS album-era cards. Find it in <b>Run ARMY</b>, the new games corner on the City map.</p>
    <ul class="rarmy-launch-steps">
      <li><span aria-hidden="true">📡</span><p><b>Finish the daily Signal Sweep</b> to collect a new BTS album cover.</p></li>
      <li><span aria-hidden="true">🎁</span><p><b>Friends can gift you a cover</b>, one a day. You can gift one too.</p></li>
      <li><span aria-hidden="true">💿</span><p><b>Collect all ${ALBUM_SIZE} covers</b> ${open ? 'to complete your album' : 'to play War of Cards'}.${count ? ` You have ${count} already.` : ''}</p></li>
    </ul>
    ${open ? '<p class="rarmy-launch-open">You can play now.</p>' : ''}`
  const go = el('button', 'btn btn-primary', 'Open Run ARMY')
  go.type = 'button'
  go.onclick = () => { hideOverlay(); openRunArmy() }
  const later = el('button', 'btn btn-ghost', 'Later')
  later.type = 'button'
  later.onclick = hideOverlay
  sheet.append(go, later)
  showOverlay(sheet)
}
