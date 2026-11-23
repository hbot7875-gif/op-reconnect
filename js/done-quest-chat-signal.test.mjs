// A finished ReConnect quest has no Team Chat on the district page, so its
// unread messages must not keep showing in Signals or on the bell.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const hud = readFileSync(new URL('./ui-hud.js', import.meta.url), 'utf8').split('\r\n').join('\n')
const district = readFileSync(new URL('./screen-district.js', import.meta.url), 'utf8').split('\r\n').join('\n')

test('team chat unread is ignored once the quest is done', () => {
  const fn = hud.slice(hud.indexOf('function reconnectTeamChat('), hud.indexOf('function invitesSheet('))
  assert.match(fn, /if \(district\.reconnect\.done\) return null/)
  assert.ok(fn.indexOf('reconnect.done') < fn.indexOf('reconnectChatUnreadCount'))
})

test('the district page still hides the quest panel (and its chat) once done', () => {
  assert.match(district, /const reconnectBox = d\.reconnect && !d\.reconnect\.done/)
})
