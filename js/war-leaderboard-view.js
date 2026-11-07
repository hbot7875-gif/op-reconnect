// War of Cards leaderboard markup — DOM-free, so Node tests render the exact
// table the sheet shows (js/war-leaderboard.js wires it up). Kept casual on
// purpose: rank, name, wins, games. The server still tracks more (streaks,
// win %); this board just doesn't show it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' }

/** The table for one getWarLeaderboard answer, with the viewer's own row
 *  after a gap when they sit below the top. */
export function boardHtml(res) {
  if (!res.rows?.length) {
    return `<p class="wl-empty">No wins ${res.period === 'week' ? 'this week yet' : 'yet'}. Win a game and you're on the board!</p>`
  }
  const row = (r) => `<li class="wl-row${MEDALS[r.position] ? ` is-top-${r.position}` : ''}${r.isMe ? ' is-me' : ''}">
      <span class="wl-pos">${MEDALS[r.position] ? `<span role="img" aria-label="Rank ${r.position}">${MEDALS[r.position]}</span>` : r.position}</span>
      <b class="wl-name">${esc(r.codename)}${r.isMe ? ' <small>(you)</small>' : ''}${champion(r)}</b>
      <span class="wl-num"><b>${r.wins}</b><small>wins</small></span>
      <span class="wl-num"><b>${r.played}</b><small>games</small></span>
    </li>`
  return `<ol class="wl-list" aria-labelledby="wl-title">${res.rows.map(row).join('')}</ol>
    ${res.me ? `<p class="wl-gap" aria-hidden="true">···</p><ol class="wl-list wl-mine" aria-label="Your rank">${row(res.me)}</ol>` : ''}`
}

/** The Card Champion badge beside a name: its own artwork when set. */
function champion(r) {
  if (!r.champion) return ''
  return r.championArt
    ? ` <img class="wl-champ" src="${esc(r.championArt)}" alt="Card Champion" title="Card Champion" decoding="async">`
    : ' <span class="wl-champ is-mark" role="img" aria-label="Card Champion" title="Card Champion">🏅</span>'
}
