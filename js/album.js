// The Album sheet: 15 BTS album covers (lib/album-rules.js), opened from
// Run ARMY (run-army.js).
//
// Everything shown comes from the server's albumState view: which covers you
// hold, how each arrived, and whether today's gift is still free. Covers are
// drawn with the RUN AMI card artwork for that era, so a cover looks exactly
// like the cards it unlocks. A gift is a copy — you keep yours — and goes to
// an agent by number; the server answers with their codename.

import { el, esc, showOverlay, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { cardHtml } from './run-ami-cards.js'
import { ALBUM_ERAS, albumEra, albumErrorText } from '../supabase/functions/op-reconnect/lib/album-rules.js'

// Covers rotate through the four game colours so the grid isn't one hue;
// wild-art eras keep their four-colour header.
const TINT = ['r', 'y', 'g', 'b']
const coverCard = (era, i) => cardHtml({ c: era.k === 'wild' || era.k === 'wd4' ? null : TINT[i % 4], k: era.k })

function coversHtml(album) {
  const held = new Map(album.covers.map((c) => [c.era, c]))
  return ALBUM_ERAS.map((era, i) => {
    const c = held.get(era.id)
    if (!c) {
      return `<li class="al-cover is-missing"><span class="al-slot" aria-hidden="true">?</span><b>${esc(era.name)}</b><span class="ra-sr">Not collected yet</span></li>`
    }
    const tag = album.todayGoalEra === era.id ? '<em class="al-tag">New today</em>'
      : c.source === 'gift' ? `<em class="al-tag is-gift">From ${esc(c.fromName || 'an agent')}</em>` : ''
    return `<li class="al-cover"><span class="al-art" aria-hidden="true">${coverCard(era, i)}</span><b>${esc(era.name)}</b>${tag}</li>`
  }).join('')
}

function todayLine(album) {
  if (album.complete) return 'Album complete. War of Cards is open to you in Run ARMY.'
  if (album.todayGoalEra) return `Today's cover: ${albumEra(album.todayGoalEra)?.name || 'collected'}. Come back tomorrow for the next one.`
  return "Finish today's Signal Sweep to collect a new cover."
}

function giftHtml(album) {
  if (!album.count) return '<p class="al-gift-note">Once you have a cover, you can share a copy with another agent.</p>'
  if (album.gift.sentToday) return '<p class="al-gift-note">Today\'s gift is sent. You can share another tomorrow.</p>'
  // Chips, not a <select>: the app's pickers are its own (rc-select.test.mjs).
  const chips = album.covers.map((c, i) => `<label class="al-chip"><input type="radio" name="era" value="${esc(c.era)}"${i === 0 ? ' checked' : ''}><span>${esc(albumEra(c.era)?.name || c.era)}</span></label>`).join('')
  return `
    <form class="al-gift-form">
      <fieldset class="al-field al-pick"><legend>Cover to share</legend><div class="al-chips">${chips}</div></fieldset>
      <label class="al-field"><span>Agent number</span><input name="to" inputmode="numeric" autocomplete="off" placeholder="050" maxlength="12"></label>
      <button class="btn btn-primary al-send" type="submit">Share a copy</button>
    </form>
    <p class="al-gift-note">You keep your cover. One gift a day, to an agent who doesn't have it yet.</p>
    <p class="al-gift-err" role="status" hidden></p>`
}

function render(sheet, album) {
  sheet.innerHTML = `
    <span class="rarmy-eyebrow">💿 Album</span>
    <h3 tabindex="-1" data-autofocus="true">BTS Album Covers</h3>
    <div class="al-progress" role="img" aria-label="${album.count} of ${album.total} covers">
      <b>${album.count}<small> / ${album.total}</small></b>
      <span class="al-bar"><i style="--p:${album.count / album.total}"></i></span>
    </div>
    <p class="al-why">Collect all ${album.total} to unlock War of Cards in Run ARMY. Each daily Signal Sweep brings one new cover, and friends can gift you one a day.</p>
    <p class="al-today">${esc(todayLine(album))}</p>
    <ol class="al-grid">${coversHtml(album)}</ol>
    <section class="al-gift"><h4>Gift a cover</h4>
      <div class="al-me"><span>Your agent number</span><b>${esc(getAgentNo() || '')}</b><button class="al-copy" type="button">Copy</button></div>
      <p class="al-gift-note">Share it so friends can gift you covers.</p>
      ${giftHtml(album)}</section>`
  const close = el('button', 'btn btn-ghost', 'Close')
  close.type = 'button'
  close.onclick = hideOverlay
  sheet.appendChild(close)

  sheet.querySelector('.al-copy').onclick = async (e) => {
    try {
      await navigator.clipboard.writeText(getAgentNo() || '')
      e.target.textContent = 'Copied'
    } catch (_) {
      e.target.textContent = 'Copy failed'
    }
    setTimeout(() => { if (e.target.isConnected) e.target.textContent = 'Copy' }, 1600)
  }

  const form = sheet.querySelector('.al-gift-form')
  if (!form) return
  const err = sheet.querySelector('.al-gift-err')
  form.onsubmit = async (e) => {
    e.preventDefault()
    const send = form.querySelector('.al-send')
    send.disabled = true
    err.hidden = true
    const res = await call('albumGift', { agentNo: getAgentNo(), to: form.to.value, era: form.era.value })
    send.disabled = false
    if (res?.success) {
      toast(`Shared ${albumEra(res.gift.era)?.name || 'a cover'} with ${res.gift.toName}`)
      render(sheet, res.album)
      return
    }
    err.textContent = albumErrorText(res?.error)
    err.hidden = false
    if (res?.album) {
      // Keep what they typed; only the gift status may have changed.
      if (res.album.gift.sentToday) render(sheet, res.album)
    }
  }
}

export async function openAlbum() {
  const sheet = el('div', 'sheet ra-sheet al-sheet')
  // The overlay focuses [data-autofocus] on open; the heading keeps the sheet
  // at the top instead of jumping to the gift form's first control.
  sheet.innerHTML = '<p class="al-loading" tabindex="-1" data-autofocus="true">Opening your album…</p>'
  showOverlay(sheet)
  const res = await call('albumState', { agentNo: getAgentNo() })
  if (!sheet.isConnected) return
  if (!res?.success || !res.album) {
    sheet.innerHTML = '<p class="al-loading">Your album could not be opened. Try again in a moment.</p>'
    const close = el('button', 'btn btn-ghost', 'Close')
    close.type = 'button'
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return
  }
  render(sheet, res.album)
  sheet.querySelector('h3')?.focus({ preventScroll: true })
  sheet.scrollTop = 0
}

/** Once per new cover on this device: a toast on the City saying it arrived
 *  — today's Signal Sweep cover, and any cover a friend shared today. Called
 *  on every City paint; the stored era keeps each to a single toast. A cover
 *  is never earned twice, so the era alone is a safe "already said" key. */
export function announceNewCover(album) {
  const said = (kind, era) => {
    const key = `rc-album-seen:${kind}:${getAgentNo() || ''}`
    try {
      if (localStorage.getItem(key) === era) return true
      localStorage.setItem(key, era)
      return false
    } catch (_) {
      return true // no storage, no way to say it only once: stay quiet
    }
  }
  const lines = []
  const goal = album?.todayGoalEra
  if (goal && !said('goal', goal)) lines.push([`New album cover: ${albumEra(goal)?.name || 'collected'} · see it in Run ARMY`, 4200])
  const gift = album?.giftToday
  if (gift?.era && !said('gift', gift.era)) lines.push([`🎁 ${gift.fromName} sent you the ${albumEra(gift.era)?.name || 'new'} cover · see it in Run ARMY`, 4600])
  // A short wait first: the City paints before main.js opens any pop-up.
  if (lines.length) setTimeout(() => afterOverlay(() => lines.forEach(([text, ms], i) => setTimeout(() => toast(text, ms), i * 4400))), 600)
}

/** Runs `fn` once no sheet is open, so a toast never sits on top of a
 *  pop-up's buttons (the launch pop-up and today's cover can arrive together).
 *  Gives up quietly after a minute. */
function afterOverlay(fn, tries = 120) {
  const overlay = document.getElementById('overlay')
  if (!overlay || overlay.hidden) { fn(); return }
  if (tries > 0) setTimeout(() => afterOverlay(fn, tries - 1), 500)
}
