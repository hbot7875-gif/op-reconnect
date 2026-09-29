// The admin / tooling selectors.
//
// Four standalone pages, fifteen native controls, and every one of them
// wired to something an admin can break production with — a goal move, a
// Red Zone launch, a badge publish. These tests pin the part that is easy
// to get wrong silently: that the <select> is still the value, that the
// handlers still hang off it, and that nothing was quietly turned from a
// single choice into a multiple one or back.
//
// Interaction (opening, ticking, focus, rebuilds) was verified in a browser
// at 375/430/768/1280 against a harness that replicates all four pages'
// markup, CSS and handlers; see the session report. What is checked here is
// what a browser pass cannot catch on an auth-gated page: drift.
//
// Comments are stripped before every source assertion — each of these files
// explains in prose what the control used to be, and matching that prose
// would pass while the code said the opposite.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const code = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')

/** Every <select> in the shipped tooling pages, by page. */
const PAGES = ['admin.html', 'badge-admin.html', 'candy-star-admin.html', 'playlist-maker.html']

/** id -> the sheet title it was given. The Playlist Vault's #vs-share-district
 *  is deliberately absent: it is player-facing and documented separately. */
const CONVERTED_SINGLE = {
  'admin.html': ['goalDistrictFilter', 'goalReconnectVariant', 'rosterSort', 'reconnectDistrictFilter'],
  'badge-admin.html': ['tpl', 'pool', 'filterTemplate', 'filterRarity', 'filterMember', 'filterUploader', 'filterStatus', 'filterStyle'],
  'playlist-maker.html': ['district'],
}
const CONVERTED_MULTI = { 'admin.html': ['rzTargetGoal'], 'candy-star-admin.html': ['genIndividual'] }

/* ── 1. every tooling select is accounted for ──────────────────────────── */

test('the tooling pages hold exactly the fifteen selects that were audited', () => {
  const counts = Object.fromEntries(PAGES.map((p) => [p, (code(p).match(/<select/g) || []).length]))
  assert.deepEqual(counts, {
    'admin.html': 6,
    'badge-admin.html': 8,
    'candy-star-admin.html': 1,
    'playlist-maker.html': 1,
  })
  // A new one appearing forces the same convert-or-document decision rather
  // than quietly shipping another platform chooser.
  assert.equal(Object.values(counts).reduce((a, b) => a + b), 16)
})

