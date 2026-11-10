import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeXHandle, xProfileUrl, pickAccountHandle } from './x-handle-rules.js'

test('X username: optional, @ stripped, lowercased, 1–15 letters/digits/underscore', () => {
  for (const blank of [undefined, null, '', '   ', '@']) assert.deepEqual(normalizeXHandle(blank), { ok: true, value: null })
  assert.deepEqual(normalizeXHandle('@BTS_twt'), { ok: true, value: 'bts_twt' })
  assert.deepEqual(normalizeXHandle('  jk  '), { ok: true, value: 'jk' })
  assert.deepEqual(normalizeXHandle('a'), { ok: true, value: 'a' })
  assert.deepEqual(normalizeXHandle('abcdefghijklmno'), { ok: true, value: 'abcdefghijklmno' })
  for (const bad of ['abcdefghijklmnop', 'moon.child', 'has space', '@@jk', 'jk!', 'jk@x', '정국']) {
    assert.deepEqual(normalizeXHandle(bad), { ok: false, error: 'x_handle_invalid' }, bad)
  }
})

test('X profile link only for a valid username', () => {
  assert.equal(xProfileUrl('@Koya_Nav'), 'https://x.com/koya_nav')
  assert.equal(xProfileUrl(null), null)
  assert.equal(xProfileUrl('javascript:alert(1)'), null)
})

test('migration: nullable, same format as the DB check, unique when set, roster passes x', () => {
  const sql = readFileSync(new URL('../../../migrations/20261110120000_rc_agent_x_handle.sql', import.meta.url), 'utf8')
  assert.match(sql, /add column if not exists x_handle text;/)
  assert.match(sql, /x_handle is null or x_handle ~ '\^\[a-z0-9_\]\{1,15\}\$'/)
  assert.match(sql, /create unique index if not exists rc_agents_x_handle_key\s+on public\.rc_agents \(x_handle\) where x_handle is not null/)
  assert.match(sql, /'x', case when a\.x_handle ~/)
  assert.match(sql, /revoke all on function public\.rc_battle_team_roster\(text, text, date\) from public, anon, authenticated;/)
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/i)
})

test('sign-up: Instagram or X, at least one; Instagram stays the account name when given', () => {
  assert.deepEqual(pickAccountHandle({ handle: 'moon.child', xHandle: '' }), { ok: true, handle: 'moon.child', handleSource: 'instagram', xHandle: null })
  assert.deepEqual(pickAccountHandle({ handle: '@moon.child', xHandle: '@Moon_X' }), { ok: true, handle: 'moon.child', handleSource: 'instagram', xHandle: 'moon_x' })
  assert.deepEqual(pickAccountHandle({ handle: '  ', xHandle: '@Koya_X' }), { ok: true, handle: 'koya_x', handleSource: 'x', xHandle: 'koya_x' })
  assert.deepEqual(pickAccountHandle({}), { ok: false, error: 'handle_required', field: 'ig' })
  assert.deepEqual(pickAccountHandle({ handle: '', xHandle: 'jk' }), { ok: false, error: 'x_handle_short', field: 'x' })
  assert.deepEqual(pickAccountHandle({ handle: 'jk', xHandle: '' }), { ok: false, error: 'handle_invalid', field: 'ig' })
  assert.deepEqual(pickAccountHandle({ handle: 'moon.child', xHandle: 'bad.name' }), { ok: false, error: 'x_handle_invalid', field: 'x' })
})

test('migration: handle_source defaults to instagram and gates the roster Instagram link', () => {
  const sql = readFileSync(new URL('../../../migrations/20261110120000_rc_agent_x_handle.sql', import.meta.url), 'utf8')
  assert.match(sql, /add column if not exists handle_source text not null default 'instagram'/)
  assert.match(sql, /check \(handle_source in \('instagram', 'x'\)\)/)
  assert.match(sql, /'ig', case when a\.handle_source = 'instagram' and/)
})
