// Dear Diary — private, finite daily sheets. Facts are read-only; the
// handwritten note is the only editable content. Nothing auto-shares.

import { call } from './api.js'
import { badgeThumb } from './badge-art.js'
import { getAgentNo } from './session.js'
import { el, esc, toast } from './state.js'
import { goResources } from './router.js'
import { packIcon } from './pack-icons.js'
import {
  DIARY_DECORATION_FAMILIES, DIARY_DECORATION_LIMIT, DIARY_KEY_DIRECTION, DIARY_THEMES,
  diaryCalendarMonth, diaryCornerState, diaryDecorationSlots, diarySheetPlan, diarySwipeDirection,
  diaryTurnTarget, normalizeDiaryDecorations, normalizeDiaryTheme,
} from './dear-diary-rules.js'
import { createDiaryArchive, createDiaryCalendar } from './dear-diary-archive.js'
import { takeDiaryTarget } from './diary-keep.js'
import { importantDatesOn, importantDatesInMonth, nextImportantDate } from '../supabase/functions/op-reconnect/lib/diary-dates.js'

const diaryThemeKey = () => `rc:dear-diary:theme:${getAgentNo() || 'preview'}`
const prefersReducedMotion = () => globalThis.__ddReduceMotion === true || matchMedia('(prefers-reduced-motion: reduce)').matches
const DECORATION_NAMES = {
  oldworld: ['Pressed flower','Ribbon','Small star','Ink flourish','Wax seal','Tiny leaf'],
  school90s: ['Tiny flower','Doodle heart','Notebook star','Pencil','Paper clip','Tape strip'],
  y2k: ['Butterfly','Mini heart','Starburst','Sparkle','Glossy sticker','Tiny CD'],
  modern: ['Minimal leaf','Tiny heart','Simple star','Coffee mark','Paperclip','Muted tape'],
  future: ['Constellation','Orbit','Signal star','Waveform','Archive glyph','Signal cluster'],
}
const DECORATION_ART = {
  oldworld: [
    '<path d="M16 28c-1-8 1-14 4-21M17 18c-6 0-8-3-8-6 5-1 8 1 9 4M19 13c1-5 4-7 8-7 0 5-2 8-7 9"/><circle cx="13" cy="9" r="3"/>',
    '<path d="M16 13c-5-7-11-3-8 3 2 4 8 3 8-1 0 4 6 5 8 1 3-6-3-10-8-3Zm0 3-5 11m5-11 5 11"/>',
    '<path d="m16 5 2.6 7.4 7.8.2-6.2 4.8 2.2 7.5-6.4-4.4-6.4 4.4 2.2-7.5-6.2-4.8 7.8-.2Z"/>',
    '<path d="M5 21c6-10 17-12 22-4-6-4-12 6-19 2 4 0 7 2 9 6"/>',
    '<circle cx="16" cy="17" r="9"/><path d="m12 17 3 3 6-7M10 7c4 2 8 2 12 0"/>',
    '<path d="M7 25c8-2 13-8 18-18M12 20c-5 0-7-3-7-6 5-1 8 1 9 4m4-5c0-5 3-7 7-8 1 5-1 8-6 10"/>',
  ],
  school90s: [
    '<circle cx="16" cy="15" r="3"/><path d="M16 12c-2-6 4-7 4-2m-7 3c-5-4-8 1-3 4m6 1c2 6-4 7-4 2m7-3c5 4 8-1 3-4"/>',
    '<path d="M16 26S5 20 5 12c0-7 9-8 11-2 2-6 11-5 11 2 0 8-11 14-11 14Z"/>',
    '<path d="m16 5 3 7 8 .7-6 5 2 8-7-4-7 4 2-8-6-5 8-.7Z"/>',
    '<path d="M8 24 22 7l4 4-14 17-6 1Zm12-15 4 4M8 24l4 4"/>',
    '<path d="M21 8 10 20c-5 6 3 11 8 5l9-11c4-5-3-9-7-5L9 20c-2 3 2 5 4 3l9-10"/>',
    '<path d="M5 11h22v11H5zM8 11v11m4-11v11m4-11v11m4-11v11m4-11v11"/>',
  ],
  y2k: [
    '<path d="M16 16C8 2 3 8 8 16c-5 8 0 14 8 1 8 13 13 7 8-1 5-8 0-14-8 0Z"/><circle cx="16" cy="16" r="2"/>',
    '<path d="M16 26S6 20 6 12c0-6 8-7 10-1 2-6 10-5 10 1 0 8-10 14-10 14Z"/>',
    '<path d="m16 3 2 9 8-5-5 8 9 1-9 2 5 8-8-5-2 9-2-9-8 5 5-8-9-2 9-1-5-8 8 5Z"/>',
    '<path d="M16 3v9m0 8v9M3 16h9m8 0h9M7 7l6 6m6 6 6 6m0-18-6 6m-6 6-6 6"/>',
    '<path d="m7 9 13-4 5 18-13 4Z"/><path d="m10 11 8-2m-7 6 8-2"/>',
    '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="3"/><path d="M19 7c4 1 6 4 7 7"/>',
  ],
  modern: [
    '<path d="M7 26C9 13 16 7 27 6c-1 12-7 19-20 20Zm4-4c5-5 9-8 14-12"/>',
    '<path d="M16 26S6 20 6 12c0-6 8-7 10-1 2-6 10-5 10 1 0 8-10 14-10 14Z"/>',
    '<path d="m16 6 2.7 7.2 7.3 2.8-7.3 2.8L16 26l-2.7-7.2L6 16l7.3-2.8Z"/>',
    '<circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="5"/><path d="M6 9c3-3 6-4 10-3"/>',
    '<path d="M21 8 10 20c-5 6 3 11 8 5l9-11c4-5-3-9-7-5L9 20c-2 3 2 5 4 3l9-10"/>',
    '<path d="M5 11h22v11H5zM8 11v11m5-11v11m6-11v11m5-11v11"/>',
  ],
  future: [
    '<circle cx="7" cy="20" r="1.5"/><circle cx="14" cy="9" r="1.5"/><circle cx="24" cy="14" r="1.5"/><circle cx="20" cy="25" r="1.5"/><path d="m8 19 5-9 10 4-3 10-12-5Z"/>',
    '<circle cx="16" cy="16" r="5"/><ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(-22 16 16)"/><circle cx="26" cy="11" r="1.5"/>',
    '<path d="m16 4 2.5 8.5L27 15l-8.5 2.5L16 26l-2.5-8.5L5 15l8.5-2.5Z"/><circle cx="16" cy="15" r="2"/>',
    '<path d="M3 17h5l3-7 5 14 4-10 3 5h6"/>',
    '<path d="m8 7 12-2 6 10-6 12-12-2-3-9Z"/><path d="m12 11 8 10m0-10-8 10"/>',
    '<circle cx="7" cy="16" r="2"/><circle cx="13" cy="12" r="1"/><circle cx="18" cy="18" r="2"/><circle cx="25" cy="10" r="1.5"/><circle cx="26" cy="23" r="1"/><path d="m8 15 4-3 6 6 7-8"/>',
  ],
}

