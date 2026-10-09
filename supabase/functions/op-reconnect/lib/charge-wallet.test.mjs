// One balance, from the database, rendered everywhere.
//
// Reported by AGENT047: "it says 4+ cells added, 8+ added, I see them in my
// bag pack, but when I go to charge my army bomb it says 0, and when I
// refresh those 10 to 13 cells get vanished."
//
// Nothing was removing cells. buildState rendered the wallet three ways in
// one response: getAgentChargeView read rc_players.charge_cells early (W),
// creditChargeCells then credited D, and the Pack was handed
// `player.charge_cells + D` — arithmetic on a row fetched before the credit.
// So the Pack said W+D while the ARMY Bomb said W, and because the Pack's
// number was reconstructed rather than read, two overlapping polls could
// report W+D and then W, which looks exactly like cells vanishing.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { resolveWalletCells } from './charge-economy.ts'

const credited = (delta, balance) => ({ delta, balance })

test('the database balance wins whenever the database spoke', () => {
  // The charge view read 0 before the credit landed; the RPC says 4.
  assert.equal(resolveWalletCells(0, credited(4, 4)), 4)
  // Even when this call credited nothing, a balance it read is still truth.
  assert.equal(resolveWalletCells(0, credited(0, 4)), 4)
})

test('a stale view only stands when the database never answered', () => {
  // balance null means the RPC was not reached: no active district, no album
  // goals, or it errored. Nothing moved after the view read, so it holds —
  // including any auto-feed the view itself spent.
  assert.equal(resolveWalletCells(7, credited(0, null)), 7)
  assert.equal(resolveWalletCells(0, credited(0, null)), 0)
})

test('zero is a real balance, not a missing one', () => {
  // The bug in miniature: treating 0 as "no information" and falling back to
  // a stale number is how a spent wallet keeps showing cells that are gone.
  assert.equal(resolveWalletCells(5, credited(0, 0)), 0)
})

test('two overlapping polls cannot make the balance go backwards', () => {
  // The exact race. Both polls read the wallet at 0 before either credited;
  // poll A credits 4, poll B then finds nothing left to credit. Before the
  // fix poll B answered `its own stale 0 + its own delta 0` = 0, so a refresh
  // landing on B showed the cells gone. Now the RPC hands B the real balance.
  const wallet = { cells: 0, awarded: 0 }
  // Both polls snapshot the wallet early, as getAgentChargeView does.
  const viewA = wallet.cells
  const viewB = wallet.cells

  // The RPC, which is the only thing holding the row lock. Returns the true
  // balance whether or not it credits, which is the property that fixes this.
  const rpc = (earned) => {
    if (earned > wallet.awarded) {
      const delta = earned - wallet.awarded
      wallet.awarded = earned
      wallet.cells += delta
      return credited(delta, wallet.cells)
    }
    return credited(0, wallet.cells)
  }

  const a = resolveWalletCells(viewA, rpc(4))
  const b = resolveWalletCells(viewB, rpc(4))

  assert.equal(a, 4, 'the crediting poll reports 4')
  assert.equal(b, 4, 'the overlapping poll must also report 4, not its stale 0')
  assert.ok(b >= a, 'no ordering of two polls may report a smaller balance')
  assert.equal(wallet.cells, 4, 'and the wallet was credited exactly once')
})

test('replaying any interleaving of N polls never dips below the last answer', () => {
  // Generalised: whatever order the snapshots and RPC calls interleave in,
  // the sequence of rendered balances must be non-decreasing while only
  // credits are happening.
  const wallet = { cells: 0, awarded: 0 }
  const rpc = (earned) => {
    if (earned > wallet.awarded) {
      const delta = earned - wallet.awarded
      wallet.awarded = earned
      wallet.cells += delta
      return credited(delta, wallet.cells)
    }
    return credited(0, wallet.cells)
  }
  const snapshots = [0, 0, 0, 0, 0]       // every poll read the wallet at 0
  const earnedSeq = [2, 2, 5, 5, 9]       // streams keep arriving
  let last = 0
  for (let i = 0; i < snapshots.length; i++) {
    const shown = resolveWalletCells(snapshots[i], rpc(earnedSeq[i]))
    assert.ok(shown >= last, `poll ${i} rendered ${shown} after ${last}`)
    last = shown
  }
  assert.equal(last, 9)
  assert.equal(wallet.cells, 9, 'credited once per increase, never twice')
})

// ── the structural half: nobody may reconstruct a balance again ──────────

test('no surface rebuilds the wallet by adding a delta to an earlier read', () => {
  const handlers = readFileSync(new URL('./handlers.ts', import.meta.url), 'utf8')
  const code = handlers.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // The exact expression that caused this.
  assert.ok(!/charge_cells\s*\|\|\s*0\s*\)\s*\+\s*chargeCellsEarnedNow/.test(code),
    'chargeCells must not be player.charge_cells + the delta')
  assert.ok(!/chargeCells:\s*\(?player\.charge_cells/.test(code),
    'chargeCells must not be read off the pre-credit player row at all')

  // Both surfaces take the resolved balance.
  assert.match(code, /walletCells = resolveWalletCells\(walletCells, credited\)/)
  assert.match(code, /chargeCells:\s*walletCells/)
  // The charge view's own stale figure is overridden for the response, and
  // its derived "fed so far" moves with it rather than contradicting it.
  assert.match(code, /chargeCellsSpent:\s*Math\.max\(0,\s*agentCharge\.chargeCellsEarned\s*-\s*walletCells\)/)

  // The delta survives only as the toast.
  assert.match(code, /earnedNow:\s*chargeCellsEarnedNow/)
})

test('the credit RPC is always asked, so the balance is never guessed', () => {
  const economy = readFileSync(new URL('./charge-economy.ts', import.meta.url), 'utf8')
  const code = economy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  // The early exit that skipped the only call that knows the balance.
  assert.ok(!/if\s*\(earned\s*<=\s*\(?activePd\.charge_cells_awarded/.test(code),
    'must not short-circuit before asking the database for the balance')
  assert.match(code, /supabase\.rpc\('rc_credit_charge_cells'/)
})

test('the RPC result is read tolerantly, so deploy order cannot drop a credit', () => {
  const economy = readFileSync(new URL('./charge-economy.ts', import.meta.url), 'utf8')
  // Pre-migration the function returned a bare integer; after it, a row.
  assert.match(economy, /typeof data === 'number'/)
  assert.match(economy, /Array\.isArray\(data\)/)
})
