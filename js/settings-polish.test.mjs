import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SETTINGS_ICON_PATHS, setIcon } from './settings-icons.js'

// Settings polish: the City / Pack / Candy system as a control centre. These
// pin the icon family, the one row recipe, the group order, the tones, and
// that every action, link and permission gate is still the same one.

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const src = read('js/screen-settings.js')
const css = read('css/reconnect.css')
const start = css.indexOf('SETTINGS POLISH')
const block = css.slice(start, css.indexOf('/* ── Moon Station screen', start))
const paint = src.slice(src.indexOf('function paintSections'), src.indexOf('function fmtDate'))
const code = paint.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('Settings icons are one Lucide family in currentColor; no emoji on the page', () => {
  for (const [key, svg] of Object.entries(SETTINGS_ICON_PATHS)) {
    assert.doesNotMatch(svg, /fill="|stroke="|style=|#[0-9a-f]{3,6}/i, `${key} carries its own colour`)
  }
  assert.match(setIcon('key'), /^<svg class="set-i" viewBox="0 0 24 24"/)
  assert.doesNotMatch(code, /\p{Extended_Pictographic}|[⚙⏻⏸◯●⚠✉]/u)
  for (const [, key] of code.matchAll(/icon: (?:account\.appearOffline \? )?'(\w+)'/g)) {
    assert.ok(SETTINGS_ICON_PATHS[key], `no icon "${key}"`)
  }
})

test('title is Orbitron Settings; no tracked mono eyebrow; no ReConnect on this screen', () => {
  assert.match(src, /<h1 class="set-title"><span class="set-title-icon">\$\{setIcon\('settings'\)\}<\/span>Settings<\/h1>/)
  assert.doesNotMatch(src, /pack-eyebrow/)
  assert.match(block, /#hud:has\(~ #scene \.set-screen\) #hudReconnectStatus \{ display: none; \}/)
  assert.doesNotMatch(code, /hudReconnectStatus/)
})

test('groups appear in the agreed order', () => {
  const order = [...paint.matchAll(/section\('([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(order, ['Connections', 'Agent', 'Security', 'Game', 'Privacy', 'Help & legal', 'Community', 'HT Access', 'Badge Vault', 'Test Play'])
})

test('every action, link and gate is unchanged', () => {
  for (const call of ['openStreamSource(account, refresh)', 'openPin(account, refresh)', 'openSignalLog()', 'navigator.clipboard.writeText(account.agentNo)',
    'showOverlay(codenameSheet(state, refresh))', 'showOverlay(emailSheet(account, refresh))', 'showOverlay(passwordSheet())', 'openMoonStation()',
    'showOverlay(signOutSheet())', 'showOverlay(retireSheet())', 'openModeSheet(getState() || state)', 'showOverlay(leaveSheet(getState() || state))',
    'showOverlay(presenceSheet(account, refresh))', 'showOverlay(agentManualSheet())', "window.location.href = 'admin.html'",
    "window.location.href = 'badge-admin.html'", "window.location.href = 'playlist-maker.html'", 'href: COMMUNITY_LINKS.updates', 'href: COMMUNITY_LINKS.discussion']) {
    assert.ok(paint.includes(call), `missing ${call}`)
  }
  for (const href of ['privacy.html', 'terms.html', 'about.html', 'credits.html', 'contact.html']) assert.ok(paint.includes(`href: '${href}'`), href)
  assert.match(paint, /if \(\(account\.agentNo \|\| ''\)\.toUpperCase\(\) === 'AGENT000'\) \{/)
  assert.match(paint, /\} else if \(state\?\.player\?\.isBadgeVaultEditor\) \{/)
  assert.match(paint, /if \(uplinkBroken\(account\)\) \{/)
  assert.match(paint, /if \(!account\.email\) \{/)
  // external rows still open in a new tab
  assert.match(src, /row\.target = '_blank'\n\s*row\.rel = 'noopener noreferrer'/)
})

test('one row recipe: icon tile, title, helper, trailing value or chevron', () => {
  assert.match(src, /<span class="sr-icon">\$\{setIcon\(r\.icon\)\}<\/span>/)
  assert.match(src, /const go = r\.copy \? setIcon\('copy'\) : r\.href \? setIcon\('external'\) : r\.onClick \? setIcon\('chevron'\) : ''/)
  assert.match(block, /grid-template-columns: 32px minmax\(0,1fr\) fit-content\(44%\)/)
  assert.match(block, /\.set-screen \.sr-value \{ font-family: var\(--body\)/)
  // mono only for the agent number
  assert.equal((paint.match(/mono: true/g) || []).length, 1)
  assert.match(paint, /name: 'Agent number', value: account\.agentNo, mono: true/)
})

test('tones: crimson only for the broken uplink and Retirement Protocol; HT Access by surface, not colour', () => {
  assert.match(paint, /name: 'Sign out', value: '', tone: 'session'/)
  assert.match(paint, /name: 'Retirement Protocol', value: '', tone: 'danger'/)
  const rules = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))
  const reds = rules.filter((r) => /--v-red|--v-tint-red|240,67,90/.test(r.body))
  assert.ok(reds.length)
  for (const r of reds) assert.match(r.sel, /is-danger|is-warn|set-alarm|sa-icon/, r.sel)
  const admin = block.split('\n').filter((l) => l.includes('is-admin')).join('\n')
  assert.match(admin, /dashed/)
  assert.doesNotMatch(admin, /red|gold/)
  assert.doesNotMatch(block, /gradient\(|box-shadow/)
})

test('values read as values: Ready gold, connected source purple, Join an inline action', () => {
  assert.match(paint, /value: account\.hasPin \? 'Ready' : 'Not set',\n\s*chip: account\.hasPin \? 'ready' : 'neutral'/)
  assert.match(block, /\.sr-chip\.is-ready \{ background: var\(--v-tint-gold\); color: var\(--v-gold\); \}/)
  assert.match(block, /\.sr-chip\.is-ok \{ background: var\(--v-tint-violet\)/)
  assert.match(paint, /name: 'Main GC', value: 'Join', join: true/)
})
