// World screen — the hub.
//
// Reads top to bottom as: any active broadcast (HT has something to say), a
// breach if there is one (drop everything), what I'm restoring right now
// (the one button that matters — the mission dominates, it's the reason
// this screen exists), the ARMY Bomb as a compact status line (real data,
// but it's network status, not the mission), then how the whole city is
// doing and where I can go.
//
// The mission card used to sit after the ARMY Bomb, which by itself was
// most of a screen's height before a player ever reached the thing they
// came here to do. The Bomb still shows real charge/boost data, just
// smaller and lower down the page — see .army-core's ~30%-smaller sizing
// in reconnect.css.
//
// The map is a stack of ward tiles (ward-tiles.js) — each ward a card with a
// mini skyline, one building per district, lit as they restore. The tiles
// carry the name/count/state text themselves, so there is no separate ward
// list: the map IS the list. Home Base itself never gets a tile there — see
// ward-tiles.js's header comment — since it's already this mission card and
// the map's own centre landmark; a third copy was pure repetition.

import { el, esc, showOverlay, hideOverlay, unlockAfter } from './state.js'
import { goWorld, goWard, goDistrict, goCandyStar, goGoldenCorner } from './router.js'
import { districtFraction } from './ui-district.js'
import { districtGoalsLeft, districtPercent } from './district-progress.js'
import { renderWardTiles, glanceStrip, wardDisplayName, districtDisplayName, HOME_BASE_WARD } from './ward-tiles.js'
import { renderCityMap } from './city-map.js'
import { districtIcon } from './landmarks.js'
import { openFinder } from './search.js'
import { openShare } from './share.js'
import { agentChargeSheet } from './agent-charge.js'
import { broadcastCards } from './broadcasts.js'
import { cityFeedCard } from './city-feed.js'
import { openSuggestions } from './suggestions.js'
import { openMagicShop } from './magic-shop.js'
import { vmaEventCard, openVmaMission } from './vma.js'
import { redZoneSheet, defuseResultSheet, defenderCommsSheet, getCommsSeen } from './bomb-sheet.js'
import { tickCountdowns } from './countdown.js'
import { redZonePercent, personalSignalCopy, redZoneHeadline, redZoneGoalCopy,
  unreadCommsCount, unreadBadgeText } from './red-zone-ui.js'

export function renderWorld(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'world-screen')
  const b = state.bomb || { charge: 0, defuse: null, brownout: false }

  const bc = broadcastCards(state)
  if (bc.children.length) wrap.appendChild(bc)
  // Red Zone no longer gets its own banner here — it's the existing ARMY
  // Bomb itself (coreBlock, below) that turns compromised/crimson and shows
  // progress. See maybeShowDefuseResult for the one-shot success/failure
  // acknowledgement, which also used to be this card's job.
  if (state.vma) wrap.appendChild(vmaEventCard(state))
  const goldenBanner = goldenCornerBanner(state)
  if (goldenBanner) wrap.appendChild(goldenBanner)
  maybeShowDefuseResult(state.bomb?.resolvedDefuse)

  // One playable command scene instead of a dashboard stack. The map is the
  // world; personal charge, recovery and the current mission sit on its edge
  // as HUD prompts. Ward tiles, status cards and the Era strip were duplicate
  // summaries of information already reachable by tapping the map/Bomb.
  const command = el('section', 'command-scene' + (b.defuse ? ' is-redzone' : ''))
  command.appendChild(cityPlan(state))
  command.appendChild(recoverySignal(state))
  const core = el('div', 'command-core')
  core.appendChild(coreBlock(state))
  command.appendChild(core)
  const mission = opCard(state)
  mission.classList.add('mission-beacon')
  command.appendChild(mission)
  command.appendChild(commandTools(state))
  wrap.appendChild(command)

  // "Other agents are here right now" — right under the map/Bomb scene,
  // high enough that it doesn't need scrolling to notice. command-scene
  // above is an absolutely-positioned overlay layout (map + Bomb dial
  // composited on a background), not normal flow, so this has to sit
  // outside it as a normal sibling rather than another absolute child.
  // See city-feed.js's header comment.
  wrap.appendChild(cityFeedCard(state))

  if (state.sideMissions) wrap.appendChild(sideMissionsPanel(state.sideMissions))

  // Personal weekly Era Cards are the Bomb's emergency reserve. This is not
  // the community/all-time Era Timeline: every count here belongs to this
  // agent, resets Monday, and a lit card waits in Pack until they spend it.
  if (state.agentCharge?.eraCards?.length) wrap.appendChild(weeklyEraCards(state))

  container.appendChild(wrap)
}

