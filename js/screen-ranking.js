// Rankings — codename, level and XP for every agent, split by streaming
// mode. Modes scale both goal targets AND the streams-per-XP rate
// (screen-settings.js: "bigger targets and slower XP per goal stream" — 10/20/30
// streams per XP on easy/medium/hard), so a six-account hard-mode agent and
// a one-device easy-mode agent are playing different games in two ways now,
// not directly comparable. Each mode gets its own board; "All" is for
// bragging rights only and says so.

import { call } from './api.js'
import { el, esc } from './state.js'
import { getAgentNo } from './session.js'
import { badgeById } from './badges.js'

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
]

let cache = null
let activeTab = 'all'

export function renderRanking(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'rank-screen')

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">🏆 Rankings</span>
    <span class="pack-name">Who's leading the network</span>
  `))

  const tabs = el('div', 'rank-tabs')
  for (const t of TABS) {
    const btn = el('button', 'rank-tab' + (activeTab === t.key ? ' sel' : ''), esc(t.label))
    btn.onclick = () => { activeTab = t.key; renderRanking(container, state) }
    tabs.appendChild(btn)
  }
  wrap.appendChild(tabs)

  const body = el('div', 'rank-body')
  wrap.appendChild(body)
  container.appendChild(wrap)

  if (cache) paintList(body, cache, state)
  else body.appendChild(el('p', 'muted', 'Reading the network…'))

  call('getLeaderboard', { agentNo: getAgentNo() }).then((res) => {
    if (!res.success) {
      body.innerHTML = ''
      body.appendChild(el('p', 'muted', esc(res.error || "Couldn't reach the network")))
      return
    }
    cache = res.agents
    paintList(body, cache, state)
  })
}

function paintList(body, agents, state) {
  body.innerHTML = ''
  const mine = state?.player?.codename

  const rows = activeTab === 'all' ? agents : agents.filter((a) => a.mode === activeTab)
  if (!rows.length) {
    body.appendChild(el('p', 'muted', activeTab === 'all'
      ? 'No agents on the board yet.'
      : `Nobody's playing ${MODE_LABEL[activeTab] || activeTab} yet. Switch modes in the header to claim it.`))
    return
  }

  const list = el('div', 'rank-list')
  rows.forEach((a, i) => {
    const place = i + 1
    const badge = badgeById(a.equippedBadgeId)
    const row = el('div', 'rank-row'
      + (a.codename === mine ? ' is-me' : '')
      + (place <= 3 ? ' is-top' : ''))
    row.innerHTML = `
      <span class="rank-place">${place <= 3 ? MEDAL[place] : place}</span>
      <span class="rank-agent-icon">${badge ? badge.icon : '⟭⟬'}</span>
      <span class="rank-main">
        <span class="rank-name">${esc(a.codename)}</span>
        <span class="rank-sub">Level ${a.level}${activeTab === 'all' ? ` · ${esc(MODE_LABEL[a.mode] || a.mode)}` : ''}</span>
      </span>
      <span class="rank-xp">${a.xp.toLocaleString()} <span class="rank-xp-unit">XP</span></span>
    `
    list.appendChild(row)
  })
  body.appendChild(list)

  // A board with one name on it under the heading "Who's leading the network"
  // reads as broken rather than early. Say the true and better version of it:
  // being first here is a real thing, and it's the state the game starts in.
  if (rows.length === 1) {
    const alone = rows[0].codename === mine
    body.appendChild(el('div', 'dim rank-hint', alone
      ? "You're the first agent on this board. Everyone who signs up after you starts below this line."
      : 'One agent on the board so far. Plenty of room at the top.'))
    return
  }

  if (activeTab === 'all') {
    body.appendChild(el('div', 'dim rank-hint',
      'Modes trade account count for bigger targets, not more XP — the All board is for bragging rights. Switch to Easy, Medium or Hard for an apples-to-apples ranking.'))
  }
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }
const MODE_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
