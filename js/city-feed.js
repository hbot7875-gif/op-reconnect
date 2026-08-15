// Live City Feed / "City News" — "other agents are here right now."
//
// ReConnect is solo + 1:1 pairing by design (see handlers.ts/feed.ts's own
// header comments — teams were deliberately removed). This is the
// replacement for the ambient "other people are doing things" feeling that
// went away with them: one line at a time, fading in and out, folded into
// the normal ~90s poll (state.cityFeed) same as broadcasts.
//
// Deliberately: only codenames, never agent numbers — the agent number is
// the secret half of an agent's identity (onboarding explicitly warns never
// to reveal it), the codename is the public half everyone already sees on
// Rankings. feed.ts's getCityFeed() resolves codenames server-side; nothing
// here ever touches agent_no. Also excludes anything js/share.js already
// treats as unleakable — no district names, no old-agent "Guardian"
// handles, no memory text.
//
// One shared page-life ticker (same "one interval, no-op if nothing on
// screen matches" shape as countdown.js) advances every .feed-ticker node
// in the DOM — no per-render setInterval/clearInterval bookkeeping needed.

import { el, esc } from './state.js'

const ROTATE_MS = 4500
const FADE_MS = 350

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.max(0, Math.floor(ms / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function lineFor(entry) {
  const who = esc(entry.codename)
  switch (entry.eventType) {
    case 'district_restored':
      return `${who} restored an area`
    case 'ward_progress': {
      const p = entry.payload || {}
      if (!p.wardName || !p.totalCount) return null
      return `${esc(p.wardName)} reached ${p.restoredCount}/${p.totalCount} restored`
    }
    case 'ward_completed': {
      const p = entry.payload || {}
      return p.wardName ? `${esc(p.wardName)} fully restored` : null
    }
    case 'level_up':
      return `${who} reached Level ${entry.payload?.level ?? '?'}`
    case 'side_mission_daily':
      return `${who} completed today's Signal Sweep`
    case 'side_mission_weekly':
      return `${who} completed the weekly Signal Sweep`
    case 'bomb_fed': {
      const hours = entry.payload?.hoursAdded
      return hours ? `${who} fed their Army Bomb (+${hours}h)` : null
    }
    case 'streak_badge': {
      const days = entry.payload?.days
      return days ? `${who} hit a ${days}-day streak` : null
    }
    case 'reconnect_completed': {
      const partner = entry.payload?.partnerCodename
      return partner ? `${who} and ${esc(partner)} completed a ReConnect` : null
    }
    case 'era_lit': {
      const era = entry.payload?.eraName
      return era ? `${who} lit up ${esc(era)}` : null
    }
    case 'item_dropped': {
      const rarity = entry.payload?.rarity
      return rarity ? `${who} found a ${esc(rarity)} item` : `${who} found an item`
    }
    case 'ticket_claimed':
      return `${who} claimed a Ticket`
    default:
      return null
  }
}

/** A one-line "City News" ticker — a single headline that fades out and is
 *  replaced by the next, instead of an ever-growing list. Empty (childless)
 *  when there's nothing yet, so callers can append it unconditionally. */
export function cityFeedCard(state) {
  const wrap = el('div', 'feed-card')
  const entries = (state.cityFeed || [])
    .map((entry) => ({ text: lineFor(entry), time: timeAgo(entry.createdAt) }))
    .filter((row) => row.text)

  // "N agents are waiting for a partner" — a live aggregate rather than a
  // logged event (see handlers.ts), so it's built here each render and
  // pinned FIRST: it's the one line in this ticker that's a standing ask
  // rather than something that already happened, and it's the only one a
  // reader can act on right now.
  const waiting = Number(state.waitingAgents) || 0
  if (waiting > 0) {
    entries.unshift({
      text: waiting === 1
        ? '1 agent is waiting for a partner'
        : `${waiting} agents are waiting for a partner`,
      time: 'now',
    })
  }
  if (!entries.length) return wrap

  wrap.appendChild(el('div', 'feed-eyebrow', 'CITY NEWS'))
  const ticker = el('div', 'feed-ticker')
  ticker._entries = entries
  ticker._index = 0
  paintTickerLine(ticker)
  wrap.appendChild(ticker)
  return wrap
}

function paintTickerLine(ticker) {
  const row = ticker._entries[ticker._index]
  ticker.innerHTML = `<span class="feed-text">${row.text}</span><span class="feed-time">${row.time}</span>`
}

function tickFeedTickers() {
  if (document.hidden) return
  for (const ticker of document.querySelectorAll('.feed-ticker')) {
    if (!ticker._entries || ticker._entries.length < 2) continue
    ticker.classList.add('is-fading')
    setTimeout(() => {
      ticker._index = (ticker._index + 1) % ticker._entries.length
      paintTickerLine(ticker)
      ticker.classList.remove('is-fading')
    }, FADE_MS)
  }
}

setInterval(tickFeedTickers, ROTATE_MS)
