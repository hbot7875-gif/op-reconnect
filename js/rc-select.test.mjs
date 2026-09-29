// The ReConnect selector sheet.
//
// Two halves, tested two ways. The decisions live in rc-select-model.js and
// are exercised directly. The wiring — that the real <select> is still the
// value holder, still carries its original onchange, and is no longer the
// thing anyone taps — is pinned against the source of the three files that
// were changed, because this repo has no DOM in `node --test` and the
// alternative is a test that proves nothing. Open/close/focus behaviour was
// verified in a browser at 360/375/430/768/1280; see the session report.
//
// Comment-stripping before every source assertion is deliberate: each of
// these files explains in prose what the OLD code did, and an assertion that
// matched that prose would pass while the code said the opposite.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import {
  SEARCH_THRESHOLD,
  displayName,
  filterOptions,
  groupOptions,
  nextIndex,
  optionTags,
  sectionLabel,
  selectedOption,
  shouldSearch,
} from './rc-select-model.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
/** Executable text only — no // lines, no /* *\/ blocks, no <!-- --> */
const code = (f) => read(f)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n')

/* ── The district list ─────────────────────────────────────────────────── */

// Shaped exactly as candy-star's districtGuides reach the markup.
const DISTRICTS = [
  { id: 'carabonara', name: 'Carabonara Diner', current: true },
  { id: 'relay-zero', name: 'Relay Zero' },
  { id: 'hopesize', name: 'Hopesize Station' },
  { id: 'dazzledew', name: 'Dazzledew Fountain' },
  { id: 'seven-crossing', name: 'Map of Seven Crossing' },
]

test('a district list with no sections renders as one flat group', () => {
  const groups = groupOptions(DISTRICTS)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, null, 'a single flat list must not grow a heading')
  assert.deepEqual(groups[0].items.map((d) => d.id), DISTRICTS.map((d) => d.id))
})

test('the district the agent is actually in is tagged, not renamed', () => {
  // The old menu printed "Carabonara Diner · current" as the option text.
  const current = DISTRICTS[0]
  assert.equal(displayName(current), 'Carabonara Diner')
  assert.deepEqual(optionTags(current), ['CURRENT'])
  assert.deepEqual(optionTags(DISTRICTS[1]), [])
})

test('the open sheet starts on the district already chosen', () => {
  assert.equal(selectedOption(DISTRICTS, 'hopesize').name, 'Hopesize Station')
  assert.equal(selectedOption(DISTRICTS, 'not-a-district'), null)
})

test('a five-district list gets no search field', () => {
  assert.equal(shouldSearch('auto', DISTRICTS.length), false)
  assert.equal(shouldSearch(false, 999), false, 'an explicit no always wins')
})

/* ── The badge list ────────────────────────────────────────────────────── */

// rc_badge_catalog rows as badge-admin's <optgroup>s present them: section
// lowercase, " (rare)" appended to the name because an <option> had nowhere
// else to put it.
const BADGES = [
  { id: 'event_vma_voter', name: 'VMA Voter', section: 'event', rarity: 'common' },
  { id: 'event_vma_power_hour', name: 'Power Hour (rare)', section: 'event', rarity: 'rare' },
  { id: 'district_frag_1', name: '25% Restored', section: 'district', rarity: 'common' },
  { id: 'district_restored', name: 'District Restored (rare)', section: 'district', rarity: 'rare' },
  { id: 'mission_bond', name: 'ReConnect Complete', section: 'achievement', rarity: 'common' },
  { id: 'backup_helper', name: 'Backup (rare)', section: 'achievement', rarity: 'rare' },
  { id: 'ward', name: 'Ward Restored', section: 'ward', rarity: 'rare' },
]

test('sections group in catalog order, not arrival order', () => {
  // ACHIEVEMENT, DISTRICT, EVENT is the order the sheet is specified to
  // show; the rows above arrive event-first on purpose.
  assert.deepEqual(groupOptions(BADGES).map((g) => g.label), ['ACHIEVEMENT', 'DISTRICT', 'WARD', 'EVENT'])
})

