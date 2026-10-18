import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// state.js wires a document listener at import; nothing here touches it.
globalThis.document ??= { addEventListener() {} }
const { howToPlayHtml } = await import('./run-ami-help.js')
const { DEFAULT_CONFIG, HAND_SIZE } = await import('../supabase/functions/op-reconnect/lib/run-ami-deck.js')
const text = howToPlayHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('How to Play states the implemented rules, with numbers from the server config', () => {
  assert.equal(DEFAULT_CONFIG.turnSeconds, 30)
  assert.equal(DEFAULT_CONFIG.runAmiGraceMs, 2000)
  for (const phrase of [
    'Create room', 'Join', '2–4 agents', `starts with ${HAND_SIZE} cards`,
    'colour', 'number', 'action', 'Draw', 'Pass',
    'Skip', 'Reverse', 'Draw Two', 'Wild', 'Wild Draw Four', 'No stacking',
    'second-to-last card', 'RUN AMI', 'within 2 seconds', '2-second grace period',
    'CAUGHT!', `draws ${DEFAULT_CONFIG.catchPenalty}`,
    `${DEFAULT_CONFIG.turnSeconds} seconds`, `${DEFAULT_CONFIG.maxTimeouts} turns in a row`,
    `${DEFAULT_CONFIG.disconnectGraceSeconds} seconds`, 'last agent standing', 'last card',
  ]) assert.ok(text.includes(phrase), `missing: ${phrase}`)
  assert.doesNotMatch(text, /\bUNO\b/i)
})

test('How to Play is reachable from the entry screen, the lobby and the match header', () => {
  const rooms = readFileSync(new URL('./run-ami-rooms.js', import.meta.url), 'utf8')
  const table = readFileSync(new URL('./run-ami-table.js', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('./screen-run-ami.js', import.meta.url), 'utf8')
  assert.equal((rooms.match(/wrap\.appendChild\(howToPlayButton\(\)\)/g) || []).length, 2)
  assert.match(table, /class="ra-help-q"[^>]*aria-label="How to play"/)
  assert.match(table, /\$\('\.ra-help-q'\)\.onclick = \(\) => handlers\.onHelp\(\)/)
  assert.match(screen, /onHelp: \(\) => openHowToPlay\(\)/)
})

test('Settings shows RUN AMI · Test Play only to testers, below Playlist Makers for agent000', () => {
  const src = readFileSync(new URL('./screen-settings.js', import.meta.url), 'utf8')
  assert.match(src, /const runAmiTester = isRunAmiTester\(account\.agentNo\)/)
  assert.match(src, /name: 'RUN AMI · Test Play', value: 'TEST'/)
  const playlist = src.indexOf("window.location.href = 'playlist-maker.html'")
  const row = src.indexOf('...(runAmiTester ? [runAmiRow] : [])')
  assert.ok(playlist > 0 && row > playlist, 'row sits right after Playlist Makers')
  assert.match(src, /if \(runAmiTester && \(account\.agentNo \|\| ''\)\.toUpperCase\(\) !== 'AGENT000'\) \{/)
})

test('RUN AMI is not on City, the nav or the home screen during the test', () => {
  for (const f of ['./screen-world.js', './ui-hud.js', '../index.html']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /goRunAmi|runami|RUN AMI/i, f)
  }
})
