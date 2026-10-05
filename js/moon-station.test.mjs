import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('js/settings-streams.js', 'utf8')
const selfCheck = readFileSync('supabase/functions/op-reconnect/lib/signal-log.ts', 'utf8')
const streams = readFileSync('supabase/functions/op-reconnect/lib/streams.ts', 'utf8')

test('partial provider history is explained and never gets a mode verdict', () => {
  assert.match(ui, /Sync catching up · \$\{esc\(sourceName\)\}/)
  assert.match(ui, /Some recent streams may be missing/)
  assert.match(ui, /won't review your streaming pace until the full history is ready/)
  assert.doesNotMatch(ui, /latest 50 streams before the next pull/)
  assert.match(ui, /!res\.partialHistory && excessStreamDays\.length/)
  assert.match(ui, /res\.mode && !res\.partialHistory/)
})

test('player copy uses familiar streaming language without an accusation', () => {
  assert.match(ui, /Your stream check/)
  assert.match(ui, /streaming pattern/)
  assert.match(ui, /Check your streaming pace/)
  assert.match(ui, /accounts and devices/)
  // Names the pattern instead of the person. "played too close" read as a
  // verdict on the player, and after the Stats.fm duplicate audit it was
  // landing on people whose only mistake was listening once.
  assert.match(ui, /repeated-play pattern/)
  assert.doesNotMatch(ui, /played too close/)
  assert.doesNotMatch(ui, /Your own police check/)
  assert.doesNotMatch(ui, />\d* flagged</)
})

test('a duplicate the source reported twice is explained, not silently dropped', () => {
  // A collapsed row set must never read as lost history.
  assert.match(ui, /ingestionDuplicates/)
  assert.match(ui, /duplicate stream\$\{dupes === 1 \? '' : 's'\} set aside/)
  assert.match(ui, /Nothing was removed from your history or your totals/)
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
