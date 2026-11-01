import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const world = readFileSync(new URL('./screen-world.js', import.meta.url), 'utf8')
const map = readFileSync(new URL('./city-map.js', import.meta.url), 'utf8')
const shortcut = readFileSync(new URL('./maker-shortcut.js', import.meta.url), 'utf8')

test('the live City map gets the DJ Booth only for known playlist makers', () => {
  assert.match(world, /\.\.\.\(dj \? \{ onDjBooth: \(\) => openPlaylistMaker\(\) \} : \{\}\)/)
  // and a first-draw redraw once the check says yes
  assert.match(world, /isPlaylistMaker\(\)\.then\(\(yes\) => \{ if \(yes && getState\(\)\?\.joined\) setState/)
})

test('city-map draws the DJ Booth marker from opts.onDjBooth', () => {
  assert.match(map, /if \(opts\.onDjBooth\) svg\.appendChild\(toolMarker\(Math\.PI \/ 4, '🎧', 'DJ Booth', opts\.onDjBooth/)
})

test('maker status comes from the server and opens the maker page', () => {
  assert.match(shortcut, /call\('amIPlaylistMaker'/)
  assert.match(shortcut, /window\.location\.href = 'playlist-maker\.html'/)
})