function decorationSvg(theme, family) {
  const familyIndex = DIARY_DECORATION_FAMILIES.findIndex((item) => item.id === family)
  const body = DECORATION_ART[theme]?.[familyIndex] || DECORATION_ART.modern[familyIndex] || ''
  return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${body}</svg>`
}
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

function monthLabel(month) {
  try { return new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
  catch { return month }
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
  const kept = Array.isArray(data.kept) ? data.kept : []
  const important = Array.isArray(data.importantDates) ? data.importantDates : importantDatesOn(data.date)
  const quiet = !badges.length && !shownProgress && !moments.length && !data.xp && !data.streams && !kept.length
  if (data.noRecordedEntry || data.archiveState === 'none' && data.summary == null) {
    // An important day with nothing recorded is still a page you can write on.
    if (important.length) return { badges: [], moments: [], kept: [], important, shownProgress: null, quiet: true, noRecorded: false, sheets: [[{ kind: 'important', weight: 1 }, { kind: 'note', weight: 2.5 }]] }
    return { badges: [], moments: [], kept: [], important: [], shownProgress: null, quiet: true, noRecorded: true, sheets: [[{ kind:'no-recorded', weight:1 }]] }
  }
  const sheets = diarySheetPlan({ summary: data.summary, badges, moments, quiet, kept, important })
  return { badges, moments, kept, important, shownProgress, quiet, noRecorded: false, sheets }
}

function decorateAction() {
  return `<button type="button" class="dd-decorate"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Zm6 12 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8Z"/></svg><span>Decorate page</span></button>`
}

