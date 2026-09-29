// One ReConnect selector, shared by every place that used to open the OS's
// own dropdown.
//
// A <select> renders its closed state with our CSS and its OPEN state with
// the platform's — on Android that is a full-height chooser with a green
// radio beside every row, which is the one part of this game nobody styled
// and everybody sees. This replaces the open state only.
//
// It is an enhancement over the real <select>, not a replacement for it.
// The element stays in the DOM holding the value, so `sel.value`, `sel.value
// = x`, `sel.onchange`, `sel.innerHTML = …` and inline onchange= attributes
// all keep working exactly as written — badge-admin.html reads $('tpl').value
// in six places and repaints its own options, and none of that had to change.
// What changes is that the element is no longer visible or focusable: a
// trigger button stands in front of it, and choosing a row writes the value
// back and dispatches the same `change` event the platform would have.
//
// The sheet itself is state.js's showOverlay — the same dialog role, focus
// trap, Escape handler, backdrop dismiss, focus restore and auto-added ✕
// that every other sheet in the game gets. Nothing here is a second modal
// framework.

import { el, esc, showOverlay, hideOverlay } from './state.js'
import {
  displayName,
  filterOptions,
  groupOptions,
  nextIndex,
  optionTags,
  selectedOption,
  shouldSearch,
} from './rc-select-model.js'

/** Read the live <select> as plain data. Sections come from the <optgroup>
 *  the option sits in; rarity and "current" come from data- attributes,
 *  because an <option> has nowhere else to put structured state and the
 *  alternative is parsing it back out of the label. */
function readOptions(select) {
  return [...select.querySelectorAll('option')].map((option) => ({
    id: option.value,
    name: option.textContent || '',
    section: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
    rarity: option.dataset.rarity || '',
    current: option.dataset.current === 'true',
    disabled: option.disabled,
  }))
}

function triggerLabel(select) {
  const option = selectedOption(readOptions(select), select.value)
  return option ? displayName(option) : ''
}

/** Assigning `.value` fires no event and mutates no child, so a programmatic
 *  reset (badge-admin does `$('tpl').value = ''` after publishing) would
 *  leave the trigger showing the old badge. Delegating the instance's own
 *  accessor to the prototype's keeps the element behaving exactly as before
 *  while giving the trigger somewhere to hear about it. */
function watchValue(select, onChange) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
  if (!descriptor?.set || Object.getOwnPropertyDescriptor(select, 'value')) return
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return descriptor.get.call(this) },
    set(next) { descriptor.set.call(this, next); onChange() },
  })
}

/**
 * Put a ReConnect sheet in front of a native <select>.
 *
 * @param select   the real element; keeps holding the value
 * @param title    sheet heading, e.g. 'DISTRICT'
 * @param hint     one quiet line under it, or nothing
 * @param search   true / false / 'auto' (shown once the list is long)
 * @returns {{refresh: () => void}}
 */
export function enhanceSelect(select, { title = '', hint = '', search = 'auto', searchPlaceholder = 'Search', variant = '' } = {}) {
  if (!select) return { refresh: () => {} }
  if (select.dataset.rcSelect === 'on') {
    const refresh = () => select.dispatchEvent(new CustomEvent('rc-select-refresh'))
    refresh()
    return { refresh }
  }
  select.dataset.rcSelect = 'on'
  select.classList.add('rc-select-native')
  // Not display:none — the element is still the form value and still the
  // thing every existing handler reads. Out of the accessibility tree and
  // out of the tab order is what makes the trigger the primary interaction.
  select.setAttribute('aria-hidden', 'true')
  select.tabIndex = -1

  const trigger = el('button', `rc-select-trigger${variant ? ` rc-select-trigger--${variant}` : ''}`)
  trigger.type = 'button'
  trigger.setAttribute('aria-haspopup', 'dialog')
  const value = el('span', 'rc-select-value')
  const chevron = el('span', 'rc-select-chevron', '▾')
  chevron.setAttribute('aria-hidden', 'true')
  trigger.append(value, chevron)
  select.insertAdjacentElement('afterend', trigger)

  function refresh() {
    const label = triggerLabel(select)
    value.textContent = label || 'Choose…'
    value.classList.toggle('is-placeholder', !label)
    trigger.disabled = select.disabled
    trigger.setAttribute('aria-label', `${title || 'Choose'}: ${label || 'nothing selected'}`)
  }

  // badge-admin repaints its whole <option> list whenever the catalog
  // reloads; the trigger has to follow it rather than cache a stale name.
  new MutationObserver(refresh).observe(select, { childList: true, subtree: true })
  select.addEventListener('rc-select-refresh', refresh)
  watchValue(select, refresh)
  refresh()

  trigger.onclick = () => {
    // showOverlay remembers whatever had focus and hands it back on close.
    // A tap does not reliably focus a <button> (iOS Safari does not, and a
    // programmatic .click() never does), so without this the focus went to
    // <body> and a keyboard or screen-reader user was dropped at the top of
    // the page every time they closed the sheet.
    trigger.focus()
    openSelectSheet({
      title,
      hint,
      search,
      searchPlaceholder,
      variant,
      options: readOptions(select),
      value: select.value,
      onChoose: (id) => {
        if (select.value === id) return
        select.value = id
        // The event goes out AFTER the sheet closes, so hideOverlay restores
        // focus to a trigger that is still in the document. Handlers that
        // re-render their own section (candySelectGuideDistrict does) would
        // otherwise leave focus on a detached node.
        select.dispatchEvent(new Event('change', { bubbles: true }))
      },
    })
  }

  return { refresh }
}

