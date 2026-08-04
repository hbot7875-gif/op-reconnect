// BOTZ — page structure copied from the old site (2026-08-02), data layer
// rewired to Op: Reconnect's own backend. See botz-api.js for what's real
// today (now playing + last 24h) and what still needs a rollup action.
// window.RCBotz is defined there and must load first.
const API = window.RCBotz.API
const STATSFM_API = 'https://api.stats.fm/api/v1/users'
const MUSICAT_API = 'https://api.musicat.fm/v1'
let currentAgentNo = null
let activePreset = 'all'
let _agentProfile          // undefined = not looked up yet, null = lookup failed
let _sfmSeq = 0            // guards stale async source overlays after filter changes
let _lastBotzData = null   // most recent getBotzJams payload — reused by the share card

const MEMBER_EMOJI = {
  'bts': '🎤', 'rm': '🐨', 'namjoon': '🐨',
  'jin': '🐹', 'suga': '🐱', 'agust d': '🐱', 'yoongi': '🐱',
  'j-hope': '🐿️', 'jhope': '🐿️', 'hobi': '🐿️',
  'jimin': '🐥',
  'v': '🐻', 'taehyung': '🐻',
  'jung kook': '🐰', 'jungkook': '🐰', 'jk': '🐰',
}
function memberEmoji(name) {
  return MEMBER_EMOJI[String(name || '').trim().toLowerCase()] || '🎵'
}

// ── THEME TOGGLE — Arirang spy red (default) vs. Purple. The 'purple' state
// itself is applied by an inline <head> script (before this file even loads)
// to avoid a flash; this just handles the click + button icon.
function syncThemeToggleIcon() {
  const btn = document.getElementById('botzThemeToggle')
  if (!btn) return
  const isPurple = document.documentElement.getAttribute('data-theme') === 'purple'
  btn.textContent = isPurple ? '💜' : '🕵️'
  btn.title = isPurple ? 'Switch to Arirang theme' : 'Switch to Purple theme'
}

function toggleBotzTheme() {
  const isPurple = document.documentElement.getAttribute('data-theme') === 'purple'
  if (isPurple) {
    document.documentElement.removeAttribute('data-theme')
    localStorage.setItem('botz_theme', 'arirang')
  } else {
    document.documentElement.setAttribute('data-theme', 'purple')
    localStorage.setItem('botz_theme', 'purple')
  }
  syncThemeToggleIcon()
}
window.toggleBotzTheme = toggleBotzTheme

async function init() {
  syncThemeToggleIcon()
  let agentNo = null
  try {
    const saved = localStorage.getItem(window.RCBotz.SESSION_KEY)
    if (saved) {
      const agent = JSON.parse(saved)
      agentNo = agent.agentNo || agent.agent_no || null
    }
  } catch (e) { /* ignore */ }

  if (!agentNo) {
    document.getElementById('notLoggedIn').style.display = 'flex'
    return
  }

  currentAgentNo = agentNo
  document.getElementById('displayAgentNo').textContent = agentNo
  document.getElementById('mainContent').style.display = 'flex'
  initPullToRefresh()
  initNowPlaying()
  await loadJams()
}

// Current date range (epoch secs) shared with the album breakdown so it
// honors the same preset as the Albums tab. null = all-time.
let currentFromEpoch = null
let currentToEpoch = null

async function loadJams() {
  if (!currentAgentNo) return
  setLoading(true)

  const from = document.getElementById('filterFrom').value
  const to   = document.getElementById('filterTo').value
  currentFromEpoch = from ? Math.floor(new Date(from + 'T00:00:00+09:00').getTime() / 1000) : null
  currentToEpoch   = to   ? Math.floor(new Date(to   + 'T23:59:59+09:00').getTime() / 1000) : null
  // Date-range filtering has no backend equivalent yet — getSignalLog is a
  // fixed rolling 24h window, so the range inputs don't reach the server.
  try {
    const data = await window.RCBotz.jams()
    if (!data.success) { setError(data.error || 'Failed'); return }
    render(data)
    updateLastUpdated()
  } catch (e) { setError('Network error') }
}

