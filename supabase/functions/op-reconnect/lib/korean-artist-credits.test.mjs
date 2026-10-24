// Hangul-only artist credits (ListenBrainz) must pass the BTS allowlist.
//
// normalizeKey's NFKD step splits each Hangul syllable into jamo, so the
// allowlist's composed "방탄소년단" never matched a normalized artist and every
// play credited only in Korean earned no stream XP. artistAllowed now
// normalizes entries the same way.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeKey, artistAllowed, countedArtistPlays } from './text.ts'

const LIVE = ['bts', '방탄소년단', 'rm', 'jin', 'suga', 'agust d', 'j hope', 'jhope', 'jimin', 'v', 'jung kook', 'jungkook']
const KOREAN = ['진', '지민', '정국', '슈가', '제이홉', '뷔']
const ALLOW = [...LIVE, ...KOREAN]
const allowed = (artist, list = ALLOW) => artistAllowed(normalizeKey(artist), list)

test('the composed group name on the live allowlist matches a normalized credit', () => {
  assert.notEqual(normalizeKey('방탄소년단'), '방탄소년단') // the root cause: NFKD decomposes it
  assert.equal(allowed('방탄소년단', LIVE), true)
  assert.equal(allowed('방탄소년단, Steve Aoki', LIVE), true)
})

test('members credited in Hangul count, alone or alongside a collaborator', () => {
  for (const a of ['진', '지민', '정국', '지민, 로꼬', '정국, Latto', '레이디 제인, 정국']) assert.equal(allowed(a), true, a)
})

test('Hangul matching stays whole-token', () => {
  for (const a of ['진아', '권진아', '정국이', '이소라', '프라이머리', '데이식스']) assert.equal(allowed(a), false, a)
})

test('Latin entries behave exactly as before', () => {
  assert.equal(allowed('V, Park Hyo Shin'), true)
  assert.equal(allowed('Vantae'), false)
  assert.equal(allowed('Chase Atlantic'), false)
  assert.equal(allowed(''), true) // stats.fm rows with no artist are still trusted
})

test('per-track overrides still apply, and Korean credits feed the counted total', () => {
  const plays = { [normalizeKey('정국')]: 224, [normalizeKey('USHER')]: 85 }
  assert.equal(countedArtistPlays(plays, ALLOW), 224)
  assert.equal(countedArtistPlays(plays, ALLOW, 'standing next to you', { 'standing next to you': ['usher'] }), 309)
})

test('the migration adds every member name and checks the group name too', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../../migrations/20261024210000_rc_korean_member_credits.sql', import.meta.url)), 'utf8')
  for (const n of KOREAN) assert.ok(sql.includes(`'${n}'`), n)
  assert.match(sql, /'방탄소년단'/)
  assert.match(sql, /where key = 'bts_artists'/)
})
