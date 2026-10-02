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
  // Names the pattern instead of the person. "played too close" read as a
  // verdict on the player, and after the Stats.fm duplicate audit it was
  // landing on people whose only mistake was listening once.
  assert.match(ui, /repeated-play pattern/)
  assert.doesNotMatch(ui, /played too close/)
  assert.doesNotMatch(ui, /Your own police check/)
  assert.doesNotMatch(ui, />\d* flagged</)
})

test('a duplicate the source reported twice is explained, not silently dropped', () => {
  // A collapsed row set must never read as lost history.
  assert.match(ui, /ingestionDuplicates/)
  assert.match(ui, /duplicate stream\$\{dupes === 1 \? '' : 's'\} set aside/)
  assert.match(ui, /Nothing was removed from your history or your totals/)
  assert.match(selfCheck, /ingestionDuplicates: countIngestionDuplicates\(rows\)/)
})

test('every incomplete provider sequence suppresses repeat judgments', () => {
  assert.match(selfCheck, /partialHistory = !streamResult\.ok \|\| !streamResult\.complete/)
  assert.match(selfCheck, /trustSequence: !partialHistory/)
  assert.match(streams, /partialReason: 'provider_error'/)
  assert.match(streams, /partialReason: complete \? null : 'page_limit'/)
  assert.match(streams, /partialReason = provider\.ok \? 'recent_limit' : 'provider_error'/)
  assert.match(streams, /partialReason: 'database_limit'/)
})
