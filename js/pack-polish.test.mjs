import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PACK_ICON_PATHS, packIcon } from './pack-icons.js'

// Agent Pack polish: City's visual system carried into the Pack. These pin the
// icon family, the one row/slot recipe, and that nothing about what a tap does
// or what a count says changed.

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const pack = read('js/screen-resources.js')
const keepsake = read('js/arirang-recelebrate.js')
const css = read('css/reconnect.css')
const blockStart = css.indexOf('AGENT PACK POLISH')
const block = css.slice(blockStart, css.indexOf('\n}\n', css.indexOf('Narrow phones', blockStart)))
const markup = pack.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('Pack icons are one outline family drawn in currentColor', () => {
  for (const [key, svg] of Object.entries(PACK_ICON_PATHS)) {
    assert.doesNotMatch(svg, /fill="|stroke="|style=|#[0-9a-f]{3,6}/i, `${key} carries its own colour`)
  }
  assert.match(packIcon('tickets'), /^<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">/)
  assert.match(block, /stroke: currentColor; stroke-width: 1\.8/)
})

test('the Pack page renders no emoji of its own', () => {
  // The page itself; the detail sheets behind a tap are not part of this pass.
  const page = markup.slice(markup.indexOf('function agentIdCard'), markup.indexOf('function avatarAdjustSheet'))
    + markup.slice(markup.indexOf('function compartments'))
  assert.doesNotMatch(page.replace("'✎'", ''), /\p{Extended_Pictographic}/u)
  const card = keepsake.slice(keepsake.indexOf('export function recelebrateKeepsake'), keepsake.indexOf('function getSessionHandle'))
  assert.doesNotMatch(card, /♡|›|TEAMS\[pass\.team\]\.icon/)
})

test('the page title is not repeated on the bag', () => {
  assert.match(pack, /<h1 class="pack-title">/)
  assert.doesNotMatch(markup, /'AGENT PACK'|>AGENT PACK</)
})

test('one recipe: every slot and pocket row uses the same icon tile', () => {
  assert.match(pack, /<span class="slot-icon">\$\{packIcon\(def\.key\)\}<\/span>/)
  for (const key of ['backupPass', 'helpAgent', 'tickets']) assert.match(pack, new RegExp(`<span class="ps-icon">\\$\\{packIcon\\('${key}'\\)\\}</span>`))
  assert.doesNotMatch(pack, /slot-buckle|SLOT_ACCENTS/)
  assert.match(block, /\.res-screen \.pocket-items \{ grid-template-columns: 1fr;/)
})

test('purple for progress, gold for ready, no crimson in the Pack', () => {
  assert.match(block, /\.res-screen \.slot-fill-bar \{ background: var\(--v-violet\)/)
  assert.match(block, /\.res-screen \.ps-qty\.is-ready \{ color: var\(--v-gold\)/)
  assert.doesNotMatch(block, /--v-red|--v-tint-red|crimson|#c8343f/)
  assert.doesNotMatch(block, /gradient\(/)
})

test('counts, gates and actions are unchanged', () => {
  assert.match(pack, /if \(backup\) backupSlot\.onclick = \(\) => openBackupPassFlow\(backup\)\n\s*else backupSlot\.disabled = true/)
  assert.match(pack, /helpSlot\.onclick = \(\) => openBackupHelpFlow\(\)/)
  assert.match(pack, /ticketSlot\.onclick = \(\) => showOverlay\(itemSheet\(unusedTickets\[0\] \|\| tickets\[0\]\)\)/)
  assert.match(pack, /\$\{unusedTickets\.length \? `\$\{unusedTickets\.length\} ready` : tickets\.length \? 'All used' : 'None yet'\}/)
  assert.match(pack, /const value = p\[def\.key\] \|\| 0/)
  assert.match(pack, /if \(items\.length >= 15\)/)
  assert.match(pack, /button\.onclick = \(\) => showOverlay\(itemSheet\(item\)\)/)
  assert.match(keepsake, /card\.onclick = \(\) => showOverlay\(passSheet\(readCache\(\), false\)\)/)
})

test('the identity card keeps its dossier header and the mono agent ID', () => {
  assert.match(pack, /el\('div', 'aid-head', '<span class="aid-file">Agent dossier<\/span>'\)/)
  assert.match(pack, /head\.appendChild\(el\('div', 'aid-active', '<i><\/i>Active'\)\)/)
  assert.match(block, /\.res-screen \.aid-id-no em \{ font-family: var\(--mono\)/)
  assert.match(block, /\.res-screen \.aid-head \{[^}]*border-bottom: 1px dashed/)
})

test('Recovered Objects: two columns at 320, three from 360 up', () => {
  assert.match(block, /\.res-screen \.collection-shelf \{ grid-template-columns: repeat\(3, minmax\(0,1fr\)\)/)
  const narrow = block.slice(block.indexOf('@media (max-width: 359px)'))
  assert.match(narrow, /\.res-screen \.collection-shelf \{ grid-template-columns: repeat\(2, minmax\(0,1fr\)\); \}/)
})

test('the event keepsake stays special without glow or gradient', () => {
  const rules = block.split('\n').filter((l) => l.includes('.arc-keepsake')).join('\n')
  assert.match(rules, /#f39cc8/, 'keeps its event colour')
  assert.doesNotMatch(rules, /gradient\(|box-shadow|text-shadow|filter:/)
})

test('resource detail sheets are left for a later pass', () => {
  for (const icon of ['⚡', '🪽', '🧊', '⏳']) assert.ok(pack.includes(`icon: '${icon}'`), `${icon} detail-sheet icon should be untouched`)
  assert.match(pack, /<div style="font-size:38px; text-align:center; margin:10px 0;">\$\{def\.icon\}<\/div>/)
})