// Two clocks run this loop, and neither one is visible anywhere else in the
// UI — the daily 1× requirement resets at KST midnight (a track streamed at
// 11:59pm KST and again at 12:01am KST is two separate clears), and the
// weekly 20× total resets Monday KST regardless of how the daily streak
// went. Without saying so anywhere, "why did my streak/count just drop to
// zero" reads as a bug instead of the schedule working as designed — this
// panel and its detail sheet now both say it in plain words, plus the
// actual week's date range, instead of leaving it implied by a UI that
// resets silently overnight.
function weekRangeLabel(weekDates) {
  if (!weekDates?.length) return ''
  const fmt = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number)
    return `${MONTH_SHORT[(m || 1) - 1]} ${d}`
  }
  return `${fmt(weekDates[0])}–${fmt(weekDates[weekDates.length - 1])}`
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function sideMissionsPanel(mission) {
  const done = Number(mission.todayDoneCount) || 0
  const total = mission.tracks?.length || 4
  const weekGaps = (mission.tracks || []).filter((t) => !t.weeklyDone).length
  const section = el('section', 'side-missions' + (mission.todayDone ? ' is-cleared' : ''))
  section.innerHTML = `
    <div class="side-mission-head">
      <div><span class="side-mission-kicker">Stabilize the BOTZ signal</span><h3>Signal Sweep</h3></div>
      <div class="side-mission-status">
        <span class="side-mission-today">${mission.todayDone ? 'SECURED' : `${done}/${total} TODAY`}</span>
        <span class="side-mission-week-tag${mission.weekDone ? ' is-done' : ''}">${mission.weekDone ? 'WEEK CLEAR' : `${weekGaps} behind this week`}</span>
      </div>
    </div>
    <p class="side-mission-rule">Stream each track <b>1×</b> today <em>and</em> <b>${mission.weeklyRequired}×</b> total this week.</p>
    <p class="side-mission-reset">Daily resets at midnight KST &middot; week resets Monday KST &middot; this week: ${weekRangeLabel(mission.weekDates)}</p>
    <div class="side-mission-tracks"></div>
    <div class="side-mission-reward">${mission.todayDone
      ? `+${mission.xpOnComplete} XP secured today`
      : `Complete all four today · +${mission.xpOnComplete} XP`}</div>
    <div class="side-mission-week-reward${mission.weekDone ? ' is-done' : ''}">${mission.weekDone
      ? `+${mission.weeklyXpOnComplete} XP secured this week`
      : `Clear all four at ${mission.weeklyRequired}× this week · +${mission.weeklyXpOnComplete} XP`}</div>`

  const list = section.querySelector('.side-mission-tracks')
  for (const track of mission.tracks || []) {
    const pct = Math.min(100, Math.round((track.weeklyTotal / Math.max(1, track.weeklyRequired)) * 100))
    const row = el('button', 'side-mission-track' + (track.todayDone ? ' is-done' : ''))
    row.type = 'button'
    const todayLabel = track.todayDone ? 'Done today' : 'Not streamed today'
    row.setAttribute('aria-label', `${track.name} by ${track.artist}. ${todayLabel}. ${track.weeklyTotal} of ${track.weeklyRequired} this week.`)
    row.innerHTML = `
      <span class="side-track-check">${track.todayDone ? '✓' : '○'}</span>
      <span class="side-track-copy"><b>${esc(track.name)}</b><i>${esc(track.artist)} &middot; ${esc(todayLabel)}</i></span>
      <span class="side-track-week">${track.weeklyTotal}/${track.weeklyRequired}</span>
      <span class="side-track-bar"><i style="width:${pct}%"></i></span>`
    row.onclick = () => showOverlay(sideMissionSheet(mission, track.id))
    list.appendChild(row)
  }
  return section
}

