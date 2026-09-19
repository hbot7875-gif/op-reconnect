// ARIRANG RE:CELEBRATE Watch Party — the stage.
//
// The embedded YouTube performance is the show; ReConnect provides the venue
// around it. Everything that reacts (the LED sign, the palette, ARMY Bomb
// tempo, timed confetti) comes from resolveMoment() in
// recelebrate-watch-program.js, driven by the YouTube player's OWN
// currentTime / playlist index — never a separate browser timer — so a pause,
// a seek or a buffer keeps the venue in step with the video.
//
// The player is created once per Party visit and never destroyed by chat
// opening/closing or by switching Battle ↔ Watch; those only toggle classes.
// Nothing is downloaded or rehosted: it's the privacy-enhanced
// (youtube-nocookie) embed of the published playlist.
//
// The agent's own ARMY Bomb is their EXISTING ReConnect Bomb — the exact
// City-screen Bomb, built by the same renderer (army-bomb.js) with the same
// styles, and lit by the same real charge/brownout logic. Watch only scales
// it up and moves the whole thing with the song; it never redraws it. Charge
// changes light only — it never gates watching. The crowd are that same Bomb
// design, smaller and lighter to render; they're atmosphere, not real
// presence (none is faked), laid out so a presence feed can drive them later.
//
// Concert behaviour comes in two layers from the program file: each song's
// base STYLE (subtle, continuous) and its authored MOMENTS (a synchronized
// swing, a wave of light across the crowd, a blackout, Bombs up, lasers).
// Window moments are toggled as classes from the player's clock every tick;
// cue moments fire once when the clock crosses them. A colour moment may
// tint the agent's Bomb, but only a lit one, and only its colour: the fill
// level, glow strength and dark/brownout state always stay the real charge.

import { el, esc } from './state.js'
import { armyBombCharge, armyBombInnerHtml } from './army-bomb.js'
import { WATCH_SCHEDULE_DAY, PREMIERE_LEAD_MS, watchScheduleStates, defaultStageEvent, fmtCountdown, scheduleNow } from './recelebrate-schedule.js'
import { WATCH_PLAYLIST, WATCH_ITEMS, SONG_BOMB_COLORS, EXTRA_BOMB_COLORS, resolveMoment, activeMoments, cuesCrossed, upNext } from './recelebrate-watch-program.js'

const TICK_MS = 250
const API_TIMEOUT_MS = 12000
const MAX_SKIPS = 4
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

let apiPromise = null
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => reject(new Error('youtube_api_blocked'))
    document.head.appendChild(s)
    setTimeout(() => reject(new Error('youtube_api_timeout')), API_TIMEOUT_MS)
  }).catch((e) => { apiPromise = null; throw e })
  return apiPromise
}

// Deterministic, not random: the same seat always has the same small phase
// offset, so the crowd feels organic but never jitters between renders.
const phase = (i, salt) => {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 4294967296
}

const swatch = ({ label, color }) =>
  `<button type="button" style="--swatch:${color}" data-bomb-color="${color}" data-label="${label}" title="${label}" aria-label="${label} colour"></button>`

