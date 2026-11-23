// placeItem refuses Backup Passes / utility items on a shelf, always lets
// anything go back to the Pack, and never touches other rows.
import assert from 'node:assert/strict'
import test from 'node:test'
import { placeItem, isPlaceableItem } from './items.ts'

function db(rows) {
  const writes = []
  const from = () => {
    const f = {}
    let update = null
    const q = {
      select() { return q }, eq(c, v) { f[c] = v; return q }, maybeSingle() { return q },
      update(u) { update = u; return q },
      then(ok) {
        const row = rows.find((r) => r.id === f.id && r.agent_no === f.agent_no) || null
        if (update) { if (row) { writes.push({ id: row.id, ...update }); Object.assign(row, update) } return Promise.resolve({ data: row ? { id: row.id } : null, error: null }).then(ok) }
        return Promise.resolve({ data: row ? { item_id: row.item_id, rc_items: { kind: row.kind } } : null, error: null }).then(ok)
      },
    }
    return q
  }
  return { from, writes }
}

test('what can go on a shelf', () => {
  assert.equal(isPlaceableItem({ itemId: 'backup-pass', kind: 'utility' }), false)
  assert.equal(isPlaceableItem({ itemId: 'ticket-voyage', kind: 'ticket' }), true, 'tickets are keepsakes')
  assert.equal(isPlaceableItem({ itemId: 'album-be', kind: 'album' }), true)
})

test('a Backup Pass is refused; going back to the Pack always works', async () => {
  const rows = [
    { id: 'bp', agent_no: 'A1', item_id: 'backup-pass', kind: 'utility', district_id: 'old-district' },
    { id: 'be', agent_no: 'A1', item_id: 'album-be', kind: 'album', district_id: null },
  ]
  const d = db(rows)
  assert.deepEqual(await placeItem(d, { agentNo: 'a1', playerItemId: 'bp', districtId: 'mono-0' }), { success: false, error: 'not_placeable' })
  assert.equal(d.writes.length, 0)
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'bp', districtId: null }), { success: true }, 'an already-placed pass can come home')
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'be', districtId: 'mono-0' }), { success: true })
  assert.deepEqual(d.writes, [{ id: 'bp', district_id: null }, { id: 'be', district_id: 'mono-0' }])
  assert.deepEqual(await placeItem(d, { agentNo: 'A2', playerItemId: 'be', districtId: 'mono-0' }), { success: false, error: 'item_not_found' }, 'only your own items')
})