function sideMissionSheet(mission, selectedId = null) {
  const weekGaps = (mission.tracks || []).filter((t) => !t.weeklyDone).length
  const sheet = el('div', 'sheet side-mission-sheet')
  sheet.append(
    el('div', 'eyebrow', 'SIGNAL SWEEP'),
    el('h3', '', mission.todayDone ? 'BOTZ signal stabilized' : `${mission.todayDoneCount}/${mission.tracks.length} signals recovered`),
  )
  // Same "what's actually required, and when does it clear" question this
  // whole redesign is answering, just spelled out in full sentences for the
  // detail view: two separate requirements (1× today, 20× this week), two
  // separate clocks (midnight KST, Monday KST), and — since "today" alone
  // doesn't say which today — the actual calendar week this progress
  // belongs to.
  sheet.appendChild(el('div', 'side-sheet-status'))
  const statusRow = sheet.querySelector('.side-sheet-status')
  statusRow.innerHTML = `
    <div class="side-sheet-stat"><span>Today</span><b class="${mission.todayDone ? 'ok' : 'warn'}">${mission.todayDone ? 'SECURED' : 'PENDING'}</b></div>
    <div class="side-sheet-stat"><span>This week</span><b class="${mission.weekDone ? 'ok' : 'warn'}">${mission.weekDone ? 'CLEAR' : `${weekGaps} GAP${weekGaps === 1 ? '' : 'S'}`}</b></div>`
  sheet.appendChild(el('p', 'muted', `Each track needs 1+ stream today <b>and</b> ${mission.weeklyRequired}+ this week — separate requirements, separate clocks. Daily resets at midnight KST; the week (${weekRangeLabel(mission.weekDates)}) resets Monday KST regardless of today's progress.`))
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  for (const track of mission.tracks || []) {
    const row = el('div', 'side-sheet-track' + (track.id === selectedId ? ' is-selected' : ''))
    const todayLabel = track.todayDone ? `✓ Done today (${track.todayCount}×)` : 'Not streamed today yet'
    row.innerHTML = `
      <div class="side-sheet-title"><b>${esc(track.name)}</b><span>${track.weeklyTotal}/${track.weeklyRequired} this week</span></div>
      <div class="side-sheet-today ${track.todayDone ? 'ok' : 'warn'}">${esc(todayLabel)}</div>
      <div class="side-sheet-days">${(track.days || []).map((day, index) => `
        <span class="${day.future ? 'future' : day.done ? 'done' : 'miss'}"><i>${days[index]}</i><b>${day.future ? '·' : day.count}</b></span>`).join('')}</div>`
    sheet.appendChild(row)
  }
  sheet.appendChild(el('div', 'dim', mission.todayDone
    ? `Daily clear complete · +${mission.xpOnComplete} XP awarded once`
    : `Finish all four before midnight KST · +${mission.xpOnComplete} XP`))
  sheet.appendChild(el('div', 'dim', mission.weekDone
    ? `Weekly clear complete · +${mission.weeklyXpOnComplete} XP awarded once`
    : `Hit ${mission.weeklyRequired}× on all four before Monday · +${mission.weeklyXpOnComplete} XP`))
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function weeklyEraCards(state) {
  const charge = state.agentCharge || {}
  const newly = new Set(charge.newlyLitEraIds || [])
  const ready = (charge.eraCards || []).filter((e) => e.status === 'lit').length
  const wrap = el('section', 'era-strip command-era-strip')
  wrap.innerHTML = `
    <div class="era-strip-head">
      <span class="era-strip-label">Era Cards</span>
      <span class="era-ready-count">${ready} ready · +10h each</span>
    </div>`
  const row = el('div', 'era-row')
  for (const e of charge.eraCards || []) {
    const chip = el('button', `era-chip era-${e.status}${newly.has(e.id) ? ' just-lit' : ''}`)
    chip.type = 'button'
    const status = e.status === 'lit' ? 'READY · +10H'
      : e.status === 'used' ? 'USED THIS WEEK'
      : e.status === 'keepsake' ? 'COLLECTED · 09.01'
      : `${e.done}/${e.total} · ${e.remaining} LEFT`
    chip.setAttribute('aria-label', `${e.name}. ${status}.`)
    chip.innerHTML = `
      <span class="era-icon">${e.icon}</span>
      <span class="era-name">${esc(e.name)}</span>
      <span class="era-count">${status}</span>
      ${newly.has(e.id) ? '<i>CARD ACTIVATED</i>' : ''}
    `
    chip.onclick = () => e.status === 'lit'
      ? showOverlay(agentChargeSheet(e.id))
      : showOverlay(eraTracksSheet(e, true))
    row.appendChild(chip)
  }
  wrap.appendChild(row)
  return wrap
}

function recoverySignal(state) {
  const wards = state.map?.wards || []
  const total = wards.reduce((sum, w) => sum + (w.totalCount || 0), 0)
  const done = wards.reduce((sum, w) => sum + (w.restoredCount || 0), 0)
  const pct = total ? Math.round((done / total) * 100) : 0
  const wrap = el('div', 'recovery-signal')
  const row = el('div', 'recovery-row', `
    <span class="recovery-orbit" style="--recovery:${pct * 3.6}deg"><b>${pct}%</b></span>
    <span class="recovery-copy"><b>City recovery</b><i>${done}/${total} online</i></span>
  `)
  wrap.appendChild(row)
  // Real agents currently on the app, not districts — deliberately worded
  // "active now" rather than reusing "online" (the span just above means
  // "this district's power is back on," a completely different thing).
  // Genuine presence (feed.ts's markOnline/getOnlineNow), not a proxy —
  // this is what actually answers "is anyone else here right now."
  //
  // Codenames only, on purpose: City is a lightweight "other agents are
  // around" signal, not a locator. Where each agent actually is now lives on
  // the district screen instead (screen-district.js's agents-here row) —
  // the one place that information is actually useful, right where you'd
  // act on it.
  const n = state.onlineNow?.count || 0
  if (n > 0) {
    const codenames = state.onlineNow.codenames || (state.onlineNow.agents || []).map((a) => a.codename)
    const shown = codenames.slice(0, 3).map((name) => esc(name)).join(' · ')
    const more = n > 3 ? ` +${n - 3}` : ''
    const line = el('div', 'active-now', `<i class="active-now-dot"></i>${n} agent${n === 1 ? '' : 's'} active now`
      + (shown ? `<span class="active-now-names">${shown}${more}</span>` : ''))
    wrap.appendChild(line)
  }
  return wrap
}

function commandTools(state) {
  const button = el('button', 'command-tools', '•••')
  button.type = 'button'
  button.setAttribute('aria-label', 'City tools')
  button.onclick = () => {
    const sheet = el('div', 'sheet command-tool-sheet')
    sheet.append(el('div', 'eyebrow', 'CITY TOOLS'), el('h3', '', 'What do you need?'))
    const share = el('button', 'btn btn-ghost', '📤 Share city progress')
    share.onclick = () => showOverlay(openShare(state))
    const find = el('button', 'btn btn-ghost', '🔍 Find an agent or district')
    find.onclick = () => { hideOverlay(); openFinder(state) }
    // Moved off the map (city-map.js's toolMarker cluster is now Candy Star
    // + Magic Shop only, two real places — a feedback form was never a
    // place). Still one tap away, just not competing for map real estate.
    const suggest = el('button', 'btn btn-ghost', '💡 Suggestions')
    suggest.onclick = () => { hideOverlay(); openSuggestions() }
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.append(share, find, suggest, close)
    showOverlay(sheet)
  }
  return button
}

/* ── The map ────────────────────────────────────────────────────────────
   Ward skyline tiles — see ward-tiles.js. */

function mapHead(state) {
  const wrap = el('div')
  const row = el('div', 'map-head')
  row.appendChild(el('span', 'world-eyebrow', 'City map'))
  const tools = el('span', 'map-tools')
  const share = el('button', 'find-btn', '📤 Share')
  share.onclick = () => showOverlay(openShare(state))
  const find = el('button', 'find-btn', '🔍 Find')
  find.onclick = () => openFinder(state)
  tools.append(share, find)
  row.appendChild(tools)
  wrap.appendChild(row)
  // Persistent, not a one-time tip — a stranger's first instinct is to tap
  // the ARMY Bomb (it's the biggest, brightest thing on screen), not this
  // map. Saying outright that the map is the way in beats hoping the visual
  // pulse on the available ward (below) gets noticed on its own. "Tap a
  // ward" is actively wrong early on, when every ward but Home Base is
  // sealed — name the one thing that's actually open instead.
  wrap.appendChild(el('div', 'map-hint', mapHint(state)))
  return wrap
}

function mapHint(state) {
  const home = (state.map?.wards || []).find((w) => w.id === HOME_BASE_WARD)
  return home && home.status !== 'restored'
    ? 'Home Base is open — tap the center to begin.'
    : 'Tap a ward to enter the city.'
}
/* The whole world, on the home screen — the entire valley at once, one block
   per district, each lighting as that district comes back. city-map.js has
   drawn this for a long time but nothing ever mounted it; the World screen
   showed only the ward tiles below, so you could see a ward's skyline but
   never the city those wards add up to. Tapping a ward opens it, same as its
   tile. The tiles stay: this answers "how much of the world is back", the
   tiles answer "what do I do next". */
function cityPlan(state) {
  const wards = state.map?.wards || []
  if (!wards.length) return el('div')
  const box = el('div', 'city-plan')
  // The core ring is solo progress, not the shared network Bomb — see
  // renderCityMap's homeFraction doc comment. Live districtFraction while
  // you're actually restoring Home Base; once you've moved on, the ward's
  // own status says whether it ended up finished.
  const activeD = state.activeDistrict
  const homeFraction = activeD?.wardId === HOME_BASE_WARD
    ? districtFraction(activeD)
    : wards.find((w) => w.id === HOME_BASE_WARD)?.status === 'restored' ? 1 : 0
  const golden = state.agentCharge?.goldenCorner
  const goldenProgress = golden ? Math.min(1, golden.communityLights / Math.max(1, golden.target)) : 0
  box.appendChild(renderCityMap(wards, state.map?.districts || [],
    (w, origin) => goWard(w.id, origin), homeFraction,
    (origin) => goCandyStar(origin),
    () => openMagicShop(),
    state.vma ? () => openVmaMission() : null,
    !!(state.vma?.isPowerHour || state.vma?.isDoubleDay),
    golden ? (origin) => goGoldenCorner(origin) : null,
    goldenProgress))
  return box
}

/** A tiny, temporary entry point for the one-day GOLDEN birthday event —
 *  the .vma-banner card was too big next to the real VMA banner this
 *  screen can already be showing; this is the same compact single-row
 *  pill hud-reconnect-status already uses for "something needs a tap"
 *  status lines. Real light count, not a static "party open" line — hides
 *  once the room is fully lit, same as the room itself has nothing left
 *  to invite anyone into. */
function goldenCornerBanner(state) {
  const corner = state.agentCharge?.goldenCorner
  if (!corner) return null
  const community = Number(corner.communityLights) || 0
  const target = Math.max(1, Number(corner.target) || 1)
  if (community >= target) return null

  const pill = el('button', 'gc-status-pill', `
    <span>🐰 JUNG KOOK DAY</span>
    <b>${community.toLocaleString()} / ${target.toLocaleString()} lights &middot; join the party</b>
    <i>›</i>
  `)
  pill.type = 'button'
  pill.onclick = (e) => goGoldenCorner({ x: e.clientX, y: e.clientY })
  return pill
}

// Exported only so the local design-review preview (_golden_corner_preview.html)
// can render several bands side by side without duplicating this markup —
// not a second entry point into the room, nothing else imports it.
export function goldenRoom(progress, personalComplete) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)))
  const band = pct >= 100 ? 100 : pct >= 90 ? 90 : pct >= 75 ? 75 : pct >= 50 ? 50 : pct >= 25 ? 25 : 0
  const room = el('div', `stage gc-room gc-p${band}${personalComplete ? ' is-personal-complete' : ''}`)
  room.style.setProperty('--gc-light', String(progress))
  room.setAttribute('role', 'img')
  room.setAttribute('aria-label', `Golden Corner is ${pct}% lit`)
  room.innerHTML = `
    <div class="gc-props">
      <div class="gc-wall"></div><div class="gc-floor"></div>
      <div class="gc-fairy" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="gc-bunting" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="gc-lamp" aria-hidden="true"></div>
      <div class="gc-shelf" aria-hidden="true"><span class="gc-frame"></span><span class="gc-bunny">🐰</span><span class="gc-date">09·01</span></div>
      <div class="gc-table" aria-hidden="true"></div>
      <div class="gc-cake" aria-hidden="true"><i></i><span></span></div>
      <div class="gc-mic" aria-hidden="true"></div>
      <div class="gc-turntable" aria-hidden="true"><i></i><span></span></div>
      <div class="gc-shadow"></div>
    </div>
    <div class="stage-overlay gc-stage-overlay">
      <div class="stage-top"><div class="stage-eyebrow">${pct >= 100 ? 'ONLINE' : 'LIGHTING UP'}</div><div class="stage-name">Golden Corner</div></div>
      <div class="stage-bottom"><div class="stage-power"><span class="pw-val">${pct >= 100 ? 'FULLY' : `${pct}%`}</span><span class="pw-lbl">${pct >= 100 ? 'LIT ✦' : 'LIT'}</span></div><div class="stage-meter"><div class="stage-meter-fill" style="width:${pct}%"></div></div></div>
    </div>`
  return room
}

