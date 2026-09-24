import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('js/settings-streams.js', 'utf8')
const selfCheck = readFileSync('supabase/functions/op-reconnect/lib/signal-log.ts', 'utf8')

test('Stats.fm partial history is explained and never gets a mode-fit verdict', () => {
  assert.match(ui, /Partial Stats\.fm history/)
  assert.match(ui, /latest 50 streams each time you sync/)
  assert.match(ui, /res\.mode && !res\.partialHistory/)
})

test('Stats.fm self-checks suppress repeat judgments on incomplete sequences', () => {
  assert.match(selfCheck, /partialHistory = streamSource === 'statsfm'/)
  assert.match(selfCheck, /trustSequence: !partialHistory/)
})
