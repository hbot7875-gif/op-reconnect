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
  assert.match(ui, /Sync catching up · \$\{name\}/)
  assert.match(ui, /Some recent streams may be missing/)
  assert.match(ui, /Review resumes when the full window is ready/)
  assert.doesNotMatch(ui, /latest 50 streams before the next pull/)
  // An incomplete window is reported as "not checked yet", never as a pass:
  // a half-synced week looks like a quiet week.
  assert.match(ui, /modeReview = !res\.partialHistory && excessStreamDays\.length > 0/)
  // An empty window is now its own case, so the mode check also refuses to
  // pass on zero streams -- see "zero streams is neither a pass nor a sync
  // problem" below.
  assert.match(ui, /modeChecked = !res\.partialHistory && !nothingToCheck && !!res\.mode/)
  // The review card shows an em dash, not a zero, when nothing was checked:
  // a zero there would read as "nothing found".
  assert.match(ui, /const patternChecked = !res\.partialHistory && !nothingToCheck/)
  assert.match(ui, /patternChecked \? String\(res\.flaggedCount\) : '—'/)
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
  // They are two metric cards rather than two stacked sections, but they
  // are still two separate answers with two separate verdicts.
  assert.match(ui, /Patterns to review/)
  assert.match(ui, /Streams checked/)
  assert.match(ui, /Spacing &amp; repeats/)
  assert.match(ui, /moon-metric-mode/)
  assert.match(ui, /moon-check-title/)
  // flaggedCount belongs to the pattern check alone. It must appear in the
  // pattern section and nowhere near the mode verdict.
  const patternAt = ui.indexOf('Patterns to review')
  const modeAt = ui.indexOf('Streams checked')
  assert.ok(patternAt > 0 && modeAt > patternAt, 'the review card precedes the volume card')
  // flaggedCount is computed for the review card and must not be read
  // anywhere near the mode verdict.
  const patternValue = ui.slice(ui.indexOf('const patternValue'), ui.indexOf('const patternSub'))
  assert.ok(patternValue.includes('res.flaggedCount'), 'the review card carries flaggedCount')
  const modeLine = ui.slice(ui.indexOf('const modeLine'), ui.indexOf('metrics.appendChild', ui.indexOf('const modeLine')))
  assert.ok(!modeLine.includes('flaggedCount'), 'the mode verdict must never read flaggedCount')
  assert.ok(!ui.slice(modeAt).includes('res.flaggedCount'),
    'flaggedCount must never reach the Mode Check section')
  // Shared listening identity is neither check, so it sits below both.
  assert.match(ui, /Account connection/)
  assert.match(ui, /This streaming account is also linked to another agent file/)
  assert.ok(ui.indexOf('Account connection') > modeAt, 'account section comes after both checks')
})

