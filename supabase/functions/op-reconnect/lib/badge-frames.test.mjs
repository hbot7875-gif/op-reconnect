// Badge frames: Card Champion's Polaroid, baked in by Badge Maker.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { polaroidLayout, frameOf, BADGE_FRAMES } from '../../../../js/badge-frames.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('polaroid: square photo window, thicker bottom, fits the rare-card crop', () => {
  const L = polaroidLayout(512)
  assert.ok(Math.abs(L.photo - (L.w - 2 * L.side)) < 1e-9, 'square photo')
  const bottom = L.h - L.side - L.photo
  assert.ok(bottom > L.side * 3, 'bottom border clearly thicker')
  assert.ok(L.photo / L.w > 0.85, 'the photo fills most of the frame')
  assert.equal(L.tilt, -4, 'a playful 4° tilt')
  // Rare badges show the middle 4/5 of the square; the tilted card stays inside.
  const half = (L.w / 2) * Math.cos(4 * Math.PI / 180) + (L.h / 2) * Math.sin(4 * Math.PI / 180)
  assert.ok(half * 2 <= 512 * 0.8 + 2, `card ${Math.round(half * 2)}px wide in a ${512 * 0.8}px crop`)
  assert.ok(L.h < 512, 'never taller than the square')
})

test('only templates that ask for it get a frame', () => {
  assert.deepEqual(BADGE_FRAMES, ['polaroid', 'polaroid_pro'])
  assert.equal(frameOf({ art_frame: 'polaroid_pro' }), 'polaroid_pro')
  assert.equal(polaroidLayout(512, 'polaroid_pro').tilt, 4, 'Pro tilts the other way')
  assert.equal(polaroidLayout(512).tilt, -4)
  assert.equal(frameOf({ art_frame: 'polaroid' }), 'polaroid')
  assert.equal(frameOf({ art_frame: null }), null)
  assert.equal(frameOf({ art_frame: 'neon' }), null)
  assert.equal(frameOf(null), null)
})

test('wiring: Badge Maker bakes the frame into the upload and the previews', () => {
  const html = read('../../../../badge-admin.html')
  assert.match(html, /if \(frameOf\(selectedTemplate\(\)\)\) drawPolaroid\(ctx, OUT, drawCroppedPhoto, frameOf\(selectedTemplate\(\)\)\)/)
  assert.match(html, /if \(frameOf\(selectedTemplate\(\)\)\) \{ drawFramedPreview\(canvas\); return \}/)
  assert.match(read('./badge-admin.ts'), /select\('id, section, rarity, name, unlock_hint, sort_order, active, art_frame, photo_style'\)/)
  const sql = read('../../../migrations/20261107115000_rc_card_champion_badge_template.sql')
  assert.match(sql, /check \(art_frame is null or art_frame in \('polaroid'\)\)/)
  assert.match(sql, /'achievement_card_champion', 'achievement', 'rare', 'War of Cards — Card Champion',\s+'Win 10 games of War of Cards\. Every 10 more wins earns another\.', 80, true, 'polaroid'/)
  assert.doesNotMatch(sql, /update public\.rc_badge_catalog set art_frame/, 'no other badge changes')
  assert.doesNotMatch(read('../../../../js/badge-frames.js'), /fillText|strokeText/, 'no captions or text')
  assert.match(read('../../../../js/badge-frames.js'), /paper: '#cdb6ff'/, 'pastel lavender instant film')
})

test('Fun photo style: Card Champion uses Fun only; every other badge keeps Cute and Hot', async () => {
  const { preferredPoolFor, poolChoicesFor, badgeArtMatches } = await import('../../../../js/badge-vault.js')
  const champion = { id: 'achievement_card_champion', rarity: 'rare', photo_style: 'fun' }
  assert.equal(preferredPoolFor(champion), 'fun')
  assert.deepEqual(poolChoicesFor(champion), ['fun'])
  assert.equal(preferredPoolFor({ rarity: 'rare' }), 'hot', 'unchanged for other badges')
  assert.equal(preferredPoolFor({ rarity: 'common' }), 'cute')
  assert.deepEqual(poolChoicesFor({ rarity: 'rare' }), ['cute', 'hot'])
  const byId = new Map([['achievement_card_champion', champion]])
  assert.equal(badgeArtMatches({ templateId: 'achievement_card_champion', pool: 'fun' }, { style: 'untagged' }, byId), false, 'Fun is a real style, not legacy')
  assert.equal(badgeArtMatches({ templateId: 'achievement_card_champion', pool: 'fun' }, { style: 'fun' }, byId), true)
  const sql = read('../../../migrations/20261108130000_rc_badge_fun_style.sql')
  assert.match(sql, /check \(photo_style is null or photo_style in \('cute', 'hot', 'fun'\)\)/)
  assert.match(sql, /update public\.rc_badge_catalog set photo_style = 'fun' where id = 'achievement_card_champion';/)
  assert.match(sql, /v_preferred_pool := coalesce\(v_style, case when v_rarity = 'rare' then 'hot' else 'cute' end\)/, 'others keep rarity rule')
  assert.match(read('./badge-admin-rules.js'), /new Set\(\['cute', 'hot', 'fun'\]\)/)
  assert.match(read('./badge-admin.ts'), /const POOL_TAGS = new Set\(\['cute', 'hot', 'fun'\]\)/)
  const html = read('../../../../badge-admin.html')
  assert.match(html, /const choices = poolChoicesFor\(template\)/)
  assert.match(html, /fun: '🎉 Fun'/)
})
