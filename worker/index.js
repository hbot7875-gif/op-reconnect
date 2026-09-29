import { publicSnapshot, questProgressLabel, questCallout } from '../supabase/functions/op-reconnect/lib/quest-share-rules.js'
const API = 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect'
const SITE = 'https://hopetrackers.org'
const ID_RE = /^[A-Za-z0-9_-]{22}$/

export function badgeLanding(snap,id) {
  const safe=publicSnapshot(snap)
  if(safe?.kind!=='badge'||!ID_RE.test(id))return ''
  const d=safe.data,title=`${d.milestonePercent}% Restored · ${d.districtDisplayName}`
  const url=`${SITE}/share/badge/${id}`,image=`${SITE}/share/image/${id}.png`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(d.reaction)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${image}"><style>*{box-sizing:border-box}body{background:#100d1a;color:#eee8f6;font:16px/1.5 system-ui;margin:0;padding:24px}main{max-width:760px;margin:auto}img{width:100%;display:block}h1{font-size:28px;line-height:1.25;color:#edcf91}.quiet{color:#c5b0dd}a{display:inline-block;padding:12px 18px;background:#a78bfa;color:#100d1a;text-decoration:none;border-radius:8px;font-weight:700}small{display:block;margin-top:24px;color:#baa9cb}</style></head><body><main><p class="quiet">◇ BADGE UNLOCKED</p><img src="${image}" alt="${escapeHtml(title)} — badge unlocked"><h1>${escapeHtml(title)}</h1><p class="quiet">come light up ur city ↗</p><a href="/">DISCOVER RECONNECT</a><small>OP: RECONNECT · hopetrackers.org</small></main></body></html>`
}

const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

async function snapshot(id) {
  const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getPublicShareSnapshot', id }) })
  if (!response.ok) return null
  const body = await response.json()
  return body?.success ? publicSnapshot(body.snapshot) : null
}

export function questLanding(snap, id) {
  const d = publicSnapshot(snap).data
  const url = `${SITE}/share/quest/${id}`, image = `${SITE}/share/image/${id}.png`
  const title = `${d.title} · ReConnect Quest`
  const progress = `${d.progress} / ${d.target} ${questProgressLabel(d)}`
  const description = `${progress} · ${d.joined} / ${d.capacity} ARMY here`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(description)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${image}"><link rel="canonical" href="${url}"><style>*{box-sizing:border-box}body{margin:0;background:#100d1a;color:#eee8f6;font:16px/1.5 system-ui,sans-serif;padding:28px 20px}main{max-width:650px;margin:auto}.eyebrow{font-size:12px;letter-spacing:2px;color:#ab90df}h1{font-size:28px;line-height:1.2;margin:20px 0}.chat{margin:30px 0}.message{padding:12px 0;overflow-wrap:anywhere}.message b{display:block;color:#ab90df;font-size:12px;letter-spacing:1px}.message.mine b{color:#dfbb75}.message p{margin:4px 0;font-size:19px}.score{color:#c4a5ff;font-size:23px;font-weight:700}.quiet{color:#b9abc9}.end{border-top:1px solid #30263e;padding-top:22px;margin-top:30px}.action{display:inline-block;background:#a78bfa;color:#100d1a;border-radius:8px;text-decoration:none;padding:12px 18px;font-weight:700}.url{display:block;color:#b9abc9;font-size:12px;margin-top:18px}</style></head><body><main><div class="eyebrow">RECONNECT QUEST</div><h1>${escapeHtml(d.title)}</h1>${d.messages.length ? `<section class="chat" aria-label="Selected conversation">${d.messages.map(m=>`<div class="message ${m.label==='YOU'?'mine':''}"><b>${escapeHtml(m.label)}</b><p>${escapeHtml(m.body)}</p></div>`).join('')}</section>` : ''}<p class="score">${escapeHtml(progress)}</p><p class="quiet">${d.joined} ARMY TOGETHER</p><p>${d.complete?'QUEST COMPLETE':d.availableSeats?`${d.availableSeats} OPEN SEAT${d.availableSeats===1?'':'S'}` : ''}</p><p>${escapeHtml(questCallout(d))}</p><section class="end"><b>OP: RECONNECT</b><p class="quiet">Streaming, but with side quests.</p><a class="action" href="/">DISCOVER RECONNECT</a><span class="url">hopetrackers.org</span></section></main></body></html>`
}

