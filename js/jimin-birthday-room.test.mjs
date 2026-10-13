import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const world = read('js/screen-world.js')
const router = read('js/router.js')
const main = read('js/main.js')
const css = read('css/reconnect.css')
const charge = read('supabase/functions/op-reconnect/lib/agent-charge.ts')

test('Jimin Birthday Room is routed as an event screen with a City return', () => {
  assert.match(router, /export function goSerendipityRoom/)
  assert.match(main, /scr\.name === 'serendipity-room'/)
  assert.match(world, /export function renderSerendipityRoom/)
  assert.match(world, /^import \{ serendipityRoomArt \} from '\.\/serendipity-room-scene\.js'$/m)
  for (const [name, from] of [['call', 'api'], ['toast', 'state'], ['getState', 'state'], ['setState', 'state'], ['getAgentNo', 'session'], ['goSerendipityRoom', 'router']]) {
    assert.match(world, new RegExp(String.raw`^import \{[^}]*\b${name}\b[^}]*\} from '\./${from}\.js'$`, 'm'), `${name} imported`)
  }
  assert.match(world, /back\.onclick = \(event\) => goWorld/)
})

test('the room uses the shared birthday-card activity and a fixed 500 target', () => {
  assert.match(charge, /const SERENDIPITY_ROOM_TARGET = 500/)
  assert.match(charge, /JIMIN_BIRTHDAY_EVENT_ID, 'Jimin Birthday Room', SERENDIPITY_ROOM_TARGET, true,/)
  assert.match(charge, /serendipityRoom: SerendipityRoomView \| null/)
})