test('section headings are uppercase for display only', () => {
  assert.equal(sectionLabel('achievement'), 'ACHIEVEMENT')
  // The stored value is untouched — grouping still keys off the raw section.
  assert.equal(groupOptions(BADGES)[0].key, 'achievement')
})

test('rows keep their catalog order inside a section', () => {
  const district = groupOptions(BADGES).find((g) => g.label === 'DISTRICT')
  assert.deepEqual(district.items.map((b) => b.id), ['district_frag_1', 'district_restored'])
})

test('rarity becomes a tag and stops being part of the name', () => {
  assert.equal(displayName(BADGES[5]), 'Backup')
  assert.deepEqual(optionTags(BADGES[5]), ['RARE'])
  assert.equal(displayName(BADGES[0]), 'VMA Voter')
  assert.deepEqual(optionTags(BADGES[0]), [])
})

test('a name is only trimmed when the structured rarity says so', () => {
  // No data attribute, no stripping — the label is left exactly as stored.
  assert.equal(displayName({ name: 'Backup (rare)', rarity: '' }), 'Backup (rare)')
  assert.equal(displayName({ name: '(rare)', rarity: 'rare' }), '(rare)', 'never strip a name down to nothing')
})

test('search filters on what is printed and keeps the groups', () => {
  const hit = filterOptions(BADGES, 'restored')
  assert.deepEqual(hit.map((b) => b.id), ['district_frag_1', 'district_restored', 'ward'])
  assert.deepEqual(groupOptions(hit).map((g) => g.label), ['DISTRICT', 'WARD'])
})

test('search is case-insensitive, matches the trimmed name, and never the id', () => {
  assert.deepEqual(filterOptions(BADGES, 'BACKUP').map((b) => b.id), ['backup_helper'])
  // "Backup (rare)" displays as "Backup", so the stripped word still hits.
  assert.deepEqual(filterOptions(BADGES, 'backup ').map((b) => b.id), ['backup_helper'])
  assert.deepEqual(filterOptions(BADGES, 'event_vma'), [], 'ids are not printed, so they must not match')
  assert.equal(filterOptions(BADGES, '   ').length, BADGES.length)
})

test('the search field appears only once a list is long enough to need it', () => {
  assert.equal(shouldSearch('auto', SEARCH_THRESHOLD - 1), false)
  assert.equal(shouldSearch('auto', SEARCH_THRESHOLD), true)
  assert.equal(shouldSearch(true, 0), true)
})

/* ── Keyboard movement ─────────────────────────────────────────────────── */

test('arrow keys wrap, and an empty list has nothing to focus', () => {
  assert.equal(nextIndex(0, 1, 5), 1)
  assert.equal(nextIndex(4, 1, 5), 0)
  assert.equal(nextIndex(0, -1, 5), 4)
  // Focus is outside the list (a search field): step in at the near end.
  assert.equal(nextIndex(-1, 1, 5), 0)
  assert.equal(nextIndex(-1, -1, 5), 4)
  assert.equal(nextIndex(0, 1, 0), -1)
})

/* ── The <select> is still the value, and no longer the interaction ────── */

test('the component hides the native control from sight, tab order and AT', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /classList\.add\('rc-select-native'\)/)
  assert.match(src, /setAttribute\('aria-hidden', 'true'\)/)
  assert.match(src, /select\.tabIndex = -1/)
  // `select.` is load-bearing, not style: every call site already styles its
  // own control through a descendant selector (`.cs-goal-guide-controls
  // select { width: 100% }`), which outranks a lone class. Written flat, the
  // control stayed full width and pushed the page 51px past a 375px phone.
  assert.match(code('css/reconnect.css'), /select\.rc-select-native \{[^}]*clip-path: inset\(50%\)/)
})

