// The ReConnect multi-select, for the two admin `<select multiple>` controls.
//
// Deliberately NOT the rc-select sheet. Both call sites sit directly under a
// filter input that re-renders the option list as you type
// (candy-star-admin's #genIndividualFilter, and the Red Zone list which the
// admin reads against the echo line right below it). Putting the options
// behind a modal would break the one loop those screens are built around:
// type, look, tick, type again. So this renders in place — same position,
// same size, same "filter and list on screen together" — and only replaces
// the rows themselves, which is the part a phone would otherwise hand to a
// full-screen multi-choice dialog.
//
// Like rc-select, the native <select multiple> stays the source of truth.
// Ticking a row writes option.selected and dispatches the same `change`
// event, so every existing handler runs exactly as before — including ones
// that write selection BACK during the event. admin.html's Red Zone echo
// does exactly that: picking any real goal clears its "Any BTS song" entry
// via `anyOpt.selected = picked.length === 0`. That is why the panel
// re-reads the DOM after dispatching rather than trusting what it just
// wrote; the handler gets the last word, as it does today.

import { el, esc } from './state.js'

/** The live options, in DOM order, with their optgroup. Read fresh every
 *  time: both call sites rebuild their whole option list from a filter box. */
function readOptions(select) {
  return [...select.querySelectorAll('option')].map((option) => ({
    id: option.value,
    name: option.textContent || '',
    group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
    selected: option.selected,
    disabled: option.disabled,
  }))
}

/**
 * Put a ReConnect checkbox list in front of a native <select multiple>.
 *
 * @param select  the real element; keeps holding the selection
 * @param label   accessible name for the group
 * @returns {{refresh: () => void}}
 */
export function enhanceMultiSelect(select, { label = 'Options', empty = 'Nothing to choose from.' } = {}) {
  if (!select) return { refresh: () => {} }
  if (select.dataset.rcMulti === 'on') {
    const refresh = () => select.dispatchEvent(new CustomEvent('rc-multi-refresh'))
    refresh()
    return { refresh }
  }
  select.dataset.rcMulti = 'on'
  select.classList.add('rc-multi-native')
  select.setAttribute('aria-hidden', 'true')
  select.tabIndex = -1

  const panel = el('div', 'rc-multi')
  panel.setAttribute('role', 'group')
  panel.setAttribute('aria-label', label)
  select.insertAdjacentElement('afterend', panel)

  // Guards the rebuild that our own write triggers: dispatching `change`
  // can make a handler re-render the option list, and re-entering paint()
  // from inside paint() would drop the click that started it.
  let painting = false

  function paint() {
    if (painting) return
    painting = true
    const options = readOptions(select)
    panel.innerHTML = ''
    if (!options.length) {
      panel.appendChild(el('p', 'rc-multi-empty', esc(empty)))
      painting = false
      return
    }
    let group = null
    for (const [i, option] of options.entries()) {
      if (option.group && option.group !== group) {
        group = option.group
        panel.appendChild(el('div', 'rc-multi-group', esc(group)))
      }
      const row = el('label', `rc-multi-row${option.selected ? ' is-on' : ''}`)
      const box = el('input')
      box.type = 'checkbox'
      box.className = 'rc-multi-box'
      box.checked = option.selected
      box.disabled = option.disabled
      // The index, not the value: candy-star-admin's catalog can hold two
      // rows with the same key, and the native control treats those as two
      // separate options. Matching by value would tick both.
      box.dataset.index = String(i)
      box.onchange = () => choose(i, box.checked)
      const name = el('span', 'rc-multi-name', esc(option.name))
      row.append(box, name)
      panel.appendChild(row)
    }
    painting = false
  }

  function choose(index, on) {
    const option = select.querySelectorAll('option')[index]
    if (!option || option.disabled) return
    option.selected = on
    // Same event the platform fires, so existing handlers are untouched.
    select.dispatchEvent(new Event('change', { bubbles: true }))
    // A handler may have adjusted the selection during that dispatch. Read
    // the DOM back rather than assuming our own write survived.
    paint()
    // paint() replaces every row, which takes the focused checkbox with it.
    // Without this, ticking a box with Space dropped focus to <body> and the
    // next Space scrolled the page instead of ticking the next option —
    // keyboard multi-select would not have worked at all.
    const again = panel.querySelector(`.rc-multi-box[data-index="${index}"]`)
    if (again && document.activeElement !== again) again.focus({ preventScroll: true })
  }

  // Both call sites replace the entire option list from a filter input.
  new MutationObserver(paint).observe(select, { childList: true, subtree: true })
  select.addEventListener('rc-multi-refresh', paint)
  paint()

  return { refresh: paint }
}