/** The sheet on its own, for callers that have options but no <select>. */
export function openSelectSheet({ title = '', hint = '', options = [], value = '', onChoose, search = 'auto', searchPlaceholder = 'Search', variant = '' } = {}) {
  // variant only adds a class. Admin screens want the same sheet at a denser
  // rhythm — they are read at a desk, in bulk, not one tap at a time — and a
  // second component for that would be two things to keep in step.
  const sheet = el('div', `sheet rc-select-sheet${variant ? ` rc-select-sheet--${variant}` : ''}`)
  const titleId = `rc-select-title-${Math.random().toString(36).slice(2, 8)}`
  sheet.setAttribute('aria-labelledby', titleId)

  const head = el('div', 'rc-select-head')
  const heading = el('h3', 'rc-select-title', esc(title))
  heading.id = titleId
  head.appendChild(heading)
  if (hint) head.appendChild(el('p', 'rc-select-hint', esc(hint)))
  sheet.appendChild(head)

  const list = el('div', 'rc-select-list')
  list.setAttribute('role', 'listbox')
  if (title) list.setAttribute('aria-label', title)

  if (shouldSearch(search, options.length)) {
    const wrap = el('label', 'rc-select-search')
    wrap.innerHTML = '<span aria-hidden="true">⌕</span>'
    const searchInput = el('input')
    searchInput.type = 'search'
    searchInput.placeholder = searchPlaceholder
    searchInput.setAttribute('aria-label', searchPlaceholder)
    // Purely client-side over options already in hand — no request per key.
    searchInput.oninput = () => paint(searchInput.value)
    wrap.appendChild(searchInput)
    head.appendChild(wrap)
  }

  /** Every row currently on screen, in visual order — what the arrow keys
   *  move through. Rebuilt by paint() so a filtered list never steps onto a
   *  row that is no longer there. */
  let rows = []

  function paint(query) {
    const visible = filterOptions(options, query)
    list.innerHTML = ''
    rows = []
    if (!visible.length) {
      list.appendChild(el('p', 'rc-select-empty', 'Nothing matches that.'))
      return
    }
    for (const group of groupOptions(visible)) {
      if (group.label) list.appendChild(el('div', 'rc-select-section', esc(group.label)))
      for (const option of group.items) {
        const chosen = option.id === value
        const row = el('button', `rc-select-row${chosen ? ' is-selected' : ''}`)
        row.type = 'button'
        row.setAttribute('role', 'option')
        row.setAttribute('aria-selected', chosen ? 'true' : 'false')
        row.disabled = option.disabled
        if (option.disabled) row.setAttribute('aria-disabled', 'true')
        // Focus opens on the current choice rather than the top of the list,
        // so a keyboard or screen-reader user starts where they already are.
        if (chosen) row.dataset.autofocus = 'true'
        const name = el('span', 'rc-select-name', esc(displayName(option)))
        const tags = el('span', 'rc-select-tags')
        for (const tag of optionTags(option)) tags.appendChild(el('span', 'rc-select-tag', esc(tag)))
        const mark = el('span', 'rc-select-mark', chosen ? '✓' : '')
        mark.setAttribute('aria-hidden', 'true')
        row.append(name, tags, mark)
        row.onclick = () => { hideOverlay(); onChoose?.(option.id) }
        list.appendChild(row)
        rows.push(row)
      }
    }
  }

  list.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (step) {
      e.preventDefault()
      const i = nextIndex(rows.indexOf(document.activeElement), step, rows.length)
      if (i >= 0) rows[i].focus()
      return
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const row = e.key === 'Home' ? rows[0] : rows[rows.length - 1]
      row?.focus()
    }
  })

  paint('')
  sheet.appendChild(list)
  // Escape, the backdrop, the focus trap, focus restore and the ✕ in the
  // corner all come from here — see state.js's showOverlay.
  showOverlay(sheet)
  return sheet
}