function initNowPlaying() {
  if (!currentAgentNo) return

  async function poll() {
    try {
      const data = await window.RCBotz.nowPlaying()
      const bar  = document.getElementById('nowPlayingBar')
      if (data.success && data.playing) {
        document.getElementById('npTrack').textContent  = data.track  || '—'
        document.getElementById('npArtist').textContent = data.artist || ''
        bar.classList.add('visible')
      } else {
        bar.classList.remove('visible')
      }
    } catch (e) {}
  }

  // Paused while the tab is backgrounded — this had no visibility handling at
  // all before, unlike app.js's heartbeat/online/chat pollers, so every BOTZ
  // tab left open in the background kept polling every 30s forever. For
  // Stats.fm/Musicat agents getBotzNowPlaying also makes a live outbound call
  // to that provider on every poll, so a hidden tab was doubly wasteful.
  let npInterval = setInterval(poll, 45000)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(npInterval)
    } else {
      poll()
      npInterval = setInterval(poll, 45000)
    }
  })

  poll()
}

function applyPreset(preset) {
  activePreset = preset
  document.querySelectorAll('.botz-preset-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === preset)
  )
  const customBar = document.getElementById('customFilterBar')
  if (preset === 'custom') {
    customBar.style.display = 'flex'
    return
  }
  customBar.style.display = 'none'
  const KST_MS = 9 * 60 * 60 * 1000
  const nowKST = new Date(Date.now() + KST_MS)
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
  const today = fmt(nowKST)
  let from = '', to = ''
  if (preset === 'today') { from = today; to = today }
  else if (preset === '7d')  { const d = new Date(nowKST); d.setUTCDate(d.getUTCDate()-6);  from = fmt(d); to = today }
  else if (preset === '30d') { const d = new Date(nowKST); d.setUTCDate(d.getUTCDate()-29); from = fmt(d); to = today }
  document.getElementById('filterFrom').value = from
  document.getElementById('filterTo').value   = to
  loadJams()
}

function toggleCustomFilter() {
  const bar = document.getElementById('customFilterBar')
  const showing = bar.style.display !== 'none'
  if (showing) {
    bar.style.display = 'none'
    applyPreset('all')
  } else {
    applyPreset('custom')
  }
}

async function render(data) {
  _lastBotzData = data
  // getSignalLog is a fixed rolling 24h window — there's no all-time total to
  // show yet, so the hero reports exactly that window instead of a fake 0.
  const jams24h = data.counted24h || 0
  document.getElementById('heroTotal').textContent = jams24h.toLocaleString()
  checkBotzMilestone(jams24h)

  const chipsEl = document.getElementById('heroSourceChips')

  const src = data.sources || {}
  // src.hasPano is really "has custom_scrobbles rows" — true for Pano, Stats.fm,
  // AND Musicat agents alike (they all write there). Label by the agent's actual
  // pref so Musicat/Stats.fm users don't see a wrong "Pano" chip if the client
  // overlay below hasn't resolved yet (or fails).
  const chips = []
  const nonLbLabel = src.pref === 'musicat' ? 'Musicat' : src.pref === 'statsfm' ? 'Stats.fm' : 'Pano'
  const nonLbColor = src.pref === 'musicat' ? '#8b5cf6' : src.pref === 'statsfm' ? '#1db954' : '#22c55e'
  if (src.hasLB)   chips.push(`<div class="botz-source-chip botz-chip-lb"><div class="botz-chip-dot" style="background:#eb743b"></div>ListenBrainz</div>`)
  if (src.hasPano) chips.push(`<div class="botz-source-chip botz-chip-pano"><div class="botz-chip-dot" style="background:${nonLbColor}"></div>${nonLbLabel}</div>`)

  let sourceNote = ''
  if (src.hasLB && !src.hasPano) {
    sourceNote = 'Pulling jams from ListenBrainz'
  } else if (src.hasLB && src.hasPano) {
    sourceNote = `Both LB &amp; ${nonLbLabel} linked — counting LB only to avoid doubles`
  } else if (src.hasPano) {
    sourceNote = `Pulling jams from ${nonLbLabel}`
  }

  if (chips.length) {
    chipsEl.innerHTML = chips.join('') + (sourceNote ? `<div style="width:100%;text-align:center;font-family:var(--font-mono);font-size:0.5rem;letter-spacing:1px;color:rgba(255,255,255,0.65);margin-top:6px;">${sourceNote}</div>` : '')
    chipsEl.style.display = 'flex'
    chipsEl.style.flexWrap = 'wrap'
  } else chipsEl.style.display = 'none'

  renderSyncStatus(data.syncStatus)
  renderRecent(data.recent || [])
  renderStreak(data.streak, data.dailyCounts)

  // Stats.fm / Musicat source agents: overlay hero + recent jams with live
  // data from that platform (the LB feed above can lag hours behind for
  // them). data.sources is always {} today — botz-api.js hasn't got a real
  // "sources" rollup yet — so the account's own streamSource is what
  // actually decides this, not the jams payload.
  const srcPref = await getProfileField('streamSource')
  if (srcPref === 'statsfm') overlayStatsfm(++_sfmSeq)
  else if (srcPref === 'musicat') overlayMusicat(++_sfmSeq)
}