function decorationSlot(slot, items, theme) {
  const item = items.find((entry) => entry.slot === slot)
  if (!item) return ''
  const family = DIARY_DECORATION_FAMILIES.find((entry) => entry.id === item.decoration_id)
  return `<button type="button" class="dd-decoration dd-decoration-${esc(item.size)} dd-slot-${esc(slot)}" data-decoration-slot="${esc(slot)}" aria-label="Edit ${esc(family?.label || 'page')} decoration">${decorationSvg(theme, item.decoration_id)}</button>`
}

function keptCard(k) {
  const art = k.artworkUrl ? `<img src="${esc(badgeThumb(k.artworkUrl))}" data-badge-full="${esc(k.artworkUrl)}" alt="" loading="lazy" decoding="async">` : `<span aria-hidden="true">${k.kind === 'district' ? '⌂' : k.kind === 'level' ? '▲' : '✦'}</span>`
  return `<li class="dd-kept-card is-${esc(k.kind)}"><div class="dd-kept-art">${art}</div><div class="dd-kept-copy"><b>${esc(k.title)}</b>${k.line ? `<p>“${esc(k.line)}”</p>` : ''}</div></li>`
}

function blockMarkup(block, data, view, context) {
  if (block.kind === 'important') return `<section class="dd-onthisday" aria-label="On this day">
      <span>ON THIS DAY</span>${view.important.map((d) => `<b><i aria-hidden="true">${esc(d.icon)}</i>${esc(d.title)}</b>`).join('')}
    </section>`
  if (block.kind === 'kept') return `<section class="dd-section dd-kept"><div class="dd-section-title"><span>✦</span><h2>Kept${block.start ? ' · continued' : ''}</h2></div><ul>${view.kept.slice(block.start, block.end).map(keptCard).join('')}</ul></section>`
  if (block.kind === 'no-recorded') return `<section class="dd-no-recorded" role="status">
      <span aria-hidden="true">—</span><p>No entry recorded for this day.</p>
    </section>`
  if (block.kind === 'entry') return `<section class="dd-summary" aria-labelledby="dd-summary-title-${esc(data.date)}">
      <div class="dd-entry-label-row">${decorationSlot('entry-leading', context.items, context.theme)}<span id="dd-summary-title-${esc(data.date)}">ENTRY</span>${decorationSlot('entry-trailing', context.items, context.theme)}</div><p>${esc(data.summary)}</p>
      <div class="dd-summary-actions"><button type="button" class="dd-regenerate">↻ rewrite</button>${context.first ? decorateAction() : ''}</div>
    </section>`
  if (block.kind === 'badges') {
    const badges = view.badges.slice(block.start, block.end)
    return `<section class="dd-section dd-achievements"><div class="dd-section-title"><span>✦</span><h2>Badges I got${block.start ? ' · continued' : ''}</h2>${decorationSlot('badges-heading', context.items, context.theme)}${context.first ? decorateAction() : ''}</div><div class="dd-stickers">${badges.map((badge, i) => sticker(badge, block.start + i)).join('')}</div></section>`
  }
  if (block.kind === 'moments') {
    const moments = view.moments.slice(block.start, block.end)
    return `<section class="dd-section dd-moments"><div class="dd-section-title"><span>♡</span><h2>Little moments${block.start ? ' · continued' : ''}</h2>${decorationSlot('moments-heading', context.items, context.theme)}${context.first ? decorateAction() : ''}</div><ul>${moments.map((m) => `<li class="is-${esc(m.kind)}">${esc(m.text)}</li>`).join('')}</ul></section>`
  }
  if (block.kind === 'note') {
    const note = data.note || ''
    const long = note.length > 180
    return `<section class="dd-section dd-note"><div class="dd-section-title"><span>✎</span><h2>${view.important?.length && !data.summary ? 'A note for this day' : 'Anything else?'}</h2>${decorationSlot('note-heading', context.items, context.theme)}${context.first ? decorateAction() : ''}</div>
      <div class="dd-note-read${long ? ' is-collapsed' : ''}"><p${note ? '' : ' class="is-empty"'}>${esc(note || (view.important?.length && !data.summary ? `Write something for ${view.important[0].title}.` : 'Nothing written here yet.'))}</p>
      <div class="dd-note-actions">${long ? '<button type="button" class="dd-note-expand" aria-expanded="false">Read more</button>' : ''}<button type="button" class="dd-note-edit">✎ ${note ? 'edit' : 'add note'}</button></div></div>
      <div class="dd-note-editor" hidden><textarea maxlength="1200" rows="5" placeholder="Write something only you need to remember…">${esc(note)}</textarea>
      <div class="dd-note-foot"><span><b class="dd-note-count">${note.length}</b>/1200 · only you</span><button type="button" class="dd-save">save</button></div></div>
    </section>`
  }
  return ''
}

