import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('js/settings-streams.js', 'utf8')
const selfCheck = readFileSync('supabase/functions/op-reconnect/lib/signal-log.ts', 'utf8')
const streams = readFileSync('supabase/functions/op-reconnect/lib/streams.ts', 'utf8')

test('partial provider history is explained and never gets a mode verdict', () => {
  assert.match(ui, /Sync catching up · \$\{esc\(sourceName\)\}/)
  assert.match(ui, /Some recent streams may be missing/)
  assert.match(ui, /won't review your streaming pace until the full history is ready/)
  assert.doesNotMatch(ui, /latest 50 streams before the next pull/)
  assert.match(ui, /!res\.partialHistory && excessStreamDays\.length/)
  assert.match(ui, /res\.mode && !res\.partialHistory/)
})

test('player copy uses familiar streaming language without an accusation', () => {
  assert.match(ui, /Your stream check/)
  assert.match(ui, /streaming pattern/)
  assert.match(ui, /Check your streaming pace/)
  assert.match(ui, /accounts and devices/)
  assert.match(ui, /played too close/)
  assert.doesNotMatch(ui, /Your own police check/)
  assert.doesNotMatch(ui, />\d* flagged</)
})

test('every incomplete provider sequence suppresses repeat judgments', () => {
  assert.match(selfCheck, /partialHistory = !streamResult\.ok \|\| !streamResult\.complete/)
  assert.match(selfCheck, /trustSequence: !partialHistory/)
  assert.match(streams, /partialReason: 'provider_error'/)
  assert.match(streams, /partialReason: complete \? null : 'page_limit'/)
  assert.match(streams, /partialReason = provider\.ok \? 'recent_limit' : 'provider_error'/)
  assert.match(streams, /partialReason: 'database_limit'/)
})
