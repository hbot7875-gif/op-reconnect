// Pack collection XP wording: potential vs locked vs earned, and the start
// time shown in the viewer's own time zone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectionChip, kstMidnightLabel, shortReset } from './collection-xp-ui.js'

const live = { started: true, qualified: true, earned: 20, cap: 50 }

test('every chip state says what it is', () => {
  assert.deepEqual(collectionChip(15, 'pack', false, false, live), { state: 'unplaced', text: 'Place to earn 15/wk' })
  assert.equal(collectionChip(15, 'unowned', false, false, live).state, 'unowned')
  assert.equal(collectionChip(15, 'restored', true, false, live).text, 'Copy · no extra XP')
  assert.equal(collectionChip(15, 'pack', true, false, live).state, 'duplicate', 'a second copy in the Pack adds nothing either')
  assert.deepEqual(collectionChip(15, 'restored', false, false, { ...live, qualified: false }), { state: 'locked', text: '🔒 15 XP/wk' })
  assert.equal(collectionChip(15, 'restored', false, false, { ...live, started: false }).state, 'locked')
  assert.equal(collectionChip(15, 'restored', false, false, { ...live, earned: 50 }).state, 'maxed')
  assert.equal(collectionChip(15, 'restored', false, false, live).state, 'live')
  assert.deepEqual(collectionChip(15, 'restored', false, true, live), { state: 'earned', text: '✓ +15 XP earned' })
  assert.equal(collectionChip(0, 'pack', false, false, live), null, 'tickets / Backup Passes show no chip')
  // Only "earned" ever shows a + amount.
  for (const where of ['pack', 'unowned', 'restored']) {
    assert.doesNotMatch(collectionChip(15, where, false, false, live).text, /\+/)
  }
})

test('Monday 00:00 KST shows as the viewer’s own day and time', () => {
  const ist = kstMidnightLabel('2026-11-30', { locale: 'en-IN', timeZone: 'Asia/Kolkata' })
  assert.match(ist, /Sun/)
  assert.match(ist, /29/)
  assert.match(ist, /8:30\s?(pm|PM)/)
  const kst = kstMidnightLabel('2026-11-30', { locale: 'en-US', timeZone: 'Asia/Seoul' })
  assert.match(kst, /Mon, Nov 30, 12:00\s?AM/)
  assert.match(shortReset('2026-12-07T00:00:00+09:00', { locale: 'en-US', timeZone: 'Asia/Kolkata' }), /Sun 8:30\s?PM/)
})

test('the Pack uses these helpers; Rankings says districts in words', () => {
  const pack = readFileSync(new URL('./screen-resources.js', import.meta.url), 'utf8')
  assert.match(pack, /Starts \$\{kstMidnightLabel\(c\.startsWeek\)\}/)
  assert.match(readFileSync(new URL('./collectible-tile.js', import.meta.url), 'utf8'), /collectionChip\(weekly, where,/)
  const ranks = readFileSync(new URL('./screen-ranking.js', import.meta.url), 'utf8')
  assert.match(ranks, /\$\{a\.districtsOwned\} district\$\{a\.districtsOwned === 1 \? '' : 's'\} restored/)
  assert.doesNotMatch(ranks, /rank-owned-key/)
})

test('the XP table players read matches what the server pays', async () => {
  const { COLLECTION_XP_ROWS } = await import('./collection-xp-ui.js')
  const { collectibleWeeklyXp, COLLECTION_WEEKLY_CAP } = await import('../supabase/functions/op-reconnect/lib/collectible-values.js')
  const xp = Object.fromEntries(COLLECTION_XP_ROWS)
  assert.equal(xp.Albums, collectibleWeeklyXp({ kind: 'album', era: 'BE' }))
  assert.equal(xp['Concert films & documentaries'], collectibleWeeklyXp({ kind: 'album', era: 'Media' }))
  assert.equal(xp['ARMY Bombs'], collectibleWeeklyXp({ kind: 'lightstick' }))
  assert.equal(xp.Clothing, collectibleWeeklyXp({ kind: 'apparel' }))
  assert.equal(xp.Photocards, collectibleWeeklyXp({ kind: 'photocard' }))
  assert.equal(xp['Posters, banners & bandanas'], collectibleWeeklyXp({ kind: 'banner' }))
  assert.equal(xp['Figures & plushies'], collectibleWeeklyXp({ kind: 'plush' }))
  assert.equal(xp['Mugs, cushions, rugs & other decor'], collectibleWeeklyXp({ kind: 'rug' }))
  assert.equal(COLLECTION_WEEKLY_CAP, 50)
  const manual = (await import('node:fs')).readFileSync(new URL('./agent-manual.js', import.meta.url), 'utf8')
  assert.match(manual, /detailSection\('Weekly Collection XP'\)/)
  assert.match(manual, /Sunday at 8:30 PM IST/)
  assert.match(manual, /Rarity doesn’t change weekly XP/)
})

test('announcement: automatic XP line, how to stay active, the closing call to action', () => {
  const src = readFileSync(new URL('./collection-xp-announce.js', import.meta.url), 'utf8')
  assert.match(src, /point\('✨', "XP is added automatically once you're eligible\. <b>No claiming needed!<\/b>"\)/)
  assert.match(src, /How to stay active\? Complete any <b>ONE<\/b> of these each week:/)
  assert.match(src, /Go place your collectibles now and start earning XP from November 29, 8:30 PM IST!/)
  assert.doesNotMatch(src, /Rewards begin/)
})

test("ARMY's Corner: n/7 beside the title, the full message, the Place button off, the 7th centred", async () => {
  const { CORNER_LIMIT } = await import('../supabase/functions/op-reconnect/lib/collectible-values.js')
  assert.equal(CORNER_LIMIT, 7)
  const district = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8')
  const items = readFileSync(new URL('./items.js', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../css/reconnect.css', import.meta.url), 'utf8')
  assert.match(items, /export const CORNER_FULL_MSG = "Your ARMY's Corner is full! Try another district or move an item to your Pack\."/)
  assert.match(district, /\$\{kept\.length\}\/\$\{CORNER_LIMIT\}/)
  assert.match(district, /add\.disabled = !spare\.length \|\| full/)
  assert.match(district, /if \(full\) wrap\.appendChild\(el\('p', 'kept-full', CORNER_FULL_MSG\)\)/)
  // A refused placement goes back where it was and says why.
  assert.match(items, /res\?\.error === 'district_full' \? CORNER_FULL_MSG/)
  assert.match(items, /Object\.assign\(hit, before\)/)
  assert.match(css, /\.army-corner > :last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; justify-self: center;/)
  // The street illustration still shows at most 6.
  assert.match(readFileSync(new URL('./scene-items.js', import.meta.url), 'utf8'), /export const MAX_PROPS = 6/)
})

test('announcement: fits a 375×812 phone with spacing, not by cutting the automatic-XP line', () => {
  const css = readFileSync(new URL('../css/reconnect.css', import.meta.url), 'utf8')
  assert.match(css, /\.cx-intro\.sheet \{ padding-top: 16px; padding-bottom: 16px; \}/)
  assert.match(css, /\.cx-intro \.help-intro-steps p \{ line-height: 1\.35; \}/)
})
