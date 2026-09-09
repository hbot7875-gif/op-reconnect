import { el, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { renderShareSceneImage } from './share-scene-image.js'

const preparing=new Map()
export function prepareSceneShare(params,request=call) {
  if(params.kind==='district')params={...params,sceneCharge:Math.max(0,Math.min(1,Number(window.__rcState?.bomb?.charge)||0))}
  const key=JSON.stringify({agentNo:getAgentNo(),...params})
  if(preparing.has(key))return preparing.get(key)
  const promise=(async()=>{
    const snapshot=await request('createShareSnapshot',{agentNo:getAgentNo(),...params})
    if(!snapshot?.success)throw new Error(snapshot?.error||'Could not prepare share')
    if(!snapshot.imageReady){const png=await renderShareSceneImage(snapshot);const saved=await request('attachShareImage',{agentNo:getAgentNo(),id:snapshot.id,png});if(!saved?.success)throw new Error(saved?.error||'Could not save image')}
    return snapshot
  })().finally(()=>preparing.delete(key))
  preparing.set(key,promise);return promise
}

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
  let copyOnly = typeof navigator.share !== 'function'

  // Prepare the small server snapshot while the sheet is open. Web Share
  // requires a live tap gesture; waiting for this network request inside the
  // tap handler can make mobile browsers revoke that gesture before
  // navigator.share() opens the app chooser.
  Promise.resolve().then(createSnapshot).then((result) => {
    if (!result?.success || !result.url) throw new Error('share_link_failed')
    snapshot = result
    primary.disabled = false
    primary.textContent = copyOnly ? 'COPY LINK' : 'SHARE'
    // Open directly when the original tap is still valid. Browsers that drop
    // activation during async preparation keep this one small Share button.
    if(!copyOnly && navigator.userActivation?.isActive && sheet.isConnected && !sheet.closest('[hidden]'))primary.click()
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
        primary.disabled = false; primary.textContent = copyOnly ? 'COPY LINK' : 'SHARE'
        return
      } catch {
        primary.disabled = false; primary.textContent = 'TRY AGAIN'; toast("Couldn't prepare this share")
        return
      }
    }
    if (copyOnly) {
      try { await navigator.clipboard.writeText(snapshot.url); toast('Link copied'); hideOverlay() }
      catch { toast("Couldn't copy the link") }
      return
    }
    primary.disabled = true; primary.textContent = 'OPENING SHARE…'
    const result = await nativeLinkShare(snapshot)
    if (result === 'shared' || result === 'cancelled') { hideOverlay(); return }
    copyOnly = true
    primary.disabled = false; primary.textContent = 'COPY LINK'
    const note = sheet.querySelector('.share-choice-note')
    if (note) note.textContent = 'Your browser could not open sharing. You can still copy the link.'
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
    () => prepareSceneShare({ kind: 'district', districtId: options.districtId || district.id }))
}

/** Fetch once on open, then freeze that response. The timer, progress and
 *  target describe one coherent instant even if the event changes while
 *  the PNG is rendering or the native share sheet is open. */
export function openRedZoneShare() {
  return shareSheet('SHARE RED ZONE', 'Call ARMY into the fight.',
    () => prepareSceneShare({ kind: 'red_zone_active' }))
}

export function openSuccessfulRedZoneShare(resolved) {
  return shareSheet('SHARE THE WIN', 'The City is safe.',
    () => prepareSceneShare({ kind: 'red_zone_success', eventId: resolved.id }))
}

export function openCityShare() {
  return shareSheet('SHARE ARMY BOMB','Your ARMY Bomb, in this moment.',()=>prepareSceneShare({kind:'city_bomb'}))
}
