// Magic Shop — BOTZ redesign Phase 2's first real currency sink. Shows
// Charge Cells (not spendable yet — Phase 3 is what feeds them into the
// per-agent ARMY Bomb), and sells Wings (bought with XP) plus a one-time
// Ticket (unlocked by a level/district/XP bar). BTS merch is a "coming
// soon" placeholder — no catalog or pricing exists for it yet.

import { call } from './api.js'
import { el, esc, toast, hideOverlay, showOverlay } from './state.js'
import { getAgentNo } from './session.js'

function statTile(icon, label, value) {
  return el('div', 'ms-stat', `<span class="ms-stat-icon">${icon}</span><span class="ms-stat-value">${value}</span><span class="ms-stat-label">${esc(label)}</span>`)
}

async function loadAndPaint(body) {
  body.innerHTML = '<p class="muted">Opening the shop…</p>'
  const res = await call('getMagicShop', { agentNo: getAgentNo() })
  if (!res.success) {
    body.innerHTML = ''
    body.appendChild(el('p', 'muted', esc(res.error || "Couldn't reach the shop")))
    return
  }
  paint(body, res.shop)
}

function paint(body, shop) {
  body.innerHTML = ''

  const stats = el('div', 'ms-stats')
  stats.append(
    statTile('⚡', 'Charge Cells', shop.chargeCells),
    statTile('🪽', 'Wings', shop.wings),
    statTile('🎟️', 'Tickets', shop.tickets),
  )
  body.appendChild(stats)
  body.appendChild(el('p', 'muted ms-note', 'Charge Cells will feed the ARMY Bomb once its per-agent charge system ships — for now they just accrue from your album-goal streams.'))

  // ── Wings ──
  const wingsCard = el('div', 'ms-card')
  wingsCard.innerHTML = `
    <div class="ms-card-head"><span class="ms-card-icon">🪽</span><span class="ms-card-title">Wings</span></div>
    <p class="ms-card-body">Up to 3 a day, ${shop.wingsCostXp} XP for the lot. Spend them on the Candy Star Generator.</p>
  `
  const buyBtn = el('button', 'btn btn-primary', shop.wingsAvailableToday > 0 ? `Buy ${shop.wingsAvailableToday} Wings — ${shop.wingsCostXp} XP` : 'Come back tomorrow')
  buyBtn.disabled = shop.wingsAvailableToday <= 0
  buyBtn.onclick = async () => {
    buyBtn.disabled = true
    const res = await call('buyWings', { agentNo: getAgentNo() })
    if (!res.success) {
      toast(res.error === 'not_enough_xp' ? "Not enough XP" : res.error === 'daily_limit_reached' ? "Already bought today's Wings" : (res.error || "Couldn't buy Wings"))
      buyBtn.disabled = false
      return
    }
    toast(`+${res.wingsGranted} Wings`)
    loadAndPaint(body)
  }
  wingsCard.appendChild(buyBtn)
  body.appendChild(wingsCard)

  // ── Ticket ──
  const t = shop.ticket
  const ticketCard = el('div', 'ms-card')
  ticketCard.innerHTML = `
    <div class="ms-card-head"><span class="ms-card-icon">🎟️</span><span class="ms-card-title">Ticket</span></div>
    <p class="ms-card-body">Needs Level ${t.requirement.level}+, ${t.requirement.districtsRestored} districts restored, ${t.requirement.xp} XP.
      You're at Level ${t.progress.level}, ${t.progress.districtsRestored} restored, ${t.progress.xp} XP.</p>
  `
  if (t.claimed) {
    ticketCard.appendChild(el('div', 'dim', '✓ Already claimed'))
  } else {
    const claimBtn = el('button', 'btn btn-primary', t.eligible ? 'Claim your Ticket' : 'Not eligible yet')
    claimBtn.disabled = !t.eligible
    claimBtn.onclick = async () => {
      claimBtn.disabled = true
      const res = await call('claimTicket', { agentNo: getAgentNo() })
      if (!res.success) { toast(res.error || "Couldn't claim it"); claimBtn.disabled = false; return }
      toast('Ticket claimed')
      loadAndPaint(body)
    }
    ticketCard.appendChild(claimBtn)
  }
  body.appendChild(ticketCard)

  // ── Merch (coming soon) ──
  body.appendChild(el('div', 'ms-card dim', `
    <div class="ms-card-head"><span class="ms-card-icon">🛍️</span><span class="ms-card-title">BTS Merch</span></div>
    <p class="ms-card-body">Coming soon.</p>
  `))
}

export function magicShopSheet() {
  const sheet = el('div', 'sheet magic-shop')
  sheet.appendChild(el('div', 'eyebrow', '🏪 MAGIC SHOP'))
  const body = el('div', 'ms-body')
  sheet.appendChild(body)
  loadAndPaint(body)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

export function openMagicShop() {
  showOverlay(magicShopSheet())
}
