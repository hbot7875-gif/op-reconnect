// Dear Diary — private, finite daily sheets. Facts are read-only; the
// handwritten note is the only editable content. Nothing auto-shares.

import { call } from './api.js'
import { badgeThumb } from './badge-art.js'
import { getAgentNo } from './session.js'
import { el, esc, toast } from './state.js'
import { goResources } from './router.js'
import { DIARY_THEMES, diarySheetPlan, diarySwipeDirection, normalizeDiaryTheme } from './dear-diary-rules.js'

const diaryThemeKey = () => `rc:dear-diary:theme:${getAgentNo() || 'preview'}`
const prefersReducedMotion = () => globalThis.__ddReduceMotion === true || matchMedia('(prefers-reduced-motion: reduce)').matches
export function cachedDiaryTheme(fallback = 'modern') {
  try { return normalizeDiaryTheme(localStorage.getItem(diaryThemeKey())) || fallback } catch { return fallback }
}
export function rememberDiaryTheme(theme) {
  try { if (normalizeDiaryTheme(theme)) localStorage.setItem(diaryThemeKey(), theme) } catch {}
}

function prettyDate(date) {
  try { return new Date(`${date}T12:00:00+09:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }
  catch { return date || 'Today' }
}

function shortDate(date) {
  try { return new Date(`${date}T12:00:00+09:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
  catch { return date || '' }
}

function applyDiaryTheme(root, value) {
  const theme = normalizeDiaryTheme(value) || 'modern'
  for (const item of DIARY_THEMES) root.classList.remove(`dd-theme-${item.id}`)
  root.classList.add(`dd-theme-${theme}`)
  root.dataset.diaryTheme = theme
  return theme
}

function openThemePicker(root, current, saveTheme, required = false) {
  root.querySelector('.dd-theme-picker')?.remove()
  const picker = document.createElement('div')
  picker.className = 'dd-theme-picker'
  picker.innerHTML = `<div class="dd-theme-dialog" role="dialog" aria-modal="true" aria-labelledby="dd-theme-title">
    ${required ? '' : '<button type="button" class="dd-theme-close" aria-label="Close diary styles">×</button>'}
    <span class="dd-theme-kicker">MAKE IT YOURS</span><h2 id="dd-theme-title">Pick your diary style</h2>
    <p>This changes the paper, not what you wrote.</p><div class="dd-theme-grid">
      ${DIARY_THEMES.map((theme) => `<button type="button" class="dd-theme-card dd-theme-swatch-${theme.id}${theme.id === current ? ' is-selected' : ''}" data-theme="${theme.id}">
        <i aria-hidden="true"><span></span></i><b>${theme.name}</b><small>${theme.note}</small>
      </button>`).join('')}
    </div></div>`
  root.appendChild(picker)
  picker.querySelector('.dd-theme-close')?.addEventListener('click', () => picker.remove())
  for (const card of picker.querySelectorAll('.dd-theme-card')) card.onclick = async () => {
    const theme = card.dataset.theme
    picker.classList.add('is-saving')
    const saved = await saveTheme(theme)
    picker.classList.remove('is-saving')
    if (saved === false) return
    applyDiaryTheme(root, theme)
    picker.remove()
  }
}

function sticker(badge, i) {
  const art = badge.artworkUrl
    ? `<img src="${esc(badgeThumb(badge.artworkUrl))}" data-badge-full="${esc(badge.artworkUrl)}" alt="" loading="lazy" decoding="async">`
    : '<span class="dd-art-unavailable" aria-label="Badge artwork unavailable"><i></i><small>artwork<br>unavailable</small></span>'
  return `<article class="dd-sticker${badge.rarity === 'rare' ? ' is-rare' : ''}${badge.artworkUrl ? '' : ' is-art-missing'}" tabindex="0" style="--tilt:${i % 2 ? '2deg' : '-2deg'}">
    <div class="dd-sticker-art">${art}</div><b>${esc(badge.name)}</b><p>${esc(badge.reason)}</p>
  </article>`
}

function diaryView(state, data) {
  const completed = data.completedDistricts || []
  const shownProgress = completed[0] ? { name: completed[0].name, percent: 100 } : null
  const badges = data.badges || []
  const moments = (data.moments || []).filter((moment) => moment.kind !== 'agent-joined').slice(0, 2).map((moment) => {
    if (moment.kind === 'helped-me' && moment.agentName) return { ...moment, text: `Agent ${moment.agentName} helped me. Noted.` }
    if (moment.kind === 'helped-agent' && moment.agentName) return { ...moment, text: `I helped Agent ${moment.agentName}. I’ll take it.` }
    if (moment.kind === 'mission' && moment.missionName) return { ...moment, text: `${moment.missionName} mission done. We survived.` }
    return moment
  })
  if (shownProgress && moments.length < 2) moments.push({ kind: 'progress', text: `${shownProgress.name} reached ${shownProgress.percent}%. Finally moving.` })
  const quiet = !badges.length && !shownProgress && !moments.length && !data.xp && !data.streams
  if (data.noRecordedEntry || data.archiveState === 'none' && data.summary == null) {
    return { badges: [], moments: [], shownProgress: null, quiet: true, noRecorded: true, sheets: [[{ kind:'no-recorded', weight:1 }]] }
  }
  const sheets = diarySheetPlan({ summary: data.summary, badges, moments, quiet })
  return { badges, moments, shownProgress, quiet, noRecorded: false, sheets }
}

function blockMarkup(block, data, view) {
  if (block.kind === 'no-recorded') return `<section class="dd-no-recorded" role="status">
      <span aria-hidden="true">—</span><p>No entry recorded for this day.</p>
    </section>`
  if (block.kind === 'entry') return `<section class="dd-summary" aria-labelledby="dd-summary-title-${esc(data.date)}">
      <span id="dd-summary-title-${esc(data.date)}">ENTRY</span><p>${esc(data.summary)}</p>
      <button type="button" class="dd-regenerate">↻ rewrite</button>
    </section>`
  if (block.kind === 'badges') {
    const badges = view.badges.slice(block.start, block.end)
    return `<section class="dd-section dd-achievements"><div class="dd-section-title"><span>✦</span><h2>Badges I got${block.start ? ' · continued' : ''}</h2></div><div class="dd-stickers">${badges.map((badge, i) => sticker(badge, block.start + i)).join('')}</div></section>`
  }
  if (block.kind === 'moments') {
    const moments = view.moments.slice(block.start, block.end)
    return `<section class="dd-section dd-moments"><div class="dd-section-title"><span>♡</span><h2>Little moments${block.start ? ' · continued' : ''}</h2></div><ul>${moments.map((m) => `<li class="is-${esc(m.kind)}">${esc(m.text)}</li>`).join('')}</ul></section>`
  }
  if (block.kind === 'note') {
    const note = data.note || ''
    const long = note.length > 180
    return `<section class="dd-section dd-note"><div class="dd-section-title"><span>✎</span><h2>Anything else?</h2></div>
      <div class="dd-note-read${long ? ' is-collapsed' : ''}"><p${note ? '' : ' class="is-empty"'}>${esc(note || 'Nothing written here yet.')}</p>
      <div class="dd-note-actions">${long ? '<button type="button" class="dd-note-expand" aria-expanded="false">Read more</button>' : ''}<button type="button" class="dd-note-edit">✎ ${note ? 'edit' : 'add note'}</button></div></div>
      <div class="dd-note-editor" hidden><textarea maxlength="1200" rows="5" placeholder="Write something only you need to remember…">${esc(note)}</textarea>
      <div class="dd-note-foot"><span><b class="dd-note-count">${note.length}</b>/1200 · only you</span><button type="button" class="dd-save">save</button></div></div>
    </section>`
  }
  return ''
}

function pageMarkup(state, data, sheetIndex = 0) {
  const view = diaryView(state, data)
  const index = Math.min(Math.max(0, sheetIndex), view.sheets.length - 1)
  const total = view.sheets.length
  const sheet = view.sheets[index]
  const status = index ? 'CONTINUED' : (data.isToday === false ? '' : 'TODAY')
  return `<main class="dd-paper${index ? ' is-continuation' : ''}${view.quiet ? ' is-quiet' : ''}${data.isFirstAgentDay ? ' is-opening-page' : ''}${view.noRecorded ? ' is-no-recorded' : ''}" data-date="${esc(data.date)}" data-sheet="${index + 1}">
    <div class="dd-spine" aria-hidden="true"></div><div class="dd-paper-ring" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="dd-date"><span>${esc(prettyDate(data.date))}</span><em>${status}</em></div>
    <div class="dd-sheet-content">${sheet.map((block) => blockMarkup(block, data, view)).join('')}</div>
    <span class="dd-page-number" aria-hidden="true">${esc(shortDate(data.date))} · ${index + 1}/${total}</span>
  </main>`
}

/** The diary's closed Pack form. It is a personal object, not a dashboard
 * row or collectible, and uses the same saved theme as the open book. */
export function closedDiaryObject({ theme = cachedDiaryTheme(), status = '', onOpen = null } = {}) {
  const safeTheme = normalizeDiaryTheme(theme) || 'modern'
  const button = el('button', `closed-diary-object dd-theme-${safeTheme}`)
  button.type = 'button'
  button.setAttribute('aria-label', `Open Dear Diary${status ? `. ${status}` : ''}`)
  button.innerHTML = `<span class="closed-diary-book" aria-hidden="true">
      <i class="closed-diary-pages"></i><i class="closed-diary-spine"></i><i class="closed-diary-band"></i>
      <span class="closed-diary-cover"><small>PRIVATE</small><b>Dear Diary</b><em>RECONNECT</em></span>
    </span><span class="closed-diary-copy"><b>Dear Diary</b><small>Your private agent journal</small>${status ? `<i>${esc(status)}</i>` : ''}</span>`
  button.onclick = () => {
    button.classList.add('is-opening')
    const reduced = prefersReducedMotion()
    setTimeout(() => onOpen?.(), reduced ? 0 : 210)
  }
  return button
}

function makeBook(root, state, actions) {
  root.tabIndex = -1
  let activeTheme = applyDiaryTheme(root, actions.initialTheme)
  root.innerHTML = `<header class="dd-head"><button type="button" class="back dd-back" aria-label="Back to Agent Pack">←</button>
    <span class="dd-mini-title">Dear Diary</span><div class="dd-head-tools"><button type="button" class="dd-style" aria-label="Diary Style" title="Diary Style">◐</button><span class="dd-private">🔒 private</span></div></header>
  <div class="dd-book" aria-live="polite"><div class="dd-page-stage"></div>
    <button type="button" class="dd-page-corner dd-page-newer" aria-label="Turn to newer diary page">‹</button>
    <button type="button" class="dd-page-corner dd-page-older" aria-label="Turn to older diary page">›</button></div>
  <div class="dd-page-position"></div><p class="dd-turn-hint">Swipe or use the page corners</p>`
  root.querySelector('.dd-back').onclick = () => {
    root.classList.add('is-closing-book')
    const reduced = prefersReducedMotion()
    setTimeout(() => (actions.back || goResources)(), reduced ? 0 : 190)
  }
  root.querySelector('.dd-style').onclick = () => openThemePicker(root, activeTheme, async (theme) => {
    const saved = await actions.setTheme?.(theme)
    if (saved !== false) { activeTheme = theme; rememberDiaryTheme(theme) }
    return saved
  })

  const stage = root.querySelector('.dd-page-stage')
  const book = root.querySelector('.dd-book')
  const marker = root.querySelector('.dd-page-position')
  const newer = root.querySelector('.dd-page-newer')
  const older = root.querySelector('.dd-page-older')
  let current = null
  let busy = false
  let availabilityToken = 0

  function bindSheet(sheet, data) {
    const note = sheet.querySelector('.dd-note textarea')
    const count = sheet.querySelector('.dd-note-count')
    const editor = sheet.querySelector('.dd-note-editor')
    const reader = sheet.querySelector('.dd-note-read')
    const edit = sheet.querySelector('.dd-note-edit')
    const expand = sheet.querySelector('.dd-note-expand')
    if (expand) expand.onclick = () => {
      const open = reader.classList.toggle('is-expanded')
      reader.classList.toggle('is-collapsed', !open)
      expand.textContent = open ? 'Show less' : 'Read more'
      expand.setAttribute('aria-expanded', String(open))
    }
    if (edit) edit.onclick = () => {
      reader.hidden = true; editor.hidden = false; note.focus(); note.setSelectionRange(note.value.length, note.value.length)
    }
    if (note) {
      note.addEventListener('input', () => { count.textContent = note.value.length; note.dataset.dirty = 'true' })
      sheet.querySelector('.dd-save').onclick = async () => {
        const btn = sheet.querySelector('.dd-save'); btn.disabled = true; btn.textContent = 'saving…'
        await actions.save?.(data.date, note.value); note.dataset.dirty = 'false'
        data.note = note.value
        await show(data, current?.index || 0)
      }
    }
    const regenerate = sheet.querySelector('.dd-regenerate')
    if (regenerate) regenerate.onclick = () => actions.regenerate?.(data.date)
  }

  async function updateChrome(data, index, total) {
    const token = ++availabilityToken
    marker.textContent = `${shortDate(data.date)} · ${index + 1}/${total}${data.isToday === false ? '' : ' • Today'}`
    const atFront = data.isToday !== false && index === 0
    newer.disabled = atFront
    newer.setAttribute('aria-hidden', String(atFront))
    if (index < total - 1) {
      older.disabled = false
      older.setAttribute('aria-disabled', 'false')
      return
    }
    older.disabled = true
    older.setAttribute('aria-disabled', 'true')
    const nextDate = await actions.adjacent?.(data.date, 'older')
    if (token !== availabilityToken) return
    older.disabled = !nextDate
    older.setAttribute('aria-disabled', String(!nextDate))
  }

  async function show(data, sheetIndex = 0, direction = null) {
    const total = diaryView(state, data).sheets.length
    const index = Math.min(Math.max(0, sheetIndex), total - 1)
    const markup = pageMarkup(state, data, index)
    if (!current || !direction) {
      stage.innerHTML = `<div class="dd-page-sheet is-current">${markup}</div>`
      current = { data, index, total }; bindSheet(stage.firstElementChild, data); await updateChrome(data, index, total)
      return
    }
    const oldSheet = stage.querySelector('.is-current')
    const incoming = document.createElement('div')
    incoming.className = `dd-page-sheet is-incoming is-${direction}`
    incoming.innerHTML = markup
    if (direction === 'older') stage.prepend(incoming); else stage.append(incoming)
    bindSheet(incoming, data)
    requestAnimationFrame(() => { oldSheet.classList.add(`is-turning-${direction}`); incoming.classList.add('is-revealed') })
    const reduced = prefersReducedMotion()
    await new Promise((resolve) => setTimeout(resolve, reduced ? 170 : 470))
    stage.innerHTML = ''; incoming.className = 'dd-page-sheet is-current'; stage.appendChild(incoming)
    current = { data, index, total }; await updateChrome(data, index, total)
  }

  async function saveDirtyNote() {
    const note = stage.querySelector('.is-current .dd-note textarea[data-dirty="true"]')
    if (note) await actions.save?.(current.data.date, note.value)
  }

  async function turn(direction) {
    if (document.activeElement?.closest?.('textarea,input,[contenteditable="true"]') || stage.querySelector('.dd-note-editor:not([hidden])')) return
    if (busy || !current || (direction === 'older' && older.disabled) || (direction === 'newer' && current.data.isToday !== false && current.index === 0)) return
    busy = true; book.classList.add('is-busy')
    try {
      await saveDirtyNote()
      if (direction === 'older' && current.index < current.total - 1) {
        await show(current.data, current.index + 1, direction)
      } else if (direction === 'newer' && current.index > 0) {
        await show(current.data, current.index - 1, direction)
      } else {
        const date = await actions.adjacent?.(current.data.date, direction)
        if (!date) return
        const data = await actions.load(date)
        if (data) {
          const target = direction === 'newer' ? diaryView(state, data).sheets.length - 1 : 0
          await show(data, target, direction)
        }
      }
    } finally { busy = false; book.classList.remove('is-busy') }
  }

  older.onclick = () => turn('older'); newer.onclick = () => turn('newer')
  root.addEventListener('keydown', (event) => {
    if (event.target.closest('textarea,input,[contenteditable="true"]')) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); turn('older') }
    if (event.key === 'ArrowRight') { event.preventDefault(); turn('newer') }
  })
  let start = null
  book.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button,textarea,input,a,.dd-sticker,[contenteditable="true"]')) return
    start = { x: event.clientX, y: event.clientY, id: event.pointerId }
  })
  book.addEventListener('pointerup', (event) => {
    if (!start || start.id !== event.pointerId) return
    const selection = window.getSelection?.()?.toString()
    const direction = selection ? null : diarySwipeDirection(event.clientX - start.x, event.clientY - start.y)
    start = null; if (direction) turn(direction)
  })
  book.addEventListener('pointercancel', () => { start = null })
  if (!normalizeDiaryTheme(actions.initialTheme)) queueMicrotask(() => openThemePicker(root, activeTheme, async (theme) => {
    const saved = await actions.setTheme?.(theme)
    if (saved !== false) activeTheme = theme
    return saved
  }, true))
  return { show, turn, current: () => current }
}

