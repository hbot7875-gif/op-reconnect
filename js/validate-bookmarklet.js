// OP: ReConnect — "Validate a playlist" bookmarklet source.
//
// NOT loaded by this app anywhere — Spotify's CSP blocks injecting a
// <script src> pointing at another origin (verified live: a dynamically
// created <script> tag pointing at our own domain silently fails to load
// on open.spotify.com, no network request even fires), so the classic
// "tiny loader stub + hosted script" bookmarklet pattern doesn't work here.
// This file exists purely as the readable, maintainable source; the actual
// bookmarklet is this same logic pasted inline as one `javascript:` URI
// into candy-star-admin.html's draggable link, since a `javascript:`
// bookmarklet triggered by a direct bookmark click is NOT subject to the
// page's script-src CSP the way an injected <script> tag is (confirmed
// live too: a fetch() from a bookmarklet-style script running on
// open.spotify.com reached our Supabase function fine — only the
// injected-<script> loading path was blocked).
//
// Why this exists at all: our connected Spotify account's token can only
// read playlists Spotify considers "ours" — reading another user's public
// playlist via the Web API 403s, because this app is still in Spotify's
// Development Mode (see validatePlaylist's own comment in candy-star.ts).
// A real logged-in browser tab has none of that restriction — it's just
// looking at a public webpage — so this scrapes the rendered tracklist
// there and hands it to validatePlaylistFromTracks instead of us fetching
// it ourselves.
//
// Selectors below were confirmed against the live open.spotify.com DOM
// (Spotify's "Encore" design system, data-testid attributes) — these are
// meaningfully more stable than their hashed CSS class names, but Spotify
// can still change them without notice. If the bookmarklet starts
// reporting 0 tracks, this is the first place to check.

