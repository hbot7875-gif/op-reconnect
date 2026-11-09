// PC Giveaway — admin review page (giveaway-admin.html). Admin key only.
// Shows the review list, freezes exactly what was reviewed, and opens the
// recording view in test or official mode. It never shows a winner before
// the official draw has been stored, because none exists until then.
import { API_URL } from './api.js'

const $ = (id) => document.getElementById(id)
const KEY = 'rc_admin_key'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }) : '—')
const ERRORS = {
  Unauthorized: 'Admin key rejected.',
  giveaway_locked: 'The list is frozen and can no longer change.',
  list_changed_review_again: 'The list was refreshed since you loaded it. Review it again before freezing.',
  count_mismatch: 'The number of eligible members changed. Review again.',
  no_eligible_members: 'Nobody is eligible yet.',
  already_drawn: 'The official winner has already been drawn.',
  not_frozen: 'Freeze the list first.',
}
const say = (id, text, kind = '') => { $(id).textContent = text; $(id).className = `msg ${kind}` }
const errText = (r) => ERRORS[r?.error] || `Something went wrong (${r?.error || 'network error'}).`

let state = null

try { $('adminKey').value = localStorage.getItem(KEY) || '' } catch { /* storage unavailable */ }
$('adminKey').addEventListener('input', () => { try { localStorage.setItem(KEY, $('adminKey').value.trim()) } catch { /* */ } })

async function call(action, extra = {}) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-2' },
      body: JSON.stringify({ action, adminKey: $('adminKey').value.trim(), ...extra }),
    })
    return await res.json()
  } catch { return { success: false, error: 'network error' } }
}

function render() {
  const g = state.giveaway
  for (const id of ['secSetup']) $(id).hidden = false
  const teamSel = $('team')
  teamSel.innerHTML = state.teams.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}${t.id === state.suggestedTeam ? ' (won the battle)' : ''}</option>`).join('')
  teamSel.value = g?.team || state.suggestedTeam || state.teams[0]?.id || ''
  teamSel.disabled = !!g && g.status !== 'draft'
  $('btnPrepare').disabled = !!g && g.status !== 'draft'
  $('status').innerHTML = g ? `<span class="pill ${g.status}">${g.status}</span>` : '<span class="pill draft">not prepared</span>'

  if (!g) { $('stats').hidden = true; for (const id of ['secList', 'secFreeze', 'secDraw', 'secRecord']) $(id).hidden = true; return }

  const list = g.candidates || []
  const eligible = list.filter((c) => c.eligible)
  const r = g.rules || {}
  $('stats').hidden = false
  $('stats').innerHTML = [
    ['Winning team', g.team_label], ['Team members', list.length], ['Eligible', eligible.length],
    ['Battle days', `${g.window_start} → ${g.window_end}`, 'small'],
    ['List prepared', fmt(g.prepared_at), 'small'],
    ['Rule', `Verified Mnet screenshots on ≥ ${r.vote_num}/${r.vote_den} and any recorded streaming on ≥ ${r.stream_num}/${r.stream_den} of the days each member was on the team. Duplicate plays from a second source don't add days.`, 'small wide'],
  ].map(([k, v, cls = '']) => `<div class="stat ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')

  $('secList').hidden = false
  const only = $('onlyEligible').checked
  $('rows').innerHTML = list.filter((c) => !only || c.eligible).map((c) => `
    <tr class="${c.eligible ? 'yes' : 'no'}">
      <td>${esc(c.display)}</td><td>${esc(c.agent_no)}</td><td>${esc(c.joined)} (${c.days} days)</td>
      <td>${c.vote_days}/${c.days} · needs ${c.vote_need}</td><td>${c.stream_days}/${c.days} · needs ${c.stream_need}</td>
      <td class="reason">${esc(c.reason)}</td>
    </tr>`).join('')

  $('secFreeze').hidden = false
  if (g.status === 'draft') {
    $('freezeText').textContent = `Freezing locks these ${eligible.length} eligible members onto the wheel, one equal entry each. After this the list can't change.`
    $('btnFreeze').disabled = eligible.length === 0
  } else {
    $('freezeText').innerHTML = `Frozen ${esc(fmt(g.frozen_at))} with ${(g.entries || []).length} entries. Fingerprint: <code>${esc(g.entries_hash)}</code>`
    $('btnFreeze').disabled = true
  }

  $('secDraw').hidden = false
  $('btnOfficial').disabled = g.status === 'draft'
  $('btnOfficial').textContent = g.status === 'drawn' ? 'Open official result' : 'Open official draw view'

  $('secRecord').hidden = !state.draw
  if (state.draw) {
    const d = state.draw
    $('record').innerHTML = `<p><b>Winner:</b> ${esc(d.winner_display)} (${esc(d.winner_agent_no)})<br>
      <b>Drawn:</b> ${esc(fmt(d.drawn_at))}<br><b>Entries:</b> ${d.entry_count}, winner was entry #${d.winner_index + 1}<br>
      <b>Random value:</b> ${esc(d.random_value)}<br><b>List fingerprint:</b> <code>${esc(d.entries_hash)}</code></p>`
  }
}

async function load() {
  say('keyMsg', 'Loading…')
  const r = await call('adminGiveawayGet')
  if (!r.success) return say('keyMsg', errText(r), 'bad')
  say('keyMsg', 'Key accepted.', 'ok')
  state = r
  render()
}

$('btnLoad').addEventListener('click', load)
$('onlyEligible').addEventListener('change', () => state && render())

$('btnPrepare').addEventListener('click', async () => {
  $('btnPrepare').disabled = true
  say('prepMsg', 'Reading voting and streaming records… this can take up to a minute.')
  const r = await call('adminGiveawayPrepare', { team: $('team').value })
  $('btnPrepare').disabled = false
  if (!r.success) return say('prepMsg', errText(r), 'bad')
  state = r
  say('prepMsg', 'List ready for review.', 'ok')
  render()
})

$('btnFreeze').addEventListener('click', async () => {
  const g = state.giveaway
  const n = (g.candidates || []).filter((c) => c.eligible).length
  const typed = prompt(`Freeze ${n} eligible members for ${g.team_label}? This can't be undone.\n\nType the number ${n} to confirm.`)
  if (typed === null) return
  if (Number(typed) !== n) return say('freezeMsg', 'Number did not match. Nothing was frozen.', 'bad')
  $('btnFreeze').disabled = true
  const r = await call('adminGiveawayFreeze', { preparedAt: g.prepared_at, expectedCount: n })
  if (!r.success) { $('btnFreeze').disabled = false; return say('freezeMsg', errText(r), 'bad') }
  state = r
  say('freezeMsg', 'List frozen.', 'ok')
  render()
})

$('btnTest').addEventListener('click', () => window.open('giveaway-wheel.html?mode=test', '_blank'))
$('btnOfficial').addEventListener('click', () => {
  if (state?.giveaway?.status === 'frozen'
    && !confirm('Open the OFFICIAL draw view?\n\nPressing SPIN there picks and saves the one official winner. Start your screen recording first.')) return
  window.open('giveaway-wheel.html?mode=official', '_blank')
})

if ($('adminKey').value) load()