async function getProfileField(field) {
  // streamSource/musicatPublicId/statsfmUsername live on the account record,
  // fetched with getAccount — the same action screen-settings.js uses. They
  // were never in the rc_agent session blob (see session.js: it only ever
  // holds agentNo/handle/email/sessionToken), so the old localStorage lookup
  // here could never have found them.
  if (_agentProfile === undefined) {
    const res = await window.RCBotz.callAction('getAccount', {})
    _agentProfile = (res && res.success && res.account) || null
  }
  return _agentProfile ? (_agentProfile[field] || null) : null
}

async function overlayStatsfm(seq) {
  const user = await getProfileField('statsfmUsername')
  if (!user || seq !== _sfmSeq) return
  const base = `${STATSFM_API}/${encodeURIComponent(user)}`

  // Only /streams/recent is fetched here — /streams/stats was dropped: it's
  // stats.fm's raw account-wide stream count across every artist the agent
  // has ever played (confirmed via their public API: a real profile with
  // ~800 BTS jams reports a `count` in the tens of thousands, with
  // cardinality.artists in the hundreds), and that endpoint has no artist
  // filter to narrow it down. The backend's counted24h from the initial
  // render(data) call is already correctly filtered to Arirang-relevant
  // tracks, so the hero total is left alone here.
  try {
    const recentRes = await fetch(`${base}/streams/recent?limit=50`)
    const recent = await recentRes.json()
    if (seq !== _sfmSeq) return

    const chipsEl = document.getElementById('heroSourceChips')
    chipsEl.innerHTML =
      `<div class="botz-source-chip botz-chip-sfm"><div class="botz-chip-dot" style="background:#1db954"></div>Stats.fm</div>` +
      `<div style="width:100%;text-align:center;font-family:var(--font-mono);font-size:0.5rem;letter-spacing:1px;color:rgba(255,255,255,0.65);margin-top:6px;">Pulling jams live from Stats.fm</div>`
    chipsEl.style.display = 'flex'
    chipsEl.style.flexWrap = 'wrap'

    let items = Array.isArray(recent?.items) ? recent.items : []
    // "recent" endpoint ignores date ranges; honor the active filter client-side
    if (currentFromEpoch) items = items.filter(it => new Date(it.endTime).getTime() / 1000 >= currentFromEpoch)
    if (currentToEpoch)   items = items.filter(it => new Date(it.endTime).getTime() / 1000 <= currentToEpoch)
    if (items.length) renderRecentStatsfm(items)
  } catch (e) { /* stats.fm unreachable or private: keep the default feed */ }
}