function pageMarkup(state, data, sheetIndex = 0, theme = 'modern') {
  const view = diaryView(state, data)
  const index = Math.min(Math.max(0, sheetIndex), view.sheets.length - 1)
  const total = view.sheets.length
  const sheet = view.sheets[index]
  const availableSlots = diaryDecorationSlots(sheet)
  const items = normalizeDiaryDecorations(data.decorations).items.filter((item) => item.sheet === index && availableSlots.includes(item.slot))
  const status = index ? 'CONTINUED' : (data.isToday === false ? '' : 'TODAY')
  return `<main class="dd-paper${index ? ' is-continuation' : ''}${view.quiet ? ' is-quiet' : ''}${data.isFirstAgentDay ? ' is-opening-page' : ''}${view.noRecorded ? ' is-no-recorded' : ''}" data-date="${esc(data.date)}" data-sheet="${index + 1}">
    <div class="dd-spine" aria-hidden="true"></div><div class="dd-paper-ring" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="dd-date"><span>${esc(prettyDate(data.date))}</span><em>${status}</em></div>
    <div class="dd-sheet-content">${sheet.map((block, blockIndex) => blockMarkup(block, data, view, { items, theme, first: blockIndex === 0 })).join('')}</div>
    ${decorationSlot('footer-center', items, theme)}
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
    <span class="dd-mini-title">Dear Diary</span><div class="dd-head-tools">${actions.archive ? `<button type="button" class="dd-tool dd-calendar-open" aria-label="Diary archive calendar" title="Archive" aria-haspopup="dialog">${packIcon('calendar')}</button>` : ''}<button type="button" class="dd-tool dd-style" aria-label="Diary Style" title="Diary Style">◐</button><span class="dd-private">🔒 private</span></div></header>
  <div class="dd-book" aria-live="polite"><div class="dd-page-stage"></div>
    <button type="button" class="dd-page-corner dd-page-older" aria-label="Turn to older diary page">‹</button>
    <button type="button" class="dd-page-corner dd-page-newer" aria-label="Turn to newer diary page">›</button></div>
  <div class="dd-page-position"></div><p class="dd-turn-hint">Swipe or use the page corners</p>`
  root.querySelector('.dd-back').onclick = () => {
    root.classList.add('is-closing-book')
    const reduced = prefersReducedMotion()
    setTimeout(() => (actions.back || goResources)(), reduced ? 0 : 190)
  }
  root.querySelector('.dd-style').onclick = () => openThemePicker(root, activeTheme, async (theme) => {
    const saved = await actions.setTheme?.(theme)
    if (saved !== false) {
      activeTheme = theme; rememberDiaryTheme(theme)
      if (current) await show(current.data, current.index)
    }
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

  async function persistDecorations(data, next) {
    const saved = await actions.saveDecorations?.(data.date, next)
    if (saved === false) return false
    data.decorations = next
    root.querySelector('.dd-decoration-tray')?.remove()
    await show(data, current?.index || 0)
    return true
  }

  function openDecorationTray(selectedSlot = null) {
    if (!current) return
    root.querySelector('.dd-decoration-tray')?.remove()
    const data = current.data, index = current.index
    const view = diaryView(state, data), blocks = view.sheets[index] || []
    if (view.noRecorded) return
    const slots = diaryDecorationSlots(blocks)
    const decorations = normalizeDiaryDecorations(data.decorations)
    const sheetItems = decorations.items.filter((item) => item.sheet === index)
    const selected = sheetItems.find((item) => item.slot === selectedSlot) || null
    const freeSlots = slots.filter((slot) => !sheetItems.some((item) => item.slot === slot) || slot === selectedSlot)
    const names = DECORATION_NAMES[activeTheme] || DECORATION_NAMES.modern
    const tray = document.createElement('div')
    tray.className = 'dd-decoration-tray'
    tray.innerHTML = `<div class="dd-decoration-panel" role="dialog" aria-modal="true" aria-labelledby="dd-decoration-title">
      <div class="dd-decoration-tray-head"><div><span>RARE DETAILS</span><h2 id="dd-decoration-title">${selected ? 'Adjust decoration' : 'Decorate page'}</h2></div><button type="button" class="dd-decoration-close" aria-label="Close decorations">×</button></div>
      ${selected ? `<div class="dd-decoration-selected">${decorationSvg(activeTheme, selected.decoration_id)}<b>${esc(names[DIARY_DECORATION_FAMILIES.findIndex((item) => item.id === selected.decoration_id)] || 'Decoration')}</b></div>
        <span class="dd-decoration-label">Move to</span><div class="dd-slot-options">${freeSlots.map((slot) => `<button type="button" data-move-slot="${esc(slot)}" class="${slot === selected.slot ? 'is-selected' : ''}">${esc(slot.replaceAll('-', ' '))}</button>`).join('')}</div>
        <div class="dd-decoration-edit-row"><span class="dd-decoration-label">Size</span><button type="button" data-size="s" class="${selected.size === 's' ? 'is-selected' : ''}">S</button><button type="button" data-size="m" class="${selected.size === 'm' ? 'is-selected' : ''}">M</button><button type="button" class="dd-decoration-remove">Remove</button></div>`
        : `<p>Small details that follow your diary style.</p><div class="dd-decoration-grid">${DIARY_DECORATION_FAMILIES.map((family, familyIndex) => `<button type="button" class="dd-decoration-choice" data-family="${family.id}" ${sheetItems.length >= DIARY_DECORATION_LIMIT || !freeSlots.length ? 'disabled' : ''}>${decorationSvg(activeTheme, family.id)}<span>${esc(names[familyIndex])}</span></button>`).join('')}</div><small>${sheetItems.length} of ${DIARY_DECORATION_LIMIT} on this sheet</small>`}
    </div>`
    root.appendChild(tray)
    tray.querySelector('.dd-decoration-close').onclick = () => tray.remove()
    tray.addEventListener('pointerdown', (event) => { if (event.target === tray) tray.remove() })
    for (const choice of tray.querySelectorAll('.dd-decoration-choice')) choice.onclick = () => {
      const slot = freeSlots[0]
      if (!slot || sheetItems.length >= DIARY_DECORATION_LIMIT) return
      persistDecorations(data, { version: 1, items: [...decorations.items, { sheet: index, decoration_id: choice.dataset.family, slot, size: 's' }] })
    }
    for (const move of tray.querySelectorAll('[data-move-slot]')) move.onclick = () => {
      if (!selected || move.dataset.moveSlot === selected.slot) return
      persistDecorations(data, { version: 1, items: decorations.items.map((item) => item === selected ? { ...item, slot: move.dataset.moveSlot } : item) })
    }
    for (const size of tray.querySelectorAll('[data-size]')) size.onclick = () => {
      if (!selected || size.dataset.size === selected.size) return
      persistDecorations(data, { version: 1, items: decorations.items.map((item) => item === selected ? { ...item, size: size.dataset.size } : item) })
    }
    tray.querySelector('.dd-decoration-remove')?.addEventListener('click', () => {
      persistDecorations(data, { version: 1, items: decorations.items.filter((item) => item !== selected) })
    })
  }

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
    sheet.querySelector('.dd-decorate')?.addEventListener('click', () => openDecorationTray())
    for (const decoration of sheet.querySelectorAll('.dd-decoration')) decoration.onclick = () => openDecorationTray(decoration.dataset.decorationSlot)
  }

  function setCorner(button, enabled) {
    button.disabled = !enabled
    button.setAttribute('aria-disabled', String(!enabled))
  }

  async function updateChrome(data, index, total) {
    const token = ++availabilityToken
    marker.textContent = `${shortDate(data.date)} · ${index + 1}/${total}${data.isToday === false ? '' : ' • Today'}`
    const isToday = data.isToday !== false
    const known = diaryCornerState({ index, total, isToday, hasOlderDate: false })
    setCorner(newer, known.newer)
    if (known.older) { setCorner(older, true); return }
    // First sheet: the older corner depends on whether an earlier recorded
    // date exists, which may need another archive window to answer.
    setCorner(older, false)
    const olderDate = await actions.adjacent?.(data.date, 'older')
    if (token !== availabilityToken) return
    setCorner(older, diaryCornerState({ index, total, isToday, hasOlderDate: !!olderDate }).older)
  }

  async function show(data, sheetIndex = 0, direction = null) {
    root.querySelector('.dd-decoration-tray')?.remove()
    const total = diaryView(state, data).sheets.length
    const index = Math.min(Math.max(0, sheetIndex), total - 1)
    const markup = pageMarkup(state, data, index, activeTheme)
    if (!current || !direction) {
      stage.innerHTML = `<div class="dd-page-sheet is-current">${markup}</div>`
      current = { data, index, total }; bindSheet(stage.firstElementChild, data); await updateChrome(data, index, total)
      return
    }
    // Newer turns the page forward (it lifts away to the left over the next
    // page); older brings the previous page back over from the left.
    const motion = direction === 'newer' ? 'forward' : 'back'
    const oldSheet = stage.querySelector('.is-current')
    const incoming = document.createElement('div')
    incoming.className = `dd-page-sheet is-incoming is-${motion}`
    incoming.innerHTML = markup
    if (motion === 'forward') stage.prepend(incoming); else stage.append(incoming)
    bindSheet(incoming, data)
    requestAnimationFrame(() => { oldSheet.classList.add(`is-turning-${motion}`); incoming.classList.add('is-revealed') })
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
    const corner = direction === 'older' ? older : newer
    if (busy || !current || corner.disabled) return
    busy = true; book.classList.add('is-busy')
    try {
      await saveDirtyNote()
      const target = diaryTurnTarget({ index: current.index, total: current.total, direction })
      if (!target) return
      if ('sheet' in target) {
        await show(current.data, target.sheet, direction)
      } else {
        const date = await actions.adjacent?.(current.data.date, direction)
        if (!date) return
        const data = await actions.load(date)
        if (data) await show(data, target.land === 'last' ? diaryView(state, data).sheets.length - 1 : 0, direction)
      }
    } finally { busy = false; book.classList.remove('is-busy') }
  }

  /** Open one date directly (archive calendar). Lands on its first sheet. */
  async function jumpTo(date) {
    if (busy || !current || !date) return
    if (date === current.data.date) { if (current.index) await show(current.data, 0, 'older'); return }
    busy = true; book.classList.add('is-busy')
    try {
      await saveDirtyNote()
      const data = await actions.load(date)
      if (data) await show(data, 0, date < current.data.date ? 'older' : 'newer')
    } finally { busy = false; book.classList.remove('is-busy') }
  }

  function closeCalendar(sheet, calendar) {
    calendar.close()
    sheet.remove()
    root.querySelector('.dd-calendar-open')?.setAttribute('aria-expanded', 'false')
    root.querySelector('.dd-calendar-open')?.focus({ preventScroll: true })
  }

  async function openCalendar() {
    const archive = actions.archive
    if (!archive || !current || root.querySelector('.dd-calendar-sheet')) return
    const calendar = createDiaryCalendar({ archive, jump: jumpTo })
    const sheet = document.createElement('div')
    sheet.className = 'dd-calendar-sheet'
    sheet.innerHTML = `<div class="dd-calendar-panel" role="dialog" aria-modal="true" aria-labelledby="dd-calendar-title">
      <div class="dd-calendar-head">
        <button type="button" class="dd-calendar-step" data-step="-1" aria-label="Previous month">${packIcon('chevronLeft')}</button>
        <div><span>ARCHIVE</span><h2 id="dd-calendar-title"></h2></div>
        <button type="button" class="dd-calendar-step" data-step="1" aria-label="Next month">${packIcon('chevron')}</button>
        <button type="button" class="dd-calendar-close" aria-label="Close archive">×</button>
      </div>
      <div class="dd-calendar-week" aria-hidden="true">${['S','M','T','W','T','F','S'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="dd-calendar-grid" role="grid"></div>
      <div class="dd-calendar-legend" aria-hidden="true"><span><i class="is-real"></i>entry</span><span><i class="is-light"></i>light day</span><span><i class="is-join"></i>first day</span><span><i class="is-important"></i>special day</span></div>
      <ul class="dd-calendar-dates" aria-label="Special days this month"></ul>
      <div class="dd-calendar-actions"><button type="button" class="dd-calendar-first">First day</button><button type="button" class="dd-calendar-today">Today</button></div>
    </div>`
    root.appendChild(sheet)
    root.querySelector('.dd-calendar-open')?.setAttribute('aria-expanded', 'true')
    let drawToken = 0
    const draw = () => {
      const token = ++drawToken
      const view = diaryCalendarMonth({ month: calendar.month, today: archive.today, joinedDate: archive.joinedDate, stateOf: archive.stateOf, selected: current?.data.date, importantOf: importantDatesOn })
      const ready = archive.monthReady(calendar.month)
      sheet.querySelector('#dd-calendar-title').textContent = monthLabel(calendar.month)
      sheet.querySelector('[data-step="-1"]').disabled = !view.canPrev
      sheet.querySelector('[data-step="1"]').disabled = !view.canNext
      const grid = sheet.querySelector('.dd-calendar-grid')
      grid.classList.toggle('is-loading', !ready)
      grid.innerHTML = `${'<span class="dd-calendar-pad"></span>'.repeat(view.leading)}${view.days.map((day) => {
        const cls = ['dd-calendar-day', day.state ? `is-${day.state}` : '', day.isToday ? 'is-today' : '', day.isSelected ? 'is-selected' : '', day.isJoin ? 'is-join' : '', day.important.length ? 'is-important' : ''].filter(Boolean).join(' ')
        const label = `${prettyDate(day.date)}${day.isToday ? ', today' : ''}${day.isJoin ? ', first agent day' : ''}${day.state === 'real' ? ', diary entry' : day.state === 'light' ? ', light day' : ''}${day.important.map((d) => `, ${d.title}`).join('')}`
        return `<button type="button" class="${cls}" data-date="${day.date}" aria-label="${esc(label)}"${day.isSelected ? ' aria-current="date"' : ''}${day.selectable && ready ? '' : ' disabled'}>${day.day}${day.important.length ? `<i class="dd-calendar-mark" aria-hidden="true">${esc(day.important[0].icon)}</i>` : ''}</button>`
      }).join('')}`
      // This month's important days, and what's next if none are left.
      const list = importantDatesInMonth(calendar.month)
      const upcoming = calendar.month === archive.today.slice(0, 7) && !list.some((d) => d.date > archive.today) ? nextImportantDate(archive.today) : null
      sheet.querySelector('.dd-calendar-dates').innerHTML = [
        ...list.map((d) => `<li class="${d.date > archive.today ? 'is-future' : ''}"><i aria-hidden="true">${esc(d.icon)}</i><span>${esc(shortDate(d.date))}</span><b>${esc(d.title)}</b></li>`),
        upcoming ? `<li class="is-future is-next"><i aria-hidden="true">${esc(upcoming.icon)}</i><span>Next · ${esc(shortDate(upcoming.date))}</span><b>${esc(upcoming.title)}</b></li>` : '',
      ].join('')
      if (!ready) archive.ensureMonth(calendar.month).then(() => { if (token === drawToken && calendar.open) draw() })
    }
    const done = (promise) => promise.then((jumped) => {
      if (jumped !== false) closeCalendar(sheet, calendar); else sheet.classList.remove('is-leaving')
    })
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet || event.target.closest('.dd-calendar-close')) { closeCalendar(sheet, calendar); return }
      const step = event.target.closest('.dd-calendar-step')
      if (step && !step.disabled) { calendar.showMonth(Number(step.dataset.step)).then(draw); draw(); return }
      const day = event.target.closest('.dd-calendar-day')
      if (day && !day.disabled) { sheet.classList.add('is-leaving'); done(calendar.choose(day.dataset.date)); return }
      if (event.target.closest('.dd-calendar-first')) { sheet.classList.add('is-leaving'); done(calendar.firstDay()); return }
      if (event.target.closest('.dd-calendar-today')) { sheet.classList.add('is-leaving'); done(calendar.today()) }
    })
    sheet.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); closeCalendar(sheet, calendar) }
    })
    // openAt picks the month synchronously; draw() shows it at once and
    // redraws when that month's archive range has arrived.
    calendar.openAt(current.data.date).catch(() => {})
    draw()
    const focusTarget = ['.dd-calendar-day.is-selected:not(:disabled)', '.dd-calendar-day.is-today', '.dd-calendar-close']
      .map((selector) => sheet.querySelector(selector)).find(Boolean)
    focusTarget?.focus({ preventScroll: true })
  }

  root.querySelector('.dd-calendar-open')?.addEventListener('click', () => openCalendar())
  older.onclick = () => turn('older'); newer.onclick = () => turn('newer')
  root.addEventListener('keydown', (event) => {
    if (event.target.closest('textarea,input,[contenteditable="true"]')) return
    const direction = DIARY_KEY_DIRECTION[event.key]
    if (direction) { event.preventDefault(); turn(direction) }
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
    if (saved !== false) {
      activeTheme = theme
      if (current) await show(current.data, current.index)
    }
    return saved
  }, true))
  return { show, turn, jumpTo, openCalendar, current: () => current }
}

