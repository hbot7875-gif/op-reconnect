// The share card.
//
// Wordle's real trick wasn't the game, it was a spoiler-free grid people
// wanted to post. The equivalent here is already sitting on screen: a ward's
// skyline is one square per district, so it renders in emoji with nothing
// invented — 🟪 the one you're restoring, 🟨 the ones you brought back, ⬛ the
// ones still dark. It maps onto the palette the game already uses.
//
// Nothing here leaks a district name, a guardian handle, or a memory. It's
// shape and counts only, so posting it can't spoil the lore for anyone.

import { el, esc, hideOverlay, toast } from './state.js'

const LIT = '🟨'
const NOW = '🟪'
const DARK = '⬛'
const ROW = 13

function square(d) {
  if (!d) return DARK
  if (d.status === 'restored' || d.status === 'centerpiece_lit') return LIT
  if (d.status === 'active') return NOW
  return DARK
}

function grid(stops) {
  const cells = stops.map(square)
  const rows = []
  for (let i = 0; i < cells.length; i += ROW) rows.push(cells.slice(i, i + ROW).join(''))
  return rows.join('\n')
}

/** The card, as plain text. Deliberately short — long posts don't get posted. */
export function buildShareText(state) {
  const wards = state.map?.wards || []
  const districts = state.map?.districts || []
  // The codename is the public half of an agent's identity (the number is the
  // secret half), so it's safe to sign the card with — and it's how agents
  // recognise each other's posts.
  const codename = state.player?.codename
  const lines = [codename ? `OP: RECONNECT — ${codename}` : 'OP: RECONNECT', '']

  // Prefer the ward being worked on; fall back to the furthest one along.
  const ward = wards.find((w) => w.status === 'active')
    || wards.find((w) => w.status === 'available')
    || wards.find((w) => w.status === 'restored')

  if (ward) {
    const stops = districts.filter((d) => d.wardId === ward.id)
    lines.push(`${ward.name} — ${ward.restoredCount}/${ward.totalCount} restored`)
    if (stops.length) lines.push(grid(stops))
    lines.push('')
  }

  if (state.bomb?.defuse) lines.push('🟥 RED ZONE — the network is under attack')

  const total = wards.reduce((a, w) => a + (w.totalCount || 0), 0)
  const done = wards.reduce((a, w) => a + (w.restoredCount || 0), 0)
  const bits = []
  if (total) bits.push(`City recovery ${Math.round((done / total) * 100)}%`)
  const streak = state.player?.streak?.current
  if (streak) bits.push(`🔥 ${streak}`)
  if (bits.length) lines.push(bits.join(' · '))

  // Resolves correctly whether this is the game page or a preview file.
  try { lines.push(new URL('index.html', location.href).href) } catch {}

  return lines.join('\n')
}

export function openShare(state) {
  const text = buildShareText(state)
  const sheet = el('div', 'sheet share')

  sheet.appendChild(el('div', 'eyebrow', 'SHARE YOUR CITY'))
  sheet.appendChild(el('div', 'share-title', 'Nothing spoiled'))
  sheet.appendChild(el('p', 'muted share-note',
    'Squares only — no district names, no guardians, no memories. Safe to post.'))

  const pre = el('pre', 'share-card')
  pre.textContent = text
  sheet.appendChild(pre)

  // navigator.share is the good path on a phone: straight into the app the
  // agent actually posts from. Clipboard is the desktop fallback.
  const canShare = typeof navigator.share === 'function'
  const primary = el('button', 'btn btn-primary', canShare ? 'Share' : '📋 Copy')
  primary.onclick = async () => {
    if (canShare) {
      try {
        await navigator.share({ text })
        return
      } catch (e) {
        if (e?.name === 'AbortError') return   // they changed their mind
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied — go post it')
    } catch {
      toast('Couldn\'t copy — select the card and copy it')
    }
  }
  sheet.appendChild(primary)

  if (canShare) {
    const copy = el('button', 'btn btn-ghost', '📋 Copy instead')
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(text); toast('Copied — go post it') }
      catch { toast('Couldn\'t copy — select the card and copy it') }
    }
    sheet.appendChild(copy)
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
