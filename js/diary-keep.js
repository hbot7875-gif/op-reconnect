// "Keep in Dear Diary" — the door from a big moment into the diary.
//
// Sits on the badge unlock, level-up and restoration pop-ups. Those moments
// already appear on their day's page by themselves; keeping one pins it to
// the top of that page as a Kept card with an optional line in the player's
// own words (lib/dear-diary.ts keepDearDiaryMoment checks it really
// happened). Then it offers to open the diary right on that page.
//
// Kept apart from screen-diary.js on purpose: pop-ups load with every
// screen, the diary only when it is opened.

import { call } from './api.js'
import { el, esc, toast } from './state.js'
import { getAgentNo } from './session.js'
import { goDiary } from './router.js'

const LINE_MAX = 140
let pendingDate = null

/** The page the diary should open on next, set by a keep. */
export function takeDiaryTarget() {
  const date = pendingDate
  pendingDate = null
  return date
}

/** `close()` dismisses the pop-up before the diary opens. */
export function keepInDiaryControl({ kind, ref, close = () => {} }) {
  const wrap = el('div', 'dd-keep')
  const start = el('button', 'dd-keep-start', '<span aria-hidden="true">✎</span> Keep in Dear Diary')
  start.type = 'button'
  wrap.appendChild(start)

  start.onclick = () => {
    wrap.innerHTML = ''
    const form = el('form', 'dd-keep-form')
    form.innerHTML = `
      <label class="dd-keep-label" for="ddKeepLine">A line about it <small>(optional · only you)</small></label>
      <input id="ddKeepLine" maxlength="${LINE_MAX}" autocomplete="off" enterkeyhint="done" placeholder="How did it feel?">
      <div class="dd-keep-actions">
        <button type="submit" class="btn btn-primary dd-keep-save">Keep it</button>
        <button type="button" class="dd-keep-cancel">Not now</button>
      </div>`
    wrap.appendChild(form)
    const input = form.querySelector('input')
    form.querySelector('.dd-keep-cancel').onclick = () => { wrap.replaceChildren(start) }
    form.onsubmit = async (e) => {
      e.preventDefault()
      const save = form.querySelector('.dd-keep-save')
      save.disabled = true
      const res = await call('keepDearDiaryMoment', { agentNo: getAgentNo(), kind, ref, line: input.value })
      if (!res?.success) { save.disabled = false; toast(res?.error || 'Couldn’t keep that one'); return }
      wrap.innerHTML = ''
      const done = el('div', 'dd-keep-done', `<span>Kept in your Dear Diary ✦</span>`)
      const day = new Date(`${res.date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
      const open = el('button', 'dd-keep-open', `Open ${res.isToday ? 'today’s page' : `the ${esc(day)} page`} →`)
      open.type = 'button'
      open.onclick = () => { pendingDate = res.date; close(); goDiary() }
      done.appendChild(open)
      wrap.appendChild(done)
    }
    input.focus({ preventScroll: true })
  }
  return wrap
}