test('player copy uses familiar streaming language without an accusation', () => {
  assert.match(ui, /Stream review/)
  // The verdict names the mode the player actually chose rather than the
  // bare word "mode", so it reads as a specific finding and never as a
  // generic warning. The value is always interpolated, never hardcoded.
  assert.match(ui, /⚠ Review \$\{esc\(modeLabel\)\}/)
  // The mode verdict lives on its own line inside the second card.
  assert.match(ui, /\$\{esc\(modeLabel\)\} fits/)
  assert.match(ui, /Recent pace: \$\{esc\(MODE_NAMES\[res\.suggestedMode\]/)
  // Names the rule instead of the person, so a player can tell what to
  // change. "played too close" read as a verdict, and "repeated-play
  // pattern" described a suspicion rather than the actual spacing rule.
  assert.match(ui, /Replayed too soon/)
  assert.match(ui, /Played twice in a row/)
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
  assert.match(ui, /stream totals are unchanged/)
  // Not attributed to Stats.fm any more: two different causes produce this
  // count now -- one play served at two precisions, and one play reported by
  // two scrobblers -- and naming only the first is wrong for exactly the
  // agents who see the second.
  assert.doesNotMatch(ui, /Stats\.fm reported the same play/)
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
  // The guard is now one expression rather than a branch, which is easier
  // to hold: flaggedCount is unreachable unless the window was complete.
  const value = ui.slice(ui.indexOf('const patternChecked'), ui.indexOf('const patternSub'))
  assert.match(value, /const patternChecked = !res\.partialHistory && !nothingToCheck/)
  assert.match(value, /patternChecked \? String\(res\.flaggedCount\) : '—'/,
    'the count must be unreachable on an incomplete or empty window')
  // The card's APPEARANCE is gated on the same predicate, so an unchecked
  // window can never borrow the settled card's gold and read as a pass.
  assert.match(value, /!patternChecked \? '' : res\.flaggedCount \? ' is-review' : ' is-settled'/)
  const sub2 = ui.slice(ui.indexOf('const patternSub'), ui.indexOf("metrics.appendChild"))
  assert.ok(sub2.indexOf('res.partialHistory') < sub2.indexOf('Spacing'),
    'partialHistory must be tested before the rule name is claimed')
  assert.match(ui, /'Not checked yet'/, 'the review card needs a not-checked state')
  // And the mode verdict has the same guard.
  assert.match(ui, /modeChecked = !res\.partialHistory/)
})

test('the high-volume day list is labelled, and stays flat', () => {
  assert.match(ui, /Recent high-volume days/)
  // Now labelled by the note it sits in rather than a separate heading
  // element, but still labelled and still a flat list.
  assert.match(ui, /Recent high-volume days/)
  assert.match(ui, /moon-days/)
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
    // "violation" is banned as an ACCUSATION but required as a DENIAL: the
    // transparency test below asserts the copy states a flag is not one. The
    // lookbehind is what tells the two uses apart.
    /(?<!not a )\bviolation\b/i, /cheating detected/i, /\bfailed\b/i,
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
  assert.match(ui, /panel\.appendChild\(metrics\)/)
  assert.match(ui, /metrics\.appendChild/)
  assert.match(ui, /streams\.appendChild\(seq\)/)

  const css = readFileSync('css/reconnect.css', 'utf8')
  // The two cards are divided by their own borders now rather than by an
  // inset rule, which is the same separation by other means.
  assert.match(css, /\.moon-metrics \{[^}]*grid-template-columns: 1fr 1fr/)
  assert.match(css, /\.moon-metric \{[^}]*border: 1px solid var\(--v-line-1\)/)
  // Shared surface system (phase 5A): the log is its own lifted card on the
  // same step as the checks panel. The checks still lead, because their
  // metric cards sit one step higher (Surface 2) and carry the state tints.
  assert.match(css, /\.moon-streams \{[^}]*background: var\(--v-surface-1\)/)
  assert.match(css, /\.moon-metric \{[^}]*background: var\(--v-surface-2\)/)
})

test('a stream row stacks title, artist and timestamp on the left', () => {
  // A right-aligned artist column fought every long title for the same
  // horizontal space; "Angel Pt. 2 (feat. Jimin of BTS, Charlie Puth and Muni
  // Long / FAST X Soundtrack)" broke across four lines with the artist
  // stacking beside it. Each wraps on its own now.
  const css = readFileSync('css/reconnect.css', 'utf8')
  // Artist and timestamp share one secondary line now, which is what made
  // the row 24px shorter; both still wrap on their own.
  assert.match(css, /\.moon-row-meta \{ display: block;[^}]*letter-spacing: 0;/)
  assert.ok(!/\.moon-row-meta \{[^}]*text-align: right/.test(css))
  // Long values must wrap rather than widen the viewport.
  for (const sel of ['.moon-track', '.moon-row-meta']) {
    const rule = css.slice(css.indexOf(sel + ' {'), css.indexOf('}', css.indexOf(sel + ' {')))
    assert.match(rule, /overflow-wrap: anywhere/, `${sel} must wrap`)
  }
})

// ── freshness: three facts, never one inferred from another ──
//
// The bug: an agent who had not listened all week was shown a sync warning,
// because "no recent streams" was being read as "sync is broken". Those are
// different facts with different remedies.

test('a quiet week is reported as a quiet week, not as a broken connection', () => {
  assert.match(ui, /No streams in this window/)
  assert.match(ui, /is connected and syncing normally/)
  assert.match(ui, /Nothing was played in the last \$\{res\.windowDays\} days/)
  // The verdict may only come from the collector's own checkpoint. If the
  // renderer ever derived it from the rows it would be guessing again.
  const note = ui.slice(ui.indexOf('function freshnessNote'), ui.indexOf('function freshnessFooter'))
  assert.doesNotMatch(note, /trackCount|flaggedCount|tracks\b/,
    'the connection verdict must never be computed from how much was played')
})

test('only a failing or stale collector is reported as a problem', () => {
  assert.match(ui, /res\.connection === 'failing' \|\| res\.connection === 'stale'/)
  assert.match(ui, /is not syncing/)
  assert.match(ui, /tone: 'is-review'/)
  // A never-synced or quiet account is informational, not crimson.
  const note = ui.slice(ui.indexOf('function freshnessNote'), ui.indexOf('function freshnessFooter'))
  assert.equal((note.match(/tone: 'is-review'/g) || []).length, 1,
    'exactly one freshness state may be shown as a problem')
})

test('a pushed source says what it cannot know instead of guessing', () => {
  // A scrobbler that stops pushing leaves no record of having stopped.
  assert.match(ui, /res\.connection === 'unobservable'/)
  assert.match(ui, /check that your scrobbler is still connected/)
  assert.match(streams, /'ok' \| 'failing' \| 'stale' \| 'never_synced' \| 'source_changed' \| 'unobservable'/)
})

test('the two timestamps are labelled for what each one measures', () => {
  // One line reading "last sync" could not tell a player whether it meant
  // when a play arrived or when the poll ran.
  assert.match(ui, /Latest stream received/)
  assert.match(ui, /last synced/)
  assert.match(selfCheck, /newestStreamAt: newestStreamAt/)
  assert.match(selfCheck, /sinceLastSuccessSeconds/)
  assert.match(selfCheck, /pollGateSeconds/)
  // A pushed source has no poll to report, so it gets no sync timestamp.
  assert.match(ui, /res\.connection !== 'unobservable' && res\.sinceLastSuccessSeconds !== null/)
})

test('freshness is judged by the same gates the capture scheduler uses', () => {
  // Two definitions of "recent" would drift, and the player would be told
  // the sync was fine by one of them and stale by the other.
  assert.match(streams, /const pollGateMs = CAPTURE_FRESHNESS_MS\[input\.source\]/)
  assert.match(streams, /const freshness = CAPTURE_FRESHNESS_MS\[source\]/)
  assert.equal((streams.match(/CAPTURE_FRESHNESS_MS: Record<string, number> = \{/g) || []).length, 1,
    'there may be exactly one freshness table')
})

// ── the marks, and what gold is allowed to mean ───────────────────────────

test('each row carries one of exactly three marks', () => {
  assert.match(ui, /is-clear/)
  assert.match(ui, /is-review/)
  assert.match(ui, /is-unchecked/)
  // Gold is reachable only when the window was complete AND the row was
  // clean. An unchecked row must never be gold: no rule ran on it, so a
  // tick there would be a pass nobody computed.
  const mark = ui.slice(ui.indexOf('const mark = !wasChecked'), ui.indexOf('// The repeat rule measures'))
  const unchecked = mark.indexOf('is-unchecked')
  const clear = mark.indexOf('is-clear')
  assert.ok(unchecked > -1 && clear > unchecked,
    'the unchecked case must be tested before a clean row can earn a tick')
})

test('the gold tick is defined narrowly and never claims legitimacy', () => {
  assert.match(ui, /no timing pattern found/)
  assert.match(ui, /label: 'No timing pattern found'/)
  // Nothing may present a tick as proof the streaming was genuine. Checked
  // against the COPY, with comments stripped: the reasoning above a line of
  // code may use "a clean row" as shorthand, but nothing a player reads may
  // describe a tick as a verification.
  const copy = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  for (const re of [/verified/i, /legitimate/i, /\bvalid\b/i, /\bapproved\b/i, /\bpassed\b/i, /\bclean\b/i]) {
    assert.doesNotMatch(copy, re, `a mark must not be described with ${re}`)
  }
  // And the mark is announced to a screen reader as the same narrow claim.
  assert.match(ui, /aria-label="\$\{esc\(mark\.label\)\}"/)
})

test('the legend explains the marks before the list that uses them', () => {
  const legendAt = ui.indexOf("'moon-legend'")
  const listAt = ui.indexOf("el('div', 'moon-list')")
  assert.ok(legendAt > 0 && listAt > legendAt, 'the legend must precede the list')
  const css = readFileSync('css/reconnect.css', 'utf8')
  // Gold ✓ / crimson ⚠ / neutral · — the same three meanings, on the shared tokens.
  assert.match(css, /\.moon-mark\.is-clear \{ color: var\(--v-gold\); \}/)
  assert.match(css, /\.moon-mark\.is-review \{ color: var\(--v-red-hi\); \}/)
  assert.match(css, /\.moon-mark\.is-unchecked \{ color: var\(--v-ink-3\); \}/)
})

// ── transparency ──────────────────────────────────────────────────────────

test('a flag is stated to be a second look, not a verdict or a penalty', () => {
  assert.match(ui, /Flags indicate patterns worth reviewing, not violations/)
  assert.match(ui, /No automatic deductions/)
})

test('the list says how much was reviewed, so 25 rows do not look like all of it', () => {
  // The checks run on the whole window; the log shows the newest 25 of it.
  // Counts now run over every reviewed stream, and the scope line says how
  // many of them are on screen. A visible subset is still never called the
  // total.
  assert.match(ui, /Newest \$\{SHOWN\} of \$\{rows\.length\} \$\{noun\}/)
  assert.match(ui, /const SHOWN = 25/)
  assert.match(ui, /rows\.slice\(0, SHOWN\)/)
})

test('the eight-minute rule is still named as the rule it is', () => {
  // Named as the rule plus the threshold it used, on two lines instead of
  // one sentence. back_to_back deliberately has no threshold entry.
  assert.match(ui, /Replayed too soon/)
  assert.match(ui, /Played twice in a row/)
  assert.match(ui, /Review threshold: 8 minutes/)
  assert.match(ui, /SELF_CHECK_FLAG_THRESHOLD = \{\s*\n\s*repeat:/,
    'only the repeat rule may carry a threshold')
})

// ── what an empty window may not claim ──
//
// Found by rendering the ten scenarios rather than by reading the code: an
// idle account with zero streams was being shown "✓ Clear" and "✓ Medium
// fits". Both are passes, and neither check had anything to run on.

test('zero streams is neither a pass nor a sync problem', () => {
  assert.match(ui, /const nothingToCheck = !res\.trackCount/)
  // Both cards must be able to say there was nothing to run on: the review
  // card shows an em dash rather than a zero, and the mode line refuses to
  // say the mode fits.
  assert.match(ui, /nothingToCheck\s*\n?\s*\? `No streams in \$\{res\.windowDays\} days`/)
  assert.match(ui, /!nothingToCheck && !!res\.mode/)
  // And mode may not pass on it either.
  assert.match(ui, /modeChecked = !res\.partialHistory && !nothingToCheck && !!res\.mode/)
})

test('a verdict reached while the collector is down says what it covers', () => {
  // "✓ Clear" under "Stats.fm is not syncing" reads as a full pass on a
  // window that is missing however long the collector has been down.
  assert.match(ui, /Covers the streams that have arrived so far/)
  assert.match(ui, /Anything played since the last sync is not included/)
})

test("the log does not say \"reviewed\" when no review ran", () => {
  // On an incomplete window every timing rule is suppressed, so the scope
  // line claimed 25 streams were reviewed directly beneath two checks that
  // both read "not checked yet".
  assert.match(ui, /const verb = res\.partialHistory \? 'received' : 'reviewed'/)
  assert.match(ui, /\$\{noun\} · oldest first/)
  assert.match(ui, /const noun = active === 'all' \? `\$\{verb\}`/)
})

// ── the two freshness messages that were wrong ──
//
// Both found by rendering the real states against live data rather than by
// reading the code, and both were assertions the evidence did not support.

test('a message about an empty history is never shown over a full one', () => {
  // 7 of 84 live agents had no usable checkpoint AND streams in the window
  // (median 2,014 rows). They were being shown "Nothing has come through
  // yet" directly above twenty-five of their own plays.
  const note = ui.slice(ui.indexOf('function freshnessNote'), ui.indexOf('function freshnessFooter'))
  const empty = [...note.matchAll(/Nothing has come through yet/g)]
  assert.equal(empty.length, 1, 'the empty-history line may exist in exactly one branch')
  // ...and that branch must be guarded on there being no streams.
  assert.match(note, /hasStreams\s*\n?\s*\?[^:]*already arrived/,
    'the has-streams branch must come first and must not claim an empty history')
  assert.match(note, /const hasStreams = !!res\.newestStreamAt/)
})

test('a provider switch says where the existing history came from', () => {
  assert.match(ui, /res\.connection === 'source_changed'/)
  assert.match(ui, /has not reported in yet/)
  assert.match(ui, /arrived before you switched/)
  assert.match(ui, /sourceName\(res\.previousSource\)/)
  // And it must still read correctly for someone who switched with an
  // empty window.
  assert.match(ui, /has not sent anything yet/)
})

test("a failing collector with no sync on record drops the dangling \"since then\"", () => {
  const note = ui.slice(ui.indexOf('function freshnessNote'), ui.indexOf('function freshnessFooter'))
  assert.doesNotMatch(note, /no record of a successful sync[^`']*since then/,
    '"since then" needs a "then"')
  assert.match(note, /No successful sync has been recorded/)
  // The branch that DOES have a timestamp may still use it.
  assert.match(note, /Last successful sync \$\{formatAgo\(lastSync\)\}\. Anything played since then/)
})

test('a row the rules could not identify gets the neutral mark, not a tick', () => {
  // Empty flags mean two different things -- "the rules ran and found
  // nothing" and "the rules could not run" -- and only the first earns a
  // tick. 3 rows in 172,344 measured, but it is a false pass by shape.
  // Both conditions now live in one predicate, used by the mark and by the
  // Clear filter so the two can never disagree about what "checked" means.
  assert.match(ui, /const wasChecked = \(res, t\) => !res\.partialHistory && t\.identified !== false/)
  assert.match(ui, /const mark = !wasChecked\(res, t\)/)
  assert.match(ui, /!isFlagged\(t\) && wasChecked\(res, t\)/)
  // The legend must explain the neutral mark whenever one is on screen.
  assert.match(ui, /const anyUnchecked = shown\.some\(\(t\) => !wasChecked\(res, t\)\)/)
  assert.match(ui, /no artist, so not checked/)
})

test('the backend reports whether each row could be identified at all', () => {
  const police = readFileSync('supabase/functions/op-reconnect/lib/police-check.ts', 'utf8')
  assert.match(police, /identified: boolean/)
  // Derived from songKey, so it can never disagree with the rule itself
  // about what counts as identifiable.
  assert.match(police, /identified: songKey\(r\) !== null/)
})

// ── the filters, and what their counts are counting ──
//
// getMySelfCheck already returns the WHOLE window, so the counts beside the
// segments are true totals rather than a description of the 25 rows on
// screen. That distinction is the whole reason this is safe to add: a
// "Flagged 2" that silently meant "2 of the 25 visible" would be the same
// class of overclaim the scope line exists to prevent.

test('filter counts are over every reviewed stream, not the visible slice', () => {
  assert.match(ui, /const flaggedAll = all\.filter\(isFlagged\)/)
  assert.match(ui, /const clearAll = all\.filter\(\(t\) => !isFlagged\(t\) && wasChecked\(res, t\)\)/)
  assert.match(ui, /\{ id: 'all', label: 'All', rows: all \}/)
  // The cap is applied to the FILTERED rows, after the counts are taken.
  const paint = ui.slice(ui.indexOf('function paint()'), ui.indexOf('paint()\n'))
  assert.ok(paint.indexOf('f.rows.length') < paint.indexOf('rows.slice(0, SHOWN)'),
    'counts must be read before the display cap is applied')
})

test('filtering never reorders and never re-runs the review', () => {
  // The rows are the same objects the backend returned, filtered and
  // reversed for display exactly as the unfiltered list already was.
  const paint = ui.slice(ui.indexOf('function paint()'), ui.indexOf('paint()\n'))
  assert.match(paint, /rows\.slice\(0, SHOWN\)\.slice\(\)\.reverse\(\)/)
  assert.doesNotMatch(paint, /\.sort\(/, 'the log must keep the order it was given')
  assert.doesNotMatch(paint, /flags\.push|REPEAT_MIN_GAP|sinceSameSong <|call\(/,
    'a filter may not compute or re-fetch a verdict')
})

test('an incomplete window gets no filters rather than three empty ones', () => {
  // Filtering by outcome is meaningless when no rule ran.
  assert.match(ui, /const filterable = !res\.partialHistory/)
  assert.match(ui, /if \(filterable\) seq\.appendChild\(bar\)/)
})

test('every filter has an empty state that names the window', () => {
  assert.match(ui, /moon-empty/)
  assert.match(ui, /No flagged streams in the last \$\{res\.windowDays\} days/)
  assert.match(ui, /No clear streams in the last \$\{res\.windowDays\} days/)
})

test('the segmented control is reachable and announces its state', () => {
  assert.match(ui, /role="tab"/)
  assert.match(ui, /aria-selected="\$\{f\.id === active\}"/)
  assert.match(ui, /setAttribute\('role', 'tablist'\)/)
  const css = readFileSync('css/reconnect.css', 'utf8')
  // Shares the .chip selection vocabulary so it reads as the same control
  // family as the rest of the app.
  assert.match(css, /\.moon-filter\.sel \{[^}]*var\(--v-tint-violet\)[^}]*var\(--v-violet-line\)/)
  // Tap targets stay usable at 320px, where the three segments are
  // narrowest.
  assert.match(css, /@media \(max-width: 359px\)[^}]*\}[\s\S]*?\.moon-filter \{[^}]*padding: 7px 2px/)
})

// ── the condensed header, and the blast radius it must not have ──────────

test('the condensed header is scoped to Moon Station and nothing else', () => {
  const css = readFileSync('css/reconnect.css', 'utf8')
  // #hud is global and repainted for every screen. Every rule that touches
  // it here must be under the Moon-only class, or City, Pack, Candy, BOTZ,
  // Rankings and Settings inherit a header they did not ask for.
  const hudRules = css.split('\n').filter((l) => /#hud/.test(l) && /is-condensed|hud-xp|hud-crest|hud-inner/.test(l))
  const moonHudRules = hudRules.filter((l) => l.includes('.moon-hud-compact'))
  const strays = hudRules.filter((l) => !l.includes('.moon-hud-compact') && l.includes('is-condensed'))
  assert.ok(moonHudRules.length > 0, 'the condensed rules must exist')
  assert.deepEqual(strays, [], 'no is-condensed rule may apply outside Moon Station')
})

test('the header listener is torn down when the screen is left', () => {
  // Otherwise it outlives the screen that asked for it and condenses the
  // header on City.
  assert.match(ui, /export function teardownMoonStation/)
  assert.match(ui, /removeEventListener\('scroll', hudScrollHandler\)/)
  assert.match(ui, /document\.body\.classList\.remove\('moon-hud-compact'\)/)
  const main = readFileSync('js/main.js', 'utf8')
  assert.match(main, /if \(scr\.name !== 'moon'\) teardownMoonStation\(\)/)
})

test('collapsing the header never removes an action', () => {
  // "Collapsed" must not mean "fewer things you can do". What condenses is
  // the XP block, which is a progress bar; every button stays mounted.
  const css = readFileSync('css/reconnect.css', 'utf8')
  const condensed = css.slice(css.indexOf('.moon-hud-compact #hud.is-condensed'),
    css.indexOf('@media (prefers-reduced-motion: reduce) {', css.indexOf('.moon-hud-compact')))
  for (const action of ['hud-sync', 'hud-bell', 'hud-identity', 'hud-eye', 'hud-reconnect-status', 'hud-row']) {
    assert.ok(!condensed.includes(action), `${action} must survive the collapse untouched`)
  }
  assert.match(condensed, /\.hud-xp \{[\s\S]*?max-height: 0/)
})

test('the scroll threshold has hysteresis so it cannot flicker', () => {
  assert.match(ui, /const HUD_CONDENSE_AT = 140/)
  assert.match(ui, /const HUD_RESTORE_AT = 70/)
  assert.ok(/HUD_RESTORE_AT\s*$|HUD_RESTORE_AT[^0-9]/.test(ui))
  // And the handler is rAF-coalesced rather than running per scroll event.
  assert.match(ui, /requestAnimationFrame\(apply\)/)
  assert.match(ui, /\{ passive: true \}/)
})

// ── identity and type ────────────────────────────────────────────────────

test('the station is named as a place, not as a report', () => {
  // MOON STATION is a destination in the game, so it is the headline. It
  // used to be a small eyebrow above "Stream review", which read as a
  // section label on an analytics page rather than the name of a place.
  assert.match(ui, /<span class="moon-title">Moon Station<\/span>/)
  assert.match(ui, /<span class="moon-subtitle">Stream Check<\/span>/)
  // Checked against the COPY: the comment above the header names the old
  // wording to explain why it went, which is reasoning, not a string a
  // player can see.
  const copy = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(copy, /Stream review|Streaming signal analysis|moon-eyebrow/)
  assert.match(ui, /class="moon-sigil" role="img" aria-label="Moon Station">👮/)

  const css = readFileSync('css/reconnect.css', 'utf8')
  const moon = css.slice(css.indexOf('/* ── Moon Station screen'))
  const rule = (sel) => moon.slice(moon.indexOf(sel + ' {'), moon.indexOf('}', moon.indexOf(sel + ' {')))
  // The name outweighs what sits under it, in the app's display face.
  assert.match(rule('.moon-title'), /var\(--disp\)[\s\S]*font-size: 23px/)
  assert.match(rule('.moon-subtitle'), /font-size: 12\.5px/)
  // The radar SVG and its animation are gone, not merely hidden — no dead
  // rules, no keyframes nothing references.
  assert.doesNotMatch(moon, /moon-sweep|moonSweep|\.moon-sigil svg|\.moon-sigil circle/)
  assert.doesNotMatch(css, /@keyframes moonSweep/)
  assert.doesNotMatch(moon, /box-shadow|linear-gradient|radial-gradient/,
    'the identity may not use glow or gradients')
})

test('each font carries the one job it is good at', () => {
  const css = readFileSync('css/reconnect.css', 'utf8')
  const moon = css.slice(css.indexOf('/* ── Moon Station screen'))
  const rule = (sel) => moon.slice(moon.indexOf(sel + ' {'), moon.indexOf('}', moon.indexOf(sel + ' {')))
  // Display for the station name and section headings.
  for (const sel of ['.moon-title', '.moon-check-title', '.moon-metric-value']) {
    assert.match(rule(sel), /var\(--disp\)/, `${sel} should be the display face`)
  }
  // Body for anything that is a sentence or a name.
  for (const sel of ['.moon-track', '.moon-row-meta', '.moon-subtitle', '.moon-fineprint', '.moon-reason']) {
    assert.match(rule(sel), /var\(--body\)/, `${sel} should be body text`)
  }
  // Mono only for numbers and short technical labels.
  for (const sel of ['.moon-seq', '.moon-scope', '.moon-metric-label', '.moon-filter-n']) {
    assert.match(rule(sel), /var\(--mono\)/, `${sel} should be mono`)
  }
  // The sentences that keep a flag from being misread are no longer set in
  // tracked-out mono, which is what made them hard to read.
  assert.match(rule('.moon-fineprint'), /letter-spacing: 0/)
})
