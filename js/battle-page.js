// Public MAMA Battle page (/battle): the live cached battle summary, refreshed
// once a minute while visible. No sign-in, no agent data — getPublicBattle
// returns team totals only, from the same shared cache as the City banner.
import '@fontsource/montserrat/900.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import { call } from './api.js'
import { battlePageHtml, battleUnavailableHtml } from './battle-page-view.js'
import { battleView, recruitView, shareText, recruitText, recruitUrl, teamFromQuery, BATTLE_URL } from './battle-share-rules.js'
import { shareLink, copyText } from './battle-share-flow.js'

const REFRESH_MS = 60_000
const root = document.getElementById('battle')
// /battle?team=aliens: that side's recruit page.
const team = teamFromQuery(location.search)
let last = null

async function load() {
  const r = await call('getPublicBattle')
  if (r?.success) {
    last = r
    root.innerHTML = battlePageHtml(r, new Date(), team)
  } else if (!last) {
    root.innerHTML = battleUnavailableHtml(r?.error === 'no_battle' ? 'none' : 'error')
  }
  root.setAttribute('aria-busy', 'false')
}

root.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-bp-share]') || !last) return
  const r = team
    ? await shareLink(recruitText(recruitView(last, team)), recruitUrl(team))
    : await shareLink(shareText(battleView(last)), BATTLE_URL)
  if (r === 'copied') flash('Link copied')
  if (r === 'failed' && (await copyText(location.href))) flash('Link copied')
})

function flash(text) {
  const t = document.createElement('div')
  t.className = 'bp-toast'
  t.setAttribute('role', 'status')
  t.textContent = text
  document.body.appendChild(t)
  setTimeout(() => t.remove(), 2200)
}

load()
setInterval(() => { if (!document.hidden) load() }, REFRESH_MS)
document.addEventListener('visibilitychange', () => { if (!document.hidden) load() })
