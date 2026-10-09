import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Moon Station moved from a sheet inside settings-streams.js to its own
// screen on 2026-10-09; the copy assertions follow it. settings-streams.js
// keeps only a one-line shim so the Settings row navigates instead of
// stacking a modal.
const ui = readFileSync('js/screen-moon.js', 'utf8')
const settingsStreams = readFileSync('js/settings-streams.js', 'utf8')
const selfCheck = readFileSync('supabase/functions/op-reconnect/lib/signal-log.ts', 'utf8')
const streams = readFileSync('supabase/functions/op-reconnect/lib/streams.ts', 'utf8')

test('partial provider history is explained and never gets a mode verdict', () => {
  assert.match(ui, /Sync catching up · \$\{esc\(sourceName\)\}/)
  assert.match(ui, /Some recent streams may be missing/)
  assert.match(ui, /Review resumes when the full history is ready/)
  assert.doesNotMatch(ui, /latest 50 streams before the next pull/)
  // An incomplete window is reported as "not checked yet", never as a pass:
  // a half-synced week looks like a quiet week.
  assert.match(ui, /modeReview = !res\.partialHistory && excessStreamDays\.length > 0/)
  assert.match(ui, /modeChecked = !res\.partialHistory && !!res\.mode/)
  assert.match(ui, /Not checked yet/)
})

test('the two checks are presented as separate, independent questions', () => {
  // The whole point of the layout. A player with clean spacing but a busy
  // week used to see one red sheet and assume the repeat check caused it.
  // Each check is its own section with its own verdict line, so neither can
  // be read as half of a combined score. There is deliberately NO intro
  // paragraph explaining that they are separate — the layout shows it, and
  // explaining it made a routine check sound like it needed defending.
  assert.doesNotMatch(ui, /runs two separate checks/)
  assert.doesNotMatch(ui, /One does not affect the other/)
  assert.match(ui, /Streaming pattern/)
  assert.match(ui, /Mode check/)
  assert.match(ui, /Spacing &amp; repeats/)
  assert.match(ui, /Daily volume vs selected mode/)
  assert.match(ui, /moon-check-title/)
  assert.match(ui, /moon-verdict/)
  // flaggedCount belongs to the pattern check alone. It must appear in the
  // pattern section and nowhere near the mode verdict.
  const patternAt = ui.indexOf("'Streaming pattern'")
  const modeAt = ui.indexOf("'Mode check'")
  assert.ok(patternAt > 0 && modeAt > patternAt, 'pattern section precedes mode section')
  assert.ok(ui.slice(patternAt, modeAt).includes('res.flaggedCount'),
    'flaggedCount lives in the Streaming Pattern section')
  assert.ok(!ui.slice(modeAt).includes('res.flaggedCount'),
    'flaggedCount must never reach the Mode Check section')
  // Shared listening identity is neither check, so it sits below both.
  assert.match(ui, /Account connection/)
  assert.match(ui, /This streaming account is also linked to another agent file/)
  assert.ok(ui.indexOf('Account connection') > modeAt, 'account section comes after both checks')
})

test('player copy uses familiar streaming language without an accusation', () => {
  assert.match(ui, /Stream review/)
  assert.match(ui, /⚠ Review mode/)
  assert.match(ui, /Current: \$\{esc\(modeLabel\)\}/)
  assert.match(ui, /Recent pace: \$\{esc\(suggestion\)\}/)
  // Names the rule instead of the person, so a player can tell what to
  // change. "played too close" read as a verdict, and "repeated-play
  // pattern" described a suspicion rather than the actual spacing rule.
  assert.match(ui, /Same song replayed within 8 min/)
  assert.match(ui, /Same song played twice in a row/)
  assert.doesNotMatch(ui, /played too close/)
  assert.doesNotMatch(ui, /Your own police check/)
  assert.doesNotMatch(ui, />\d* flagged</)
  // Nothing in the sheet may tell a player their account failed. Scoped to
  // moonStationSheet rather than the file: "Copy failed" lives in an
  // unrelated clipboard toast further down.
  const start = ui.indexOf('export function renderMoonStation')
  assert.ok(start > 0, 'renderMoonStation not found')
  const sheetSrc = ui.slice(start)
  assert.doesNotMatch(sheetSrc, /\bfailed\b/i)
  assert.doesNotMatch(sheetSrc, /\bcheating\b/i)
})