test('the Serendipity Listening Moment opens only at room 100%, after the gift, and grants nothing', () => {
  const jiminRoom = world.slice(world.indexOf('const GIFT_BADGE_NAMES'), world.indexOf('export function renderSerendipityRoom'))
  assert.ok(jiminRoom.length > 500)
  // Exactly one embed: the prototype's full-length Serendipity track.
  assert.equal((jiminRoom.match(/<iframe /g) || []).length, 1)
  assert.match(jiminRoom, /open\.spotify\.com\/embed\/track\/5cQB9fbuQCz4muQUFkv3rR/)
  // Gated on the shared room alone - not on the agent's own card.
  assert.match(jiminRoom, /if \(communityComplete\) \{\n\s+const music = el\('section', 'sr-music'\)/)
  assert.doesNotMatch(jiminRoom, /personalComplete \|\| communityComplete|YOUR LISTENING MOMENT/)
  // Placed after the gift card so it stays secondary.
  assert.ok(jiminRoom.indexOf("sheet.appendChild(giftCard)") < jiminRoom.indexOf("el('section', 'sr-music')"))
  // Celebration only: the music block touches no reward state or call.
  const music = jiminRoom.slice(jiminRoom.indexOf('if (communityComplete) {'), jiminRoom.indexOf('sheet.appendChild(music)'))
  assert.doesNotMatch(music, /call\(|gift|badge|wing|cell|charge|setState/i)
  assert.match(css, /\.sr-music\{/)
  assert.doesNotMatch(world, /serendipityRoomEntry|Enter .* Birthday Room/i)
  assert.doesNotMatch(css, /serendipity-room-entry/)
})

test('the room explains both rewards and never reads below 100% once complete', () => {
  assert.match(world, /<i>YOUR ERA CARD<\/i>[\s\S]*\+10H ARMY Bomb charge[\s\S]*<i>SHARED ROOM 100%<\/i>[\s\S]*Jimin Day Gift for everyone who helped/)
  assert.match(world, /const progress = room\?\.complete \? 1 : Math\.min\(1, community \/ target\)/)
  assert.match(world, /'The room is complete\. Your birthday gift is ready\.'|The room is complete\. Your birthday gift is ready\./)
  assert.match(world, /call\('claimBirthdayGift', \{ agentNo: getAgentNo\(\) \}\)/)
})

const scene = read('js/serendipity-room-scene.js')
const { serendipityRoomArt } = await import('./serendipity-room-scene.js')
const art = Object.fromEntries([0, 25, 50, 75, 100].map((band) => [band, serendipityRoomArt(band)]))
const has = (band, cls) => art[band].includes(`class="${cls}`)

test('the room keeps the shared restoration contract and its labels', () => {
  assert.match(world, /const restored = Math\.max\(0, Math\.min\(1, Number\(progress\) \|\| 0\)\)/)
  assert.match(world, /pct >= 100 \? 100 : pct >= 75 \? 75 : pct >= 50 \? 50 : pct >= 25 \? 25 : 0/)
  assert.match(world, /`stage sr-room sr-p\$\{band\}/)
  assert.match(world, /room\.style\.setProperty\('--sr-light', String\(restored\)\)/)
  assert.match(world, /\$\{serendipityRoomArt\(band\)\}/)
  for (const label of ['QUIET', 'FIRST LIGHT', 'GETTING READY', 'ALMOST READY', 'HAPPY BIRTHDAY']) assert.match(world, new RegExp(label))
  for (const copy of ['The room is getting ready', 'Halfway there', 'Almost ready for Jimin', 'Happy birthday, Jimin.', 'restore this room together']) {
    assert.ok(world.includes(copy), copy)
  }
})

test('one fixed-canvas composition, so props stay grounded at every width', () => {
  for (const band of [0, 25, 50, 75, 100]) assert.match(art[band], /^<svg class="sr-art" viewBox="0 -34 400 318"/)
  assert.match(css, /\.sr-room\{[^}]*aspect-ratio:400\/318/)
  assert.doesNotMatch(scene, /<image|https?:\/\/(?!www\.w3\.org)/, 'original drawing only: no photos or remote art')
  assert.doesNotMatch(scene, /\p{Extended_Pictographic}/u, 'no emoji decoration')
})

test('0% is the base room only: sofa, window, bare table, quiet listening corner', () => {
  for (const cls of ['sr-window', 'sr-curtain', 'sr-bench', 'sr-side-table', 'sr-music-corner is-quiet']) assert.ok(has(0, cls), cls)
  for (const cls of ['sr-lamp', 'sr-vase', 'sr-gifts', 'sr-cake', 'sr-string-lights', 'sr-message-cards', 'sr-birthday']) assert.ok(!has(0, cls), cls)
  assert.ok(art[0].includes('fill="#5c5a55"'), 'the moon lamp is present but off')
})

test('every threshold adds its own visible layer', () => {
  // 25: first warm lamp, flowers on the table, one gift in the gift corner.
  for (const cls of ['sr-lamp', 'sr-warm-pool', 'sr-vase', 'sr-gifts']) assert.ok(has(25, cls), cls)
  assert.ok(!has(25, 'sr-cake'))
  // 50: the cake becomes the focal point, the record goes on, warmer wash.
  for (const cls of ['sr-cake', 'sr-music-corner is-playing', 'sr-warm-wash']) assert.ok(has(50, cls), cls)
  assert.ok(!has(50, 'sr-string-lights'))
  // 75: string lights, the message-card cluster, the moon lamp lit.
  for (const cls of ['sr-string-lights', 'sr-message-cards']) assert.ok(has(75, cls), cls)
  assert.ok(art[75].includes('url(#srMoonGlow)') && !art[50].includes('url(#srMoonGlow)'))
  assert.ok(!has(75, 'sr-birthday') && !has(75, 'sr-flames'))
  // 100: lit candles, the finished message wall and the words.
  for (const cls of ['sr-birthday', 'sr-flames']) assert.ok(has(100, cls), cls)
  assert.match(art[100], /Happy birthday,<\/text>[\s\S]*Jimin<\/text>/)
  const count = (band, re) => (art[band].match(re) || []).length
  assert.ok(count(25, /width="2\.6"/g) < count(50, /width="2\.6"/g) && count(50, /width="2\.6"/g) < count(75, /width="2\.6"/g), 'the gift corner grows')
  assert.ok(count(75, /<rect x="\d+" y="\d+" width="1\d" height="1\d" fill="#/g) < count(100, /<rect x="\d+" y="\d+" width="1\d" height="1\d" fill="#/g), 'the message wall fills in')
})

test('the cat sits on the sofa at every stage, a calm silhouette with no face', () => {
  for (const band of [0, 25, 50, 75, 100]) assert.ok(has(band, 'sr-cat'), `cat at ${band}`)
  // Drawn after the sofa so it sits on the seat; rim-lit from 0%.
  assert.ok(art[0].indexOf('class="sr-cat"') > art[0].indexOf('class="sr-bench"'))
  assert.match(art[0], /class="sr-cat"[\s\S]*stroke="#a9c2d8"/)
  assert.match(art[25], /class="sr-cat"[\s\S]*stroke="#f1cd98"/)
  const cat = scene.slice(scene.indexOf('const CAT = '), scene.indexOf('// ── Center zone'))
  assert.doesNotMatch(cat, /<ellipse|<circle/, 'no eyes or facial details')
})

test('no dance figure or sculpture in the room', () => {
  assert.doesNotMatch(scene, /sr-dance|sr-dancer|DANCE|tutu/)
})

test('the art respects reduced motion and has no restaging animations', () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.sr-flame,\.sr-bulb\{animation:none!important\}/)
  assert.match(css, /\.sr-warm-pool\{opacity:calc\([^)]*var\(--sr-light\)/)
})
