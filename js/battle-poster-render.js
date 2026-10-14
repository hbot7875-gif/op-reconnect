// Browser side of the share poster: load the self-hosted poster fonts once,
// draw a style onto a 1080×1350 canvas, return a PNG Blob.
//
// Fonts ship with the site (@fontsource, OFL) so the poster looks the same
// in every browser, including in-app ones. If they can't load in time the
// poster still draws, in the system fallback fonts.
import montserrat900 from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2?url'
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url'
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url'
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?url'
import { drawPoster, W, H, FONT_DISPLAY, FONT_SANS } from './battle-poster.js'
import { LYRICS } from './battle-share-rules.js'

const FONT_TIMEOUT_MS = 4000
let fontsReady = null

function loadFonts() {
  if (fontsReady) return fontsReady
  const faces = [
    [FONT_DISPLAY, montserrat900, '900'],
    [FONT_SANS, inter600, '600'], [FONT_SANS, inter700, '700'], [FONT_SANS, inter800, '800'],
  ].map(([family, url, weight]) => new FontFace(family, `url(${url}) format("woff2")`, { weight }))
  const load = Promise.all(faces.map(async (f) => document.fonts.add(await f.load())))
  fontsReady = Promise.race([load, new Promise((r) => setTimeout(r, FONT_TIMEOUT_MS))]).catch(() => {})
  return fontsReady
}

/** The poster for one style, one battle view and the two team lines
 *  (defaults when a line is empty), as a PNG Blob. */
export async function renderPoster(style, view, lines = {}) {
  await loadFonts()
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  drawPoster(canvas.getContext('2d'), style, view, {
    hooligans: lines.hooligans || LYRICS.hooligans,
    aliens: lines.aliens || LYRICS.aliens,
  })
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster_failed'))), 'image/png'))
}