test('choosing a row writes the value back and fires the same change event', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /select\.value = id/)
  assert.match(src, /dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/)
  // Close first, THEN notify: hideOverlay restores focus to the trigger, and
  // a handler that re-renders its own section would otherwise leave focus on
  // a node that is no longer in the document. Both halves of that ordering
  // live in the row's own click handler, which is the only place either
  // runs — a plain "which appears first in the file" check would compare
  // two unrelated functions and pass on whichever way they were written.
  assert.match(src, /row\.onclick = \(\) => \{ hideOverlay\(\); onChoose\?\.\(option\.id\) \}/)
})

test('the sheet is the existing overlay, not a second modal framework', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /import \{[^}]*showOverlay[^}]*hideOverlay[^}]*\} from '\.\/state\.js'/)
  assert.doesNotMatch(src, /position:\s*fixed|createElement\('dialog'\)|showModal/)
  // Escape, the focus trap, the backdrop dismiss and the focus restore all
  // come from state.js; re-implementing any of them here would mean two.
  assert.doesNotMatch(src, /'Escape'/)
  // The class list is built with the optional admin variant appended, but it
  // still opens with the shared `sheet` class — that is what carries the
  // backdrop, the dismiss and the sizing.
  assert.match(src, /el\('div', `sheet rc-select-sheet\$\{variant \? ` rc-select-sheet--\$\{variant\}` : ''\}`\)/)
})

test('rows are options in a listbox, with a real selected state', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /setAttribute\('role', 'listbox'\)/)
  assert.match(src, /setAttribute\('role', 'option'\)/)
  assert.match(src, /setAttribute\('aria-selected', chosen \? 'true' : 'false'\)/)
  // Focus lands on the current choice, not the top of the list.
  assert.match(src, /if \(chosen\) row\.dataset\.autofocus = 'true'/)
})

test('a disabled option stays disabled rather than becoming selectable', () => {
  const src = code('js/rc-select.js')
  assert.match(src, /row\.disabled = option\.disabled/)
  assert.match(src, /setAttribute\('aria-disabled', 'true'\)/)
})

test('rows clear the 44px touch target', () => {
  assert.match(code('css/reconnect.css'), /\.rc-select-row \{[^}]*min-height: 54px/)
  assert.match(code('css/reconnect.css'), /\.rc-select-trigger \{[^}]*min-height: 44px/)
})

/* ── Nothing underneath either list changed ────────────────────────────── */

