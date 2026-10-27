// The header's controls use the bottom nav's outline icon family, not emoji:
// emoji are drawn by each phone maker in its own glossy colours (a blue sync
// square, a gold bell) and never matched the line icons below them.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { HUD_ICON_PATHS, hudIcon } from './nav-icons.js'

const hud = readFileSync(new URL('./ui-hud.js', import.meta.url), 'utf8')
const markup = hud.slice(hud.indexOf('container.innerHTML = `'), hud.indexOf('<div class="hud-xp">'))

test('streak, sync, signals and the codename eye are outline icons', () => {
  for (const key of ['flame', 'sync', 'bell', 'eye', 'eyeOff']) assert.ok(HUD_ICON_PATHS[key], key)
  assert.match(hud, /const streakLabel = `\$\{hudIcon\('flame'\)\}/)
  assert.match(markup, /aria-label="Sync streams now">\$\{hudIcon\('sync'\)\}<\/button>/)
  assert.match(markup, /\$\{hudIcon\('bell'\)\}\$\{signalCount/)
  assert.match(markup, /hudIcon\(codenameHidden \? 'eyeOff' : 'eye'\)/)
  assert.doesNotMatch(markup + hud.match(/const streakLabel = [^\n]*/)[0], /🔥|🔄|🔔|🙈|👁|○ 0D/)
})

test('hudIcon draws in currentColor, hidden from assistive tech', () => {
  const svg = hudIcon('bell')
  assert.match(svg, /^<span class="hud-ico" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">/)
  assert.doesNotMatch(svg, /fill="#|stroke="#/)
  const css = readFileSync(new URL('../css/reconnect.css', import.meta.url), 'utf8')
  assert.match(css, /\.hud-ico svg \{[^}]*fill: none; stroke: currentColor;/)
})