test('a duplicate the source reported twice is explained, not silently dropped', () => {
  // A collapsed row set must never read as lost history, and must not look
  // like a warning — the source double-reported, the player did nothing.
  assert.match(ui, /ingestionDuplicates/)
  assert.match(ui, /duplicate report\$\{dupes === 1 \? '' : 's'\} excluded/)
  assert.match(ui, /Totals unchanged/)
  // Quiet and informational, never the crimson warning shape.
  assert.match(ui, /moon-note/)
  assert.doesNotMatch(ui, /moon-alt[^]{0,80}duplicate report/)
  assert.match(selfCheck, /ingestionDuplicates: countIngestionDuplicates\(rows\)/)
})

test('every incomplete provider sequence suppresses repeat judgments', () => {
  assert.match(selfCheck, /partialHistory = !streamResult\.ok \|\| !streamResult\.complete/)
  assert.match(selfCheck, /trustSequence: !partialHistory/)
  assert.match(streams, /partialReason: 'provider_error'/)
  assert.match(streams, /partialReason: complete \? null : 'page_limit'/)
  assert.match(streams, /partialReason = provider\.ok \? 'recent_limit' : 'provider_error'/)
  assert.match(streams, /partialReason: 'database_limit'/)
})

// ── the admin panel's wiring ──────────────────────────────────────────────
//
// The renderer sat in public/js/botz.js, which the BOTZ revamp (99c58bf) left
// loaded by nothing: the script tag AND the markup were dropped while the
// .botz-moon-* styles stayed. The backend never broke, so the panel looked
// retired rather than broken. These tests exist so it cannot silently detach
// again.

const botzHtml = readFileSync('botz.html', 'utf8')
const moonJs = readFileSync('public/js/moon-station.js', 'utf8')
const botzApi = readFileSync('public/js/botz-api.js', 'utf8')
const botzPhase1 = readFileSync('public/js/botz-phase1.js', 'utf8')

test('botz.html carries every id the Moon Station renderer looks up', () => {
  const ids = [...moonJs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])
  assert.ok(ids.length >= 8, 'expected the renderer to look up several nodes')
  for (const id of new Set(ids)) {
    assert.match(botzHtml, new RegExp(`id="${id}"`), `botz.html is missing #${id}`)
  }
})

test('the page loads moon-station.js, and only after window.RCBotz exists', () => {
  const order = [...botzHtml.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1])
  assert.ok(order.includes('moon-station.js'), 'moon-station.js is not loaded at all')
  assert.ok(order.indexOf('botz-api.js') < order.indexOf('moon-station.js'),
    'botz-api.js publishes window.RCBotz and must load first')
})

