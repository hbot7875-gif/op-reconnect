// RUN AMI room chat, browser side: what reaches the screen is escaped text,
// the input and reactions follow the server's rules, and the panel is
// wired into the lobby and match without touching game actions.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const chat = src('./run-ami-chat.js')
const screen = src('./screen-run-ami.js')
const { RUN_AMI_CHAT_MAX, RUN_AMI_REACTIONS, checkRunAmiChat } = await import('../supabase/functions/op-reconnect/lib/run-ami-chat-rules.js')

test('every chat field is escaped before it reaches innerHTML', () => {
  assert.match(chat, /<time>\$\{esc\(time\(m\.at\)\)\}<\/time>/)
  assert.match(chat, /<span class="ra-msg-body">\$\{esc\(m\.body\)\}<\/span>/)
  assert.match(chat, /<b>\$\{esc\(m\.mine \? 'You' : m\.name\)\}<\/b>/)
})

test('input limit and quick reactions come from the server rules', () => {
  assert.equal(RUN_AMI_CHAT_MAX, 120)
  assert.deepEqual([...RUN_AMI_REACTIONS], ['😂', '😭', '💜', '👀', '🔥'])
  assert.match(chat, /maxlength="\$\{RUN_AMI_CHAT_MAX\}"/)
  assert.match(chat, /RUN_AMI_REACTIONS\.map/)
  assert.deepEqual(checkRunAmiChat('react', '💜'), { ok: true, kind: 'react', body: '💜' })
  assert.equal(checkRunAmiChat('text', 'a'.repeat(121)).reason, 'too_long')
})

test('chat lives only in a lobby or match and sends on its own route', () => {
  assert.match(screen, /if \(next\.phase !== 'lobby' && next\.phase !== 'match'\) \{\n\s+chat\?\.destroy\(\)/)
  assert.match(screen, /timedCall\('runAmiChat', \{ agentNo: getAgentNo\(\), kind, body: text \}\)/)
  assert.doesNotMatch(chat, /runAmiAct|act\(/, 'the panel never sends a game action')
  // the panel stays clear of the hand
  assert.match(screen, /floor: \(\) => body\?\.querySelector\('\.ra-hand'\)\?\.getBoundingClientRect\(\)\.top/)
})