function goldenCornerContent(state) {
  const corner = state.agentCharge?.goldenCorner
  const card = (state.agentCharge?.eraCards || []).find((entry) => entry.id === corner?.eventId)
  const community = Number(corner?.communityLights) || 0
  const target = Math.max(1, Number(corner?.target) || 260)
  const progress = Math.min(1, community / target)
  const personalDone = Math.min(Number(card?.done) || 0, Number(card?.total) || 13)
  const personalTotal = Number(card?.total) || 13
  const personalComplete = personalDone >= personalTotal || card?.status === 'keepsake'

  const sheet = el('div', 'golden-corner-content')
  sheet.append(goldenRoom(progress, personalComplete))
  const copy = el('div', 'gc-copy')
  copy.innerHTML = progress >= 1
    ? `<h3>Happy Jung Kook Day 💜</h3><p>A little room in the City lit up today. ${personalDone ? 'You helped light it.' : ''}</p>`
    : '<h3>Light up Golden Corner together 🐰</h3><p>Complete your GOLDEN Birthday Era Card. Every track adds a little more light.</p>'
  sheet.appendChild(copy)

  // Three community numbers, in the order they answer "is this working?":
  // how lit the room is, how many of us lit it, and what you personally
  // still have left. `agents` counts everyone who has lit at least one
  // track here today — the room is not a district, so there is no live
  // presence feed to say who is standing in it this second.
  const agents = Math.max(0, Number(corner?.agents) || 0)
  const progressRow = el('div', 'gc-progress')
  progressRow.innerHTML = `
    <span><i>OUR LIGHTS</i><b>${community} / ${target}</b></span>
    <span><i>ARMY HERE</i><b>${agents}</b></span>
    <span><i>YOUR CARD</i><b>${personalDone} / ${personalTotal}</b></span>`
  sheet.appendChild(progressRow)
  // "Finished" is the harder number and the one people will ask about, so
  // it rides in the sentence rather than taking a fourth stat box that
  // would crowd the row at 320px.
  const completed = Math.max(0, Number(corner?.completed) || 0)
  const lightLine = agents === 0
    ? 'Be the first to light it today.'
    : agents === 1
      ? '1 ARMY has helped light the Corner today'
      : `${agents} ARMY have helped light the Corner today`
  const finishedLine = agents === 0 ? ''
    : completed === 0 ? ' — nobody has completed their card yet.'
    : completed === 1 ? ' · 1 completed their card.'
    : ` · ${completed} completed their card.`
  sheet.appendChild(el('p', 'gc-agents-note', `${lightLine}${finishedLine}`))

  if (personalComplete) {
    const reward = el('div', 'gc-reward')
    reward.innerHTML = '<b>YOUR LIGHT IS IN ✨</b><span>Jung Kook Birthday Badge · +10H charge</span>'
    sheet.appendChild(reward)
    const music = el('section', 'gc-music')
    music.innerHTML = `
      <div><p><b>NOW PLAYING IN GOLDEN CORNER 🎵</b><span>Euphoria</span></p></div>
      <iframe title="Euphoria by Jung Kook on Spotify" src="https://open.spotify.com/embed/track/5YMXGBD6vcYP7IolemyLtK?utm_source=generator&theme=0" width="100%" height="152" frameborder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>`
    sheet.appendChild(music)
  } else if (card) {
    sheet.appendChild(el('p', 'gc-record-note', 'Complete your GOLDEN card to unlock the birthday listening moment.'))
    const continueButton = el('button', 'btn btn-primary', 'Continue GOLDEN')
    continueButton.onclick = () => showOverlay(eraTracksSheet(card, true))
    sheet.appendChild(continueButton)
  }

  return sheet
}