test('the district picker still calls the district handler it always did', () => {
  const src = code('js/candy-star.js')
  assert.match(src, /onchange="candySelectGuideDistrict\(this\.value\)"/)
  assert.match(src, /onchange="candySelectGuideMode\(this\.value\)"/)
  // The handler itself is untouched: set the id, repaint the guide.
  assert.match(src, /candySelectGuideDistrict\(id\) \{[\s\S]{0,200}guideDistrictId = id;[\s\S]{0,60}candyRenderGoalGuide\(\)/)
})

test('the district picker no longer glues "· current" onto a name', () => {
  const src = code('js/candy-star.js')
  assert.doesNotMatch(src, /· current/)
  assert.match(src, /d\.isCurrent \? ' data-current="true"' : ''/)
  // isCurrent itself is untouched — it still drives the guide's own banner.
  assert.match(src, /district\.isCurrent \? '<span class="cs-guide-current">/)
})

test('neither field is a <label> any more', () => {
  // A <label> forwards its click to its control, which would reopen the
  // platform dropdown behind the sheet.
  const guide = code('js/candy-star.js').match(/<div class="cs-goal-guide-controls">[\s\S]*?<\/div>\s*<div id="cs-goal-guide-content">/)
  assert.ok(guide, 'the guide controls block moved')
  assert.doesNotMatch(guide[0], /<label/)
  assert.match(code('badge-admin.html'), /<div class="bv-field">\s*<span>Badge<\/span>\s*<select class="input-field" id="tpl">/)
})

test('the badge picker still feeds every existing consumer of $("tpl")', () => {
  const src = code('badge-admin.html')
  assert.match(src, /\$\('tpl'\)\.onchange = paintTemplateGuidance/)
  assert.match(src, /selectedTemplate = \(\) => templates\.find\(\(template\) => template\.id === \$\('tpl'\)\.value\)/)
  assert.match(src, /\$\('tpl'\)\.value = ''/, 'the post-publish reset is still there')
  assert.match(src, /enhanceSelect\(\$\('tpl'\), \{ title: 'BADGE'/)
})

test('which badges the picker offers is decided exactly where it was', () => {
  const src = code('badge-admin.html')
  // Still only active templates, still grouped by the catalog's own section,
  // still ordered by the query's .order('section').order('sort_order').
  assert.match(src, /templates\.filter\(\(template\) => template\.active !== false\)/)
  assert.match(src, /\(bySection\[t\.section\] \|\|= \[\]\)\.push\(t\)/)
  assert.match(code('supabase/functions/op-reconnect/lib/badge-admin.ts'), /\.order\('section'\)\.order\('sort_order'\)/)
})

test('the selector knows nothing about badges, districts or unlock rules', () => {
  // The component is a list of {id, name, section, rarity}. If a badge id,
  // a district id or an unlock check ever appears in it, the UI has started
  // making decisions that belong to the catalog and the backend.
  for (const file of ['js/rc-select.js', 'js/rc-select-model.js']) {
    const src = code(file)
    assert.doesNotMatch(src, /badge_|district_|event_vma|unlock|locked|equip|award/i, `${file} reaches past presentation`)
    // api.js's call('action', …) and raw fetch — not Function.prototype.call,
    // which rc-select.js uses to delegate to the <select>'s own accessor.
    assert.doesNotMatch(src, /\bfetch\(|[^.]\bcall\(['"]/, `${file} talks to the backend`)
  }
})

/* ── Every player-facing dropdown is accounted for ─────────────────────── */

test('the game bundle holds no <select> beyond the ones audited', () => {
  // Comments are stripped first, so the several files that only DISCUSS
  // <select> (rc-select.js, screen-district.js) do not register here.
  // A new one appearing in the game makes this fail, which is the point:
  // it forces the same convert-or-document decision rather than quietly
  // shipping another platform chooser to players.
  const owners = readdirSync(new URL('./', import.meta.url))
    .filter((f) => f.endsWith('.js') && /<select/.test(code(`js/${f}`)))
    .sort()
  assert.deepEqual(owners, ['candy-star.js', 'playlist-vault-sheet.js'])
})

test('both Candy Star pickers are converted', () => {
  const src = code('js/candy-star.js')
  assert.match(src, /enhanceSelect\(\$\('cs-guide-district'\), \{/)
  assert.match(src, /enhanceSelect\(\$\('cs-guide-mode'\), \{/)
  assert.match(src, /candyEnhanceGuideSelects\(\);/, 'the enhancement has to run on every render')
})

test('the Vault district select is the documented exception, not an oversight', () => {
  const src = code('js/playlist-vault-sheet.js')
  assert.doesNotMatch(src, /rc-select/, 'the Vault must not enhance a select inside its own sheet')
  // The reason has to travel with the code; a bare omission reads as a miss.
  assert.match(read('js/playlist-vault-sheet.js'), /showOverlay is single-slot/)
})

test('showOverlay is still single-slot — the reason the Vault select stays native', () => {
  // If this ever stacks, the Vault exception above can be revisited. Until
  // then, mounting a picker from inside a sheet throws the sheet away.
  const overlay = code('js/state.js')
  assert.match(overlay, /export function showOverlay\(contentNode\) \{[\s\S]{0,260}overlay\.innerHTML = ''/)
  assert.match(code('js/playlist-vault-sheet.js'), /showOverlay\(sheet\)/)
})
