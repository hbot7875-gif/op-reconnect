// BOTZ Phase 1 — one truthful ReConnect feed. Provider history, BTS
// eligibility and mission credit all come from getSignalLog.
let currentAgentNo = null
let lastBotzData = null
let activeView = 'jams'

const SOURCE_NAMES = {
  listenbrainz: 'ListenBrainz', direct: 'Pano / Web Scrobbler',
  statsfm: 'Stats.fm', musicat: 'Musicat',
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char])
}

function ago(epoch) {
  if (!epoch) return 'No jams received yet'
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(epoch))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function syncThemeToggleIcon() {
  const button = document.getElementById('botzThemeToggle')
  if (!button) return
  const purple = document.documentElement.getAttribute('data-theme') === 'purple'
  button.textContent = purple ? '💜' : '🕵️'
  button.title = purple ? 'Switch to Arirang theme' : 'Switch to Purple theme'
}

function toggleBotzTheme() {
  const purple = document.documentElement.getAttribute('data-theme') === 'purple'
  if (purple) document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', 'purple')
  localStorage.setItem('botz_theme', purple ? 'arirang' : 'purple')
  syncThemeToggleIcon()
}
window.toggleBotzTheme = toggleBotzTheme

function renderTracking(tracking) {
  const copy = {
    receiving: ['Receiving streams ✓', `Last jam received ${ago(tracking?.lastReceivedAt)} · ${tracking?.sourceLabel || ''}`],
    connected_no_recent: ['Connected · no recent jams', `${tracking?.sourceLabel || 'Streaming source'} is ready`],
    needs_setup: ['Needs setup', 'Connect a streaming source so ReConnect can receive your jams.'],
    check_failed: ["Couldn't check your source", 'Your setup is saved. Try again in a moment.'],
  }[tracking?.state] || ["Couldn't check your source", 'Try again in a moment.']
  document.getElementById('trackingTitle').textContent = copy[0]
  document.getElementById('trackingMeta').textContent = copy[1]
  document.getElementById('trackingAction').hidden = tracking?.state !== 'needs_setup'
  const profileSource = document.getElementById('profileSource')
  if (profileSource) {
    const source = tracking?.sourceLabel || SOURCE_NAMES[tracking?.source] || 'ReConnect'
    profileSource.textContent = tracking?.state === 'needs_setup'
      ? 'No jam source connected'
      : `Jams from ${source}`
  }
}

function renderToday(today, missions) {
  document.getElementById('todayBts').textContent = Number(today?.btsJams || 0).toLocaleString()
  document.getElementById('todayHelped').textContent = Number(today?.helpedMissions || 0).toLocaleString()
  document.getElementById('missionContext').innerHTML = (missions || []).map((mission) => {
    const progress = mission.kind === 'birthday'
      ? `${mission.progress || 0}/${mission.total || 0}`
      : `+${mission.today || 0} today`
    return `<div class="botz-mission-line"><span>${escapeHtml(mission.icon || '✦')} ${escapeHtml(mission.label)} · <b>${escapeHtml(progress)}</b></span></div>`
  }).join('') || '<div class="botz-muted">No active mission context</div>'
}

function renderLastPlayed(last) {
  const summary = document.getElementById('latestSummary')
  if (summary) summary.textContent = last ? `Latest received ${ago(last.at)}` : 'No recent jams'
}

function resultFor(jam) {
  if (jam.attributions?.length) return { cls: 'helped', text: `✓ Helped ${jam.attributions.map((item) => item.label).join(' + ')}` }
  if (jam.eligible) return { cls: 'tracked', text: '○ Tracked · not part of your active mission' }
  return { cls: 'not-counted', text: 'Not counted · artist not eligible for ReConnect' }
}

function coverMarkup(item) {
  const title = String(item?.track || '')
  let hash = 0
  for (let index = 0; index < title.length; index++) hash = ((hash << 5) - hash + title.charCodeAt(index)) | 0
  const hue = 250 + Math.abs(hash % 70)
  if (item?.artworkUrl) {
    return `<span class="botz-cover"><img src="${escapeHtml(item.artworkUrl)}" alt="" loading="lazy"></span>`
  }
  return `<span class="botz-cover botz-cover-fallback" style="--cover-hue:${hue}" aria-hidden="true"><em>♪</em></span>`
}