;(function () {
  var API_URL = 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect'
  var KEY_STORAGE = 'rc_admin_key'

  function panel() {
    var p = document.getElementById('rcValidatePanel')
    if (p) return p
    p = document.createElement('div')
    p.id = 'rcValidatePanel'
    p.style.cssText = 'position:fixed;top:16px;right:16px;width:340px;max-height:80vh;overflow-y:auto;' +
      'background:#13111e;color:#ece9f2;border:1px solid rgba(255,255,255,.15);border-radius:14px;' +
      'padding:16px;font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;z-index:999999;box-shadow:0 12px 30px rgba(0,0,0,.6);'
    document.body.appendChild(p)
    return p
  }
  function closeBtn() {
    return '<button id="rcValidateClose" style="margin-top:10px;background:none;border:1px solid rgba(255,255,255,.15);' +
      'color:#9c96b0;border-radius:8px;padding:6px 10px;cursor:pointer;">Close</button>'
  }
  function wireClose() {
    var c = document.getElementById('rcValidateClose')
    if (c) c.onclick = function () { var p = document.getElementById('rcValidatePanel'); if (p) p.remove() }
  }
  function status(msg) {
    panel().innerHTML = '<div style="font-weight:700;margin-bottom:8px;">OP: ReConnect — Validate</div>' +
      '<div style="color:#9c96b0;">' + msg + '</div>' + closeBtn()
    wireClose()
  }

  function parseDurationText(t) {
    var m = /(\d+):(\d{2})(?::(\d{2}))?/.exec(t || '')
    if (!m) return null
    if (m[3]) return ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000
    return ((+m[1]) * 60 + (+m[2])) * 1000
  }

  /** Spotify's own listRowTitle id doubles as a per-render React key (e.g.
   *  "...spotify:track:453W.../-0", "-1", "-2"...) — the trailing number is
   *  the row's actual playlist position. Repeated plays of the very same
   *  track id are common in these "148 combo" playlists, so dedup has to
   *  key on this per-position id, never on the track id — keying on track
   *  id alone silently collapsed every repeat into one row (confirmed live:
   *  45 real rows in a 10x/9x/1x playlist came back as only 36 "unique"
   *  tracks before this fix), which breaks every count-based rule check
   *  (top-song detection, repeat-gap spacing) downstream in candy-star-rules.ts. */
  function rowKey(row) {
    var titleEl = row.querySelector('[data-encore-id="listRowTitle"]')
    return (titleEl && titleEl.id) || null
  }

  function readRow(row, domIndex) {
    var trackA = row.querySelector('a[href^="/track/"]')
    if (!trackA) return null
    var id = trackA.getAttribute('href').split('/track/')[1].split('?')[0]
    var name = row.getAttribute('aria-label') || trackA.textContent.trim()
    var artistLinks = row.querySelectorAll('[data-testid="internal-artist-link"] a, a[href^="/artist/"]')
    var artists = [].map.call(artistLinks, function (a) {
      var href = a.getAttribute('href') || ''
      var id2 = href.indexOf('/artist/') > -1 ? href.split('/artist/')[1].split('?')[0] : null
      return { id: id2, name: a.textContent.trim() }
    }).filter(function (a) { return a.id })
    var durEl = row.querySelector('[data-testid="duration"]')
    var durationMs = durEl ? parseDurationText(durEl.textContent) : null
    if (durationMs == null) {
      var m = row.textContent.match(/\b\d{1,2}:\d{2}\b/)
      durationMs = m ? parseDurationText(m[0]) : 200000 // best-effort estimate — duration wasn't in the DOM
    }
    var rk = rowKey(row)
    var orderMatch = rk ? /-(\d+)$/.exec(rk) : null
    return {
      key: rk || ('idx-' + domIndex + '-' + id), // dedup key across scroll ticks
      order: orderMatch ? parseInt(orderMatch[1], 10) : domIndex, // playlist position, for sorting at the end
      id: id, name: name, artists: artists, durationMs: durationMs,
    }
  }

  function findScrollParent(start) {
    var el = start
    for (var i = 0; i < 8 && el; i++) {
      var cs = getComputedStyle(el)
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el
      el = el.parentElement
    }
    return null
  }

  /** Rows are lazy-mounted as you scroll (an infinite-scroll list, not a
   *  static one) — keep scrolling + collecting until the found-track count
   *  stops growing for a few rounds in a row. */
  function collectAll(done) {
    var seen = {}
    var stableRounds = 0
    var lastCount = -1
    var guard = 0
    function tick() {
      guard++
      var rows = document.querySelectorAll('[data-testid="track-row"]')
      for (var i = 0; i < rows.length; i++) {
        var t = readRow(rows[i], i)
        if (t) seen[t.key] = t
      }
      var count = Object.keys(seen).length
      status('Scrolling and collecting tracks… ' + count + ' found so far.')
      if (count === lastCount) stableRounds++; else stableRounds = 0
      lastCount = count
      if (stableRounds >= 4 || guard > 300) {
        var list = Object.keys(seen).map(function (k) { return seen[k] })
        list.sort(function (a, b) { return a.order - b.order })
        done(list)
        return
      }
      var scroller = findScrollParent(rows[0] || document.querySelector('[data-testid="infinite-scroll-list"]') || document.body)
      if (scroller) scroller.scrollTop = scroller.scrollHeight
      else window.scrollTo(0, document.body.scrollHeight)
      setTimeout(tick, 450)
    }
    tick()
  }

  function getAdminKey(cb) {
    var saved = null
    try { saved = localStorage.getItem(KEY_STORAGE) } catch (e) {}
    if (saved) { cb(saved); return }
    var key = window.prompt('OP: ReConnect admin key (SYNC_ADMIN_KEY):')
    if (key) { try { localStorage.setItem(KEY_STORAGE, key) } catch (e) {} }
    cb(key)
  }

  function renderReport(res) {
    if (res && res.error === 'Unauthorized') {
      try { localStorage.removeItem(KEY_STORAGE) } catch (e) {}
      status('<span style="color:#e5384f;">Admin key rejected — run this again and re-enter it.</span>')
      return
    }
    if (!res || !res.success) {
      status('<span style="color:#e5384f;">' + ((res && res.error) || 'Something went wrong.') + '</span>')
      return
    }
    var s = res.summary || {}
    var rows = (res.findings || []).map(function (f) {
      var color = f.status === 'pass' ? '#d9ad5f' : f.status === 'warn' ? '#a78bfa' : '#e5384f'
      var ico = f.status === 'pass' ? '✓' : f.status === 'warn' ? '⚠' : '✗'
      return '<div style="display:flex;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08);">' +
        '<span style="color:' + color + ';font-weight:900;">' + ico + '</span>' +
        '<div><div style="font-weight:700;">' + f.rule + '</div>' +
        '<div style="color:#9c96b0;font-size:12px;">' + f.detail + '</div></div></div>'
    }).join('')
    panel().innerHTML = '<div style="font-weight:700;margin-bottom:8px;">Validated ' + (res.trackCount || '') + ' track(s)</div>' +
      '<div style="color:#9c96b0;font-size:12px;margin-bottom:6px;">' + (s.tracks || 0) + ' tracks · ' + (s.runtimeMin || 0) + ' min · ' +
      '<span style="color:#d9ad5f;">' + (s.passed || 0) + ' passed</span> · <span style="color:#e5384f;">' + (s.failed || 0) + ' failed</span></div>' +
      rows + closeBtn()
    wireClose()
  }

  function run() {
    if (!/^\/playlist\//.test(location.pathname)) {
      status('Open a Spotify playlist page first, then click this again.')
      return
    }
    status('Collecting tracks… scroll happens automatically, don’t touch the page.')
    collectAll(function (tracks) {
      if (!tracks.length) { status('Found 0 tracks — the page structure may have changed.'); return }
      status('Found ' + tracks.length + ' track(s). Checking the rules…')
      getAdminKey(function (adminKey) {
        if (!adminKey) { status('Admin key required.'); return }
        var name = (document.title || '').split(' - playlist by')[0].trim()
        fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'validatePlaylistFromTracks', adminKey: adminKey, name: name, tracks: tracks }),
        }).then(function (r) { return r.json() }).then(renderReport)
          .catch(function (e) { status('<span style="color:#e5384f;">Network error: ' + e.message + '</span>') })
      })
    })
  }

  run()
})()