export function createWatchStage({ partyEndsAtIso } = {}) {
  const sec = el('section', 'rcp-area rcp-watch')
  sec.setAttribute('aria-label', 'Watch party stage')
  sec.innerHTML = `
    <div class="rcp-sched" role="region" aria-label="Watch schedule, ${WATCH_SCHEDULE_DAY}">
      <div class="rcp-sched-head"><span>TODAY'S WATCH · ${WATCH_SCHEDULE_DAY}</span><em>IST</em></div>
      <ol class="rcp-sched-list"></ol>
    </div>
    <div class="rcp-stage is-unstarted" data-kind="performance">
      <div class="rcp-venue" aria-hidden="true"></div>
      <div class="rcp-lasers" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="rcp-beam is-l" aria-hidden="true"></div>
      <div class="rcp-beam is-r" aria-hidden="true"></div>
      <div class="rcp-stage-col is-l" aria-hidden="true"></div>
      <div class="rcp-stage-col is-r" aria-hidden="true"></div>
      <div class="rcp-presence" hidden><i></i><span></span></div>
      <div class="rcp-sign" aria-live="polite">
        <span class="rcp-sign-label"><i></i><em>UP FIRST</em></span>
        <b class="rcp-sign-title"></b>
      </div>
      <div class="rcp-frame"><div class="rcp-screen">
        <button type="button" class="rcp-play" aria-label="Start the Gwanghwamun performances">
          <img alt="" src="https://i.ytimg.com/vi/${WATCH_PLAYLIST.firstVideoId}/hqdefault.jpg" loading="lazy">
          <span class="rcp-play-btn">▶</span>
        </button>
      </div>
      <div class="rcp-premiere" hidden>
        <img class="rcp-premiere-bg" alt="">
        <div class="rcp-premiere-in">
          <span class="rcp-premiere-eyebrow"></span>
          <b class="rcp-premiere-clock" aria-live="off"></b>
          <span class="rcp-premiere-title"></span>
          <span class="rcp-premiere-when"></span>
        </div>
      </div></div>
      <div class="rcp-uplights" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="rcp-hero" role="img" aria-label="Your ARMY Bomb"><div class="army-core rcp-hero-core"></div></div>
      <div class="rcp-fx" aria-hidden="true"></div>
    </div>
    <div class="rcp-program">
      <div class="rcp-slot is-now"><span class="rcp-slot-when">NOW</span><span class="rcp-slot-title"></span></div>
      <div class="rcp-slot is-next"><span class="rcp-slot-when">UP NEXT</span><span class="rcp-slot-title"></span></div>
      <a class="rcp-yt-link" href="${WATCH_PLAYLIST.watchUrl}" target="_blank" rel="noopener noreferrer">WATCH ON YOUTUBE ↗</a>
    </div>
    <div class="rcp-bomb-controls">
      <button type="button" class="rcp-bomb-controls-toggle" aria-expanded="true">
        <span>YOUR ARMY BOMB</span><em>HIDE CONTROLS ▾</em>
      </button>
      <div class="rcp-bomb-controls-body">
        <div class="rcp-bomb-control-row">
          <span class="rcp-bomb-control-label">MOVE</span>
          <div class="rcp-bomb-pills" role="group" aria-label="ARMY Bomb movement">
            <button type="button" class="is-on" data-bomb-move="auto">AUTO</button>
            <button type="button" data-bomb-move="sway">〰 SWAY</button>
            <button type="button" data-bomb-move="drift">◌ DRIFT</button>
            <button type="button" data-bomb-move="ocean">≈ OCEAN</button>
            <button type="button" data-bomb-move="stars">✦ STARS</button>
            <button type="button" data-bomb-move="flutter">⌁ FLUTTER</button>
          </div>
        </div>
        <div class="rcp-bomb-control-row">
          <span class="rcp-bomb-control-label">SPEED</span>
          <div class="rcp-bomb-pills" role="group" aria-label="Custom movement speed">
            <button type="button" data-bomb-speed="8">1X</button>
            <button type="button" class="is-on" data-bomb-speed="4">2X</button>
            <button type="button" data-bomb-speed="2">3X</button>
          </div>
        </div>
        <div class="rcp-bomb-control-row">
          <span class="rcp-bomb-control-label">COLOR <b class="rcp-bomb-color-name">AUTO</b></span>
          <div class="rcp-bomb-colors" role="group" aria-label="ARMY Bomb color">
            <button type="button" class="is-auto is-on" data-bomb-color="auto" data-label="AUTO" aria-label="Automatic song color">AUTO</button>
            ${SONG_BOMB_COLORS.map(swatch).join('')}
            <i class="rcp-bomb-colors-sep" aria-hidden="true"></i>
            ${EXTRA_BOMB_COLORS.map(swatch).join('')}
            <button type="button" class="is-rainbow" data-bomb-color="rainbow" data-label="Rainbow" title="Rainbow" aria-label="Rainbow"></button>
          </div>
        </div>
        <p class="rcp-bomb-dark-note" role="status" hidden></p>
      </div>
    </div>
    <div class="rcp-watch-note" hidden></div>
  `

  const stage = sec.querySelector('.rcp-stage')
  const signLabel = sec.querySelector('.rcp-sign-label em')
  const signTitle = sec.querySelector('.rcp-sign-title')
  const nowTitle = sec.querySelector('.rcp-slot.is-now .rcp-slot-title')
  const nextTitle = sec.querySelector('.rcp-slot.is-next .rcp-slot-title')
  const note = sec.querySelector('.rcp-watch-note')
  const fx = sec.querySelector('.rcp-fx')
  const hero = sec.querySelector('.rcp-hero')
  const controls = sec.querySelector('.rcp-bomb-controls')
  const colorName = sec.querySelector('.rcp-bomb-color-name')

  let player = null
  let tick = null
  let moment = null
  let prevTime = 0
  let lastIndex = -1
  let skips = 0
  let active = true
  let momentSig = ''
  // The schedule event on the stage (recelebrate-schedule.js). 'playlist'
  // runs the full Gwanghwamun programme; 'video' is one video lit in its
  // song's concert colour; no video = listed, not playable yet.
  let ev = null
  let pinned = false // the agent opened a replay themselves
  let pinnedUntilLive = false // …or chose the live event during a countdown
  let nextEventLabel = ''
  let loadToken = 0
  // Live counts from the Party page's presence check-in (setPresence).
  let presence = null
  const isPlaylist = () => !ev || ev.video?.kind === 'playlist'
  const timers = {}
  const USER_MOVE_CLASSES = ['is-user-sway', 'is-user-drift', 'is-user-ocean', 'is-user-stars', 'is-user-flutter']

  // The agent's own Bomb picks (and whether the panel is folded) are
  // remembered on this device, so a refresh or a trip to the City doesn't
  // reset them. Storage can be unavailable (private mode); then it's
  // simply per-visit.
  const PREFS_KEY = 'rc-rcp-bomb-v1'
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {} } catch { return {} } })()
  const savePrefs = (patch) => {
    Object.assign(prefs, patch)
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* not stored */ }
  }

  const setActiveControl = (selector, value, attr) => {
    sec.querySelectorAll(selector).forEach((button) => {
      const on = button.getAttribute(attr) === value
      button.classList.toggle('is-on', on)
      button.setAttribute('aria-pressed', String(on))
    })
  }
  const setBombMove = (move = 'auto') => {
    hero.classList.remove(...USER_MOVE_CLASSES)
    if (move !== 'auto' && USER_MOVE_CLASSES.includes(`is-user-${move}`)) hero.classList.add(`is-user-${move}`)
    setActiveControl('[data-bomb-move]', move, 'data-bomb-move')
    savePrefs({ move })
  }
  const setBombSpeed = (seconds = 4) => {
    const value = String(seconds)
    hero.style.setProperty('--user-move-dur', `${value}s`)
    setActiveControl('[data-bomb-speed]', value, 'data-bomb-speed')
    savePrefs({ speed: value })
  }
  const setBombColor = (color = 'auto') => {
    hero.classList.remove('has-user-color', 'is-user-rainbow')
    hero.style.removeProperty('--user-bomb')
    if (color === 'rainbow') {
      hero.classList.add('has-user-color', 'is-user-rainbow')
      hero.style.setProperty('--user-bomb', '#a855f7')
    } else if (color !== 'auto') {
      hero.classList.add('has-user-color')
      hero.style.setProperty('--user-bomb', color)
    }
    setActiveControl('[data-bomb-color]', color, 'data-bomb-color')
    colorName.textContent = sec.querySelector('[data-bomb-color].is-on')?.dataset.label || 'AUTO'
    savePrefs({ color })
  }
  const toggle = sec.querySelector('.rcp-bomb-controls-toggle')
  const setCollapsed = (collapsed) => {
    controls.classList.toggle('is-collapsed', collapsed)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.querySelector('em').textContent = collapsed ? 'SHOW CONTROLS ▴' : 'HIDE CONTROLS ▾'
  }

  sec.querySelectorAll('[data-bomb-move]').forEach((button) => button.addEventListener('click', () => setBombMove(button.dataset.bombMove)))
  sec.querySelectorAll('[data-bomb-speed]').forEach((button) => button.addEventListener('click', () => setBombSpeed(button.dataset.bombSpeed)))
  sec.querySelectorAll('[data-bomb-color]').forEach((button) => button.addEventListener('click', () => setBombColor(button.dataset.bombColor)))
  toggle.addEventListener('click', () => {
    const collapsed = !controls.classList.contains('is-collapsed')
    setCollapsed(collapsed)
    savePrefs({ collapsed })
  })
  // Restore saved picks; anything no longer offered falls back to the default.
  const offered = (attr, v) => v != null && !!sec.querySelector(`[${attr}="${CSS.escape(String(v))}"]`)
  setBombMove(offered('data-bomb-move', prefs.move) ? prefs.move : 'auto')
  setBombSpeed(offered('data-bomb-speed', prefs.speed) ? prefs.speed : 4)
  setBombColor(offered('data-bomb-color', prefs.color) ? prefs.color : 'auto')
  // On a phone the panel starts folded (it's long); the Bomb itself is on
  // screen as the hint. An agent's own choice always wins.
  setCollapsed(typeof prefs.collapsed === 'boolean' ? prefs.collapsed : window.matchMedia('(max-width: 560px)').matches)

  const MOMENT_CLASSES = ['mo-swing', 'mo-pulse', 'mo-color', 'mo-up', 'mo-calm', 'mo-blackout', 'mo-spot', 'mo-strobe']
  const paint = (tint) => {
    const p = moment.palette
    const glow = tint || p.glow
    stage.style.setProperty('--v-glow', glow)
    stage.style.setProperty('--v-beam', tint ? `color-mix(in srgb, ${tint} 60%, ${p.beam})` : p.beam)
    stage.style.setProperty('--v-haze', p.haze)
    stage.style.setProperty('--bomb', glow)
  }

  // The window moments in effect, as classes on the stage. Only touches the
  // DOM when the set actually changes.
  const setMoments = (list) => {
    const sig = list.map((m) => `${m.type}:${m.variant || ''}:${m.tint || ''}`).join('|')
    if (sig === momentSig) return
    momentSig = sig
    stage.classList.remove(...MOMENT_CLASSES)
    let tint = null
    for (const m of list) {
      if (m.type === 'swing') stage.classList.add('mo-swing')
      else if (m.type === 'pulse') stage.classList.add('mo-pulse')
      else if (m.type === 'bombsUp') stage.classList.add('mo-up')
      else if (m.type === 'calm') stage.classList.add('mo-calm')
      else if (m.type === 'light') stage.classList.add(`mo-${m.variant}`)
      else if (m.type === 'color') { stage.classList.add('mo-color'); tint = m.tint }
    }
    if (tint) stage.style.setProperty('--m-tint', tint)
    // Flashing is never shown to anyone who asked for reduced motion.
    if (reducedMotion()) stage.classList.remove('mo-strobe')
    paint(tint)
  }

  // A cue class held for `ms`, restarted cleanly if it fires again.
  const flashClass = (cls, ms) => {
    clearTimeout(timers[cls])
    stage.classList.remove(cls)
    void stage.offsetWidth
    stage.classList.add(cls)
    timers[cls] = setTimeout(() => stage.classList.remove(cls), ms)
  }

  const wave = (tint) => {
    if (!active || reducedMotion()) return
    stage.style.setProperty('--wave-tint', tint || moment?.palette.beam || '#ffffff')
    flashClass('cue-wave', 2600)
  }
  const laser = () => {
    if (!active || reducedMotion()) return
    flashClass('cue-laser', 2600)
  }

  const fire = (cue) => {
    if (cue.type === 'wave') wave(cue.tint)
    else if (cue.type === 'laser') laser()
    else if (cue.type === 'confetti') burst()
  }

  const apply = (m) => {
    moment = m
    momentSig = null
    paint(null)
    stage.style.setProperty('--sway-dur', `${(120 / m.swayBpm).toFixed(3)}s`)
    stage.style.setProperty('--pulse-dur', m.bpm ? `${(60 / m.bpm).toFixed(3)}s` : '4s')
    stage.dataset.kind = m.kind
    stage.dataset.track = m.paletteKey
    stage.dataset.style = m.style
    stage.classList.toggle('is-doubletime', !!m.doubleTime)
    stage.classList.toggle('has-pulse', m.pulse)
    signTitle.textContent = m.title
    nowTitle.textContent = m.title
    if (isPlaylist()) {
      const next = upNext(m.index, m.segment)
      nextTitle.textContent = next ? next.title : 'End of the show'
    } else {
      // One video (or none yet): the event is the show; next is the schedule.
      signTitle.textContent = ev.title
      nowTitle.textContent = ev.title
      nextTitle.textContent = nextEventLabel
    }
  }

  const setStatus = (label, cls) => {
    signLabel.textContent = label
    stage.classList.remove('is-unstarted', 'is-playing', 'is-paused', 'is-ended')
    stage.classList.add(cls)
  }

  const showNote = (html) => { note.innerHTML = html; note.hidden = !html }

  const burst = () => {
    if (!active || reducedMotion() || !moment) return
    const colors = [moment.palette.glow, moment.palette.beam, '#ffffff']
    const frag = document.createDocumentFragment()
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('i')
      // Emitted from the stage floor into the side gutters and crowd space —
      // never across the video itself.
      const side = i % 2 ? 'r' : 'l'
      s.className = `rcp-conf is-${side}`
      s.style.setProperty('--x', `${(phase(i, 11) * 100).toFixed(1)}%`)
      s.style.setProperty('--rise', `${(40 + phase(i, 13) * 55).toFixed(0)}%`)
      s.style.setProperty('--spin', `${Math.round(phase(i, 17) * 540 - 270)}deg`)
      s.style.setProperty('--d', `${(phase(i, 19) * 0.35).toFixed(2)}s`)
      s.style.background = colors[i % colors.length]
      frag.appendChild(s)
    }
    fx.appendChild(frag)
    setTimeout(() => { fx.innerHTML = '' }, 2200)
  }

  const read = () => {
    if (!isPlaylist() || !player?.getPlaylistIndex) return
    const index = player.getPlaylistIndex()
    const t = player.getCurrentTime?.() || 0
    const dur = player.getDuration?.() || 0
    const title = player.getVideoData?.()?.title || ''
    const m = resolveMoment(index, t, title)
    if (index !== lastIndex) { lastIndex = index; prevTime = t }
    if (!moment || m.key !== moment.key) {
      apply(m)
      prevTime = t
      // e.g. Dynamite → between songs at 3:20: stop claiming NOW PLAYING.
      if (stage.classList.contains('is-playing')) signLabel.textContent = m.label
    }
    setMoments(activeMoments(m, t, dur))
    for (const cue of cuesCrossed(m, prevTime, t, dur)) fire(cue)
    prevTime = t
  }

  const startTicking = () => { if (!tick) tick = setInterval(read, TICK_MS) }
  const stopTicking = () => { clearInterval(tick); tick = null }

  const onState = (e) => {
    const S = window.YT.PlayerState
    if (e.data === S.PLAYING) {
      skips = 0
      showNote('')
      read()
      setStatus(isPlaylist() ? (moment?.label || 'NOW PLAYING') : ev.state === 'replay' ? 'REPLAY ↻' : 'NOW PLAYING', 'is-playing')
      if (isPlaylist()) startTicking()
    } else if (e.data === S.PAUSED) {
      read(); setStatus('PAUSED', 'is-paused'); stopTicking()
    } else if (e.data === S.ENDED) {
      const last = ev?.video?.kind === 'video' || player.getPlaylistIndex?.() >= lastListIndex()
      if (last) { setStatus("THAT'S THE SHOW ✦", 'is-ended'); stopTicking() }
    } else if (e.data === S.BUFFERING) {
      read()
    }
  }

  // One unavailable/blocked video never breaks the party: skip it, and only
  // fall back to "watch on YouTube" if several in a row can't play here.
  const lastListIndex = () => (isPlaylist() ? WATCH_ITEMS.length : (player?.getPlaylist?.()?.length || 1)) - 1
  const onError = () => {
    if (ev?.video?.kind === 'video') {
      showNote(`This video can't play inside ReConnect right now. <a href="${eventUrl(ev)}" target="_blank" rel="noopener noreferrer">Watch it on YouTube ↗</a>`)
      return
    }
    skips += 1
    const index = player?.getPlaylistIndex?.() ?? -1
    if (skips > MAX_SKIPS || index >= lastListIndex()) {
      showNote(`These performances can't play inside ReConnect right now. <a href="${eventUrl(ev)}" target="_blank" rel="noopener noreferrer">Watch them on YouTube ↗</a>`)
      return
    }
    showNote("One performance can't play here — skipping to the next ✦")
    setTimeout(() => player?.nextVideo?.(), 1500)
  }

  const start = async () => {
    const v = ev?.video
    if (!v) return
    const token = loadToken
    const screen = sec.querySelector('.rcp-screen')
    const host = document.createElement('div')
    host.className = 'rcp-embed'
    screen.innerHTML = ''
    screen.appendChild(host)
    screen.insertAdjacentHTML('beforeend', '<div class="rcp-screen-wait">Loading the stage…</div>')
    try {
      const YT = await loadYouTubeApi()
      if (token !== loadToken) return // another event was opened meanwhile
      player = new YT.Player(host, {
        host: 'https://www.youtube-nocookie.com',
        videoId: v.kind === 'video' ? v.youtubeId : v.kind === 'list' ? v.firstVideoId : WATCH_PLAYLIST.firstVideoId,
        playerVars: {
          ...(v.kind === 'playlist' ? { listType: 'playlist', list: WATCH_PLAYLIST.listId } : {}),
          ...(v.kind === 'list' ? { listType: 'playlist', list: v.listId } : {}),
          autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1,
        },
        events: {
          onReady: (e) => { screen.querySelector('.rcp-screen-wait')?.remove(); e.target.playVideo() },
          onStateChange: onState,
          onError,
        },
      })
    } catch {
      screen.innerHTML = `<div class="rcp-screen-fallback">
        <b>The stage video couldn't load here</b>
        <a href="${eventUrl(ev)}" target="_blank" rel="noopener noreferrer">WATCH ON YOUTUBE ↗</a></div>`
    }
  }

  const eventUrl = (e) => e?.video?.kind === 'video' ? `https://www.youtube.com/watch?v=${e.video.youtubeId}`
    : e?.video?.kind === 'list' ? `https://www.youtube.com/watch?v=${e.video.firstVideoId}&list=${e.video.listId}`
    : e?.video?.kind === 'playlist' ? WATCH_PLAYLIST.watchUrl : null
  const ytLink = sec.querySelector('.rcp-yt-link')
  const HOUSE_INDEX = WATCH_ITEMS.findIndex((it) => it.kind === 'ment')
  const trackIndex = (title) => Math.max(0, WATCH_ITEMS.findIndex((it) => it.title === title))
  const preLabel = (e) => e.state === 'replay' ? 'REPLAY ↻' : e.state === 'now' ? 'ON NOW' : `STARTS ${e.timeLabel}`

  // Put one schedule event on the stage: its poster and play button (the
  // player is only created on tap), its concert colour, its YouTube link.
  const loadEvent = (e) => {
    loadToken += 1
    stopTicking()
    try { player?.destroy?.() } catch { /* already gone */ }
    player = null; lastIndex = -1; prevTime = 0; skips = 0
    ev = e
    showNote('')
    const screen = sec.querySelector('.rcp-screen')
    const url = eventUrl(e)
    ytLink.hidden = !url
    if (url) ytLink.href = url
    const upcoming = e.state === 'next' || e.state === 'later'
    const poster = !e.video ? null : e.video.kind === 'video' ? e.video.youtubeId
      : e.video.kind === 'list' ? e.video.firstVideoId : WATCH_PLAYLIST.firstVideoId
    premiereBg.src = poster ? `https://i.ytimg.com/vi/${poster}/hqdefault.jpg` : ''
    premiereBg.hidden = !poster
    if (upcoming) {
      screen.innerHTML = ''
    } else if (e.video) {
      screen.innerHTML = `<button type="button" class="rcp-play" aria-label="Play ${esc(e.title)}${e.state === 'replay' ? ' (replay)' : ''}">
          <img alt="" src="https://i.ytimg.com/vi/${poster}/hqdefault.jpg" loading="lazy">
          <span class="rcp-play-btn">▶</span>
        </button>`
      screen.querySelector('.rcp-play').onclick = start
    } else {
      screen.innerHTML = `<div class="rcp-screen-fallback"><b>${esc(e.title)}</b>
        <span>${e.state === 'now' ? 'On now' : e.state === 'replay' ? 'Replay' : `Starts ${e.timeLabel} IST`} · the video link will appear here</span></div>`
    }
    const kind = e.video?.kind
    const base = resolveMoment(kind === 'playlist' ? 0 : kind === 'video' ? trackIndex(e.video.track) : HOUSE_INDEX, 0)
    apply(kind === 'list' ? { ...base, kind: 'performance', title: e.title } : base)
    // The playlist re-applies its first song once the player reports in.
    if (isPlaylist()) moment = { ...moment, key: '' }
    setMoments([])
    signTitle.textContent = e.title
    setStatus(preLabel(e), 'is-unstarted')
    paintPremiere()
    paintPresence()
    sec.dispatchEvent(new CustomEvent('rcp-stage-event', { detail: { id: e.id } }))
  }

  // "842 watching" — agents whose stage is on this same event right now
  // (waiting, during a countdown). Real check-ins only; hidden until the
  // first count arrives.
  const presenceEl = sec.querySelector('.rcp-presence')
  const fmtN = (n) => Number(n).toLocaleString('en-US')
  const presenceFor = () => (presence && ev ? Number(presence.watching?.[ev.id]) || 0 : null)
  function paintPresence() {
    const n = presenceFor()
    const upcoming = !!ev && (ev.state === 'next' || ev.state === 'later')
    presenceEl.hidden = !n
    if (n) {
      presenceEl.querySelector('span').textContent = `${fmtN(n)} ${upcoming ? 'waiting' : 'watching'}`
      presenceEl.setAttribute('aria-label', `${fmtN(n)} agents ${upcoming ? 'waiting for' : 'watching'} ${ev.title} with u`)
    }
  }

  // The premiere: an upcoming event's waiting screen, and for its last 15
  // minutes a live countdown, like an MV premiere. Everything is read from
  // the real clock, so an agent arriving at 9:22 sees 07:59, not 15:00.
  const premiere = sec.querySelector('.rcp-premiere')
  const premiereBg = sec.querySelector('.rcp-premiere-bg')
  const premiereEyebrow = sec.querySelector('.rcp-premiere-eyebrow')
  const premiereClock = sec.querySelector('.rcp-premiere-clock')
  const premiereTitle = sec.querySelector('.rcp-premiere-title')
  const premiereWhen = sec.querySelector('.rcp-premiere-when')
  let showtimeUntil = 0
  let lastSecond = null
  function paintPremiere() {
    if (Date.now() < showtimeUntil) return
    const upcoming = !!ev && (ev.state === 'next' || ev.state === 'later')
    premiere.hidden = !upcoming
    stage.classList.toggle('is-premiere', upcoming)
    if (!upcoming) { stage.classList.remove('is-final-count'); premiere.classList.remove('is-counting', 'is-showtime'); return }
    const left = ev.startsAt - scheduleNow()
    const counting = left <= PREMIERE_LEAD_MS
    premiere.classList.toggle('is-counting', counting)
    premiereEyebrow.textContent = counting ? 'PREMIERES IN' : 'STARTS AT'
    premiereClock.textContent = counting ? fmtCountdown(left) : ev.timeLabel
    premiereTitle.textContent = ev.title
    const waiting = presenceFor()
    premiereWhen.textContent = counting
      ? (waiting ? `${fmtN(waiting)} ARMY waiting · get ur Bomb ready ✦` : `${ev.timeLabel} IST · get ur Bomb ready ✦`)
      : `${WATCH_SCHEDULE_DAY} · IST`
    const final = counting && left <= 10_000
    stage.classList.toggle('is-final-count', final)
    // Restart the beat on every new second of the last ten.
    const second = Math.ceil(left / 1000)
    if (final && second !== lastSecond && !reducedMotion()) {
      premiereClock.classList.remove('is-tick')
      void premiereClock.offsetWidth
      premiereClock.classList.add('is-tick')
    }
    lastSecond = second
    // Screen readers get the count once a minute, not every second.
    premiereClock.setAttribute('aria-label', counting ? `${ev.title} premieres in ${Math.ceil(left / 60000)} minutes` : `${ev.title} starts at ${ev.timeLabel}`)
  }
  // Zero: a moment of "IT'S TIME", then the event opens with its play button.
  const showtime = (e) => {
    showtimeUntil = Date.now() + 2600
    premiere.hidden = false
    premiere.classList.add('is-showtime')
    stage.classList.remove('is-final-count')
    premiereEyebrow.textContent = e.title
    premiereClock.textContent = "IT'S TIME ✦"
    premiereWhen.textContent = ''
    premiereTitle.textContent = ''
    setTimeout(() => {
      showtimeUntil = 0
      premiere.classList.remove('is-showtime')
      if (ev?.id === e.id) loadEvent(ev)
    }, 2600)
  }

  // The day's schedule. States come from the real clock every time (see
  // recelebrate-schedule.js), so a refresh lands on the same NOW / UP NEXT /
  // REPLAY. The stage follows the live event; tapping a REPLAY opens it
  // (and holds it there), tapping NOW goes back to the live one.
  const schedList = sec.querySelector('.rcp-sched-list')
  const SCHED_TAG = { now: 'NOW', next: 'UP NEXT', later: 'LATER', replay: 'REPLAY ↻' }
  const SCHED_SAY = { now: 'on now', next: 'up next', later: 'later today', replay: 'replay available' }
  let schedSig = ''
  let schedItems = []
  const paintSchedule = () => {
    const now = scheduleNow()
    const items = watchScheduleStates(now, { partyEndsAtIso })
    schedItems = items
    const target = defaultStageEvent(items, now)
    if (pinned && ev?.id === target.id) pinned = false
    // Chose the live event during the next one's countdown: held until that
    // next event actually goes live, then the stage moves with the party.
    if (pinned && pinnedUntilLive && target.state === 'now') pinned = false
    if (!pinned) pinnedUntilLive = false
    // A countdown never cuts off something the agent is watching; the
    // stage moves over once that video stops (or the event goes live).
    const holdForPlaying = stage.classList.contains('is-playing') && target.state !== 'now'
    if (!ev || (!pinned && ev.id !== target.id && !holdForPlaying)) loadEvent(target)
    else {
      const fresh = items.find((x) => x.id === ev.id)
      const was = ev.state
      const changed = fresh.state !== was
      ev = fresh
      if (changed && (was === 'next' || was === 'later') && fresh.state === 'now') showtime(fresh)
      else if (changed && stage.classList.contains('is-unstarted')) setStatus(preLabel(ev), 'is-unstarted')
    }
    const i = items.findIndex((x) => x.id === ev.id)
    const n = items[i + 1]
    nextEventLabel = n ? (n.state === 'next' || n.state === 'later' ? `${n.title} · ${n.timeLabel}` : n.title) : 'End of the day'
    if (!isPlaylist()) nextTitle.textContent = nextEventLabel
    const countdownFor = (s) => s.state === 'next' && s.startsAt - now <= PREMIERE_LEAD_MS ? `IN ${fmtCountdown(s.startsAt - now)}` : null
    const sig = `${items.map((s) => s.state).join()}|${ev.id}`
    if (sig === schedSig) {
      for (const s of items) {
        const c = countdownFor(s)
        const el = c && schedList.querySelector(`[data-event="${s.id}"] .rcp-sched-time`)
        if (el) el.textContent = c
      }
      return
    }
    schedSig = sig
    schedList.innerHTML = items.map((s) => {
      const open = (s.state === 'now' || s.state === 'replay') && s.video
      const body = `
        <span class="rcp-sched-tag">${s.state === 'now' ? '<i></i>' : ''}${SCHED_TAG[s.state]}</span>
        <b class="rcp-sched-title">${s.title}</b>
        <span class="rcp-sched-time">${s.state === 'replay' ? (s.video ? `WAS ${s.timeLabel}` : 'LINK SOON') : s.state === 'now' ? `SINCE ${s.timeLabel}` : countdownFor(s) || `STARTS ${s.timeLabel}`}</span>`
      const say = `${s.title}, ${s.state === 'replay' ? 'replay' : `${s.state === 'now' ? 'started' : 'starts'} ${s.timeLabel}`} — ${SCHED_SAY[s.state]}`
      const onScreen = s.id === ev.id
      return `<li class="rcp-sched-item is-${s.state}${onScreen ? ' is-on-screen' : ''}" data-event="${s.id}">${open
        ? `<button type="button" class="rcp-sched-open" data-open="${s.id}" aria-label="${esc(say)}${onScreen ? ', on screen' : ', open it'}"${onScreen ? ' aria-current="true"' : ''}>${body}</button>`
        : `<div class="rcp-sched-body" aria-label="${esc(say)}">${body}</div>`}</li>`
    }).join('')
  }
  schedList.addEventListener('click', (e) => {
    const id = e.target.closest('[data-open]')?.dataset.open
    const item = schedItems.find((x) => x.id === id)
    if (!item || item.id === ev?.id) return
    pinned = item.id !== defaultStageEvent(schedItems, scheduleNow()).id
    pinnedUntilLive = pinned && item.state === 'now'
    loadEvent(item)
    paintSchedule()
  })
  paintSchedule()
  let wasAttached = false
  const schedTimer = setInterval(() => {
    if (sec.isConnected) { wasAttached = true; paintSchedule(); paintPremiere() }
    else if (wasAttached) clearInterval(schedTimer)
  }, 1000)

  return {
    el: sec,
    // Battle tab on a phone / hidden page: keep the player (and its audio)
    // alive, just stop spending frames on the venue.
    setActive(on) {
      active = !!on
      stage.classList.toggle('is-idle', !active)
    },
    // Same reading and same lighting rules as the City Bomb (coreBlock):
    // --charge on the 48h scale, is-brownout when dark or never fed.
    setCharge(agentCharge) {
      const c = armyBombCharge(agentCharge)
      const heroCore = sec.querySelector('.rcp-hero-core')
      const key = `${c.frac.toFixed(3)}|${c.isDark}|${c.neverFed}`
      if (heroCore.dataset.key === key) return
      heroCore.dataset.key = key
      heroCore.innerHTML = armyBombInnerHtml({ chargeFrac: c.frac })
      heroCore.style.setProperty('--charge', c.frac.toFixed(3))
      heroCore.classList.toggle('is-brownout', c.isDark || c.neverFed)
      // A dark Bomb can't show a colour; say so instead of silently ignoring
      // the picker.
      const darkNote = sec.querySelector('.rcp-bomb-dark-note')
      darkNote.hidden = !(c.isDark || c.neverFed)
      darkNote.textContent = c.isDark
        ? 'Your Bomb is dark right now — recharge it in the City and your colour will light up ✦'
        : c.neverFed ? 'Your Bomb has no charge yet — charge it in the City and your colour will light up ✦' : ''
      heroCore.parentElement.setAttribute('aria-label', c.isDark ? 'Your ARMY Bomb — dark'
        : c.neverFed ? 'Your ARMY Bomb — empty' : `Your ARMY Bomb — ${Math.round(c.hours)} hours of charge`)
    },
    player: () => player,
    // The schedule event on this agent's stage (for the presence check-in).
    stageEventId: () => (ev && ev.id !== 'preview' ? ev.id : null),
    setPresence(counts) {
      presence = counts
      paintPresence()
      paintPremiere()
    },
    // Review aids (dev only; exposed as window.__rcpWatch in DEV builds).
    // Paint a moment of the programme without playing the video.
    previewMoment(index, t, { status = 'NOW PLAYING', duration = 0 } = {}) {
      ev = { id: 'preview', title: '', video: { kind: 'playlist' } }
      pinned = true
      const m = resolveMoment(index, t)
      apply(m)
      setMoments(activeMoments(m, t, duration))
      setStatus(status === 'NOW PLAYING' ? m.label : status, 'is-playing')
    },
    // Try a moment that isn't authored yet (e.g. SWIM's swing, before its
    // timestamp is placed): windows = [{type,…}], cues = [{type,…}].
    previewFx(windows = [], cues = []) {
      setMoments(windows)
      cues.forEach(fire)
    },
    previewPose(pose = '') {
      stage.classList.toggle('is-preview-swing', pose === 'swing')
    },
    setBombMove,
    setBombSpeed,
    setBombColor,
    // Authoring aid: where the player is now, to place a moment's `at`.
    where() {
      if (!player?.getPlaylistIndex) return null
      const t = player.getCurrentTime?.() || 0
      const m = resolveMoment(player.getPlaylistIndex(), t, player.getVideoData?.()?.title || '')
      return { index: m.index, title: m.title, t: +t.toFixed(1), at: +(t - m.from).toFixed(1), toEnd: +(t - (player.getDuration?.() || 0)).toFixed(1) }
    },
    burst,
  }
}

