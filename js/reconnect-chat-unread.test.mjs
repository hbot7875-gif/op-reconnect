import assert from 'node:assert/strict'
import { reconnectChatUnreadCount, reconnectChatBadgeText } from './reconnect-chat-unread.js'

assert.equal(reconnectChatUnreadCount(5, 2), 3)
assert.equal(reconnectChatUnreadCount(2, 5), 0)
assert.equal(reconnectChatUnreadCount(undefined, undefined), 0)
assert.equal(reconnectChatBadgeText(0), '')
assert.equal(reconnectChatBadgeText(1), '1')
assert.equal(reconnectChatBadgeText(10), '9+')

console.log('reconnect-chat-unread: all tests passed')