test('every single-choice tooling select is enhanced', () => {
  for (const [page, ids] of Object.entries(CONVERTED_SINGLE)) {
    const src = code(page)
    for (const id of ids) {
      const direct = new RegExp(`enhanceSelect\\(\\$\\('${id}'\\)`)
      // the six badge filters are enhanced from a list, not one call each
      const inList = new RegExp(`\\['${id}',\\s*'[A-Z ]+'\\]`)
      assert.ok(direct.test(src) || inList.test(src), `${page}: ${id} is not enhanced`)
    }
  }
  // the per-row "move to district", which has no id
  assert.match(code('admin.html'), /enhanceSelect\(moveSel, \{ title: 'MOVE TO DISTRICT'/)
})

test('both multi-selects use the multi primitive, never the single one', () => {
  for (const [page, ids] of Object.entries(CONVERTED_MULTI)) {
    const src = code(page)
    for (const id of ids) {
      assert.match(src, new RegExp(`enhanceMultiSelect\\(\\$\\('${id}'\\)`), `${page}: ${id}`)
      assert.doesNotMatch(src, new RegExp(`enhanceSelect\\(\\$\\('${id}'\\)`), `${page}: ${id} was downgraded to single-choice`)
    }
  }
})

/* ── 2 + 11. the controls keep their own kind and their own options ────── */

test('the multi-selects are still multiple, the single ones still are not', () => {
  assert.match(code('admin.html'), /<select id="rzTargetGoal"[^>]*\bmultiple\b/)
  assert.match(code('candy-star-admin.html'), /<select id="genIndividual"[^>]*\bmultiple\b/)
  for (const [page, ids] of Object.entries(CONVERTED_SINGLE)) {
    const src = code(page)
    for (const id of ids) {
      const tag = src.match(new RegExp(`<select[^>]*id="${id}"[^>]*>`))
      assert.ok(tag, `${page}: ${id} markup missing`)
      assert.doesNotMatch(tag[0], /\bmultiple\b/, `${page}: ${id} became a multi-select`)
    }
  }
})

test('static option values and their order are untouched', () => {
  // The three lists that live in markup rather than being loaded.
  assert.match(code('admin.html'), /<option value="sotd">[\s\S]*?<option value="cipher">[\s\S]*?<option value="memory">[\s\S]*?<option value="connect">[\s\S]*?<option value="invite">/)
  assert.match(code('admin.html'), /<option value="attention">[\s\S]*?<option value="deadline">[\s\S]*?<option value="recent">[\s\S]*?<option value="newest">[\s\S]*?<option value="agent">/)
  assert.match(code('badge-admin.html'), /id="pool" required>\s*<option value="">[\s\S]*?<option value="cute">[\s\S]*?<option value="hot">/)
})

/* ── 3 + 8 + 9. the same handlers, on the same elements ────────────────── */

test('admin handlers still read the same <select> values', () => {
  const src = code('admin.html')
  assert.match(src, /\$\('goalDistrictFilter'\)\.addEventListener\('change'/)
  assert.match(src, /goalDistrictFilter = \$\('goalDistrictFilter'\)\.value/)
  assert.match(src, /\$\('goalReconnectVariant'\)\.addEventListener\('change', toggleReconnectFields\)/)
  assert.match(src, /\$\('rosterSort'\)\.addEventListener\('change', applyRosterFilter\)/)
  assert.match(src, /\$\('reconnectDistrictFilter'\)\.onchange = \(\) => paintReconnectList\(\)/)
  // the three adminAddGoal calls still take the district from that filter
  assert.equal((src.match(/districtId: goalDistrictFilter \|\| null/g) || []).length, 3)
})

test('the goal move still writes through the same admin action', () => {
  const src = code('admin.html')
  assert.match(src, /moveSel\.onchange = async \(\) => \{/)
  assert.match(src, /const districtId = moveSel\.value \|\| null/)
  assert.match(src, /call\('adminUpdateGoal', \{ id, districtId \}\)/)
  // the popup that holds it must still swallow its own clicks
  assert.match(src, /moveSel\.onclick = \(e\) => e\.stopPropagation\(\)/)
})

test('Red Zone still reads its targets from selectedOptions', () => {
  const src = code('admin.html')
  assert.match(src, /\[\.\.\.\$\('rzTargetGoal'\)\.selectedOptions\]\.map\(\(o\) => o\.value\)\.filter\(Boolean\)/)
  assert.match(src, /\$\('rzTargetGoal'\)\.addEventListener\('change', paintRZTargetEcho\)/)
  // the write-back that makes "Any BTS song" exclusive is untouched
  assert.match(src, /anyOpt\.selected = picked\.length === 0/)
})

test('badge publishing and filtering still read the same fields', () => {
  const src = code('badge-admin.html')
  assert.match(src, /const pool = \$\('pool'\)\.value/)
  assert.match(src, /\$\('pool'\)\.onchange = updateReviewEnabled/)
  assert.match(src, /\$\(id\)\.onchange = \(\) => \{ filters\[key\] = \$\(id\)\.value; paintFilterState\(\); paintGrid\(\) \}/)
  assert.match(src, /templates\.filter\(\(template\) => template\.active !== false\)/)
})

test('playlist-maker still submits the same district value', () => {
  const src = code('playlist-maker.html')
  assert.match(src, /const districtId = \$\('district'\)\.value/)
  assert.match(src, /if \(!districtId\)/, 'the empty-district guard is gone')
})

test('candy-star still rebuilds individualSelected from selectedOptions', () => {
  const src = code('candy-star-admin.html')
  assert.match(src, /individualSelected = new Set\(\[\.\.\.\$\('genIndividual'\)\.selectedOptions\]\.map\(o => o\.value\)\)/)
  assert.match(src, /\[\.\.\.new Set\(\[\.\.\.albumKeys, \.\.\.individualSelected\]\)\]/)
  // the filter still rewrites the option list and re-marks it from the Set
  assert.match(src, /individualSelected\.has\(key\) \? 'selected' : ''/)
})

/* ── 4 + 5. programmatic writes and rebuilds reach the visible control ─── */

test('rc-select follows a programmatic .value and a rebuilt option list', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /Object\.defineProperty\(select, 'value'/)
  assert.match(src, /new MutationObserver\(refresh\)\.observe\(select, \{ childList: true, subtree: true \}\)/)
})

test('rc-multiselect follows a rebuilt option list and re-reads after dispatch', () => {
  const src = code('js/rc-multiselect.js')
  assert.match(src, /new MutationObserver\(paint\)\.observe\(select, \{ childList: true, subtree: true \}\)/)
  // the handler gets the last word on what is selected
  assert.ok(
    src.indexOf("select.dispatchEvent(new Event('change'") < src.lastIndexOf('paint()'),
    'the panel must re-read the DOM after the change event',
  )
})

test('the pages that repaint their own option lists still do it themselves', () => {
  assert.match(code('admin.html'), /function renderDistrictFilterOptions\(\) \{/)
  assert.match(code('badge-admin.html'), /function paintFilterOptions\(\) \{/)
  assert.match(code('badge-admin.html'), /\$\('filterTemplate'\)\.value = filters\.templateId/)
  assert.match(code('candy-star-admin.html'), /function renderIndividualOptions\(filter = ''\) \{/)
})

/* ── 6. disabled options ───────────────────────────────────────────────── */

test('a disabled option stays unselectable in both primitives', () => {
  assert.match(code('js/rc-select.js'), /row\.disabled = option\.disabled/)
  const multi = code('js/rc-multiselect.js')
  assert.match(multi, /box\.disabled = option\.disabled/)
  assert.match(multi, /if \(!option \|\| option\.disabled\) return/)
})

/* ── 7. the badge dependency ───────────────────────────────────────────── */

test('picking a badge template still fills the photo style for you', () => {
  const src = code('badge-admin.html')
  assert.match(src, /\$\('tpl'\)\.onchange = paintTemplateGuidance/)
  assert.match(src, /if \(template && !\$\('pool'\)\.value\) \$\('pool'\)\.value = preferred/)
  // that write is a bare .value assignment with no event, which is exactly
  // what rc-select's value accessor exists to notice.
  assert.match(code('js/rc-select.js'), /set\(next\) \{ descriptor\.set\.call\(this, next\); onChange\(\) \}/)
})

/* ── 12 + 13. no player-facing regression, no native chooser left ──────── */

test('the player-facing selectors are untouched by the admin pass', () => {
  const candy = code('js/candy-star.js')
  assert.match(candy, /enhanceSelect\(\$\('cs-guide-district'\), \{/)
  assert.match(candy, /enhanceSelect\(\$\('cs-guide-mode'\), \{/)
  assert.doesNotMatch(candy, /variant:/, 'the game pickers must keep the player-facing density')
  // and the Vault exception still stands
  assert.doesNotMatch(code('js/playlist-vault-sheet.js'), /rc-select/)
  assert.match(read('js/playlist-vault-sheet.js'), /showOverlay is single-slot/)
})

test('every converted control hides its native chooser the same way', () => {
  assert.match(code('css/reconnect.css'), /select\.rc-select-native \{[^}]*clip-path: inset\(50%\)/)
  assert.match(code('css/reconnect.css'), /select\.rc-multi-native \{[^}]*clip-path: inset\(50%\)/)
  const multi = code('js/rc-multiselect.js')
  assert.match(multi, /classList\.add\('rc-multi-native'\)/)
  assert.match(multi, /setAttribute\('aria-hidden', 'true'\)/)
  assert.match(multi, /select\.tabIndex = -1/)
})

test('page CSS cannot out-rank the rule that hides the native control', () => {
  // Each page styles its own controls through a descendant selector and its
  // <style> block comes after reconnect.css, so an un-excluded rule puts the
  // real <select> back on screen at full width. Measured once already: it
  // pushed a 375px phone 51px wider than itself.
  assert.match(code('admin.html'), /\.adm-field \.ob-input:not\(\.rc-select-native\):not\(\.rc-multi-native\)/)
  assert.match(code('admin.html'), /\.adm-roster-toolbar \.ob-input:not\(\.rc-select-native\)/)
  assert.match(code('badge-admin.html'), /\.bv-filter-grid select:not\(\.rc-select-native\)/)
  // and the mobile grid must place the trigger, not the control it replaced
  assert.match(code('admin.html'), /\.adm-roster-toolbar \.rc-select-trigger \{ grid-column: 1 \/ -1/)
  assert.match(code('admin.html'), /\.rh-toolbar \.rc-select-trigger \{ grid-column: 1 \/ -1/)
})

test('admin keeps its own density without a second component', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /variant = ''/)
  assert.match(src, /rc-select-sheet\$\{variant \? ` rc-select-sheet--\$\{variant\}` : ''\}/)
  assert.match(code('css/reconnect.css'), /\.rc-select-sheet--admin \.rc-select-row \{[^}]*min-height: 40px/)
  // touch targets do not shrink on a phone just because it is an admin screen
  assert.match(code('css/reconnect.css'), /\.rc-select-sheet--admin \.rc-select-row \{ min-height: 46px/)
})

test('the multi-select keeps focus on the row it just toggled', () => {
  // paint() replaces every row, which takes the focused checkbox with it —
  // without this, Space ticked one box and then scrolled the page.
  assert.match(code('js/rc-multiselect.js'), /again\.focus\(\{ preventScroll: true \}\)/)
})
