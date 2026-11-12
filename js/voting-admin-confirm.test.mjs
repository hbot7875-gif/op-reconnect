import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { votingConfirmText } from './voting-admin.js'

test('irreversible review decisions ask first; saving checks and undoing do not', () => {
  for (const [kind, act, min] of [['proof', 'verify'], ['proof', 'reject'], ['xrepl', 'approve'], ['xrepl', 'reject'],
    ['chat', 'remove'], ['chat', 'timeout', '60'], ['chat', 'timeout', '1440'], ['chat', 'timeout', 'event']]) {
    const spec = votingConfirmText(kind, act, min)
    assert.ok(spec && spec.title && spec.body && spec.confirmLabel, `${kind}/${act}/${min}`)
  }
  assert.equal(votingConfirmText('proof', 'keep'), null)
  assert.equal(votingConfirmText('chat', 'restore'), null)
  assert.equal(votingConfirmText('chat', 'timeout', '0'), null, 'lifting a timeout is not a penalty')
  assert.match(votingConfirmText('chat', 'timeout', 'event').body, /rest of the event/)
})

test('every decision path waits for the confirmation before calling the backend', () => {
  const src = readFileSync(new URL('./voting-admin.js', import.meta.url), 'utf8')
  for (const fn of ['decideReplacement', 'moderate', 'decide']) {
    const body = src.slice(src.indexOf(`async function ${fn}(`))
    const ask = body.indexOf('await confirm(ask)')
    const send = body.indexOf('await call(')
    assert.ok(ask > 0 && ask < send, `${fn} confirms before it calls`)
  }
})