function renderRecentStatsfm(items) {
  const el = document.getElementById('recentList')
  el.innerHTML = items.map(it => {
    const t = it.track || {}
    const artist = t.artists?.[0]?.name || ''
    const album  = t.albums?.[0]?.name || ''
    const img    = t.albums?.[0]?.image || ''
    const d = it.endTime ? new Date(it.endTime) : null
    const meta = [artist, album].filter(Boolean).join(' · ')
    return `
      <div class="botz-recent-row">
        ${img
          ? `<img src="${esc(img)}" class="botz-art-thumb" alt="" loading="lazy" onerror="this.outerHTML='<div class=botz-recent-dot></div>'">`
          : '<div class="botz-recent-dot"></div>'}
        <div class="botz-recent-info">
          <div class="botz-recent-name">${esc(t.name || '—')}</div>
          ${meta ? `<div class="botz-recent-meta">${esc(meta)}</div>` : ''}
        </div>
        <div class="botz-recent-right">
          <div class="botz-recent-time">${d ? relTime(d) : ''}</div>
          <div class="botz-src-pill botz-src-sfm">SFM</div>
        </div>
      </div>`
  }).join('')
}

// musicat playedAt strings carry no timezone suffix — the API returns UTC
function musicatDate(playedAt) {
  const raw = String(playedAt || '')
  if (!raw) return null
  const d = new Date(/[Zz]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + 'Z')
  return isNaN(d.getTime()) ? null : d
}

