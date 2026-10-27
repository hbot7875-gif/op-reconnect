import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CANDY_ICON_PATHS, csIcon } from './candy-icons.js'

// Candy Star polish: City and Pack's visual system carried into the builder.
// These pin the icon family, the component recipes, and -- most of all --
// that every hook the generator's logic reads is still in the markup.

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const candy = read('js/candy-star.js')
const host = read('js/screen-candystar.js')
const vault = read('js/playlist-vault-sheet.js')
const world = read('js/screen-world.js')
const resources = read('js/screen-resources.js')
const css = read('css/reconnect.css')
const start = css.indexOf('CANDY STAR POLISH')
// the Candy block ends where the next polish banner (or the Moon section) begins
const nextBanner = css.indexOf('/* ════', start + 20)
const moonAt = css.indexOf('/* ── Moon Station screen', start)
const block = css.slice(start, nextBanner > 0 && nextBanner < moonAt ? nextBanner : moonAt)

test('Candy icons: Lucide for utilities, Solar Line Duotone for Candy features, the alpaca for identity', () => {
  const SOLAR_KEYS = ['stars', 'map', 'music', 'disc', 'library']
  for (const [key, svg] of Object.entries(CANDY_ICON_PATHS)) {
    // every icon draws in currentColor; none carries a colour of its own
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}|style=|fill="(?!none)|stroke="(?!currentColor)/i, `${key} carries its own colour`)
    if (SOLAR_KEYS.includes(key)) assert.match(svg, /^<g fill="none" stroke="currentColor"/, `${key} should be a Solar body`)
    else assert.doesNotMatch(svg, /stroke="/, `${key} should be a plain Lucide/custom path`)
  }
  for (const key of SOLAR_KEYS) assert.match(read('js/candy-icons.js'), new RegExp(`  ${key}: '<g[^\\n]*// solar:[a-z0-9-]+-line-duotone`))
  assert.match(csIcon('alpaca'), /^<svg class="cs-i" viewBox="0 0 24 24"/)
  assert.match(block, /stroke: currentColor;\s+stroke-width: 1\.8/)
  // CC BY 4.0: Solar is credited
  assert.match(read('credits.html'), /Solar Icon Set<\/strong> by 480 Design[^<]*\(<a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/)
})

