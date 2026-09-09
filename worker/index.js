import { publicSnapshot, questProgressLabel } from '../supabase/functions/op-reconnect/lib/quest-share-rules.js'
const API = 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect'
const SITE = 'https://hopetrackers.org'
const ID_RE = /^[A-Za-z0-9_-]{22}$/

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(description)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${image}"><link rel="canonical" href="${url}"><style>*{box-sizing:border-box}body{margin:0;background:#100d1a;color:#eee8f6;font:16px/1.5 system-ui,sans-serif;padding:28px 20px}main{max-width:650px;margin:auto}.eyebrow{font-size:12px;letter-spacing:2px;color:#ab90df}h1{font-size:28px;line-height:1.2;margin:20px 0}.chat{margin:30px 0}.message{padding:12px 0;overflow-wrap:anywhere}.message b{display:block;color:#ab90df;font-size:12px;letter-spacing:1px}.message.mine b{color:#dfbb75}.message p{margin:4px 0;font-size:19px}.score{color:#c4a5ff;font-size:23px;font-weight:700}.quiet{color:#b9abc9}.end{border-top:1px solid #30263e;padding-top:22px;margin-top:30px}.action{display:inline-block;background:#a78bfa;color:#100d1a;border-radius:8px;text-decoration:none;padding:12px 18px;font-weight:700}.url{display:block;color:#b9abc9;font-size:12px;margin-top:18px}</style></head><body><main><div class="eyebrow">RECONNECT QUEST</div><h1>${escapeHtml(d.title)}</h1>${d.messages.length ? `<section class="chat" aria-label="Selected conversation">${d.messages.map(m=>`<div class="message ${m.label==='YOU'?'mine':''}"><b>${escapeHtml(m.label)}</b><p>${escapeHtml(m.body)}</p></div>`).join('')}</section>` : ''}<p class="score">${escapeHtml(progress)}</p><p class="quiet">${d.joined} / ${d.capacity} ARMY HERE</p><p>${d.complete?'QUEST COMPLETE':d.availableSeats?`${d.availableSeats} OPEN SEAT${d.availableSeats===1?'':'S'}`:'TEAM FULL'}</p><section class="end"><b>OP: RECONNECT</b><p class="quiet">Streaming, but with side quests.</p><a class="action" href="/">DISCOVER RECONNECT</a><span class="url">hopetrackers.org</span></section></main></body></html>`
}

function page(snap, id) {
  if(snap.kind === 'quest') return questLanding(snap,id)
  const district = snap.kind === 'district'
  const city = snap.kind === 'city_bomb'
  const success = snap.kind === 'red_zone_success'
  const d = snap.data || {}
  const title = city ? 'My ARMY Bomb · ReConnect' : district ? `${d.displayName} · ${d.percent}% restored` : success ? 'ReConnect · City safe' : 'ReConnect · City under attack'
  const description = city ? d.line : district ? `${d.line} ${d.displayName} is ${d.percent}% restored.` : success ? `${d.line} ${d.progress} / ${d.target} streams.` : `${d.line} ${d.progress} / ${d.target} ${d.unit || 'streams'}.`
  const kind = city ? 'city' : district ? 'district' : 'red-zone'
  const canonical = `${SITE}/share/${kind}/${id}`
  const image = `${SITE}/share/image/${id}.png`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><meta property="og:type" content="website"><meta property="og:site_name" content="ReConnect · HopeTracker"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${image}"><link rel="canonical" href="${canonical}"><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#08070d;color:#f3eff9;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;padding:24px}.wrap{width:min(680px,100%)}img{width:100%;height:auto;display:block;border:1px solid #282235}.copy{padding:28px 2px}.eyebrow{color:#9e8bc9;letter-spacing:.24em;font-size:12px}.copy h1{font-size:clamp(26px,7vw,40px);line-height:1.1;margin:12px 0}.copy p{color:#bbb4c5;margin:0 0 24px}.action{display:inline-block;text-decoration:none;color:#0b0810;background:#a78bfa;font-weight:800;padding:14px 20px;border-radius:8px}.quiet{display:block;color:#777184;font-size:12px;margin-top:20px}</style></head><body><main class="wrap"><img src="${image}" alt="${escapeHtml(title)}"><section class="copy"><div class="eyebrow">RECONNECT · HOPETRACKER</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><a class="action" id="continue" href="/">DISCOVER RECONNECT</a><span class="quiet">A streaming game built with ARMY.</span></section></main><script>try{if(localStorage.getItem('rc_agent')){const a=document.getElementById('continue');a.textContent='OPEN RECONNECT';a.href='/game'}}catch(e){}</script></body></html>`
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pageMatch = url.pathname.match(/^\/share\/(district|red-zone|quest|city)\/([A-Za-z0-9_-]{22})\/?$/)
    if (pageMatch) {
      const snap = await snapshot(pageMatch[2])
      const expected = snap?.kind === 'city_bomb' ? 'city' : snap?.kind === 'quest' ? 'quest' : snap?.kind === 'district' ? 'district' : snap ? 'red-zone' : null
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
  },
}