async function overlayMusicat(seq) {
  const publicId = await getProfileField('musicatPublicId')
  if (!publicId || seq !== _sfmSeq) return

  const fetchPage = (page, range) => fetch(`${MUSICAT_API}/users/listening-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer empty' },
    body: JSON.stringify({ publicUserId: publicId, range, sorting: 'DESC', page }),
  }).then(r => r.ok ? r.json() : null)

  // No hero-total override here (for any preset, not just "all"): Musicat's
  // listening-history API has no artist filter, so any count built from it
  // includes every artist the agent has played, not just BTS. The backend's
  // counted24h from the initial render(data) call is already correctly
  // filtered to Arirang-relevant tracks, so the hero total is left alone —
  // this overlay only refreshes the source chip + recent-jams list.
  try {
    // Recent feed: latest page, unfiltered
    const recent = await fetchPage(0, { start: null, end: null })
    if (seq !== _sfmSeq) return

    const chipsEl = document.getElementById('heroSourceChips')
    chipsEl.innerHTML =
      `<div class="botz-source-chip botz-chip-mc"><div class="botz-chip-dot" style="background:#8b5cf6"></div>Musicat</div>` +
      `<div style="width:100%;text-align:center;font-family:var(--font-mono);font-size:0.5rem;letter-spacing:1px;color:rgba(255,255,255,0.65);margin-top:6px;">Pulling jams live from Musicat</div>`
    chipsEl.style.display = 'flex'
    chipsEl.style.flexWrap = 'wrap'

    let items = Array.isArray(recent) ? recent : []
    if (currentFromEpoch) items = items.filter(it => { const d = musicatDate(it.playedAt); return d && d.getTime() / 1000 >= currentFromEpoch })
    if (currentToEpoch)   items = items.filter(it => { const d = musicatDate(it.playedAt); return d && d.getTime() / 1000 <= currentToEpoch })
    if (items.length) renderRecentMusicat(items)
  } catch (e) { /* musicat unreachable: keep the default feed */ }
}

function renderRecentMusicat(items) {
  const el = document.getElementById('recentList')
  el.innerHTML = items.map(it => {
    const img = it.thumbnails?.sm || it.coverUrl || ''
    const d = musicatDate(it.playedAt)
    const meta = [it.artists, it.source].filter(Boolean).join(' · ')
    return `
      <div class="botz-recent-row">
        ${img
          ? `<img src="${esc(img)}" class="botz-art-thumb" alt="" loading="lazy" onerror="this.outerHTML='<div class=botz-recent-dot></div>'">`
          : '<div class="botz-recent-dot"></div>'}
        <div class="botz-recent-info">
          <div class="botz-recent-name">${esc(it.name || '—')}</div>
          ${meta ? `<div class="botz-recent-meta">${esc(meta)}</div>` : ''}
        </div>
        <div class="botz-recent-right">
          <div class="botz-recent-time">${d ? relTime(d) : ''}</div>
          <div class="botz-src-pill botz-src-mc">MC</div>
        </div>
      </div>`
  }).join('')
}

function renderSyncStatus(s) {
  const box = document.getElementById('syncStatus')
  if (!box) return
  if (!s) { box.style.display = 'none'; return }
  box.style.display = 'block'

  const dot = document.getElementById('syncDot')
  const srcLabel = { lb: 'ListenBrainz', direct: 'Pano', statsfm: 'Stats.fm', musicat: 'Musicat' }[s.source] || s.source || '—'
  document.getElementById('syncSource').textContent = srcLabel

  // Last counted
  document.getElementById('syncLast').textContent =
    s.lastSyncedAt ? relTime(new Date(s.lastSyncedAt)) : 'never'

  // Next sync — minutes until estimate, floored at "soon"
  let nextTxt = '—'
  if (s.nextSyncEstimate) {
    const mins = Math.round((new Date(s.nextSyncEstimate).getTime() - Date.now()) / 60000)
    nextTxt = mins <= 0 ? 'due now' : `~${mins}m`
  }
  document.getElementById('syncNext').textContent = nextTxt

  // Pending jams waiting for the next sync
  const pending = s.pendingJams || 0
  document.getElementById('syncPending').textContent = pending > 0 ? `${pending} jam${pending === 1 ? '' : 's'}` : 'none'

  // Connection dot: green = connected, red = no source
  dot.style.background = s.connected ? '#22c55e' : '#ef4444'
}

// ── STREAK + HEATMAP ──────────────────────────────────────────
function renderStreak(streak, dailyCounts) {
  const card = document.getElementById('streakCard')
  if (!card) return
  if (!streak || !dailyCounts || !dailyCounts.length) { card.style.display = 'none'; return }
  card.style.display = 'block'

  document.getElementById('streakCurrent').textContent =
    `${streak.current} day${streak.current === 1 ? '' : 's'}`
  document.getElementById('streakBest').textContent = `Best: ${streak.longest} day${streak.longest === 1 ? '' : 's'}`

  // Build a dense day->count map, then render one cell per day across the
  // fetched range (gaps in the data = 0-jam days, not missing days).
  const byDate = new Map(dailyCounts.map(d => [d.date, d.count]))
  const first = dailyCounts[0].date
  const last  = dailyCounts[dailyCounts.length - 1].date
  const cursor = new Date(first + 'T00:00:00Z')
  const endD   = new Date(last  + 'T00:00:00Z')
  const max = Math.max(1, ...dailyCounts.map(d => d.count))
  const cells = []
  while (cursor.getTime() <= endD.getTime()) {
    const ds = cursor.toISOString().slice(0, 10)
    const count = byDate.get(ds) || 0
    const lvl = count === 0 ? 0 : count >= max * 0.75 ? 4 : count >= max * 0.5 ? 3 : count >= max * 0.25 ? 2 : 1
    cells.push(`<div class="botz-heat-cell" data-lvl="${lvl}" title="${ds}: ${count} jam${count === 1 ? '' : 's'}"></div>`)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  document.getElementById('streakHeatmap').innerHTML = cells.join('')
  // Scroll the heatmap to the most recent (rightmost) days by default
  const hm = document.getElementById('streakHeatmap')
  hm.scrollLeft = hm.scrollWidth
}

// ── MILESTONE CELEBRATIONS ────────────────────────────────────
const BOTZ_MILESTONES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]
function checkBotzMilestone(total) {
  if (!currentAgentNo || !total) return
  const key = `botz_milestone_seen_${currentAgentNo}`
  const seen = parseInt(localStorage.getItem(key) || '0', 10)
  const crossed = BOTZ_MILESTONES.filter(m => total >= m && m > seen)
  if (!crossed.length) return
  const newest = crossed[crossed.length - 1]
  localStorage.setItem(key, String(newest))
  if (seen === 0) return // first load ever — don't celebrate pre-existing history
  showBotzMilestoneToast(newest)
  fireBotzConfetti()
}

function showBotzMilestoneToast(milestone) {
  document.getElementById('botzMilestoneToast')?.remove()
  const el = document.createElement('div')
  el.id = 'botzMilestoneToast'
  el.className = 'botz-milestone-toast'
  el.innerHTML = `
    <div class="botz-milestone-emoji">🎉</div>
    <div>
      <div class="botz-milestone-title">${milestone.toLocaleString()} Jams!</div>
      <div class="botz-milestone-sub">New milestone unlocked 💜</div>
    </div>`
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}

function ensureBotzConfettiStyles() {
  if (document.getElementById('botz-confetti-styles')) return
  const style = document.createElement('style')
  style.id = 'botz-confetti-styles'
  style.textContent = `
    @keyframes botzConfettiFall {
      0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
      100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }
    .botz-confetti-piece { position: fixed; top: -10px; z-index: 999998; pointer-events: none; }`
  document.head.appendChild(style)
}

function fireBotzConfetti() {
  ensureBotzConfettiStyles()
  const isPurple = document.documentElement.getAttribute('data-theme') === 'purple'
  const colors = isPurple
    ? ['#a78bfa', '#c9b8fc', '#ffffff', '#ffd700', '#8b5cf6']
    : ['#e8282b', '#ffffff', '#ffd700', '#ff6b6e', '#c4b5fd']
  const fragment = document.createDocumentFragment()
  const pieces = []
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('div')
    c.className = 'botz-confetti-piece'
    const size = 4 + Math.random() * 6
    const duration = 2 + Math.random() * 2
    c.style.cssText = `left:${Math.random() * 100}%; width:${size}px; height:${size}px; background:${colors[Math.floor(Math.random() * colors.length)]}; opacity:${0.6 + Math.random() * 0.4}; transform:rotate(${Math.random() * 360}deg); animation:botzConfettiFall ${duration}s ease-out forwards;`
    fragment.appendChild(c)
    pieces.push(c)
  }
  document.body.appendChild(fragment)
  setTimeout(() => pieces.forEach(p => p.remove()), 4500)
}

function renderRecent(jams) {
  const el = document.getElementById('recentList')
  if (!jams.length) { el.innerHTML = '<div class="botz-empty">No recent jams</div>'; return }
  el.innerHTML = jams.map(j => {
    const d = j.at ? new Date(j.at * 1000) : null
    const meta = [j.artist, j.album].filter(Boolean).join(' · ')
    const srcPill = j.source === 'lb'
      ? `<div class="botz-src-pill botz-src-lb">LB</div>`
      : j.source === 'statsfm'
      ? `<div class="botz-src-pill botz-src-sfm">Stats.fm</div>`
      : j.source === 'musicat'
      ? `<div class="botz-src-pill botz-src-musicat">Musicat</div>`
      : j.source === 'pano'
      ? `<div class="botz-src-pill botz-src-pano">Pano</div>`
      : ''
    return `
      <div class="botz-recent-row">
        ${j.mbid
          ? `<img src="https://coverartarchive.org/release/${j.mbid}/front-250" class="botz-art-thumb" alt="" onerror="this.outerHTML='<div class=botz-recent-dot></div>'">`
          : '<div class="botz-recent-dot"></div>'}
        <div class="botz-recent-info">
          <div class="botz-recent-name">${esc(j.track || '—')}</div>
          ${meta ? `<div class="botz-recent-meta">${esc(meta)}</div>` : ''}
        </div>
        <div class="botz-recent-right">
          <div class="botz-recent-time">${d ? relTime(d) : ''}</div>
          ${srcPill}
        </div>
      </div>`
  }).join('')
}

function applyFilter() { loadJams() }
function clearFilter() {
  document.getElementById('filterFrom').value = ''
  document.getElementById('filterTo').value = ''
  loadJams()
}

function updateLastUpdated() {
  const el = document.getElementById('lastUpdated')
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  el.textContent = `Updated ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function initPullToRefresh() {
  let startY = 0, pulling = false, threshold = 60
  const ptr = document.getElementById('ptrBar')
  const ptrText = document.getElementById('ptrText')
  const content = document.getElementById('mainContent')

  content.addEventListener('touchstart', e => {
    if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true }
  }, { passive: true })

  content.addEventListener('touchmove', e => {
    if (!pulling) return
    const diff = e.touches[0].clientY - startY
    if (diff > 10) {
      ptr.classList.add('visible')
      if (diff >= threshold) {
        ptr.classList.add('ready')
        ptrText.textContent = 'Release to refresh'
      } else {
        ptr.classList.remove('ready')
        ptrText.textContent = 'Pull to refresh'
      }
    }
  }, { passive: true })

  content.addEventListener('touchend', e => {
    if (!pulling) return
    pulling = false
    const diff = e.changedTouches[0].clientY - startY
    ptr.classList.remove('visible', 'ready')
    ptrText.textContent = 'Pull to refresh'
    if (diff >= threshold) loadJams()
  }, { passive: true })
}

function skeletonRows(n) {
  return Array.from({length: n}, () => `
    <div class="botz-skeleton-row">
      <div class="botz-skel botz-skel-icon"></div>
      <div class="botz-skel-lines">
        <div class="botz-skel botz-skel-name"></div>
        <div class="botz-skel botz-skel-sub"></div>
      </div>
      <div class="botz-skel botz-skel-num"></div>
    </div>`).join('')
}

function setLoading(on) {
  if (!on) return
  document.getElementById('recentList').innerHTML = skeletonRows(5)
  document.getElementById('heroTotal').textContent = '—'
  document.getElementById('lastUpdated').textContent = ''
}

function setError(msg) {
  const h = `<div class="botz-empty">${esc(msg)}<br><button class="botz-retry-btn" onclick="loadJams()">↺ Retry</button></div>`
  document.getElementById('recentList').innerHTML = h
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function relTime(d) {
  const diff = Date.now() - d
  if (diff < 60000)      return 'just now'
  if (diff < 3600000)    return Math.floor(diff / 60000) + 'm ago'
  if (diff < 86400000)   return Math.floor(diff / 3600000) + 'h ago'
  if (diff < 604800000)  return Math.floor(diff / 86400000) + 'd ago'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── SHAREABLE SNAPSHOT CARD ───────────────────────────────────
function truncateCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

// Guaranteed-to-work fallback for the snapshot share card: shows the
// rendered image full-screen (long-press to save works on every mobile
// browser) since a programmatic <a download> silently fails on a lot of
// mobile browsers (iOS Safari, in-app webviews like Instagram/KakaoTalk) —
// no error, no file, no feedback. botz.html doesn't load app.js, so this is
// a local copy of the same helper defined there.
function _showSharePreview(blob, filename) {
  const url = URL.createObjectURL(blob)
  document.getElementById('share-preview-overlay')?.remove()
  const overlay = document.createElement('div')
  overlay.id = 'share-preview-overlay'
  overlay.style.cssText = `position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:14px;`
  overlay.onclick = e => { if (e.target === overlay) { URL.revokeObjectURL(url); overlay.remove() } }

  overlay.innerHTML = `
    <div style="font-size:11px;color:rgba(255,255,255,0.6);text-align:center;max-width:320px;line-height:1.5;">
      📸 Long-press (or right-click) the image to save it — works on every device.
    </div>
    <img src="${url}" style="max-width:min(320px,85vw);max-height:60vh;border-radius:16px;box-shadow:0 0 40px rgba(0,0,0,0.5);" />
    <div style="display:flex;gap:10px;width:100%;max-width:320px;">
      <button id="share-preview-download" class="btn-outline" style="flex:1;padding:12px;font-size:11px;">⬇ Download</button>
      <button id="share-preview-close" class="btn-red" style="flex:1;padding:12px;font-size:11px;">✕ Close</button>
    </div>`

  document.body.appendChild(overlay)
  document.getElementById('share-preview-download').onclick = () => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  document.getElementById('share-preview-close').onclick = () => { URL.revokeObjectURL(url); overlay.remove() }
}

async function shareBotzSnapshot() {
  if (!_lastBotzData || !currentAgentNo) return
  const btn = document.getElementById('botzShareBtn')
  if (btn) btn.disabled = true
  try {
    if (document.fonts?.ready) await document.fonts.ready

    const isPurple = document.documentElement.getAttribute('data-theme') === 'purple'
    const accent = isPurple ? '#a78bfa' : '#e8282b'
    const accentGlow = isPurple ? 'rgba(167,139,250,0.45)' : 'rgba(232,40,43,0.45)'

    const W = 1080, H = 1920
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0d0810')
    bg.addColorStop(1, '#050308')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    const glow = ctx.createRadialGradient(W / 2, H * 0.3, 50, W / 2, H * 0.3, W * 0.85)
    glow.addColorStop(0, accentGlow)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)

    ctx.textAlign = 'center'
    ctx.fillStyle = accent
    ctx.font = '900 66px Orbitron, sans-serif'
    ctx.fillText('BOTZ', W / 2, 150)
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.font = '600 22px "Share Tech Mono", monospace'
    ctx.fillText('IF YOU KNOW YOU KNOW', W / 2, 188)

    const total = _lastBotzData.counted24h || 0
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '700 26px "Share Tech Mono", monospace'
    ctx.fillText('JAMS (LAST 24H)', W / 2, 400)
    ctx.fillStyle = accent
    ctx.font = '900 170px Orbitron, sans-serif'
    ctx.shadowColor = accentGlow
    ctx.shadowBlur = 44
    ctx.fillText(total.toLocaleString(), W / 2, 560)
    ctx.shadowBlur = 0

    const streak = _lastBotzData.streak || { current: 0, longest: 0 }
    ctx.fillStyle = '#fff'
    ctx.font = '800 38px Orbitron, sans-serif'
    ctx.fillText(`🔥 ${streak.current}-day streak`, W / 2, 650)

    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.beginPath(); ctx.moveTo(140, 730); ctx.lineTo(W - 140, 730); ctx.stroke()

    let y = 830
    const drawStatBlock = (label, name, sub, jams) => {
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.font = '700 24px "Share Tech Mono", monospace'
      ctx.fillText(label, 140, y)
      ctx.fillStyle = '#fff'
      ctx.font = '800 44px Inter, sans-serif'
      ctx.fillText(truncateCanvasText(ctx, name || '—', W - 320), 140, y + 56)
      if (sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.font = '600 26px Inter, sans-serif'
        ctx.fillText(truncateCanvasText(ctx, sub, W - 320), 140, y + 92)
      }
      ctx.textAlign = 'right'
      ctx.fillStyle = accent
      ctx.font = '900 54px Orbitron, sans-serif'
      ctx.fillText(String(jams || 0), W - 140, y + 56)
      y += 170
    }

    const topTrack  = (_lastBotzData.tracks  || [])[0]
    const topAlbum  = (_lastBotzData.albums  || [])[0]
    const topMember = (_lastBotzData.artists || [])[0]
    if (topTrack)  drawStatBlock('🎵 TOP TRACK',  topTrack.name,  topTrack.artist, topTrack.jams)
    if (topAlbum)  drawStatBlock('📀 TOP ALBUM',  topAlbum.name,  topAlbum.artist, topAlbum.jams)
    if (topMember) drawStatBlock('👤 TOP MEMBER', `${memberEmoji(topMember.name)} ${topMember.name}`, '', topMember.jams)

    const agentName = (await getProfileField('name')) || currentAgentNo
    const rangeLabel = { all: 'ALL TIME', today: 'TODAY', '7d': 'LAST 7 DAYS', '30d': 'LAST 30 DAYS', custom: 'CUSTOM RANGE' }[activePreset] || 'ALL TIME'

    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '700 28px "Share Tech Mono", monospace'
    ctx.fillText(agentName, W / 2, H - 160)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '600 22px "Share Tech Mono", monospace'
    ctx.fillText(rangeLabel, W / 2, H - 120)
    ctx.fillStyle = accent
    ctx.font = '800 24px Orbitron, sans-serif'
    ctx.fillText('HOPETRACKER · BOTZ', W / 2, H - 60)

    canvas.toBlob(async (blob) => {
      if (!blob) return
      const file = new File([blob], 'botz-snapshot.png', { type: 'image/png' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'My BOTZ Snapshot' }); return } catch (e) { /* user cancelled or unsupported — fall through to the visible preview below */ }
      }
      _showSharePreview(blob, file.name)
    }, 'image/png')
  } finally {
    if (btn) btn.disabled = false
  }
}
window.shareBotzSnapshot = shareBotzSnapshot

init()
