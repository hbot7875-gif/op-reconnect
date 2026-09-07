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
    // Put the URL in both channels. Some installed apps ignore the dedicated
    // `url` member but preserve text; others use `url` to build the preview.
    await navigator.share({ title: snapshot.title, text: snapshot.url, url: snapshot.url })
    return 'shared'
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

function shareSheet(kicker, heading, createSnapshot) {
  const sheet = el('div', 'sheet share')
  sheet.append(el('div', 'eyebrow', kicker), el('div', 'share-title', heading))
  sheet.append(el('p', 'muted', 'Share a live ReConnect link with its picture preview.'))
  const primary = el('button', 'btn btn-primary', 'PREPARING LINK…')
  primary.disabled = true
  sheet.append(primary)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  let sharing = false
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
    if (sharing) return
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
    sharing = true; primary.disabled = true; primary.textContent = 'OPENING SHARE…'
    try {
      // snapshot is already resolved, so navigator.share() is invoked during
      // this exact user gesture instead of after a network round trip.
      const result = await nativeLinkShare(snapshot)
      if (result === 'shared' || result === 'cancelled') { hideOverlay(); return }
      await navigator.clipboard.writeText(snapshot.url)
      toast('Sharing is unavailable here · link copied')
    } catch { toast("Couldn't prepare this share · try again") }
    sharing = false; primary.disabled = false; primary.textContent = 'SHARE'
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
