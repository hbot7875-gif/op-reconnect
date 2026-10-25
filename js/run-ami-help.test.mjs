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
    'colour', 'number', 'action', 'Pick', 'Pass',
    'Skip', 'Reverse', 'Pick Two', 'Wild', 'Wild Pick Four', 'No stacking',
    'second-to-last card', 'MIC CHECK!', 'within 2 seconds', '2-second grace period',
    'RUN AMI', `picks ${DEFAULT_CONFIG.catchPenalty} cards`,
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

test('Settings shows War of Cards · Test Play only to testers, below Playlist Makers for agent000', () => {
  const src = readFileSync(new URL('./screen-settings.js', import.meta.url), 'utf8')
  // The server's live tester list (rc_run_ami_testers), via the game state.
  assert.match(src, /const runAmiTester = !!state\?\.runAmiTester/)
  // AGENT000 manages that list from HT Access.
  assert.match(src, /name: 'War of Cards testers'[\s\S]*?onClick: \(\) => openTesterManager\(\)/)
  assert.match(src, /name: 'War of Cards · Test Play', value: 'TEST'/)
  const playlist = src.indexOf("window.location.href = 'playlist-maker.html'")
  const row = src.indexOf('...(runAmiTester ? [runAmiRow] : [])')
  assert.ok(playlist > 0 && row > playlist, 'row sits right after Playlist Makers')
  assert.match(src, /if \(runAmiTester && \(account\.agentNo \|\| ''\)\.toUpperCase\(\) !== 'AGENT000'\) \{/)
})

test('RUN AMI is not on the nav or the home screen during the test', () => {
  for (const f of ['./ui-hud.js', '../index.html']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /goRunAmi|runami|RUN AMI/i, f)
  }
})

test('City reaches RUN AMI only through Run ARMY: testers get Play, everyone else a lock', () => {
  const world = readFileSync(new URL('./screen-world.js', import.meta.url), 'utf8')
  assert.doesNotMatch(world, /goRunAmi|runami|RUN AMI/i)
  assert.match(world, /onRunArmy: \(\) => openRunArmy\(\)/)
  const zone = readFileSync(new URL('./run-army.js', import.meta.url), 'utf8')
  // Same rule as the server (run-ami.ts allowAgent): testers, or a full album.
  assert.match(zone, /const open = !!getState\(\)\?\.runAmiTester \|\| !!album\?\.complete/)
  // The only way in is the Play button, and it exists only for testers.
  assert.match(zone, /if \(open\) \{\s*const play = el\('button', 'btn btn-primary rarmy-play', 'Play War of Cards'\)/)
  assert.equal(zone.match(/goRunAmi\(/g).length, 1)
  assert.match(zone, /Unlocks once you collect all \$\{ALBUM_SIZE\} BTS album covers/)
  // 15 is the number of distinct eras the card faces carry.
  const art = readFileSync(new URL('./run-ami-art.js', import.meta.url), 'utf8')
  const eras = [...art.match(/const ERA_OF = \{([^}]*)\}/)[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1])
  assert.equal(new Set(eras).size, 15)
  assert.match(zone, /Coming soon to Run ARMY/)
})

test('players are told how to collect covers wherever they meet them', () => {
  const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')
  // Signal Sweep, where covers are earned, names the reward and today's cover.
  const world = read('./screen-world.js')
  assert.match(world, /wrap\.appendChild\(sideMissionsPanel\(state\.sideMissions, state\.album\)\)/)
  assert.match(world, /<span>Album<\/span><i>\$\{era \? esc\(era\.name\) : `Complete all \$\{total\} today`\}<\/i><b>\+1 cover<\/b>/)
  assert.match(world, /announceNewCover\(state\.album\)/)
  // Run ARMY's lock and the Album both say how covers arrive.
  const zone = read('./run-army.js')
  assert.match(zone, /one for each daily Signal Sweep, or as a gift from a friend/)
  const album = read('./album.js')
  assert.match(album, /Each daily Signal Sweep brings one new cover, and friends can gift you one a day/)
  assert.match(album, /Your agent number/)
  assert.match(album, /sent you the \$\{albumEra\(gift\.era\)\?\.name \|\| 'new'\} cover/)
  // The manual covers it too.
  const manual = read('./agent-manual.js')
  assert.match(manual, /earns \+10 XP and one new BTS album cover/)
  assert.match(manual, /detailSection\('Run ARMY and the Album'\)/)
})

test('the launch pop-up shows once per agent, waits for other sheets, and opens Run ARMY', () => {
  const zone = readFileSync(new URL('./run-army.js', import.meta.url), 'utf8')
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8')
  assert.match(main, /checkForBirthdayEraPopup\(state\)\r?\n\s*checkForRunAmiLaunch\(state\)/)
  assert.match(zone, /War of Cards is live now/)
  assert.match(zone, /if \(localStorage\.getItem\(`\$\{LAUNCH_KEY\}\$\{agentNo\}`\) === '1'\) return/)
  assert.match(zone, /if \(overlay && !overlay\.hidden\) return/)
  assert.match(zone, /go\.onclick = \(\) => \{ hideOverlay\(\); openRunArmy\(\) \}/)
})

test('MIC CHECK! only plays a selected card when it is your second-to-last', () => {
  const table = readFileSync(new URL('./run-ami-table.js', import.meta.url), 'utf8')
  assert.match(table, /const playIt = !!selected && playableNow\(selected\) && view\?\.me\.hand\.length === 2/)
  assert.match(table, /handlers\.onRunAmi\(playIt \? selected : null, playIt \? cardOf\(selected\) : null\)/)
})

test('special cards are explained where they happen', () => {
  const table = readFileSync(new URL('./run-ami-table.js', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('./screen-run-ami.js', import.meta.url), 'utf8')
  const cards = readFileSync(new URL('./run-ami-cards.js', import.meta.url), 'utf8')
  // Players see "Pick", never "Draw".
  assert.match(cards, /d2: 'Pick Two'/)
  assert.match(cards, /wd4: 'Wild Pick Four'/)
  assert.match(table, /class="ra-btn ra-btn-draw" type="button">Pick</)
  // A Pick Two / Pick Four is announced on the table, once, naming who it hit.
  assert.match(table, /`\+\$\{n\} · You pick \$\{n\} and skip`/)
  assert.match(table, /if \(!hit\.has\(e\.seat\)\) cue\(/)
  // The colour sheet says what the Wild will do.
  assert.match(screen, /'Choose the next colour'/)
  assert.match(screen, /The next agent also picks 4 cards and misses their turn/)
})

test('How to Play leads with four easy steps; the fine print folds away', () => {
  const html = howToPlayHtml()
  const steps = html.slice(html.indexOf('<ol class="ra-help-steps">'), html.indexOf('</ol>'))
  assert.equal((steps.match(/<li>/g) || []).length, 4)
  const more = html.indexOf('<details class="ra-help-more">')
  assert.ok(more > html.indexOf('The two shouts'), 'More rules comes after the basics')
  for (const fine of ['Create room', 'grace period', 'turns in a row', 'last agent standing']) {
    assert.ok(html.indexOf(fine) > more, `${fine} belongs under More rules`)
  }
})