test('the legacy botz.js is gone, and nothing still points at it', () => {
  // Restoring its script tag wholesale was the tempting fix and the wrong one.
  for (const [name, src] of [['botz.html', botzHtml], ['botz-api.js', botzApi], ['botz-phase1.js', botzPhase1]]) {
    assert.doesNotMatch(src, /["']js\/botz\.js["']/, `${name} still references the retired file`)
  }
  assert.doesNotMatch(botzHtml, /src="js\/botz\.js"/)
})

test('no two scripts on the page claim the same window export', () => {
  // The legacy file also owned shareBotzSnapshot and toggleBotzTheme, which
  // botz-phase1.js owns now. Loading both would have handed the live buttons
  // to whichever script ran last.
  const exportsOf = (src) => new Set([...src.matchAll(/^\s*window\.([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]))
  const sets = { 'botz-api.js': exportsOf(botzApi), 'botz-phase1.js': exportsOf(botzPhase1), 'moon-station.js': exportsOf(moonJs) }
  const seen = new Map()
  for (const [file, names] of Object.entries(sets)) {
    for (const n of names) {
      assert.ok(!seen.has(n), `${n} is exported by both ${seen.get(n)} and ${file}`)
      seen.set(n, file)
    }
  }
  for (const n of ['moonToggleOpen', 'moonUnlock', 'moonCheck', 'moonSetVerdict', 'moonScanAlts']) {
    assert.equal(seen.get(n), 'moon-station.js', `${n} must come from moon-station.js`)
  }
})

test('every inline handler on the page resolves to a loaded script', () => {
  // Bare calls only. The lookbehind drops member calls like location.reload(),
  // which resolve on the host object rather than on a script of ours.
  const used = new Set([...botzHtml.matchAll(/on(?:click|keydown|change|input)="([^"]*)"/g)]
    .flatMap((m) => [...m[1].matchAll(/(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)].map((x) => x[1]))
    .filter((n) => !['if', 'while', 'for', 'return', 'typeof'].includes(n)))
  const provided = new Set([...botzApi.matchAll(/^\s*window\.([A-Za-z0-9_]+)\s*=/gm),
    ...botzPhase1.matchAll(/^\s*window\.([A-Za-z0-9_]+)\s*=/gm),
    ...moonJs.matchAll(/^\s*window\.([A-Za-z0-9_]+)\s*=/gm)].map((m) => m[1]))
  for (const n of used) {
    assert.ok(provided.has(n), `botz.html calls ${n}() but no loaded script defines it`)
  }
})

test('the extracted module carries no legacy BOTZ logic', () => {
  const code = moonJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  for (const legacy of ['shareBotzSnapshot', 'toggleBotzTheme', 'fireBotzConfetti',
    'renderStreak', 'overlayStatsfm', 'overlayMusicat', 'checkBotzMilestone']) {
    assert.ok(!code.includes(legacy), `${legacy} should not have come across`)
  }
  // And it must not run the old page bootstrap.
  assert.doesNotMatch(code, /^\s*init\(\)\s*$/m)
})

test('the module is a classic script and no-ops without its panel', () => {
  // botz.html wires it with inline onclick=, which can only see window.
  assert.doesNotMatch(moonJs, /^\s*(import|export)\s/m, 'must not be an ES module')
  assert.match(moonJs, /if \(!document\.getElementById\('moonStation'\)\) return/)
})

test('the admin panel shows the duplicate note in neutral words', () => {
  assert.match(moonJs, /ingestionDuplicates/)
  assert.match(moonJs, /possible ingestion duplicate/)
  assert.match(moonJs, /repeated-play pattern/)
  assert.match(moonJs, /Still stored and still counted/)
  assert.doesNotMatch(moonJs, /🔁 repeat'/)
  assert.doesNotMatch(moonJs, /\} flagged</)
})

test('BOTZ explains a de-duplicated feed instead of just showing fewer rows', () => {
  // getSignalLog now hands BOTZ the canonical list, so a Stats.fm player sees
  // one row per play. Without the note, a feed that halved would read as lost
  // history rather than as a source reporting the same play twice.
  assert.match(botzApi, /ingestionDuplicates: Number\(res\.ingestionDuplicates \|\| 0\)/)
  assert.match(botzPhase1, /function renderRecent\(jams, ingestionDuplicates\)/)
  assert.match(botzPhase1, /renderRecent\(jams, lastBotzData\?\.ingestionDuplicates\)/)
  assert.match(botzPhase1, /duplicate \$\{dupes === 1 \? 'entry' : 'entries'\} set aside/)
  assert.match(botzPhase1, /Nothing was removed from your totals/)
  // Neutral: it describes the source, never the player.
  assert.doesNotMatch(botzPhase1, /looping|cheat|suspicious/i)
})

// ── the two tab bars must list the same destinations ──────────────────────
//
// botz.html is its own page, so it hand-writes a copy of ui-hud.js's TABS.
// That copy silently lost MOON: Moon Station was a SHEET, with no ?screen=
// target to link to, so there was nothing to put in the standalone bar. It
// is a screen now, and this test exists so the two lists cannot drift apart
// again without something failing.

const uiHud = readFileSync('js/ui-hud.js', 'utf8')
const botz = readFileSync('botz.html', 'utf8')

test('BOTZ offers every destination the in-app tab bar does', () => {
  const tabsBlock = uiHud.slice(uiHud.indexOf('const TABS = ['), uiHud.indexOf('/** The nav strip'))
  const appKeys = [...tabsBlock.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(appKeys,
    ['network', 'resources', 'candystar', 'botz', 'moonstation', 'ranking', 'settings'],
    'the in-app tab order changed — update botz.html to match')

  const barStart = botz.indexOf('<div class="botz-tabs">')
  const botzBar = botz.slice(barStart, botz.indexOf('</div>', barStart + 1))
  // Every router-backed tab must be reachable from the standalone page.
  const expectedHrefs = ['screen=world', 'screen=resources', 'screen=candystar', 'screen=moon',
    'screen=ranking', 'screen=settings']
  for (const href of expectedHrefs) {
    assert.ok(botzBar.includes(href), `botz.html tab bar is missing ${href}`)
  }
  // BOTZ itself is the current page, so it is a span rather than a link.
  assert.match(botzBar, /<span class="botz-tab sel"[^>]*title="BOTZ"/)
  // The tab elements themselves, not their .botz-tab-ico/.botz-tab-lbl children.
  assert.equal((botzBar.match(/class="botz-tab[" ]/g) || []).length, 7,
    'botz.html must show all seven destinations')
})

test('Moon Station is a routable screen, not a sheet', () => {
  // The property that lets botz.html link to it at all.
  const router = readFileSync('js/router.js', 'utf8')
  assert.match(router, /DEEP_LINKABLE = new Set\(\[[^\]]*'moon'/)
  assert.match(router, /export function goMoon/)
  assert.match(uiHud, /key: 'moonstation'[^}]*go: goMoon/)
  assert.match(uiHud, /here === 'moon'/)
  // And the City tab must not light up while Moon is the active screen.
  assert.match(uiHud, /here !== 'moon'/)
  // The Settings row navigates rather than stacking a modal.
  assert.match(settingsStreams, /export function openMoonStation\(\) \{ goMoon\(\) \}/)
  assert.doesNotMatch(settingsStreams, /moonStationSheet/)
})

test('an unsynced window can never render a green Streaming Pattern', () => {
  // flaggedCount is 0 while partialHistory is true because trustSequence is
  // off and the timing rules were never RUN. Reading that 0 as a pass is the
  // false green Mode Check already avoids; both checks must be able to say
  // they do not know yet. Asserted on source because the verdict is chosen
  // before any DOM exists.
  const start = ui.indexOf('const pattern = el(')
  // The section now ends where it is wrapped into the shared checks panel.
  const end = ui.indexOf("const panel = el('div', 'moon-panel')")
  assert.ok(start > 0 && end > start, 'pattern section not found')
  const block = ui.slice(start, end)
  // The partial branch comes first and owns the verdict in that state.
  const partialAt = block.indexOf('if (res.partialHistory)')
  const clearAt = block.indexOf("'✓ Clear'")
  assert.ok(partialAt > -1, 'partialHistory must be handled before any verdict')
  assert.ok(clearAt > partialAt, "'✓ Clear' must live in the else branch")
  assert.ok(block.includes("'· Not checked yet'"), 'pattern needs a not-checked verdict')
  assert.ok(block.includes("'Syncing recent streams'"))
  // And the else branch is the only place a pass or a count can be produced.
  const elseAt = block.indexOf('} else {')
  assert.ok(elseAt > -1 && elseAt < clearAt, 'the pass must be inside else')
  // Comments stripped: the branch explains itself by naming flaggedCount,
  // which is prose, not a read.
  const partialCode = block.slice(partialAt, elseAt).replace(/\/\/[^\n]*/g, '')
  assert.ok(!partialCode.includes('flaggedCount'),
    'flaggedCount must not be read in the partial-history branch')
})

test('the high-volume day list is labelled, and stays flat', () => {
  assert.match(ui, /Recent high-volume days/)
  assert.match(ui, /moon-days-title/)
  // Not wrapped in another card or bordered panel.
  const css = readFileSync('css/reconnect.css', 'utf8')
  const rule = css.slice(css.indexOf('.moon-days-title'), css.indexOf('.moon-days {'))
  assert.doesNotMatch(rule, /border:|background:/)
})

test('the tone stays procedural: neither customer support nor interrogation', () => {
  // A routine integrity review. Reassurance reads as apology and implies
  // there was something to apologise for; accusation language implies a
  // verdict this check cannot reach.
  const src = ui.slice(ui.indexOf('export function renderMoonStation'))
  const banned = [
    /don'?t worry/i, /nothing bad happened/i, /your streams are safe/i,
    /we'?re just checking/i, /your stream health/i, /suspicious activity/i,
    /\bviolation\b/i, /cheating detected/i, /\bfailed\b/i,
  ]
  for (const re of banned) {
    assert.doesNotMatch(src, re, `Moon Station copy must not use ${re}`)
  }
})

test('the two checks share a panel and the log sits in a lighter one', () => {
  // Containment is what the full-screen conversion lost: the old sheet bounded
  // everything in one card, and each row in a smaller one. Both are back
  // without the modal. The checks stay separate inside the shared panel -- an
  // inset divider, not two full-bleed rules -- so a mode warning still cannot
  // read as a consequence of a timing flag.
  assert.match(ui, /el\('div', 'moon-panel'\)/)
  assert.match(ui, /el\('div', 'moon-streams'\)/)
  assert.match(ui, /panel\.appendChild\(pattern\)/)
  assert.match(ui, /panel\.appendChild\(mode\)/)
  assert.match(ui, /streams\.appendChild\(seq\)/)

  const css = readFileSync('css/reconnect.css', 'utf8')
  const panel = css.slice(css.indexOf('.moon-panel {'), css.indexOf('.moon-check-title {'))
  assert.match(panel, /\.moon-panel \.moon-check \+ \.moon-check \{[^}]*border-top/,
    'the divider between the checks must be inset, not full-bleed')
  // The log reads lighter than the checks it explains.
  assert.match(css, /\.moon-streams \{[^}]*rgba\(255,255,255,0\.045\)/)
})

test('a stream row stacks title, artist and timestamp on the left', () => {
  // A right-aligned artist column fought every long title for the same
  // horizontal space; "Angel Pt. 2 (feat. Jimin of BTS, Charlie Puth and Muni
  // Long / FAST X Soundtrack)" broke across four lines with the artist
  // stacking beside it. Each wraps on its own now.
  const css = readFileSync('css/reconnect.css', 'utf8')
  assert.match(css, /\.moon-row-top \{ display: block; \}/)
  assert.match(css, /\.moon-artist \{ display: block;[^}]*letter-spacing: 0;/)
  assert.ok(!/\.moon-artist \{[^}]*text-align: right/.test(css))
  // Long values must wrap rather than widen the viewport.
  for (const sel of ['.moon-track', '.moon-artist']) {
    const rule = css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')))
    assert.match(rule, /overflow-wrap: anywhere/, `${sel} must wrap`)
  }
})