export function renderGoldenCorner(container, state) {
  if (!state.agentCharge?.goldenCorner) { goWorld(); return }
  container.innerHTML = ''
  const screen = el('div', 'golden-corner-screen')
  const head = el('div', 'screen-head')
  const back = el('button', 'back-btn', 'City')
  back.onclick = (event) => goWorld({ x: event.clientX, y: event.clientY })
  head.appendChild(back)
  screen.append(head, goldenCornerContent(state))
  container.appendChild(screen)
}

function mapField(state) {
  const wards = state.map?.wards || []
  if (!wards.length) return el('div')
  return renderWardTiles(wards, state.map?.districts || [],
    (w, origin) => goWard(w.id, origin),
    (d, w) => showOverlay(peekSheet(d, w, state)))
}

/* ── Peeking at one building ────────────────────────────────────────────
   Every building in a ward's skyline is a real district, so tapping one
   should tell you whose it is and let you go there — the skyline stops
   being a picture of the data and becomes the data. */

const PEEK_STATE = {
  restored: 'Restored', active: 'Restoring', available: 'Offline',
  locked: 'Sealed', centerpiece_dark: 'Dormant', centerpiece_lit: 'Awake',
}

function peekSheet(d, ward, state) {
  const live = state.activeDistrict?.id === d.id ? state.activeDistrict : null
  const pct = d.status === 'restored' || d.status === 'centerpiece_lit' ? 100
    : d.status === 'active' ? districtPercent(live)
    : 0

  const sheet = el('div', 'sheet peek')
  sheet.appendChild(el('div', 'peek-head', `
    <span class="peek-icon">${districtIcon(d.name)}</span>
    <span class="peek-id">
      <span class="peek-name">${esc(districtDisplayName(d))}</span>
      <span class="peek-ward">${esc(wardDisplayName(ward))} &middot; ${PEEK_STATE[d.status] || ''}</span>
    </span>
  `))

  if (d.echoOf) {
    sheet.appendChild(el('div', 'peek-guardian', `<span>👤 Guardian</span><b>${esc(d.echoOf)}</b>`))
  }

  if (d.status !== 'locked' && d.status !== 'centerpiece_dark') {
    sheet.appendChild(el('div', 'goal-line', `
      <div class="pbar" style="flex:1" role="progressbar" aria-label="${esc(districtDisplayName(d))} restoration progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="pfill${pct === 100 ? ' done' : ''}" style="width:${pct}%"></div></div>
      <span class="count">${pct}%</span>`))
  }

  if (d.status === 'centerpiece_dark') {
    sheet.appendChild(el('div', 'dim', 'Nobody keeps this one. It stays dark until every district around it is back.'))
  } else if (d.status === 'locked') {
    const gate = unlockAfter(state.map?.wards || [], d.wardId)
    sheet.appendChild(el('div', 'dim', gate
      ? `🔒 Sealed until ${esc(wardDisplayName(gate))} is whole.`
      : '🔒 Opens later in the operation.'))
  }

  const open = el('button', 'btn btn-primary', 'Open district')
  open.onclick = (e) => { hideOverlay(); goDistrict(ward.id, d.id, { x: e.clientX, y: e.clientY }) }
  sheet.appendChild(open)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/* ── The ARMY Bomb ──────────────────────────────────────────────────────── */

// The World screen re-renders on every poll (main.js, every 90s + tab focus)
// — the power-on entrance and the count-up should only ever play the first
// time an agent sees the bomb this session, not replay on every refresh,
// which would read as glitchy rather than as an entrance.
let bombIntroPlayed = false
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function coreBlock(state) {
  const charge = state.agentCharge || { hoursRemaining: 0, isDark: false }
  const cells = Number(state.player?.chargeCells) || 0
  const hours = Math.max(0, Number(charge.hoursRemaining) || 0)
  const neverFed = !charge.isDark && hours <= 0
  const defuse = state.bomb?.defuse || null
  const firstReveal = !bombIntroPlayed
  bombIntroPlayed = true

  const zone = el('div', 'core-block' + (defuse ? ' is-redzone' : ''))

  // Personal charge is a completely different number from Red Zone
  // progress — while an event is active the Bomb's main dial tells the
  // city's story, so charge moves to a small secondary line underneath
  // instead of disappearing. See btn.onclick below for the corresponding
  // tap-target swap.
  const chargeFrac = Math.max(0, Math.min(1, hours / 48))
  // Same 48-hour visual ceiling as the full Personal Charge sheet: one Cell
  // visibly helps without making a 2-hour feed look completely full.
  const mainFrac = defuse ? Math.max(0, Math.min(1, defuse.progress / Math.max(1, defuse.target))) : chargeFrac

  // Red Zone leads with what happened and what to do about it, in that
  // order: headline, then the instruction generated from this event's own
  // target, then the clock. The lore eyebrow ("SIGNAL BREACH") is gone on
  // purpose — it said the same thing as the headline in words a new player
  // has to translate first.
  const band = defuse ? redZoneBandOf(defuse) : null
  const head = defuse ? redZoneHeadline(band) : null
  const goal = defuse ? redZoneGoalCopy(defuse, band) : null
  if (!defuse) zone.appendChild(el('div', 'core-eyebrow', 'Your lifeline'))
  zone.appendChild(el('div', 'core-title', defuse ? `${head.icon} ${head.title}` : 'ARMY Bomb'))
  if (defuse) {
    zone.appendChild(el('div', 'core-goal', esc(goal.instruction)))
    const untilIso = defuse.activeUntil || defuse.endsAt
    zone.appendChild(el('div', 'core-timer', `<b data-deadline="${esc(untilIso)}">--:--:--</b><i>left</i>`))
  }

  const btn = el('button', 'army-core'
    + (defuse ? ` is-attack is-band-${redZoneBandOf(defuse)}` : (charge.isDark || neverFed ? ' is-brownout' : ''))
    + (firstReveal && !reducedMotion() ? ' core-intro' : ''))
  btn.setAttribute('aria-label', defuse
    ? `The City is under attack. The ARMY Bomb is ${redZonePercent(defuse.progress, defuse.target)} percent defused. ${goal.instruction}. Tap for details.`
    : charge.isDark
      ? 'Your ARMY Bomb is dark. Tap to feed it.'
      : neverFed ? 'Your ARMY Bomb is empty. Tap to charge it.'
      : `Your ARMY Bomb has ${Math.round(hours)} hours remaining. Tap to feed it.`)
  // Red Zone uses the Bomb itself as the progress display. It starts with
  // one red liquid layer and drains to neutral dark glass as qualified
  // streams arrive. Personal charge remains a separate supporting value;
  // its purple fill, rings and particles are deliberately not rendered in
  // the Red Zone state.
  const CIRC = 2 * Math.PI * 106
  const ringsHtml = `
      <circle class="ring-outer" cx="110" cy="110" r="98"></circle>
      <circle class="ring-inner" cx="110" cy="110" r="90"></circle>
      <circle class="ring-charge-bg" cx="110" cy="110" r="106"></circle>
      <circle class="ring-charge" cx="110" cy="110" r="106" transform="rotate(-90 110 110)"
        stroke-dasharray="${(CIRC * chargeFrac).toFixed(1)} ${CIRC.toFixed(1)}"></circle>
  `
  const normalDecorHtml = defuse ? '' : `
    <svg class="core-rings" viewBox="0 0 220 220" aria-hidden="true">
      ${ringsHtml}
    </svg>
    <div class="core-particles"><span></span><span></span><span></span><span></span><span></span><span></span></div>
  `
  btn.innerHTML = `
    <div class="core-glow"></div>
    ${normalDecorHtml}
      <div class="rc-bomb">
      <div class="rc-sphere">
        <span class="rc-fill"></span>
        ${defuse ? '<span class="rz-liquid" aria-hidden="true"></span>' : ''}
        <span class="rc-shine"></span>
        <span class="rc-shine-2"></span>
        <span class="rc-logo">⟭⟬</span>
      </div>
      <div class="rc-handle"><span class="rc-grip"></span><span class="rc-grip"></span></div>
    </div>
  `
  btn.style.setProperty('--charge', (defuse ? 0 : mainFrac).toFixed(3))
  if (defuse) {
    btn.style.setProperty('--rz-restored', mainFrac.toFixed(3))
    btn.style.setProperty('--rz-glow-opacity', (0.08 + (1 - mainFrac) * 0.18).toFixed(3))
  }
  btn.onclick = () => showOverlay(defuse ? redZoneSheet(state) : agentChargeSheet())
  zone.appendChild(btn)

  if (defuse) {
    const pct = redZonePercent(defuse.progress, defuse.target)
    const read = el('div', 'core-read is-redzone')
    read.innerHTML = `
      <div class="core-pct">${pct}<i>% DEFUSED</i></div>
      <div class="core-lbl">${esc(goal.progressLine)}</div>
    `
    zone.appendChild(read)
    const signal = personalSignalCopy(defuse.yourStreams, defuse.minimumStreams)
    const support = el('div', 'core-support-row')
    support.appendChild(el('div', 'core-signal' + (signal.qualified ? ' is-qualified' : ''),
      `<span class="core-signal-lbl">Your streams</span><span class="core-signal-val">${esc(signal.value)}</span>`))
    const chargePill = el('button', 'core-charge-pill', `Personal charge · ${charge.isDark ? 'dark' : neverFed ? 'empty' : `${Math.round(hours)}h`}`)
    chargePill.onclick = (e) => { e.stopPropagation(); showOverlay(agentChargeSheet()) }
    support.appendChild(chargePill)
    zone.appendChild(support)

    // ARMY Comms, on the City screen itself. It used to be two taps in
    // (Bomb → details sheet → Comms), which is where a live channel goes to
    // be missed — the whole point of it is that people can see each other
    // streaming while the event is running. Locked state stays visible
    // rather than hidden: "there's a room here, one stream gets you in" is
    // the more useful message than showing nothing at all.
    // Unread lines since this agent last had the room open. A count rather
    // than a plain dot: "2 new" is a reason to look, an anonymous dot is
    // just decoration. Only for agents who can actually open it.
    const unread = defuse.isDefender
      ? unreadCommsCount(defuse.messageCount, getCommsSeen(defuse.id))
      : 0
    const badge = unreadBadgeText(unread)
    const comms = el('button', 'core-comms' + (defuse.isDefender ? '' : ' is-locked'), '')
    comms.innerHTML = defuse.isDefender
      ? `💬 ARMY Comms &middot; ${(defuse.defenderAgents || 0).toLocaleString()}`
        + (badge ? `<span class="core-comms-badge">${esc(badge)}</span>` : '')
      : '🔒 Stream once to join ARMY Comms'
    if (badge) {
      comms.setAttribute('aria-label',
        `ARMY Comms, ${unread} new message${unread === 1 ? '' : 's'}. ${defuse.defenderAgents || 0} ARMY defenders.`)
    }
    comms.disabled = !defuse.isDefender
    comms.onclick = () => showOverlay(defenderCommsSheet({
      eventId: defuse.id, progress: defuse.progress, target: defuse.target,
      defenderAgents: defuse.defenderAgents, messageCount: defuse.messageCount,
    }))
    zone.appendChild(comms)
    // "Comms" reads as communications to anyone who plays games and as
    // nothing at all to anyone who doesn't. The name earns its place in the
    // agent/city fiction; this line means nobody has to guess what it opens.
    // Kept as a sibling, not inside the button, so the locked state's own
    // dimming never takes the explanation down with it.
    zone.appendChild(el('div', 'core-comms-sub', defuse.isDefender
      ? 'Chat with other ARMY protecting the Bomb'
      : 'Contributors unlock the Red Zone chat'))

    // The Bomb is the entry point to everything else about the event, and a
    // sphere with no chrome doesn't read as tappable on its own.
    zone.appendChild(el('div', 'core-hint', 'Tap the ARMY Bomb for full details'))

    tickCountdowns()
    return zone
  }

  const read = el('div', 'core-read' + (charge.isDark ? ' is-attack' : ''))
  const chargeText = charge.isDark ? 'DARK' : neverFed ? 'EMPTY' : `${Math.round(hours)}H`
  read.innerHTML = `
    <div class="core-pct">${chargeText}</div>
    <div class="core-lbl">${charge.isDark ? 'charge lost &middot; tap to feed'
      : neverFed ? 'tap to start charging' : 'charge remaining &middot; tap to feed'}</div>
  `
  zone.appendChild(read)

  // The same affordance the Red Zone state carries. It matters more here:
  // .core-lbl ("tap to feed") is hidden inside the City scene on every
  // width, so outside a Red Zone the Bomb had NO visible instruction at all
  // — a sphere with no chrome that happens to be the entry point to the
  // whole charge economy.
  zone.appendChild(el('div', 'core-hint', charge.isDark
    ? 'Tap the ARMY Bomb to power it back up'
    : 'Tap the ARMY Bomb to charge it'))

  if ((charge.isDark || hours <= 2) && cells > 0) {
    const low = el('button', 'core-low-cta', 'LOW POWER · FEED 1 CELL → +2 HOURS')
    low.onclick = () => showOverlay(agentChargeSheet())
    zone.appendChild(low)
  }

  const litPorts = chargeFrac > 0 ? Math.max(1, Math.ceil(chargeFrac * 4)) : 0
  const ports = el('div', 'core-ports' + (charge.isDark || neverFed ? ' is-brownout' : ''))
  ports.innerHTML = Array.from({ length: 4 }, (_, i) => `<span class="wp${i < litPorts ? ' lit' : ''}"></span>`).join('')
  zone.appendChild(ports)

  // Charges up from 0 rather than just appearing, same "this is happening
  // live" feeling the count-up rings already sell — but only on the entrance,
  // never on a routine poll where the value usually hasn't moved.
  if (firstReveal && hours > 0 && !reducedMotion()) {
    const numEl = read.querySelector('.core-pct')
    const start = performance.now()
    const dur = 900
    requestAnimationFrame(function frame(now) {
      const t = Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - t, 3)
      numEl.textContent = `${Math.round(hours * eased)}H`
      if (t < 1) requestAnimationFrame(frame)
    })
  }
  return zone
}

