import { el, esc, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { districtFraction } from './district-progress.js'
import { districtShareAsset, liveRedZoneShareAsset, successfulRedZoneShareAsset } from './share-card.js'
import { shareAssetNativeFirst } from './native-share.js'

function findDistrict(state, districtId, suppliedDistrict) {
  if (suppliedDistrict) return suppliedDistrict
  const districts = state.map?.districts || []
  if (districtId) return districts.find((district) => district.id === districtId) || null
  if (state.activeDistrict?.id) return districts.find((district) => district.id === state.activeDistrict.id) || state.activeDistrict
  return [...districts].reverse().find((district) => district.status === 'restored' || district.status === 'centerpiece_lit') || null
}

function districtProgress(state, district, forcedProgress) {
  if (Number.isFinite(forcedProgress)) return Math.max(0, Math.min(1, forcedProgress))
  if (district.status === 'restored' || district.status === 'centerpiece_lit') return 1
  if (state.activeDistrict?.id === district.id) return districtFraction(state.activeDistrict)
  if (district.status === 'available') return .05
  return 0
}

function download(asset) {
  const url = URL.createObjectURL(asset.blob)
  const a = document.createElement('a')
  a.href = url; a.download = asset.filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1200)
}

async function copyCaption(asset) {
  try { await navigator.clipboard.writeText(asset.caption); toast('Caption copied') }
  catch { toast("Couldn't copy the caption") }
}

async function nativeImageShare(asset) {
  return shareAssetNativeFirst(asset, {
    share: typeof navigator.share === 'function' ? navigator.share.bind(navigator) : null,
    canShare: typeof navigator.canShare === 'function' ? navigator.canShare.bind(navigator) : null,
    FileCtor: File,
  }, async () => {
    download(asset)
    await copyCaption(asset)
    toast('Image saved · caption copied')
  })
}

async function nativeLinkShare(snapshot) {
  if (typeof navigator.share !== 'function') return 'unsupported'
  try {
    // Put the URL in both channels. Some installed apps ignore the dedicated
    // `url` member but preserve text; others use `url` to build the preview.
    await navigator.share({ title: snapshot.title, text: snapshot.caption, url: snapshot.url })
    return 'shared'
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

async function freshGameState() {
  const fresh = await call('getGameState', { agentNo: getAgentNo() })
  if (!fresh?.success) throw new Error('share_refresh_failed')
  return fresh
}

function shareSheet(kicker, heading, buildAsset, createSnapshot) {
  const sheet = el('div', 'sheet share share-image-sheet')
  sheet.append(el('div', 'eyebrow', kicker), el('div', 'share-title', heading))
  const preview = el('div', 'share-image-preview', '<span>MAKING YOUR SHARE…</span>')
  sheet.appendChild(preview)
  const primary = el('button', 'btn btn-primary', 'PREPARING SHARE…')
  const imageShare = el('button', 'btn btn-ghost', 'SHARE IMAGE / STORY')
  const copy = el('button', 'btn btn-ghost', 'COPY CAPTION')
  const save = el('button', 'btn btn-ghost', 'SAVE IMAGE')
  primary.disabled = imageShare.disabled = copy.disabled = save.disabled = true
  sheet.append(primary, imageShare, copy, save)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  Promise.resolve().then(buildAsset).then((asset) => {
    if (!asset?.blob) throw new Error('share_image_failed')
    const objectUrl = URL.createObjectURL(asset.blob)
    preview.innerHTML = `<img src="${esc(objectUrl)}" alt="Generated ReConnect share image">`
    primary.textContent = 'SHARE'
    primary.disabled = imageShare.disabled = copy.disabled = save.disabled = false
    let sharing = false
    let snapshotPromise = null
    const ensureSnapshot = () => {
      if (!snapshotPromise) snapshotPromise = Promise.resolve().then(createSnapshot).then((result) => {
        if (!result?.success || !result.url) throw new Error('share_link_failed')
        return result
      }).catch((error) => { snapshotPromise = null; throw error })
      return snapshotPromise
    }
    primary.onclick = async () => {
      if (sharing) return
      sharing = true; primary.disabled = true; primary.textContent = 'PREPARING SHARE…'
      try {
        const snapshot = await ensureSnapshot()
        primary.textContent = 'OPENING SHARE…'
        const result = await nativeLinkShare(snapshot)
        if (result === 'shared' || result === 'cancelled') { URL.revokeObjectURL(objectUrl); hideOverlay(); return }
        await navigator.clipboard.writeText(snapshot.caption)
        toast('Share link + caption copied')
      } catch { toast("Couldn't prepare this share · try again") }
      sharing = false; primary.disabled = false; primary.textContent = 'SHARE'
    }
    imageShare.onclick = async () => {
      if (sharing) return
      sharing = true; imageShare.disabled = true; imageShare.textContent = 'PREPARING IMAGE…'
      try {
        const snapshot = await ensureSnapshot()
        const currentAsset = await buildAsset()
        const result = await nativeImageShare({ ...currentAsset, title: snapshot.title, caption: snapshot.caption, url: snapshot.url })
        if (result === 'shared' || result === 'cancelled') { URL.revokeObjectURL(objectUrl); hideOverlay(); return }
      } catch { toast("Couldn't prepare this share · try again") }
      sharing = false; imageShare.disabled = false; imageShare.textContent = 'SHARE IMAGE / STORY'
    }
    copy.onclick = async () => {
      try { await copyCaption(await ensureSnapshot()) } catch { toast("Couldn't prepare this caption") }
    }
    save.onclick = () => download(asset)
    close.onclick = () => { URL.revokeObjectURL(objectUrl); hideOverlay() }
  }).catch(() => { preview.innerHTML = '<span>COULDN\'T MAKE THIS SHARE · TRY AGAIN</span>' })
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
    async () => {
      // The share button can be opened from a City screen that has been sitting
      // still for a while. Resolve the same visible district against one fresh
      // state so its artwork and percentage cannot lag behind the server.
      const fresh = await freshGameState()
      const current = findDistrict(fresh, options.districtId || district.id)
      if (!current) throw new Error('district_not_found')
      const progress = districtProgress(fresh, current, options.progress)
      return districtShareAsset(fresh, current, progress)
    }, () => call('createShareSnapshot', { agentNo: getAgentNo(), kind: 'district', districtId: options.districtId || district.id }))
}

/** Fetch once on open, then freeze that response. The timer, progress and
 *  target describe one coherent instant even if the event changes while
 *  the PNG is rendering or the native share sheet is open. */
export function openRedZoneShare(state) {
  return shareSheet('SHARE RED ZONE', 'Call ARMY into the fight.', async () => {
    const snapshot = await freshGameState()
    if (!snapshot.bomb?.defuse) throw new Error('red_zone_resolved')
    const capturedAt = Date.now()
    return liveRedZoneShareAsset(structuredClone(snapshot.bomb.defuse), capturedAt)
  }, () => call('createShareSnapshot', { agentNo: getAgentNo(), kind: 'red_zone_active' }))
}

export function openSuccessfulRedZoneShare(resolved) {
  return shareSheet('SHARE THE WIN', 'The City is safe.',
    () => successfulRedZoneShareAsset(structuredClone(resolved)),
    () => call('createShareSnapshot', { agentNo: getAgentNo(), kind: 'red_zone_success', eventId: resolved.id }))
}
