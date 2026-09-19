import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// handlers.ts is Deno/TypeScript and cannot be imported into plain Node, so
// these guard the ORDERING CONTRACT at the source level instead. That is the
// part the Phase A parallelisation could plausibly break later: every
// dependency below is invisible in the type system and survives only because
// the awaits sit in a particular order.
const src = readFileSync(fileURLToPath(new URL('./handlers.ts', import.meta.url)), 'utf8')

function bodyOf(name) {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start > -1, `${name} not found`)
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error(`unterminated ${name}`)
}

/** The Promise.all(...) call sites in a function body, as source text. */
function parallelBlocks(body) {
  const blocks = []
  let from = 0
  for (;;) {
    const at = body.indexOf('Promise.all(', from)
    if (at === -1) return blocks
    let depth = 0
    for (let i = body.indexOf('(', at); i < body.length; i++) {
      if (body[i] === '(') depth++
      else if (body[i] === ')' && --depth === 0) { blocks.push(body.slice(at, i + 1)); from = i; break }
    }
    if (from <= at) return blocks
  }
}

test('getGameState batches its three independent reads and keeps the guard order', () => {
  const body = bodyOf('getGameState')
  const blocks = parallelBlocks(body)
  assert.equal(blocks.length, 1, 'expected exactly one Promise.all in getGameState')
  for (const call of ['loadContent(', 'getAgent(', 'getPlayer(']) {
    assert.ok(blocks[0].includes(call), `${call} should be in the batch`)
  }
  // An unknown agent must still lose to 'Agent not found' rather than
  // falling through to the not-joined payload.
  assert.ok(body.indexOf("error: 'Agent not found'") < body.indexOf('if (!player)'),
    'the agent guard must still precede the player guard')
})

test('buildState keeps every dependency that only ordering enforces', () => {
  const body = bodyOf('buildState')

  const chargeAt = body.indexOf('getAgentChargeView(')
  const pdAt = body.indexOf("from('rc_player_districts').select('*')")
  const rollupsAt = body.indexOf('ensureDailyRollups(')
  const bombAt = body.indexOf('getBombView(')
  for (const [name, at] of [['getAgentChargeView', chargeAt], ['pdRows', pdAt],
    ['ensureDailyRollups', rollupsAt], ['getBombView', bombAt]]) {
    assert.ok(at > -1, `${name} missing from buildState`)
  }

  // getAgentChargeView's blackout reset DELETEs from rc_player_districts,
  // so the read of that table has to see the deletes; it also has to keep
  // seeing PRE-rollup state, which both of these orderings preserve.
  assert.ok(chargeAt < pdAt, 'the district read must follow getAgentChargeView')
  assert.ok(pdAt < rollupsAt, 'rollups need goalXpScope from the district read')
  // A manual Sync must persist its listens before Red Zone reads its window.
  assert.ok(rollupsAt < bombAt, 'getBombView must follow ensureDailyRollups')
})

test('nothing that writes or refreshes shared state is run concurrently', () => {
  const blocks = parallelBlocks(bodyOf('buildState'))
  assert.ok(blocks.length >= 1, 'expected the Batch 1 Promise.all')
  const forbidden = [
    'rc_player_districts', 'ensureDailyRollups(', 'getBombView(',
    'awardBadge(', 'logFeedEvent(', 'rc_xp_ledger', 'rc_drop_district_item',
    'awardDailySideMissionXp(', 'awardWeeklySideMissionXp(', 'rc_add_resources',
  ]
  for (const block of blocks) {
    for (const needle of forbidden) {
      assert.ok(!block.includes(needle),
        `${needle} must stay sequential — found inside a Promise.all`)
    }
  }
})

test('the Batch 1 members are exactly the four independent reads', () => {
  const blocks = parallelBlocks(bodyOf('buildState'))
  const batch = blocks.find((b) => b.includes('getAgentChargeView('))
  assert.ok(batch, 'Batch 1 not found')
  for (const call of ['getAgentChargeView(', 'getEraTimeline(', 'getMyInvites(', 'getReconnectMatchAlerts(']) {
    assert.ok(batch.includes(call), `${call} should be in Batch 1`)
  }
  // Each appears once: a duplicated call would double any side effect the
  // branch has (getAgentChargeView writes).
  for (const call of ['getAgentChargeView(', 'getEraTimeline(']) {
    assert.equal(batch.split(call).length - 1, 1, `${call} should appear once`)
  }
})