export function renderDiaryContent(root, state, data, actions = {}) {
  const book = makeBook(root, state, { initialTheme: actions.initialTheme || 'modern', ...actions, load: actions.load || (async () => null), save: actions.save || (() => {}), regenerate: actions.regenerate || (() => {}) })
  book.show(data)
  return book
}

export function renderDearDiary(container, state, { previewData = null, previewDate = null, previewSheet = 0, previewTheme = 'modern', previewBack = null } = {}) {
  container.innerHTML = ''
  const root = el('div', 'dd-screen'); container.appendChild(root)
  if (previewData) {
    const pages = Array.isArray(previewData) ? previewData : [previewData]
    const byDate = new Map(pages.map((page, index) => [page.date, { ...page, isToday: page.isToday ?? index === 0 }]))
    const dates = [...byDate.keys()].sort().reverse()
    const first = byDate.get(previewDate) || byDate.values().next().value
    const book = makeBook(root, state, {
      initialTheme: previewTheme,
      back: previewBack || (() => {}), load: async (date) => byDate.get(date) || null,
      adjacent: async (date, direction) => {
        const index = dates.indexOf(date)
        return dates[index + (direction === 'older' ? 1 : -1)] || null
      },
      save: async () => toast('Preview only · note not sent'), regenerate: () => toast('Preview only · wording stays put'), setTheme: async () => true,
    })
    book.show(first, previewSheet); root.focus({ preventScroll: true }); return book
  }

  root.innerHTML = '<div class="dd-loading"><span>Dear Diary…</span><p>finding today’s little receipts</p></div>'
  let book = null
  let archiveDates = []
  let archiveNext = null
  const fetchPage = async (date, regenerate = false) => {
    const res = await call('getDearDiary', { agentNo: getAgentNo(), date, regenerate })
    if (!res?.success) { toast(res?.error || 'That page would not open'); return null }
    return res
  }
  const start = async () => {
    const archive = await call('getDearDiaryArchive', { agentNo: getAgentNo(), days: 60 })
    if (archive?.success) {
      archiveDates = archive.dates.map((item) => item.date)
      archiveNext = archive.nextBefore
    }
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    if (!archiveDates.includes(today)) archiveDates.unshift(today)
    const res = await fetchPage(today)
    if (!res) {
      root.innerHTML = '<div class="dd-error"><b>The diary won’t open right now.</b><p>Try again in a moment.</p><button type="button" class="btn btn-ghost">BACK TO PACK</button></div>'
      root.querySelector('button').onclick = () => goResources(); return
    }
    if (res.theme) rememberDiaryTheme(res.theme)
    book = makeBook(root, state, {
      initialTheme: res.theme,
      load: (date) => fetchPage(date),
      adjacent: async (date, direction) => {
        let index = archiveDates.indexOf(date)
        if (direction === 'older' && index === archiveDates.length - 1 && archiveNext) {
          const more = await call('getDearDiaryArchive', { agentNo: getAgentNo(), before: archiveNext, days: 60 })
          if (more?.success) {
            for (const item of more.dates) if (!archiveDates.includes(item.date)) archiveDates.push(item.date)
            archiveDates.sort().reverse(); archiveNext = more.nextBefore; index = archiveDates.indexOf(date)
          }
        }
        return archiveDates[index + (direction === 'older' ? 1 : -1)] || null
      },
      save: async (date, value) => {
        const saved = await call('saveDearDiaryNote', { agentNo: getAgentNo(), date, note: value })
        toast(saved?.success ? 'Diary note saved ✦' : (saved?.error || 'Couldn’t save your note'))
      },
      regenerate: async (date) => { const refreshed = await fetchPage(date, true); if (refreshed) await book.show(refreshed) },
      setTheme: async (theme) => {
        const saved = await call('saveDearDiaryTheme', { agentNo: getAgentNo(), theme })
        toast(saved?.success ? 'Diary style saved ✦' : (saved?.error || 'Couldn’t save that style'))
        return saved?.success === true
      },
    })
    await book.show(res); root.focus({ preventScroll: true })
  }
  start()
}