function page(snap, id) {
  if(snap.kind === 'badge') return badgeLanding(snap,id)
  if(snap.kind === 'quest') return questLanding(snap,id)
  const district = snap.kind === 'district'
  const city = snap.kind === 'city_bomb'
  const success = snap.kind === 'red_zone_success'
  const d = snap.data || {}
  const title = city ? 'My ARMY Bomb · ReConnect' : district ? `${d.displayName} · ${d.percent}% restored` : success ? 'ReConnect · City safe' : 'ReConnect · City under attack'
  const description = city ? d.line : district ? d.line : success ? `${d.line} ${d.progress} / ${d.target} streams.` : `${d.line} ${d.progress} / ${d.target} ${d.unit || 'streams'}.`
  const kind = city ? 'city' : district ? 'district' : 'red-zone'
  const canonical = `${SITE}/share/${kind}/${id}`
  const image = `${SITE}/share/image/${id}.png`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:site_name" content="ReConnect · HopeTracker"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${image}"><link rel="canonical" href="${canonical}"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#08070d;color:#f3eff9;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;padding:24px}.wrap{width:min(680px,100%)}img{width:100%;height:auto;display:block;border:1px solid #282235}.copy{padding:28px 2px}.eyebrow{color:#9e8bc9;letter-spacing:.24em;font-size:12px}.copy h1{font-size:clamp(26px,7vw,40px);line-height:1.1;margin:12px 0}.copy p{color:#bbb4c5;margin:0 0 24px}.action{display:inline-block;text-decoration:none;color:#0b0810;background:#a78bfa;font-weight:800;padding:14px 20px;border-radius:8px}.quiet{display:block;color:#777184;font-size:12px;margin-top:20px}</style></head><body><main class="wrap"><img src="${image}" alt="${escapeHtml(title)}"><section class="copy"><div class="eyebrow">RECONNECT · HOPETRACKER</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><a class="action" id="continue" href="/">DISCOVER RECONNECT</a><span class="quiet">A streaming game built with ARMY.</span></section></main><script>try{if(localStorage.getItem('rc_agent')){const a=document.getElementById('continue');a.textContent='OPEN RECONNECT';a.href='/game'}}catch(e){}</script></body></html>`
}

/* Baseline response headers, applied to everything this worker returns —
   the /share/* pages it renders itself AND the static site it hands off to
   ASSETS. Setting them here rather than in a _headers file is deliberate:
   every response already passes through this fetch handler, so there is one
   place to read and no second mechanism whose precedence has to be reasoned
   about.

   What is deliberately NOT here:
   - A general Content-Security-Policy. This site loads Google Fonts, the
     Spotify iframe API, self-hosted tesseract wasm and inline styles; a
     script-src/style-src policy would need every one of those proven first,
     and a wrong one breaks the game silently. frame-ancestors is the one
     directive that is safe in isolation — it restricts who may embed US,
     and constrains nothing the page itself loads.
   - Strict-Transport-Security. See the release notes: it is a commitment
     about every current and future subdomain of the apex, and it is not
     reversible within its own max-age. That is a decision to take
     deliberately, not to slip into a header pass.
   Permissions-Policy lists only features this codebase never calls
   (verified: no getUserMedia, no geolocation, no payment request). Clipboard
   and Web Share are left unlisted on purpose — they default to same-origin
   and the share/copy flows depend on them. */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "frame-ancestors 'none'",
  // Belt and braces for browsers predating frame-ancestors support.
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
}

function secured(response) {
  // Responses from ASSETS are immutable, so the headers are copied onto a
  // new Response rather than mutated in place.
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export default {
  async fetch(request, env) {
    return secured(await route(request, env))
  },
}

async function route(request, env) {
  const url = new URL(request.url)
  const pageMatch = url.pathname.match(/^\/share\/(district|red-zone|quest|city|badge)\/([A-Za-z0-9_-]{22})\/?$/)
  if (pageMatch) {
    const snap = await snapshot(pageMatch[2])
    const expected = snap?.kind === 'badge' ? 'badge' : snap?.kind === 'city_bomb' ? 'city' : snap?.kind === 'quest' ? 'quest' : snap?.kind === 'district' ? 'district' : snap ? 'red-zone' : null
    if (!snap || expected !== pageMatch[1]) return new Response('Share not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return new Response(page(snap, pageMatch[2]), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex, nofollow' } })
  }
  const imageMatch = url.pathname.match(/^\/share\/image\/([A-Za-z0-9_-]{22})\.png$/)
  if (imageMatch) {
    const upstream = await fetch(`${API}/share-image/${imageMatch[1]}.png`)
    if (!upstream.ok) return new Response('Image not found', { status: 404 })
    return new Response(upstream.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } })
  }
  return env.ASSETS.fetch(request)
}
