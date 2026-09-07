import { el, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'

function findDistrict(state, districtId, suppliedDistrict) {
  if (suppliedDistrict) return suppliedDistrict
  const districts = state.map?.districts || []
  if (districtId) return districts.find((district) => district.id === districtId) || null
  if (state.activeDistrict?.id) return districts.find((district) => district.id === state.activeDistrict.id) || state.activeDistrict
  return [...districts].reverse().find((district) => district.status === 'restored' || district.status === 'centerpiece_lit') || null
}

async function nativeLinkShare(snapshot) {
  if (typeof navigator.share !== 'function') return 'unsupported'
  try {
    // Keep the URL in one field only. Supplying it as both text and url makes
    // several Android share targets visibly paste the same link twice.
    await navigator.share({ title: snapshot.title, url: snapshot.url })
    return 'shared'
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

function shareDestination(label, href) {
  const link = el('a', 'btn btn-ghost', label)
  link.href = href
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  return link
}

function showShareDestinations(sheet, snapshot, primary) {
  primary.remove()
  sheet.querySelector('.share-choice-note')?.remove()

  const encodedUrl = encodeURIComponent(snapshot.url)
  const encodedTitle = encodeURIComponent(snapshot.title || 'ReConnect')
  const choices = el('div', 'share-destinations')
  if (typeof navigator.share === 'function') {
    const more = el('button', 'btn btn-primary share-more-apps', 'MORE APPS')
    more.onclick = async () => {
      more.disabled = true; more.textContent = 'OPENING APPS…'
      const result = await nativeLinkShare(snapshot)
      if (result === 'shared') { hideOverlay(); return }
      more.disabled = false; more.textContent = 'MORE APPS'
      if (result !== 'cancelled') toast("Couldn't open the system share menu")
    }
    choices.appendChild(more)
  }
  choices.append(
    shareDestination('WHATSAPP', `https://wa.me/?text=${encodedUrl}`),
    shareDestination('TELEGRAM', `https://t.me/share/url?url=${encodedUrl}`),
    shareDestination('X', `https://twitter.com/intent/tweet?url=${encodedUrl}`),
    shareDestination('FACEBOOK', `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`),
    shareDestination('EMAIL', `mailto:?subject=${encodedTitle}&body=${encodedUrl}`),
  )

  const copy = el('button', 'btn btn-ghost', 'COPY LINK')
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(snapshot.url); toast('Link copied') }
    catch { toast("Couldn't copy the link") }
  }
  choices.appendChild(copy)
  sheet.insertBefore(choices, sheet.querySelector('button:last-child'))
}

function shareSheet(kicker, heading, createSnapshot) {
  const sheet = el('div', 'sheet share')
  sheet.append(el('div', 'eyebrow', kicker), el('div', 'share-title', heading))
  sheet.append(el('p', 'muted share-choice-note', 'Share a live ReConnect link with its picture preview.'))
  const primary = el('button', 'btn btn-primary', 'PREPARING LINK…')
  primary.disabled = true
  sheet.append(primary)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  let snapshot = null

  // Prepare the small server snapshot while the sheet is open. Web Share
  // requires a live tap gesture; waiting for this network request inside the
  // tap handler can make mobile browsers revoke that gesture before
  // navigator.share() opens the app chooser.
  Promise.resolve().then(createSnapshot).then((result) => {
    if (!result?.success || !result.url) throw new Error('share_link_failed')
    snapshot = result
    primary.disabled = false
    primary.textContent = 'SHARE'
  }).catch(() => {
    primary.textContent = 'COULDN\'T PREPARE LINK · TRY AGAIN'
    primary.disabled = false
  })

  primary.onclick = async () => {
    if (!snapshot) {
      primary.disabled = true; primary.textContent = 'PREPARING LINK…'
      try {
        const result = await createSnapshot()
        if (!result?.success || !result.url) throw new Error('share_link_failed')
        snapshot = result
        primary.disabled = false; primary.textContent = 'SHARE'
        return
      } catch {
        primary.disabled = false; primary.textContent = 'TRY AGAIN'; toast("Couldn't prepare this share")
        return
      }
    }
    showShareDestinations(sheet, snapshot, primary)
  }
  return sheet
}

export function openDistrictShare(state, options = {}) {
  const district = findDistrict(state, options.districtId, options.district)
  if (!district) {
    const sheet = el('div', 'sheet share')
    sheet.append(el('div', 'eyebrow', 'SHARE MY DISTRICT'), el('p', 'muted', 'Start restoring a district first — then its lights can become your share.'))
    const close = el('button', 'btn btn-ghost', 'Close'); close.onclick = hideOverlay; sheet.appendChild(close)
    return sheet
  }
  return shareSheet('SHARE MY DISTRICT', 'Your City moment, ready to post.',
    () => call('createShareSnapshot', { agentNo: getAgentNo(), kind: 'district', districtId: options.districtId || district.id }))
}

/** Fetch once on open, then freeze that response. The timer, progress and
 *  target describe one coherent instant even if the event changes while
 *  the PNG is rendering or the native share sheet is open. */
export function openRedZoneShare() {
  return shareSheet('SHARE RED ZONE', 'Call ARMY into the fight.',
    () => call('createShareSnapshot', { agentNo: getAgentNo(), kind: 'red_zone_active' }))
}

export function openSuccessfulRedZoneShare(resolved) {
  return shareSheet('SHARE THE WIN', 'The City is safe.',
    () => call('createShareSnapshot', { agentNo: getAgentNo(), kind: 'red_zone_success', eventId: resolved.id }))
}
