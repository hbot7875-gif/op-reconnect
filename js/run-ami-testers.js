// War of Cards testers — AGENT000's sheet to add and remove them
// (Settings → HT Access). The server decides everything
// (lib/run-ami-testers.js): it refuses anyone but AGENT000, keeps AGENT000
// on the list, and answers each change with the fresh list, which is all
// this renders. Changes apply on the tester's next refresh; nobody has to
// redeploy.

import { el, esc, showOverlay, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { TESTER_ERRORS } from '../supabase/functions/op-reconnect/lib/run-ami-testers.js'

const say = (code) => TESTER_ERRORS[code] || TESTER_ERRORS.server_error

function listHtml(testers) {
  return testers.map((t) => `
    <li class="tm-row">
      <span class="tm-who"><b>${esc(t.name)}</b><small>${esc(t.agentNo)}</small></span>
      ${t.owner ? '<em class="tm-owner">Owner</em>'
        : `<button class="tm-remove" type="button" data-agent="${esc(t.agentNo)}" aria-label="Remove ${esc(t.name)}">Remove</button>`}
    </li>`).join('')
}

function render(sheet, testers) {
  sheet.innerHTML = `
    <span class="rarmy-eyebrow">🃏 War of Cards</span>
    <h3 tabindex="-1" data-autofocus="true">Testers</h3>
    <p class="tm-lede">Testers can play War of Cards without collecting all 15 album covers. Changes apply on their next refresh.</p>
    <form class="tm-add">
      <input name="target" inputmode="numeric" autocomplete="off" placeholder="Agent number, e.g. 050" maxlength="12" aria-label="Agent number to add">
      <button class="btn btn-primary" type="submit">Add</button>
    </form>
    <p class="tm-err" role="status" hidden></p>
    <p class="tm-count">${testers.length} tester${testers.length === 1 ? '' : 's'}</p>
    <ul class="tm-list">${listHtml(testers)}</ul>`
  const close = el('button', 'btn btn-ghost', 'Close')
  close.type = 'button'
  close.onclick = hideOverlay
  sheet.appendChild(close)

  const err = sheet.querySelector('.tm-err')
  const fail = (res) => { err.textContent = say(res?.error); err.hidden = false }

  const form = sheet.querySelector('.tm-add')
  form.onsubmit = async (e) => {
    e.preventDefault()
    const target = form.target.value.trim()
    if (!target) return
    const btn = form.querySelector('button')
    btn.disabled = true
    const res = await call('runAmiTesterAdd', { agentNo: getAgentNo(), target })
    btn.disabled = false
    if (!res?.success) { fail(res); return }
    const added = res.testers.at(-1)
    toast(`${added?.name || 'Agent'} can now play War of Cards`)
    render(sheet, res.testers)
  }

  sheet.querySelectorAll('.tm-remove').forEach((b) => {
    b.onclick = async () => {
      const who = b.closest('.tm-row')?.querySelector('b')?.textContent || 'this agent'
      if (b.dataset.confirm !== '1') {
        // Two taps: the first only asks, so a stray tap can't remove anyone.
        b.dataset.confirm = '1'
        b.textContent = 'Tap again'
        setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = 'Remove' } }, 3000)
        return
      }
      b.disabled = true
      const res = await call('runAmiTesterRemove', { agentNo: getAgentNo(), target: b.dataset.agent })
      if (!res?.success) { b.disabled = false; fail(res); return }
      toast(`${who} is no longer a tester`)
      render(sheet, res.testers)
    }
  })
}

export async function openTesterManager() {
  const sheet = el('div', 'sheet ra-sheet tm-sheet')
  sheet.innerHTML = '<p class="tm-lede" tabindex="-1" data-autofocus="true">Loading testers…</p>'
  showOverlay(sheet)
  const res = await call('runAmiTesters', { agentNo: getAgentNo() })
  if (!sheet.isConnected) return
  if (!res?.success) {
    sheet.innerHTML = `<p class="tm-lede">${esc(say(res?.error))}</p>`
    const close = el('button', 'btn btn-ghost', 'Close')
    close.type = 'button'
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return
  }
  render(sheet, res.testers)
}