function redZoneBandOf(defuse) {
  const frac = defuse.target > 0 ? Math.max(0, Math.min(1, defuse.progress / defuse.target)) : 0
  if (frac >= 1) return 'restored'
  if (frac >= 0.9) return 'final-push'
  if (frac >= 0.25) return 'restoring'
  return 'compromised'
}


/** One-shot success/failure acknowledgement. resolvedDefuse never expires
 *  on the server (see bomb.ts's own doc comment) so a slow/offline client
 *  still gets its chance to see the result — this is the client half of
 *  that contract: remember the last event id already shown, in
 *  localStorage (survives a reload, unlike an in-memory flag), and never
 *  show the same one twice. */
const LAST_DEFUSE_RESULT_KEY = 'rc_last_defuse_result_shown'
function maybeShowDefuseResult(resolved) {
  if (!resolved) return
  let lastShown = null
  try { lastShown = localStorage.getItem(LAST_DEFUSE_RESULT_KEY) } catch { /* private mode etc. */ }
  if (lastShown === resolved.id) return
  try { localStorage.setItem(LAST_DEFUSE_RESULT_KEY, resolved.id) } catch { /* best-effort only */ }
  showOverlay(defuseResultSheet(resolved))
}

/* ── The conduit ────────────────────────────────────────────────────────
   The bomb isn't decoration sitting above a list — it powers the city, and
   the city feeds it back. A pulse runs down this line into the operations
   map, faster the more personal charge remains. When the Bomb goes dark,
   it stops — the city has visibly lost its power source. */

