import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const world = readFileSync(new URL('./screen-world.js', import.meta.url), 'utf8')
const shortcut = readFileSync(new URL('./maker-shortcut.js', import.meta.url), 'utf8')

test('the City map head carries the maker button next to Share and Find', () => {
  assert.match(world, /import \{ playlistMakerButton \} from '\.\/maker-shortcut\.js'/)
  assert.match(world, /tools\.append\(playlistMakerButton\(el\), share, find\)/)
})

test('the button is hidden until the server says this agent is a maker', () => {
  assert.match(shortcut, /btn\.hidden = true/)
  assert.match(shortcut, /call\('amIPlaylistMaker'/)
  assert.match(shortcut, /btn\.href = 'playlist-maker\.html'/)
})
