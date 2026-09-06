import { shareTextWithoutUrl } from './share-card-copy.js'

export function nativeSharePayload(asset, FileCtor = File) {
  const file = new FileCtor([asset.blob], asset.filename, { type: 'image/png' })
  return {
    file,
    payload: {
      title: asset.title,
      text: shareTextWithoutUrl(asset.caption),
      url: asset.url,
      files: [file],
    },
  }
}

/** Native file sharing is the only native path that preserves the complete
 * zero-effort share. If the browser cannot send files, use the explicit PNG
 * download + caption-copy fallback instead of silently sharing text alone. */
export async function shareAssetNativeFirst(asset, platform, fallback) {
  const { file, payload } = nativeSharePayload(asset, platform.FileCtor)
  let supportsFiles = false
  if (typeof platform.share === 'function' && typeof platform.canShare === 'function') {
    try { supportsFiles = platform.canShare({ files: [file] }) }
    catch { /* fall through to the explicit fallback */ }
  }
  if (supportsFiles) {
    try {
      await platform.share(payload)
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
    }
  }
  await fallback()
  return 'fallback'
}