test('Quick: goal songs are wrapped pills, the alpaca has its orbit, the CTA keeps the name', () => {
  // one plain label per pill: no checkbox, no icon, no artist inside
  assert.match(candy, /onclick="candyQuickToggle\(this\)" title="\$\{sanitize\(\(s\.artists \|\| \[\]\)\.join\(', '\)\)\}">\$\{sanitize\(s\.name\)\}<\/button>`/)
  assert.doesNotMatch(candy, /cs-pick-box|cs-pick-artist/)
  assert.match(block, /\.cs-screen \.cs-quick-chips \{ display: flex; flex-wrap: wrap; gap: 9px 8px; justify-content: flex-start;/)
  // organic but composed: small vertical offsets only, never rotation; tap target kept
  const offsets = [...block.matchAll(/\.cs-goal-chip:nth-child\([^)]*\) \{ --cs-y: (-?\d+)px; \}/g)].map((m) => Math.abs(+m[1]))
  assert.ok(offsets.length >= 2 && offsets.every((y) => y <= 3), `offsets ${offsets}`)
  assert.doesNotMatch(block.slice(block.indexOf('a small playlist ritual')), /rotate\(/)
  assert.match(block, /\.cs-screen \.cs-goal-chip \{[^}]*min-height: 40px/)
  assert.match(block, /\.cs-screen \.cs-goal-chip \{[^}]*border-radius: 999px/)
  // picked = a soft lavender tint with a brighter edge, not a solid purple fill
  assert.match(block, /\.cs-screen \.cs-goal-pick\.is-picked \{[^}]*border-color: #b9a6ff; background: rgba\(167,139,250,\.16\)/)
  // the CTA keeps the strongest purple on the card
  assert.match(block, /\.cs-screen \.cs-quick-card #cs-quick-btn:not\(:disabled\) \{ background: var\(--v-violet\); \}/)
  assert.match(candy, /<svg class="cs-orbit" viewBox="0 0 80 80"/)
  assert.match(candy, /<b>One tap, one alpaca<\/b>/)
  assert.match(candy, /onclick="candyGenerate\('quick'\)">\$\{csIcon\('alpaca'\)\}Make me an alpaca<\/button>/)
  // the quick rules themselves did not move
  assert.match(candy, /function candyQuickCap\(\) \{ return window\._candyStar\?\.quickAlbum \? 2 : 3; \}/)
  assert.match(candy, /b\.disabled = !on && picked >= cap;/)
  assert.match(candy, /count\.textContent = `\$\{picked\} of \$\{cap\}`;/)
})

test('the title is the current type system, not the tracked mono eyebrow', () => {
  assert.match(host, /<h1 class="cs-title"><span class="cs-title-icon">\$\{csIcon\('candy'\)\}<\/span>Candy Star<\/h1>/)
  const code = host.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /Candy Star Generator|pack-eyebrow|🍬|🦙/)
})

test('Candy shows no ReConnect notice; City and Pack keep theirs', () => {
  const code = host.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /hudReconnectStatus|reconnect-row|ReConnect/)
  // hidden on this screen only, by a rule that needs the Candy screen mounted
  assert.match(block, /#hud:has\(~ #scene \.cs-screen\) #hudReconnectStatus \{ display: none; \}/)
  // one scoped rule per screen that drops it (Candy, Settings), never a global one
  const hides = [...css.matchAll(/([^{}\n]*)#hudReconnectStatus \{ display: none/g)].map((m) => m[1].trim())
  assert.deepEqual(hides, ['#hud:has(~ #scene .cs-screen)', '#hud:has(~ #scene .set-screen)', '#hud:has(~ #scene .vt-screen)'], 'one scoped rule per screen: Candy, Settings, the MAMA hub')
  assert.match(world, /classList\.add\('city-reconnect-notice'\)/)
  assert.match(resources, /button\.classList\.add\('pack-reconnect-notice'\)/)
})

test('the back action is a Lucide arrow in system sans, not the tracked-mono arrow glyph', () => {
  assert.match(host, /el\('button', 'back-btn cs-back', `\$\{csIcon\('arrowLeft'\)\}<span>Agent Pack<\/span>`\)/)
  assert.match(host, /back\.onclick = \(e\) => goResources\(\{ x: e\.clientX, y: e\.clientY \}\)/)
  assert.match(block, /\.cs-screen > \.screen-head \.cs-back::before \{ content: none; \}/)
  assert.match(block, /\.cs-back \{[^}]*font-family: var\(--body\)/)
})

test('status messages use the shared icons; the alpaca stays identity, not a status symbol', () => {
  const statuses = [...candy.matchAll(/candySetStatus\('(\w+)', ([\s\S]*?)\);\n/g)]
  assert.ok(statuses.length >= 7)
  for (const [, kind, html] of statuses) {
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u, `${kind} status still has an emoji`)
    if (kind === 'error') assert.match(html, /csIcon\('alert'\)/)
    if (kind === 'success') assert.match(html, /csIcon\('checkCircle'\)/)
  }
  assert.match(block, /\.cs-screen \.cs-status-open \{[^}]*color: #1db954/, 'the Spotify link in the status stays Spotify green')
})

test('every element the generator logic reads is still rendered', () => {
  for (const hook of ['id="cs-quick-btn"', 'id="cs-quick-count"', 'id="cs-quick-album"', 'id="cs-focus-rows"', 'class="cs-add-row"',
    'class="cs-album-check"', 'id="cs-album-selected-count"', 'class="cs-album-card"', 'id="cs-name"', 'id="cs-estimate-val"',
    'id="cs-preview-list"', 'id="cs-preview-list-mobile"', 'id="cs-mobile-details-body"', 'id="cs-my-playlists"',
    'data-tab="quick"', 'data-tab="custom"', 'id="cs-panel-quick"', 'id="cs-panel-custom"', 'class="cs-tabs"',
    'class="cs-focus-sel"', 'class="cs-focus-mult"', 'class="cs-song-dropdown"', 'id="cs-goal-guide-panel"', 'id="cs-goal-guide-title"']) {
    assert.ok(candy.includes(hook), `missing ${hook}`)
  }
  for (const stat of ['core', 'focus', 'album', 'filler', 'duration']) assert.ok(candy.includes(`id="cs-stat-${stat}"`), stat)
  // the guide's add control is still the same handler on the same data
  assert.match(candy, /<button type="button" class="cs-guide-use\$\{canUse \? '' : ' is-unavailable'\}" \$\{dataAttr\} onclick="\$\{handler\}"/)
})

test('limits and payload logic are untouched', () => {
  assert.match(candy, /const CS_MAX_FOCUS_ROWS = 2;\nconst CS_MAX_ALBUMS = 2;\nconst CS_HEAVY_FOCUS_PLAYS = 15;/)
  assert.match(candy, /const CANDY_QUICK_MULTS = \[10, 5, 4\];/)
  assert.match(candy, /function candyQuickCap\(\) \{ return window\._candyStar\?\.quickAlbum \? 2 : 3; \}/)
  assert.match(candy, /payload\.focus = cs\.quickPicks\.map\(\(key, i\) => \(\{ key, multiplier: CANDY_QUICK_MULTS\[i\] \|\| 4 \}\)\);/)
  assert.match(candy, /const res = await Api\.call\('generateAlpaca', payload/)
})

test('one segmented control and one secondary button, no arrows or emoji in the controls', () => {
  assert.match(candy, /onclick="candySwitchTab\('quick'\)">Quick<\/button>/)
  assert.match(candy, /id="cs-my-playlists">\$\{csIcon\('library'\)\}<span>My playlists<\/span><\/button>/)
  assert.match(block, /\.cs-screen \.cs-tab\.is-active \{ background: var\(--v-surface-3\); border-color: var\(--v-violet-line\)/)
  assert.match(block, /\.vault-sheet \.cs-vault-filter\.is-active \{ background: var\(--v-surface-3\); border-color: var\(--v-violet-line\)/)
})

test('albums are an accordion of compact selectable rows, with no hue gradient art', () => {
  assert.match(candy, /<details class="cs-form-section cs-albums">/)
  assert.doesNotMatch(candy, /--art-hue/)
  assert.match(candy, /checkbox\.closest\('details'\)\?\.setAttribute\('open', ''\);/)
})

test('the sticky action bar rides above the bottom nav with its estimate and Wing cost', () => {
  assert.match(block, /\.cs-screen \.cs-actionbar \{ bottom: calc\(100px \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(candy, /<span id="cs-estimate-val">0 tracks<\/span>\n\s*<span class="cs-actionbar-cost">\$\{csIcon\('feather'\)\}1 Wing<\/span>/)
})

test('My playlists actions wrap and compact at 320 instead of overflowing', () => {
  assert.match(block, /\.vault-sheet \.cs-vault-actions \{[^}]*flex-wrap: wrap/)
  assert.match(block, /\.vault-sheet \.cs-vault-card \.cs-vault-delete \{ position: absolute;/)
  const narrow = block.slice(block.indexOf('@media (max-width: 359px)'))
  assert.match(narrow, /\.vault-sheet \.cs-vault-action span \{ display: none; \}/)
})

test('Spotify green only on the Spotify action; crimson only for delete, invalid and an old-generator warning', () => {
  const greens = block.split('\n').filter((l) => /#1db954|#24c55f/i.test(l))
  assert.ok(greens.length && greens.every((l) => /\.cs-vault-open|\.cs-status-open/.test(l)), 'green outside Open in Spotify')
  // Generate stays the game's own purple primary
  assert.match(block, /\.cs-screen \.btn-red \{[^}]*background: var\(--v-violet\)/)
  const reds = block.split('\n').filter((l) => /--v-red|--v-tint-red/.test(l))
  assert.ok(reds.every((l) => /cs-vault-delete|cs-invalid|cs-row-remove|is-older|cs-status-error/.test(l)), reds.join('\n'))
  assert.doesNotMatch(block, /gradient\(/)
})

test('the playlist row keeps its actions and confirms before deleting', () => {
  assert.match(vault, /del\.onclick = \(\) => opts\.onDelete\(item, card\)/)
  assert.match(vault, /if \(!window\.confirm\(message\)\) return/)
  assert.match(vault, /openLink\.href = item\.url/)
  assert.match(vault, /save\.onclick = \(\) => opts\.onToggleSave\(item, card\)/)
})
