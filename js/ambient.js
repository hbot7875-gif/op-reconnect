// A small toggle for optional looping ambience or a YouTube soundtrack.
//
// Off by default on purpose, not just because browsers block autoplaying
// audio with sound anyway — unexpected sound on a form screen is bad
// manners even where the browser would allow it. One <audio loop> per call,
// so the auth screen and the onboarding lore screen each own an independent
// instance rather than sharing state across a screen transition; turning it
// on during sign-in and having it silently drop on the next screen is a
// rough edge, but a shared singleton is more machinery than a 1.5s ambient
// loop is worth right now.

import { el } from './state.js'

export function ambientToggle(src) {
  const youtubeId = String(src).match(/(?:youtu\.be\/|[?&]v=|embed\/)([\w-]{11})/)?.[1]
  if (youtubeId) return youtubeToggle(youtubeId)

  const audio = new Audio(src)
  audio.loop = true
  audio.volume = 0.35

  const btn = el('button', 'ambient-toggle', '🔈')
  btn.setAttribute('aria-label', 'Toggle ambient sound')
  btn.setAttribute('type', 'button')
  btn.onclick = () => {
    if (audio.paused) { audio.play(); btn.textContent = '🔊'; btn.classList.add('is-on') }
    else { audio.pause(); btn.textContent = '🔈'; btn.classList.remove('is-on') }
  }
  // Fails silent, not broken: a missing/unplayable file removes its own
  // control rather than sitting there as a dead button.
  audio.onerror = () => btn.remove()
  btn.stopPlayback = () => audio.pause()
  return btn
}

/** YouTube cannot be used as an <audio> source. Keep its embed visually out
 *  of the composition and expose one honest play/pause control. Playback is
 *  always user-triggered so browser autoplay policy is respected. */
function youtubeToggle(videoId) {
  const wrap = el('div', 'ambient-soundtrack')
  const frame = document.createElement('iframe')
  frame.className = 'ambient-youtube-frame'
  frame.title = 'Operation ReConnect mission soundtrack'
  frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&playsinline=1&controls=0&rel=0&loop=1&playlist=${encodeURIComponent(videoId)}`
  frame.allow = 'autoplay; encrypted-media'
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.tabIndex = -1
  frame.setAttribute('aria-hidden', 'true')

  const btn = el('button', 'ambient-toggle', '🔈')
  btn.type = 'button'
  btn.disabled = true
  btn.title = 'Loading mission soundtrack'
  btn.setAttribute('aria-label', 'Play mission soundtrack')

  let playing = false
  const command = (func, args = []) => frame.contentWindow?.postMessage(JSON.stringify({
    event: 'command', func, args,
  }), 'https://www.youtube-nocookie.com')

  frame.onload = () => {
    btn.disabled = false
    btn.title = 'Play mission soundtrack'
  }
  btn.onclick = () => {
    playing = !playing
    if (playing) {
      command('setVolume', [35])
      command('playVideo')
      btn.textContent = '🔊'
      btn.title = 'Pause mission soundtrack'
      btn.setAttribute('aria-label', 'Pause mission soundtrack')
      btn.classList.add('is-on')
    } else {
      command('pauseVideo')
      btn.textContent = '🔈'
      btn.title = 'Play mission soundtrack'
      btn.setAttribute('aria-label', 'Play mission soundtrack')
      btn.classList.remove('is-on')
    }
  }

  wrap.stopPlayback = () => {
    if (!playing) return
    playing = false
    command('pauseVideo')
    btn.textContent = '🔈'
    btn.classList.remove('is-on')
  }
  wrap.append(frame, btn)
  return wrap
}