function coreFeed(state) {
  const charge = state.agentCharge || { hoursRemaining: 0, isDark: false }
  const fraction = Math.max(0, Math.min(1, (Number(charge.hoursRemaining) || 0) / 48))
  const feed = el('div', 'core-feed' + (charge.isDark || fraction <= 0 ? ' is-brownout' : ''))
  feed.setAttribute('aria-hidden', 'true')
  feed.innerHTML = '<i class="cf-line"></i><i class="cf-pulse"></i><i class="cf-pulse d2"></i>'

  // More personal charge moves a stronger signal into the city below.
  const secs = (2.6 - fraction * 1.4).toFixed(2)
  for (const p of feed.querySelectorAll('.cf-pulse')) p.style.animationDuration = `${secs}s`
  return feed
}

/* ── Era Timeline ───────────────────────────────────────────────────────
   How much of the whole discography the NETWORK has collectively streamed,
   era by era — not per-district (districts are just agent names, nothing
   to do with BTS eras) and not per-team (this game doesn't have teams).
   One shared strip everyone sees the same numbers on, same framing as City
   Recovery below it.
   Each chip used to be read-only — a count with nothing to tap. But
   "12/16" doesn't tell you which 4 songs are still missing, and there was
   nowhere in the whole game that named them. Tapping a chip now opens the
   exact album/track list for that era, checkmarked against what the
   network has already crossed the stream threshold on. */

