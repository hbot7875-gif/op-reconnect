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
    let single = false
    const q = {
      select() { return q }, eq(c, v) { f[c] = v; return q }, maybeSingle() { single = true; return q },
      update(u) { update = u; return q },
      then(ok) {
        if (!single && !update) {
          const list = rows.filter((r) => r.agent_no === f.agent_no && r.district_id === f.district_id)
          return Promise.resolve({ data: list.map((r) => ({ id: r.id, item_id: r.item_id, rc_items: { kind: r.kind } })), error: null }).then(ok)
        }
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

test("ARMY's Corner: 7 per district, every placed collectible counts, existing ones untouched", async () => {
  const kinds = ['album', 'album', 'apparel', 'ticket', 'banner', 'magnet', 'mug']   // copies + kinds the scene doesn't draw
  const rows = kinds.map((kind, i) => ({ id: `p${i}`, agent_no: 'A1', item_id: i < 2 ? 'album-be' : `x${i}`, kind, district_id: 'mono-0' }))
  rows.push({ id: 'bp', agent_no: 'A1', item_id: 'backup-pass', kind: 'utility', district_id: 'mono-0' })   // an old pass doesn't take a slot
  rows.push({ id: 'new', agent_no: 'A1', item_id: 'pc-arirang', kind: 'photocard', district_id: null })
  const d = db(rows)
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'new', districtId: 'mono-0' }), { success: false, error: 'district_full', limit: 7 })
  assert.equal(d.writes.length, 0, 'nothing written, nothing already placed moved')
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'new', districtId: 'mono-1' }), { success: true }, 'another district is fine')
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'p0', districtId: null }), { success: true }, 'Move to Pack always works')
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'new', districtId: 'mono-0' }), { success: true }, 'room again after one leaves')
  // Re-placing an item into the district it's already in never counts itself.
  assert.deepEqual(await placeItem(d, { agentNo: 'A1', playerItemId: 'p1', districtId: 'mono-0' }), { success: true })
})
