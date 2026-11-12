// Supabase records a migration by its version (the timestamp before the first
// underscore) alone. Two files with one version means the second is taken for
// already applied and never runs — which happened on 2026-11-12 when two
// branches both picked 20261112120000.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'

test('every migration has its own version', () => {
  const files = readdirSync(new URL('./migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'))
  const byVersion = new Map()
  for (const f of files) {
    const v = f.split('_')[0]
    assert.match(v, /^\d{14}$/, `${f}: version must be a 14-digit timestamp`)
    byVersion.set(v, [...(byVersion.get(v) || []), f])
  }
  const dupes = [...byVersion.values()].filter((list) => list.length > 1)
  assert.deepEqual(dupes, [], `migrations sharing a version: ${JSON.stringify(dupes)}`)
})
