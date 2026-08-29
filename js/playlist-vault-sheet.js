// Playlist Vault — one sheet, two entry points.
//
// Opened with a districtId (from screen-district.js's Vault card) it defaults
// to Relevant | Community | Mine, scored against that district's real goal
// catalog keys (candy-star.ts's getDistrictGoalCatalogMatch — never a guess:
// a shared Spotify link with no config.focus data just never appears in
// Relevant). Opened with no districtId (Candy's "My Playlists →") it's
// Mine | Saved | Community instead — the same backend action and the same
// card rendering either way, just a different default view and tab set.
//
// This used to be candy-star.js's own "Vault" tab (window._candyVault +
// candyVault* functions, inline onclick markup ported from the old site).
// Moved here so it can open as a sheet from anywhere instead of only
// existing inside the Candy screen's own DOM — the actions and card layout
// are the same idea, rebuilt with el()/direct handlers to match how the
// rest of the app builds sheets (screen-world.js, ui-district.js).

import { el, esc, showOverlay, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goCandyStar } from './router.js'

const DISTRICT_VIEWS = [
  { id: 'relevant', label: 'Relevant' },
  { id: 'community', label: 'Community' },
  { id: 'mine', label: 'Mine' },
]
const GLOBAL_VIEWS = [
  { id: 'mine', label: 'Mine' },
  { id: 'saved', label: 'Saved' },
  { id: 'community', label: 'Community' },
]

