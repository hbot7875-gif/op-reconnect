// Polaroid badges (War of Cards) are shown as designed everywhere: their own
// RUN ARMY section in the Badge Collection, and no circle crop, second frame
// or glow in the collection, story, reveal, avatar, Agent ID or rankings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isFramedArt, RUN_ARMY_BADGES } from './badge-frames.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('which art counts as framed, and which badges are Run ARMY', () => {
  assert.equal(isFramedArt('polaroid'), true)
  assert.equal(isFramedArt('polaroid_pro'), true)
  assert.equal(isFramedArt(null), false)
  assert.equal(isFramedArt('crown'), false)
  assert.deepEqual([...RUN_ARMY_BADGES], ['achievement_card_champion', 'achievement_card_champion_pro'])
})

test('the server says which badges carry a frame', () => {
  const bp = read('../supabase/functions/op-reconnect/lib/badge-profile.ts')
  assert.match(bp, /artFrame: template\.art_frame \|\| null,\s+artworkUrl: publicArtUrl/, 'collection: earned')
  assert.match(bp, /artFrame: t\.art_frame \|\| null,/, 'collection: templates')
  assert.match(bp, /select\('id, name, rarity, art_frame'\)/, 'equipped badge (avatar, rankings, Agent ID)')
})

test('Badge Collection: a RUN ARMY section; Polaroids without the rare frame', () => {
  const bd = read('./badge-drawer.js')
  assert.match(bd, /\{ id: 'run_army', icon: '♠', title: 'RUN ARMY', note: 'Badges from Run ARMY games' \}/)
  assert.match(bd, /const sectionOf = \(templateId, section\) => \(RUN_ARMY_BADGES\.includes\(templateId\) \? 'run_army' : section\)/)
  assert.match(bd, /\(framed \? ' is-polaroid' : ''\)/)
  assert.match(bd, /'<span class="bdr-rarity">RARE<\/span>'/, 'the RARE label stays')
  assert.match(bd, /artFrame: info\.artFrame \|\| null \}/, 'equipping keeps the frame flag')
})

test('every place the badge shows marks a Polaroid, and the CSS shows it whole', () => {
  assert.match(read('./ui-hud.js'), /const crestFramed = framedArt && !photoOnlySrc \? ' is-polaroid' : ''/, 'the whole Polaroid only until the photo cut is ready')
  assert.match(read('./screen-resources.js'), /photo\.classList\.add\('is-polaroid'\)/)
  assert.match(read('./screen-ranking.js'), /\$\{frame && !photoOnlySrc \? ' is-polaroid' : ''\}/)
  assert.match(read('./badge-reveal.js'), /isFramedArt\(badge\.artFrame\) \? ' is-polaroid' : ''/)
  const css = read('../css/reconnect.css')
  for (const rule of [
    /#overlay \.bdr-tile\.got\.is-polaroid \{[^}]*border: 0;[^}]*background: none;[^}]*box-shadow: none;[^}]*animation: none;/,
    /#overlay \.bdr-tile\.is-polaroid \.bdr-photo \{ object-fit: contain;[^}]*border-radius: 0;/,
    /#hud \.hud-crest\.is-polaroid \.hud-crest-photo \{[^}]*border-radius: 0; clip-path: none;[^}]*object-fit: contain;/,
    /#scene \.rank-agent-icon\.is-polaroid \.rank-agent-photo \{ object-fit: contain; border-radius: 0; \}/,
    /#scene \.aid-photo\.is-polaroid img \{ object-fit: contain; \}/,
    /#overlay \.badge-unlock\.is-polaroid \.bgu-art img \{ object-fit: contain;/,
  ]) assert.match(css, rule)
  assert.match(read('../css/run-ami.css'), /\.wl-row \.wl-champ:not\(\.is-mark\) \{[^}]*border-radius: 0; object-fit: contain; \}/)
})

test('avatar spots show only the photo inside the frame', async () => {
  const { photoWindow } = await import('./badge-photo-only.js')
  const a = photoWindow('polaroid'), b = photoWindow('polaroid_pro')
  assert.equal(a.tilt, -4); assert.equal(b.tilt, 4)
  assert.ok(a.side > 0.6 && a.side < 0.7, 'the photo window is about two-thirds of the art')
  assert.ok(a.cy > 0.4 && a.cy < 0.45, 'and sits above the chunky bottom')
  const hud = read('./ui-hud.js')
  assert.match(hud, /const photoOnlySrc = framedArt \? photoOnlyCached\(badgeArt, framedArt\) : null/)
  assert.match(hud, /photoOnly\(badgeArt, framedArt\)\.then\(\(src\) => \{ if \(src && container\.isConnected\) renderHud\(container, state\) \}\)/)
  const res = read('./screen-resources.js')
  assert.match(res, /photoOnly\(artworkUrl, frame\)\.then\(\(src\) => \{ if \(src && photo\.isConnected\) paintPhoto\(src\) \}\)/, 'the photo comes in with its pencil')
  assert.match(res, /const adjust = el\('button', 'aid-photo-adjust', '✎'\)/)
  assert.match(read('./screen-ranking.js'), /swapToPhotoOnly\(row\.querySelector\('\.rank-agent-photo'\), row\.querySelector\('\.rank-agent-icon'\), fullArt, frame\)/)
  // The collection, story, reveal and leaderboard keep the whole Polaroid.
  for (const f of ['./badge-drawer.js', './badge-reveal.js', './war-leaderboard-view.js']) assert.doesNotMatch(read(f), /badge-photo-only/, f)
})