function renderRecent(jams) {
  const list = document.getElementById('recentList')
  if (!jams?.length) {
    list.innerHTML = '<div class="botz-empty-compact">No jams received in the last 24 hours.</div>'
    return
  }
  list.innerHTML = jams.map((jam, index) => {
    const result = resultFor(jam)
    const time = new Date(Number(jam.at) * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    return `<details class="botz-jam-row"><summary>
      ${coverMarkup(jam)}
      <span class="botz-jam-main">${index === 0 ? '<span class="botz-latest-tag">LAST PLAYED</span>' : ''}<b>${escapeHtml(jam.track)}</b><small>${escapeHtml(jam.artist || 'Artist unavailable')}</small><span class="botz-jam-result ${result.cls}">${escapeHtml(result.text)}</span></span>
      <span class="botz-jam-age">${escapeHtml(ago(jam.at))}</span>
    </summary><div class="botz-jam-details">Received ${escapeHtml(time)} · ${escapeHtml(SOURCE_NAMES[jam.source] || jam.source || 'ReConnect')}</div></details>`
  }).join('')
}

function aggregate(jams, keyOf, labelOf) {
  const groups = new Map()
  for (const jam of jams || []) {
    const key = keyOf(jam)
    if (!key) continue
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { ...labelOf(jam), count: 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}

function renderSummary(items, emptyCopy) {
  const list = document.getElementById('recentList')
  if (!items.length) {
    list.innerHTML = `<div class="botz-empty-compact">${escapeHtml(emptyCopy)}</div>`
    return
  }
  list.innerHTML = items.map((item, index) => `<div class="botz-summary-row">
    <span class="botz-rank">${index + 1}</span>
    ${coverMarkup({ track: item.title, artworkUrl: item.artworkUrl })}
    <span class="botz-summary-main"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.subtitle || '')}</small></span>
    <span class="botz-play-count">${item.count} ${item.count === 1 ? 'jam' : 'jams'}</span>
  </div>`).join('')
}

function renderView() {
  const jams = lastBotzData?.recent || []
  document.querySelectorAll('[data-botz-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.botzView === activeView)
  })
  const label = document.getElementById('recentLabel')
  const summary = document.getElementById('latestSummary')
  if (activeView === 'tracks') {
    label.textContent = 'Top tracks'
    summary.textContent = 'From your recent 24h jams'
    renderSummary(aggregate(
      jams,
      (jam) => `${String(jam.track || '').toLowerCase()}|${String(jam.artist || '').toLowerCase()}`,
      (jam) => ({ title: jam.track || 'Unknown track', subtitle: jam.artist || 'Artist unavailable', artworkUrl: jam.artworkUrl }),
    ), 'No track jams received in the last 24 hours.')
    return
  }
  if (activeView === 'albums') {
    label.textContent = 'Top albums'
    const known = jams.filter((jam) => String(jam.album || '').trim())
    const missing = jams.length - known.length
    summary.textContent = 'From your recent 24h jams'
    renderSummary(aggregate(
      known,
      (jam) => `${String(jam.album).toLowerCase()}|${String(jam.artist || '').toLowerCase()}`,
      (jam) => ({ title: jam.album, subtitle: jam.artist || 'Artist unavailable', artworkUrl: jam.artworkUrl }),
    ), 'No album information was supplied with your recent jams.')
    if (missing > 0 && known.length > 0) {
      document.getElementById('recentList').insertAdjacentHTML('afterbegin', `<div class="botz-view-note">${missing} recent ${missing === 1 ? 'jam has' : 'jams have'} no album information from the source.</div>`)
    }
    return
  }
  label.textContent = 'Recent jams'
  renderLastPlayed(lastBotzData?.lastPlayed)
  renderRecent(jams)
}

function setBotzView(view) {
  if (!['jams', 'tracks', 'albums'].includes(view)) return
  activeView = view
  renderView()
}
window.setBotzView = setBotzView

function render(data) {
  lastBotzData = data
  renderTracking(data.tracking)
  renderToday(data.today, data.missions)
  renderView()
  document.getElementById('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

async function loadJams(silent = false) {
  if (!silent) document.getElementById('recentList').innerHTML = '<div class="botz-loading"><div class="botz-spinner"></div>Checking your signal…</div>'
  const data = await window.RCBotz.jams().catch(() => ({ success: false }))
  if (!data.success) {
    document.getElementById('trackingTitle').textContent = "Couldn't check your source"
    document.getElementById('trackingMeta').textContent = 'Try again in a moment.'
    document.getElementById('recentList').innerHTML = '<div class="botz-empty-compact">Recent jams are unavailable right now.</div>'
    return
  }
  render(data)
}

async function shareBotzSnapshot() {
  const today = lastBotzData?.today || {}
  const text = `BOTZ · Today\n${today.btsJams || 0} BTS jams · ${today.helpedMissions || 0} helped missions`
  if (navigator.share) await navigator.share({ title: 'BOTZ', text }).catch(() => {})
  else await navigator.clipboard?.writeText(text).catch(() => {})
}
window.shareBotzSnapshot = shareBotzSnapshot

function initPullToRefresh() {
  let start = 0
  document.addEventListener('touchstart', (event) => { if (scrollY === 0) start = event.touches[0].clientY }, { passive: true })
  document.addEventListener('touchend', (event) => {
    if (start && event.changedTouches[0].clientY - start > 75) loadJams()
    start = 0
  }, { passive: true })
}

async function init() {
  syncThemeToggleIcon()
  const session = window.RCBotz.session()
  currentAgentNo = session?.agentNo || session?.agent_no || null
  if (!currentAgentNo) {
    document.getElementById('notLoggedIn').style.display = 'flex'
    return
  }
  document.getElementById('displayAgentNo').textContent = currentAgentNo
  const profileAgentNo = document.getElementById('profileAgentNo')
  if (profileAgentNo) profileAgentNo.textContent = currentAgentNo
  document.getElementById('mainContent').style.display = 'block'
  initPullToRefresh()
  await loadJams()
  setInterval(() => { if (!document.hidden) loadJams(true) }, 90_000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadJams(true) })
}

init()
