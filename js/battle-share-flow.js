// MAMA Battle share — the browser actions behind the share sheet.
//
// Every path ends somewhere useful: a platform that can't take an image
// shares the link; one that can't share at all copies it. Nothing here
// changes battle data, and the only link ever shared is the public page.
import { BATTLE_URL } from './battle-share-rules.js'

const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|Twitter|TikTok|musical_ly|Snapchat|; wv\)/i

export function isInAppBrowser(ua = navigator.userAgent || '') {
  return IN_APP.test(ua)
}

export function posterFile(blob) {
  return new File([blob], 'mama-battle.png', { type: 'image/png' })
}

/** Can this browser share an image file through the system sheet? */
export function canShareFiles(file) {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

const cancelled = (e) => e?.name === 'AbortError'

/**
 * Poster + text (which already ends with the public link). Some apps drop
 * the text when an image comes along, so it also goes to the clipboard.
 * → 'shared' | 'cancelled' | 'failed'
 */
export async function sharePoster(file, text) {
  await copyText(text)
  try {
    await navigator.share({ files: [file], title: 'MAMA Battle', text })
    return 'shared'
  } catch (e) {
    return cancelled(e) ? 'cancelled' : 'failed'
  }
}

/** Link-only share — the public page, or one side's recruit page; with no
 *  system share at all, copy the link instead.
 *  → 'shared' | 'cancelled' | 'copied' | 'failed' */
export async function shareLink(text, url = BATTLE_URL) {
  const body = text.replace(`\n${url}`, '')
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'MAMA Battle', text: body, url })
      return 'shared'
    } catch (e) {
      if (cancelled(e)) return 'cancelled'
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed'
}

export async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s)
    return true
  } catch {
    // Older and in-app browsers: the textarea route.
    try {
      const t = document.createElement('textarea')
      t.value = s
      t.setAttribute('readonly', '')
      t.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
      document.body.appendChild(t)
      t.select()
      const ok = document.execCommand('copy')
      t.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** Download the poster where that works; in-app browsers ignore downloads,
 *  so there the sheet shows the image to press-and-hold instead.
 *  → 'downloaded' | 'hold' */
export function savePoster(blobUrl) {
  if (isInAppBrowser()) return 'hold'
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = 'mama-battle.png'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return 'downloaded'
}
