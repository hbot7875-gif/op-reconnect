export function nativeSharePayload(asset, FileCtor = File) {
  const file = new FileCtor([asset.blob], asset.filename, { type: 'image/png' })
  return {
    file,
    payload: {
      title: asset.title,
      // Keep the URL in the visible text too. Several Android share targets
      // silently discard Web Share's separate `url` member when `files` is
      // present; duplicating it here makes the destination robust while the
      // dedicated field still enables rich link previews where supported.
      text: asset.caption,
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