export function renderDiaryContent(root, state, data, actions = {}) {
  const book = makeBook(root, state, { initialTheme: actions.initialTheme || 'modern', ...actions, load: actions.load || (async () => null), save: actions.save || (() => {}), regenerate: actions.regenerate || (() => {}) })
  book.show(data)
  return book
}

export function renderDearDiary(container, state, { previewData = null, previewDate = null, previewSheet = 0, previewTheme = 'modern', previewBack = null, previewJoinedDate = null } = {}) {
  // main.js repaints the current screen on every state refresh (the 90s poll,
  // tab focus, any setState). The diary reads none of that state; it owns its
  // pages, archive and open sheets, so an open book is kept as-is rather than
  // reloaded back to Today. Navigating away replaces the scene, so the next
  // visit still opens fresh.
  if (!previewData && container.querySelector(':scope > .dd-screen[data-live="true"]')) return null
  container.innerHTML = ''
  const root = el('div', 'dd-screen'); container.appendChild(root)
  if (!previewData) root.dataset.live = 'true'
  if (previewData) {
    const pages = Array.isArray(previewData) ? previewData : [previewData]
    const byDate = new Map(pages.map((page, index) => [page.date, { ...page, isToday: page.isToday ?? index === 0 }]))
    const dates = [...byDate.keys()].sort()
    const today = [...byDate.values()].find((page) => page.isToday !== false)?.date || dates.at(-1)
    const first = byDate.get(previewDate) || byDate.values().next().value
    // Preview pages stand in for the archive range endpoint, so the book and
    // calendar run the same date-index code as the live diary.
    const archive = createDiaryArchive({ today, fetchRange: async () => ({
      success: true, joinedDate: previewJoinedDate || dates[0], nextBefore: null,
      dates: dates.map((date) => ({ date, state: byDate.get(date).archiveState === 'light' ? 'light' : 'real' })),
    }) })
    archive.start()
    const book = makeBook(root, state, {
      initialTheme: previewTheme, archive,
      back: previewBack || (() => {}), load: async (date) => byDate.get(date) || null,
      adjacent: (date, direction) => archive.adjacent(date, direction),
      save: async () => toast('Preview only · note not sent'),
      saveDecorations: async () => true,
      regenerate: () => toast('Preview only · wording stays put'), setTheme: async () => true,
    })
    book.show(first, previewSheet); root.focus({ preventScroll: true }); return book
  }

  root.innerHTML = '<div class="dd-loading"><span>Dear Diary…</span><p>finding today’s little receipts</p></div>'
  let book = null
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  const archive = createDiaryArchive({ today, fetchRange: (range) => call('getDearDiaryArchive', { agentNo: getAgentNo(), ...range }) })
  const fetchPage = async (date, regenerate = false) => {
    const res = await call('getDearDiary', { agentNo: getAgentNo(), date, regenerate })
    if (!res?.success) { toast(res?.error || 'That page would not open'); return null }
    return res
  }
  const start = async () => {
    // A "Keep in Dear Diary" pop-up can ask for its own page.
    const target = takeDiaryTarget()
    const [res] = await Promise.all([fetchPage(target || today), archive.start()])
    if (!res) {
      root.innerHTML = '<div class="dd-error"><b>The diary won’t open right now.</b><p>Try again in a moment.</p><button type="button" class="btn btn-ghost">BACK TO PACK</button></div>'
      root.querySelector('button').onclick = () => goResources(); return
    }
    if (res.theme) rememberDiaryTheme(res.theme)
    book = makeBook(root, state, {
      initialTheme: res.theme, archive,
      load: (date) => fetchPage(date),
      adjacent: (date, direction) => archive.adjacent(date, direction),
      save: async (date, value) => {
        const saved = await call('saveDearDiaryNote', { agentNo: getAgentNo(), date, note: value })
        toast(saved?.success ? 'Diary note saved ✦' : (saved?.error || 'Couldn’t save your note'))
      },
      saveDecorations: async (date, decorations) => {
        const saved = await call('saveDearDiaryDecorations', { agentNo: getAgentNo(), date, decorations })
        toast(saved?.success ? 'Page detail saved ✦' : (saved?.error || 'Couldn’t save that decoration'))
        return saved?.success === true
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
