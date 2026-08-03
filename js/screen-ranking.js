// Rankings — codename, level and XP for every agent, split by streaming
// mode. Modes aren't a difficulty score (screen-settings.js: "bigger targets,
// same XP per stream"), but they're still not directly comparable — a
// six-account hard-mode agent and a one-device easy-mode agent are playing
// different games, so ranking them against each other would just reward
// account count. Each mode gets its own board; "All" is for bragging rights
// only and says so.

import { call } from './api.js'
import { el, esc } from './state.js'
import { getAgentNo } from './session.js'

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
    body.appendChild(el('p', 'muted', 'No agents on this board yet.'))
    return
  }

  const list = el('div', 'rank-list')
  rows.forEach((a, i) => {
    const place = i + 1
    const row = el('div', 'rank-row'
      + (a.codename === mine ? ' is-me' : '')
      + (place <= 3 ? ' is-top' : ''))
    row.innerHTML = `
      <span class="rank-place">${place <= 3 ? MEDAL[place] : place}</span>
      <span class="rank-main">
        <span class="rank-name">${esc(a.codename)}</span>
        <span class="rank-sub">Level ${a.level}${activeTab === 'all' ? ` · ${esc(MODE_LABEL[a.mode] || a.mode)}` : ''}</span>
      </span>
      <span class="rank-xp">${a.xp.toLocaleString()} <span class="rank-xp-unit">XP</span></span>
    `
    list.appendChild(row)
  })
  body.appendChild(list)

  if (activeTab === 'all') {
    body.appendChild(el('div', 'dim rank-hint',
      'Modes trade account count for bigger targets, not more XP — the All board is for bragging rights. Switch to Easy, Medium or Hard for an apples-to-apples ranking.'))
  }
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' }
const MODE_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