function eraTimelineStrip(timeline) {
  const wrap = el('div', 'era-strip')
  wrap.appendChild(el('div', 'era-strip-label', 'Era Timeline'))
  const row = el('div', 'era-row')
  for (const e of timeline.eras || []) {
    const chip = el('button', 'era-chip' + (e.done >= e.total && e.total > 0 ? ' done' : ''))
    if (e.description) chip.title = e.description
    chip.setAttribute('aria-label', `${e.name} — ${e.done} of ${e.total} streamed. Tap to see which songs.`)
    chip.innerHTML = `
      <span class="era-icon">${e.icon}</span>
      <span class="era-name">${esc(e.name)}</span>
      <span class="era-count">${e.done}/${e.total}</span>
    `
    chip.onclick = () => showOverlay(eraTracksSheet(e))
    row.appendChild(chip)
  }
  wrap.appendChild(row)
  return wrap
}

function eraTracksSheet(e, personal = false) {
  const sheet = el('div', 'sheet era-tracks')
  sheet.appendChild(el('div', 'eyebrow', `${e.icon} ${esc(e.name)}`))
  if (e.description) sheet.appendChild(el('p', 'muted', esc(e.description)))
  if (e.albums?.length) {
    sheet.appendChild(el('div', 'et-albums', `From: ${esc(e.albums.join(', '))}`))
  }
  sheet.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1" role="progressbar" aria-label="${esc(e.name)} tracks streamed" aria-valuemin="0" aria-valuemax="${e.total}" aria-valuenow="${Math.min(e.done, e.total)}"><div class="pfill${e.done >= e.total && e.total > 0 ? ' done' : ''}" style="width:${e.total ? Math.round((e.done / e.total) * 100) : 0}%"></div></div>
    <span class="count">${e.done} / ${e.total} streamed</span>`))
  sheet.appendChild(el('div', 'dim', personal
    ? (e.isSpecial
      ? (e.status === 'keepsake'
        ? 'Birthday card complete — your badge and +10H charge are secured.'
        : 'Stream every track once today to complete your birthday card, earn the badge, and add +10H charge.')
      : e.status === 'used'
      ? 'This card has powered your ARMY Bomb and resets Monday.'
      : 'Stream every track once this week to activate this +10h emergency card.')
    : 'Stream a song enough for the whole network to cross its threshold, and it lights up here for everyone.'))

  const list = el('div', 'et-list')
  for (const t of e.tracks || []) {
    const row = el('div', 'et-row' + (t.done ? ' done' : ''))
    row.innerHTML = `<span class="et-mark">${t.done ? '✓' : '○'}</span><span class="et-title">${esc(t.title)}</span>`
    list.appendChild(row)
  }
  sheet.appendChild(list)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}


/* ── The one thing the player is here to do ─────────────────────────────── */

function opCard(state) {
  const wards = state.map?.wards || []
  const districts = state.map?.districts || []
  const active = districts.find((d) => d.status === 'active')
  const card = el('section', 'op-card')

  if (active) {
    const ward = wards.find((w) => w.id === active.wardId)
    const live = state.activeDistrict?.id === active.id ? state.activeDistrict : null
    const pct = live ? districtPercent(live) : 0
    const left = live ? districtGoalsLeft(live) : null

    // Home base's single district carries the same raw name as the ward
    // around it, so the two lines below would render "Relay Zero" twice —
    // on the most prominent card of the first screen after sign-in.
    // districtDisplayName/wardDisplayName both promote it to "Home Base",
    // so drop the "where" line whenever it would only repeat the title back
    // (kept general: any ward whose centrepiece shares its name hits the
    // same thing).
    const name = districtDisplayName(active)

    card.classList.add('is-live')
    card.innerHTML = `
      <div class="op-top"><span class="op-eyebrow">Now restoring</span></div>
      <div class="op-name">${esc(name)}</div>
      <div class="op-meter"><div class="op-meter-fill" style="width:${pct}%"></div></div>
      <div class="op-foot">
        <span class="op-status">${left === null ? 'Loading&hellip;'
          : left === 0 ? 'Ready to restore'
          : `${pct}% &middot; ${left} goal${left === 1 ? '' : 's'} left`}</span>
        <button class="op-enter" type="button">${left === 0 ? 'Finish' : 'Enter'} <i>→</i></button>
      </div>
    `
    const go = card.querySelector('.op-enter')
    go.onclick = (e) => goDistrict(active.wardId, active.id, { x: e.clientX, y: e.clientY })
    return card
  }

  const ward = wards.find((w) => w.status === 'active')
    || wards.find((w) => w.status === 'available')
    || wards.find((w) => w.status !== 'locked')

  // Nothing open yet, so this card doubles as the tutorial: it names the
  // exact ward that's pulsing on the map below (see .wt-tile.available /
  // .cm-ward.available in reconnect.css) instead of just saying "pick one".
  card.classList.add('is-spotlight')
  card.innerHTML = `
    <div class="op-top"><span class="op-eyebrow">You're up</span></div>
    <div class="op-name">Pick a district</div>
    <div class="op-note">${ward
      ? `Start here — <b>${esc(wardDisplayName(ward))}</b> is highlighted on the map below. Open it and pick who you're bringing back.`
      : 'All quiet out there. Check back tomorrow.'}</div>
  `
  if (ward) {
    const go = el('button', 'btn btn-primary op-go', `Choose a district in ${wardDisplayName(ward)}`)
    go.onclick = (e) => goWard(ward.id, { x: e.clientX, y: e.clientY })
    card.appendChild(go)
  }
  return card
}

// The bomb's panel lives in bomb-sheet.js — it grew into a real dashboard.
