// A small toggle for optional looping ambience.
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
  return btn
}