function vaultDate(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function vaultFocus(config) {
  const display = Array.isArray(config?.display?.focus) ? config.display.focus : []
  if (display.length) return display.map((item) => ({ name: item.name || 'Focus song', plays: Number(item.plays) || 0 }))
  return (Array.isArray(config?.focus) ? config.focus : []).map((item) => ({ name: 'Focus song', plays: Number(item.multiplier) || 0 }))
}

function vaultAlbumNames(config) {
  return Array.isArray(config?.display?.albums) ? config.display.albums : []
}

function vaultRuntime(config) {
  const ms = Number(config?.runtimeMs) || 0
  if (!ms) return ''
  const mins = Math.round(ms / 60000)
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function vaultRecipe(item) {
  if (item.source === 'shared') return 'Shared by an agent'
  const parts = [
    ...vaultFocus(item.config).map((s) => `${s.name}${s.plays ? ` ×${s.plays}` : ''}`),
    ...vaultAlbumNames(item.config).map((name) => `${name} album`),
  ]
  return parts.length ? parts.join(' · ') : 'Candy Star mix'
}

function vaultCard(item, opts) {
  const card = el('article', 'cs-vault-card')
  const thumbOk = typeof item.config?.thumbnailUrl === 'string' && /^https:\/\//.test(item.config.thumbnailUrl)
  const art = el('div', 'cs-vault-art')
  art.innerHTML = thumbOk
    ? `<img src="${esc(item.config.thumbnailUrl)}" alt="" loading="lazy">`
    : `<span aria-hidden="true">${item.source === 'shared' ? '♫' : '🦙'}</span>`
  card.appendChild(art)

  const body = el('div', 'cs-vault-body')
  const meta = [
    item.trackCount ? `${item.trackCount} tracks` : '',
    vaultRuntime(item.config),
    item.saveCount ? `${item.saveCount} saved` : '',
  ].filter(Boolean)
  body.innerHTML = `
    <div class="cs-vault-kicker"><span>${item.source === 'shared' ? 'Shared playlist' : 'Candy Star mix'}</span><span>${esc(vaultDate(item.createdAt))}</span></div>
    <h3>${esc(item.name)}</h3>
    <p class="cs-vault-recipe">${esc(vaultRecipe(item))}</p>
    ${item.matchCount > 0 ? `<p class="cs-vault-match">Matches ${item.matchCount} district goal${item.matchCount === 1 ? '' : 's'}</p>` : ''}
    <div class="cs-vault-by">By ${esc(item.creator)}${meta.length ? ` · ${esc(meta.join(' · '))}` : ''}</div>
  `
  const actions = el('div', 'cs-vault-actions')
  const openLink = el('a', 'cs-vault-open', 'Open in Spotify ↗')
  openLink.href = item.url
  openLink.target = '_blank'
  openLink.rel = 'noopener noreferrer'
  actions.appendChild(openLink)

  if (item.source === 'generated' && vaultFocus(item.config).length) {
    const use = el('button', 'cs-vault-action', 'Use setup')
    use.type = 'button'
    use.onclick = () => opts.onRemix(item)
    actions.appendChild(use)
  }

  const save = el('button', `cs-vault-action${item.saved ? ' is-saved' : ''}`, item.saved ? 'Saved ✓' : 'Save')
  save.type = 'button'
  save.setAttribute('aria-pressed', item.saved ? 'true' : 'false')
  save.onclick = () => opts.onToggleSave(item, card)
  actions.appendChild(save)

  if (item.isMine) {
    const del = el('button', 'cs-vault-delete', 'Delete')
    del.type = 'button'
    del.onclick = () => opts.onDelete(item, card)
    actions.appendChild(del)
  } else {
    const report = el('button', 'cs-vault-report', item.reported ? 'Reported' : 'Broken link?')
    report.type = 'button'
    report.disabled = item.reported
    report.onclick = () => opts.onReport(item, card)
    actions.appendChild(report)
  }
  body.appendChild(actions)
  card.appendChild(body)
  return card
}

/** Loads the Custom tab in Candy Star with one Vault playlist's setup — same
 *  song picks/album checks/name the old site's "remix" did. If Candy is
 *  already mounted (this sheet opened via its own "My Playlists" link),
 *  applies it right there — no navigation, and no need to fight
 *  screen-candystar.js's own re-render guard, which would otherwise skip a
 *  same-screen goCandyStar() and never notice the hand-off. Otherwise (this
 *  sheet opened from the district screen, which never mounts Candy's DOM at
 *  all) it hands off via window.__pendingCandyRemix and navigates — Candy
 *  star.js's renderCandyStar() checks for that once its own DOM exists. */
function remixHandoff(item) {
  hideOverlay()
  if (document.getElementById('cs-focus-rows')) {
    import('./candy-star.js').then((mod) => mod.candyApplyRemix(item))
  } else {
    window.__pendingCandyRemix = item
    goCandyStar()
  }
}

export function openPlaylistVault({ districtId = null, districtName = null } = {}) {
  const views = districtId ? DISTRICT_VIEWS : GLOBAL_VIEWS
  const st = {
    view: districtId ? 'relevant' : 'mine',
    items: [],
    offset: 0,
    hasMore: false,
    loading: false,
    query: '',
  }

  const sheet = el('div', 'sheet vault-sheet')
  const head = el('div', 'vault-sheet-head')
  head.innerHTML = `
    <div>
      <div class="eyebrow">${districtId ? 'PLAYLIST VAULT' : 'MY PLAYLISTS'}</div>
      <h3>${esc(districtId ? `Playlists for ${districtName || 'this district'}` : 'Your playlist library')}</h3>
    </div>`
  const shareToggle = el('button', 'cs-vault-share-toggle', '+ Share')
  shareToggle.type = 'button'
  shareToggle.setAttribute('aria-expanded', 'false')
  head.appendChild(shareToggle)
  sheet.appendChild(head)

  const shareForm = el('div', 'cs-vault-share')
  shareForm.hidden = true
  shareForm.innerHTML = `
    <label class="cs-field-label" for="vs-share-url">Spotify playlist link</label>
    <div class="cs-vault-share-row">
      <input id="vs-share-url" class="input-field" type="url" inputmode="url" autocomplete="off" placeholder="https://open.spotify.com/playlist/…">
      <button type="button" class="btn-red">Add to Vault</button>
    </div>
    <div class="cs-vault-share-note">Spotify checks the title and public link before it appears. Up to 5 shares a day.</div>
    <div class="cs-vault-share-message" role="status"></div>`
  sheet.appendChild(shareForm)
  const shareUrlInput = shareForm.querySelector('#vs-share-url')
  const shareMessage = shareForm.querySelector('.cs-vault-share-message')
  const shareBtn = shareForm.querySelector('.btn-red')
  shareToggle.onclick = () => {
    shareForm.hidden = !shareForm.hidden
    shareToggle.setAttribute('aria-expanded', shareForm.hidden ? 'false' : 'true')
    if (!shareForm.hidden) shareUrlInput.focus()
  }
  shareBtn.onclick = async () => {
    const url = shareUrlInput.value.trim()
    if (!url) { shareMessage.textContent = 'Paste a Spotify playlist link first.'; return }
    shareBtn.disabled = true
    shareBtn.textContent = 'Checking Spotify…'
    shareMessage.textContent = ''
    const res = await call('shareCandyPlaylist', { agentNo: getAgentNo(), url })
    shareBtn.disabled = false
    shareBtn.textContent = 'Add to Vault'
    if (!res?.success) { shareMessage.textContent = res?.error || 'Could not add that playlist.'; return }
    shareUrlInput.value = ''
    shareMessage.textContent = res.alreadyThere ? 'That playlist is already in the Vault.' : `${res.name} was added for everyone.`
    // Community is the one view guaranteed to show a freshly-shared link
    // (relevant needs config.focus data shared links never have; mine/saved
    // don't apply to something someone else may open next) — jump there so
    // "was it actually added" has an immediate answer instead of a promise.
    setView('community')
  }

  const filters = el('div', 'cs-vault-filters', '')
  filters.setAttribute('role', 'tablist')
  const filterButtons = views.map((v) => {
    const btn = el('button', `cs-vault-filter${v.id === st.view ? ' is-active' : ''}`, v.label)
    btn.type = 'button'
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-selected', v.id === st.view ? 'true' : 'false')
    btn.dataset.view = v.id
    btn.onclick = () => setView(v.id)
    filters.appendChild(btn)
    return btn
  })

  function setView(id) {
    if (st.view === id || !views.some((v) => v.id === id)) return
    st.view = id
    for (const b of filterButtons) {
      const active = b.dataset.view === id
      b.classList.toggle('is-active', active)
      b.setAttribute('aria-selected', active ? 'true' : 'false')
    }
    load(true)
  }

  const searchWrap = el('label', 'cs-vault-search')
  searchWrap.innerHTML = '<span aria-hidden="true">⌕</span>'
  const searchInput = el('input')
  searchInput.type = 'search'
  searchInput.placeholder = 'Search song or album'
  searchInput.setAttribute('aria-label', 'Search playlists')
  searchInput.oninput = () => { st.query = searchInput.value || ''; render() }
  searchWrap.appendChild(searchInput)

  const tools = el('div', 'cs-vault-tools')
  tools.append(filters, searchWrap)
  sheet.appendChild(tools)

  const list = el('div', 'cs-vault-list')
  sheet.appendChild(list)

  const more = el('button', 'cs-vault-more', 'Load more')
  more.type = 'button'
  more.hidden = true
  more.onclick = () => load(false)
  sheet.appendChild(more)

  async function toggleSave(item) {
    const next = !item.saved
    const res = await call('setCandyPlaylistSaved', { agentNo: getAgentNo(), playlistId: item.playlistId, saved: next })
    if (!res?.success) { toast(res?.error || 'Could not update that save.'); return }
    item.saved = next
    item.saveCount = Math.max(0, (Number(item.saveCount) || 0) + (next ? 1 : -1))
    if (!next && st.view === 'saved') st.items = st.items.filter((entry) => entry.playlistId !== item.playlistId)
    render()
  }

  async function reportItem(item) {
    if (item.reported) return
    if (!window.confirm('Report this only if the Spotify link no longer opens. Continue?')) return
    const res = await call('reportCandyPlaylist', { agentNo: getAgentNo(), playlistId: item.playlistId })
    if (!res?.success) { toast(res?.error || 'Could not send that report.'); return }
    if (res.hidden) st.items = st.items.filter((entry) => entry.playlistId !== item.playlistId)
    else item.reported = true
    render()
    toast(res.hidden ? 'Broken playlist removed from the Vault.' : 'Report sent. Thank you.')
  }

  async function deleteItem(item) {
    const message = item.source === 'generated'
      ? 'Delete this playlist from the Vault and the connected Spotify library? This cannot be undone.'
      : 'Delete this shared playlist from the Vault? This cannot be undone.'
    if (!window.confirm(message)) return
    const res = await call('deleteCandyPlaylist', { agentNo: getAgentNo(), playlistId: item.playlistId })
    if (!res?.success) { toast(res?.error || 'Could not delete that playlist.'); return }
    st.items = st.items.filter((entry) => entry.playlistId !== item.playlistId)
    render()
    toast(res.warning || 'Playlist deleted.')
  }

  function render() {
    const query = st.query.trim().toLowerCase()
    const visible = query
      ? st.items.filter((item) => `${item.name} ${vaultRecipe(item)} ${item.creator}`.toLowerCase().includes(query))
      : st.items

    list.innerHTML = ''
    if (!visible.length && !st.loading) {
      const label = st.view === 'mine' ? 'You have not added a playlist yet.'
        : st.view === 'saved' ? 'Your saved playlists will wait here.'
        : st.view === 'relevant' ? 'No playlists match this district’s goals yet.'
        : query ? 'No playlists match that search.' : 'The Vault is waiting for its first playlist.'
      const sub = st.view === 'relevant' ? 'Try Community, or build one from Candy Star.'
        : st.view === 'community' ? 'Generate one from Candy Star, or share a Spotify link.'
        : 'Browse Community to find one.'
      list.innerHTML = `<div class="cs-vault-empty"><span>♫</span><b>${esc(label)}</b><small>${esc(sub)}</small></div>`
    } else {
      for (const item of visible) {
        list.appendChild(vaultCard(item, { onToggleSave: toggleSave, onReport: reportItem, onDelete: deleteItem, onRemix: remixHandoff }))
      }
    }
    more.hidden = !st.hasMore || !!query
    more.disabled = st.loading
    more.textContent = st.loading ? 'Loading…' : 'Load more'
  }

  async function load(reset) {
    if (st.loading) return
    st.loading = true
    if (reset) {
      st.items = []
      st.offset = 0
      list.innerHTML = '<div class="cs-vault-loading"><span class="cs-spinner"></span>Opening the Vault…</div>'
    }
    const res = await call('getCandyPlaylistLibrary', {
      agentNo: getAgentNo(),
      view: st.view,
      districtId: districtId || undefined,
      offset: st.offset,
      limit: 24,
    })
    st.loading = false
    if (!res?.success) {
      list.innerHTML = `<div class="cs-vault-empty"><b>Couldn't open the Vault.</b><small>${esc(res?.error || 'Please try again.')}</small></div>`
      return
    }
    st.items = reset ? (res.playlists || []) : [...st.items, ...(res.playlists || [])]
    st.offset = Number(res.nextOffset) || st.items.length
    st.hasMore = !!res.hasMore
    render()
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  showOverlay(sheet)
  load(true)
}
