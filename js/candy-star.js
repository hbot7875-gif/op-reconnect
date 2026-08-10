// Candy Star Generator — playlist builder.
//
// UI structure came from the old site's app.js (lines 18661-19347), 2026-08-02.
// Its DATA layer did not: that version leaned on app.js globals and called
// generateAlpaca/previewAlpaca/getAlpacaOptions on arirang-btsbackend — a
// different Supabase project with a different accounts table, where this
// game's agent numbers don't exist at all.
//
// The shims below re-point those globals at Op: Reconnect's own modules.
// getAlpacaOptions/generateAlpaca/previewAlpaca now have a real, matching
// implementation on THIS project's own backend (supabase/functions/op-reconnect,
// lib/candy-star.ts) — same action names, same param/response shapes — so
// they're routed through the normal api.js call() like everything else.
// api.js already attaches this agent's own sessionToken automatically (it's
// not in api.js's PUBLIC_ACTIONS set), which is what makes these agent-scoped
// on the new backend instead of the old site's role-based gate.
//
// One real limitation remains, and it's data, not wiring: `bts_song_catalog`
// and `spotify_filler_library` start EMPTY on this project (see migration
// 030's own comment) until an admin runs the catalog-refresh/filler-import
// admin actions from candy-star-admin.html. Until then getAlpacaOptions
// returns an empty catalog and generateAlpaca fails with an honest
// "Need ~N unique non-BTS fillers…" / "No playable BTS catalog songs…"
// error — surfaced through candySetStatus like any other real error, not a
// bug in this file.

import { esc, toast } from './state.js'
import { getAgentNo } from './session.js'
import { call as apiCall } from './api.js'

// ── compatibility shims for the globals this section grew up with ──
const $ = (id) => document.getElementById(id)
const sanitize = esc
const showToast = toast
// Old-site role gate for the playlist-maker tool. Op: Reconnect has no roles —
// every agent gets the same tools — so this is simply true here.
const isPLMaker = () => true
const STATE = { get agentNo() { return getAgentNo() } }

const Api = {
  // _opts (dedupe/cache/timeout) was the old site's own fetch-wrapper config;
  // api.js's call() is a plain fetch with no such knobs, so it's accepted
  // here for call-site compatibility and simply ignored.
  async call(action, params, _opts) {
    return apiCall(action, { ...(params || {}), agentNo: STATE.agentNo })
  },
}

// ==================== CANDY STAR GENERATOR (agent-facing alpaca maker) ====================
window._candyStar = window._candyStar || { songByLabel: {}, albums: [], remaining: null, cap: 3 };

// Ported straight from the old site (see file header) with its goal names
// hardcoded — "Wild Flower", "Killin' It Girl" — none of which are even in
// THIS game's current Home Base goal set (DSYLM, Haegeum, DNA, Permission to
// Dance, Swim, Normal, Come Over, plus the Arirang/Keep Swimming/Echo/Indigo
// album goals). Read live instead, off the same activeDistrict main.js
// stashes on window.__rcState for every screen that needs the current run
// of goals without threading state through every function (screen-district's
// mountScene callbacks do the same).
function candyCurrentGoalNames() {
  const d = window.__rcState?.activeDistrict;
  if (!d) return [];
  const tracks = (d.trackGoals || []).map(g => g.label).filter(Boolean);
  const albums = (d.albums || []).map(a => a.label).filter(Boolean);
  return [...tracks, ...albums];
}

/**
 * Resolves a song field to a catalog key. Accepts either the input ELEMENT
 * (preferred — checks dataset.resolvedKey first, set the moment a dropdown
 * pick is made, so no re-parsing of displayed text is needed) or a raw string
 * (for validation paths that only have the text). String fallback tries:
 * 1. Exact label match, 2. case-insensitive label match, 3. case-insensitive
 * EXACT song-name match, only when unambiguous (exactly one catalog entry has
 * that name) — so typing "Swim" resolves to the base "SWIM — BTS" without
 * needing the full "Name — Artist" label, while a name shared by multiple
 * entries (e.g. remixes) still needs an explicit pick.
 */
function candyResolveSongKey(typedOrEl) {
  let typed, el = null;
  if (typedOrEl && typeof typedOrEl === 'object') { el = typedOrEl; typed = (el.value || '').trim(); }
  else { typed = (typedOrEl || '').trim(); }
  if (el?.dataset?.resolvedKey) return el.dataset.resolvedKey;
  const cs = window._candyStar || {};
  if (!typed) return null;
  if (cs.songByLabel && cs.songByLabel[typed]) return cs.songByLabel[typed];
  const lower = typed.toLowerCase();
  if (cs.songByLabelLower && cs.songByLabelLower[lower]) return cs.songByLabelLower[lower];
  if (cs.songByNameLower && cs.songByNameLower[lower]) return cs.songByNameLower[lower];
  return null;
}
function candyLabelFor(s) { return `${s.name} — ${(s.artists || []).join(', ')}`; }

/** Ranked search over the full catalog — prefix matches first, then substring,
 * then artist matches, tie-broken toward shorter/simpler titles (so a base
 * track like "SWIM" outranks "SWIM with j-hope (Afrobeat Remix)" for "swim"). */
function candySearchSongs(query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const list = window._candyStar?.songList || [];
  const scored = [];
  for (const s of list) {
    const nameLower = s.name.toLowerCase();
    const artistLower = (s.artists || []).join(' ').toLowerCase();
    let score;
    if (nameLower === q) score = 100;
    else if (nameLower.startsWith(q)) score = 80;
    else if (nameLower.includes(q)) score = 50;
    else if (artistLower.startsWith(q)) score = 30;
    else if (artistLower.includes(q)) score = 15;
    else continue;
    score -= nameLower.length * 0.05;
    scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.s);
}

// Per-agent "recently picked" songs, so repeat visits need less typing.
function candyRecentKey() { return `candystar_recent_${STATE.agentNo || 'anon'}`; }
function candyGetRecent() {
  try { return JSON.parse(localStorage.getItem(candyRecentKey()) || '[]'); } catch (_) { return []; }
}
function candyAddRecent(key, label) {
  try {
    const recent = candyGetRecent().filter(r => r.key !== key);
    recent.unshift({ key, label });
    localStorage.setItem(candyRecentKey(), JSON.stringify(recent.slice(0, 6)));
  } catch (_) { /* localStorage unavailable — recent picks just won't persist */ }
}

function candyDropdownRowHTML(name, artists, key, label) {
  return `<button type="button" class="cs-dd-item" data-key="${sanitize(key)}" data-label="${sanitize(label)}">
    <span class="cs-dd-name">${sanitize(name)}</span>
    <span class="cs-dd-artist">${sanitize(artists)}</span>
  </button>`;
}
function candyWireDropdownClicks(dropdown, input) {
  dropdown.querySelectorAll('.cs-dd-item').forEach((btn, i) => {
    // mousedown (not click) fires before the input's blur, so a pick always registers.
    btn.onmousedown = (e) => { e.preventDefault(); candySelectSong(input, btn.dataset.key, btn.dataset.label); };
    btn.dataset.idx = i;
  });
  dropdown._activeIdx = -1;
}
export function candySongInput(input) {
  input.dataset.resolvedKey = '';
  input.classList.remove('cs-invalid');
  const dropdown = input.parentElement.querySelector('.cs-song-dropdown');
  if (!dropdown) return;
  const q = input.value.trim();
  if (!q) { candySongFocus(input); candyUpdateEstimate(); return; }
  const results = candySearchSongs(q, 8);
  dropdown.innerHTML = results.length
    ? results.map(s => candyDropdownRowHTML(s.name, (s.artists || []).join(', '), s.key, candyLabelFor(s))).join('')
    : `<div class="cs-dd-empty">No matching songs</div>`;
  dropdown.classList.add('is-open');
  candyWireDropdownClicks(dropdown, input);
  candyUpdateEstimate();
}
// Empty-field focus: show recent picks + this week's goal tracks, so most
// users can click straight through without typing at all.
export function candySongFocus(input) {
  if (input.value.trim()) { candySongInput(input); return; }
  const dropdown = input.parentElement.querySelector('.cs-song-dropdown');
  if (!dropdown) return;
  const recent = candyGetRecent();
  const frequent = window._candyStar?.frequentSongs || [];
  let html = '';
  if (recent.length) {
    html += `<div class="cs-dd-section">Recent</div>` + recent.map(r => {
      const [name, ...rest] = r.label.split(' — ');
      return candyDropdownRowHTML(name, rest.join(' — '), r.key, r.label);
    }).join('');
  }
  if (frequent.length) {
    html += `<div class="cs-dd-section">This week's goals</div>` +
      frequent.map(s => candyDropdownRowHTML(s.name, (s.artists || []).join(', '), s.key, candyLabelFor(s))).join('');
  }
  dropdown.innerHTML = html;
  dropdown.classList.toggle('is-open', !!html);
  candyWireDropdownClicks(dropdown, input);
}
function candySelectSong(input, key, label) {
  input.value = label;
  input.classList.remove('cs-invalid');
  input.dataset.resolvedKey = key;
  candyAddRecent(key, label);
  const dropdown = input.parentElement.querySelector('.cs-song-dropdown');
  if (dropdown) { dropdown.classList.remove('is-open'); dropdown.innerHTML = ''; }
  candyUpdateEstimate();
  input.closest('.cs-focus-row')?.querySelector('.cs-focus-mult')?.focus();
}
function candyCloseDropdown(input) {
  const dropdown = input?.parentElement?.querySelector('.cs-song-dropdown');
  if (dropdown) dropdown.classList.remove('is-open');
}
export function candyRowBlur(e) {
  const input = e.target;
  // Delay so a dropdown mousedown-select still lands before we hide it.
  setTimeout(() => { candyCloseDropdown(input); candyValidateRow(input); }, 120);
}

function candyFocusRow(mult) {
  return `<div class="cs-focus-row">
    <div class="cs-song-search">
      <input class="cs-focus-sel" type="text" placeholder="Search songs…" autocomplete="off" aria-label="Song"
        oninput="candySongInput(this)" onfocus="candySongFocus(this)" onblur="candyRowBlur(event)" onkeydown="candyRowKeydown(event)">
      <div class="cs-song-dropdown" role="listbox"></div>
    </div>
    <span class="cs-mult-wrap"><span class="cs-mult-x">×</span><input class="cs-focus-mult" type="number" min="1" value="${mult}" title="Times to stream" aria-label="Times to stream" oninput="candyUpdateEstimate()" onblur="candyValidateRow(this)" onkeydown="candyRowKeydown(event)"></span>
    <button type="button" class="cs-row-remove" title="Remove song" onclick="candyRemoveRow(this)">×</button>
  </div>`;
}
// Song field: arrow keys move the dropdown highlight, Enter picks the
// highlighted (or first) result, Escape closes it. Enter with no dropdown
// open — or from the Times field — jumps to the next row, adding one if needed.
export function candyRowKeydown(e) {
  if (e.target.classList.contains('cs-focus-sel')) {
    const dropdown = e.target.parentElement.querySelector('.cs-song-dropdown');
    const items = dropdown?.classList.contains('is-open') ? [...dropdown.querySelectorAll('.cs-dd-item')] : [];
    if (items.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        let idx = dropdown._activeIdx ?? -1;
        idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        dropdown._activeIdx = idx;
        items.forEach((it, i) => it.classList.toggle('is-active', i === idx));
        items[idx]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const idx = dropdown._activeIdx ?? -1;
        const target = items[idx] || items[0];
        candySelectSong(e.target, target.dataset.key, target.dataset.label);
        return;
      }
      if (e.key === 'Escape') { dropdown.classList.remove('is-open'); return; }
    }
  }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const row = e.target.closest('.cs-focus-row');
  const next = row?.nextElementSibling;
  if (next) next.querySelector('.cs-focus-sel')?.focus();
  else candyAddFocusRow();
}
// Custom builder is locked to the same combo the backend enforces
// (generateAlpaca/previewAlpaca in candy-star.ts) — 2 songs max, 2 albums
// max, never both maxed at once. Capping the inputs here means a player
// finds out from a disabled button, not from a rejection after they've
// already filled the whole thing in.
const CS_MAX_FOCUS_ROWS = 2;
const CS_MAX_ALBUMS = 2;

export function candyAddFocusRow() {
  const wrap = $('cs-focus-rows');
  if (!wrap || wrap.children.length >= CS_MAX_FOCUS_ROWS) return;
  wrap.insertAdjacentHTML('beforeend', candyFocusRow(4));
  wrap.lastElementChild?.querySelector('.cs-focus-sel')?.focus();
  candySyncRowControls();
}
export function candyRemoveRow(btn) {
  btn.closest('.cs-focus-row')?.remove();
  candySyncRowControls();
  candyUpdateEstimate();
}
/** Shows/hides "+ Add another song" depending on whether the cap is reached. */
function candySyncRowControls() {
  const wrap = $('cs-focus-rows');
  const addBtn = document.querySelector('.cs-add-row');
  if (wrap && addBtn) addBtn.style.display = wrap.children.length >= CS_MAX_FOCUS_ROWS ? 'none' : '';
}
export function candyValidateRow(el) {
  const row = el.closest('.cs-focus-row');
  if (!row) return;
  const selEl = row.querySelector('.cs-focus-sel');
  const multEl = row.querySelector('.cs-focus-mult');
  const typed = selEl.value.trim();
  const key = candyResolveSongKey(selEl);
  selEl.classList.toggle('cs-invalid', !!typed && !key);
  selEl.dataset.resolvedKey = key || '';
  // Resolved via a partial/case-insensitive match (not the exact label) — fill
  // in the canonical "Name — Artist" text so it's visible what actually matched.
  const canonicalLabel = key && window._candyStar.keyToLabel ? window._candyStar.keyToLabel[key] : null;
  if (canonicalLabel && canonicalLabel !== typed) selEl.value = canonicalLabel;
  const mult = parseInt(multEl.value) || 0;
  multEl.classList.toggle('cs-invalid', !!typed && mult <= 0);
}
// Desktop sidebar and mobile "Track details" panel show identical live data —
// these keep both copies (id and id-mobile) in sync from one call site.
function candySetText(id, value) {
  const a = $(id);
  if (a) a.textContent = value;
  const b = $(`${id}-mobile`);
  if (b) b.textContent = value;
}
function candySetHTML(id, html) {
  const a = $(id);
  if (a) a.innerHTML = html;
  const b = $(`${id}-mobile`);
  if (b) b.innerHTML = html;
}
export function candyToggleMobileDetails() {
  const body = $('cs-mobile-details-body');
  const btn = document.querySelector('.cs-mobile-details-toggle');
  if (!body || !btn) return;
  const open = body.classList.toggle('is-open');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.classList.toggle('is-open', open);
}
export function candyUpdateEstimate() {
  const out = $('cs-estimate-val');
  if (!out) return;
  let focusTotal = 0;
  document.querySelectorAll('#cs-focus-rows .cs-focus-row').forEach(row => {
    const selEl = row.querySelector('.cs-focus-sel');
    const mult = parseInt(row.querySelector('.cs-focus-mult')?.value) || 0;
    if (selEl?.value?.trim() && candyResolveSongKey(selEl) && mult > 0) focusTotal += mult;
  });
  const checkedAlbums = document.querySelectorAll('.cs-album-check:checked');
  let albumTotal = 0;
  checkedAlbums.forEach(chk => {
    try { albumTotal += (JSON.parse(chk.value) || []).length; } catch (_) {}
  });
  const total = focusTotal + albumTotal;
  out.textContent = total > 0 ? `~${total}+ tracks` : '0 tracks';

  // Desktop sticky summary + mobile collapsible "Track details" — same numbers,
  // richer breakdown. "core" excludes filler/spacer tracks the backend weaves in,
  // which aren't knowable client-side (no per-song duration data here, and filler
  // count depends on the actual randomized build) — the note under the number
  // says so honestly, until the live preview resolves and swaps in real counts.
  candySetText('cs-stat-core', total);
  candySetText('cs-stat-focus', focusTotal);
  candySetText('cs-stat-album', albumTotal);

  const albumCountEl = $('cs-album-selected-count');
  if (albumCountEl) {
    albumCountEl.classList.toggle('is-visible', checkedAlbums.length > 0);
    albumCountEl.textContent = checkedAlbums.length ? `${checkedAlbums.length} selected` : '';
  }

  candyQueuePreview();
}

let candyPreviewTimer = null;
let candyPreviewToken = 0;

/** Debounced — waits for typing/clicking to settle before hitting the backend. */
function candyQueuePreview() {
  const listEl = $('cs-preview-list');
  if (!listEl) return;
  clearTimeout(candyPreviewTimer);
  candyPreviewTimer = setTimeout(candyRunPreview, 700);
}

/**
 * Reads the Custom tab's focus rows + album checkboxes into the shape every
 * build path needs. `unmatched` holds typed text that resolved to no catalog
 * song — generate surfaces it as an error, the live preview just skips it.
 */
function candyCollectCustom({ flagInvalid = false } = {}) {
  const focus = [];
  const seen = new Set();
  const unmatched = [];
  document.querySelectorAll('#cs-focus-rows .cs-focus-row').forEach(row => {
    const selEl = row.querySelector('.cs-focus-sel');
    const multEl = row.querySelector('.cs-focus-mult');
    const typed = selEl?.value?.trim();
    const mult = parseInt(multEl?.value) || 0;
    if (!typed || mult <= 0) return;
    const key = candyResolveSongKey(selEl);
    if (!key) { unmatched.push(typed); if (flagInvalid) selEl?.classList.add('cs-invalid'); return; }
    if (!seen.has(key)) { seen.add(key); focus.push({ key, multiplier: mult }); }
  });
  const album = [];
  const albumIds = [];
  document.querySelectorAll('.cs-album-check:checked').forEach(chk => {
    try { (JSON.parse(chk.value) || []).forEach(k => { if (!album.includes(k)) album.push(k); }); } catch (_) {}
    const id = chk.dataset.albumId;
    if (id && !albumIds.includes(id)) albumIds.push(id);
  });
  return { focus, album, albumIds, unmatched };
}

async function candyRunPreview() {
  const listEl = $('cs-preview-list');
  if (!listEl) return;

  const { focus, album, albumIds } = candyCollectCustom();

  if (!focus.length) {
    candySetHTML('cs-preview-list', `<div class="cs-preview-empty">Add a song to see the track order.</div>`);
    candySetText('cs-stat-filler', '—');
    candySetText('cs-stat-duration', '—');
    return;
  }

  const seq = ++candyPreviewToken;
  candySetHTML('cs-preview-list', `<div class="cs-preview-loading"><span class="cs-spinner"></span> Building preview…</div>`);

  const res = await Api.call('previewAlpaca', { action: 'previewAlpaca', agentNo: STATE.agentNo, mode: 'custom', focus, album, albumIds }, { dedupe: false, cache: false, timeout: 20000 });
  if (seq !== candyPreviewToken) return; // a newer request already superseded this one

  if (!res || !res.success) {
    // A rule rejection (banned album, wrong song/album combo) is something
    // the agent can act on right now — show it in place of the generic
    // fallback so they don't have to hit Generate just to find out why.
    const msg = res?.error && /^(Pick exactly one of|.+ can't be used for generated playlists)/.test(res.error)
      ? res.error
      : 'Preview unavailable right now — generate to see the real order.';
    candySetHTML('cs-preview-list', `<div class="cs-preview-empty">${sanitize(msg)}</div>`);
    candySetText('cs-stat-filler', '—');
    candySetText('cs-stat-duration', '—');
    return;
  }

  const rows = res.preview.map(t => {
    const icon = t.isFocus ? '⭐' : (t.isBTS ? candyIcon('disc', 12) : candyIcon('sparkles', 12));
    return `<div class="cs-preview-row${t.isFocus ? ' is-focus' : ''}"><span class="cs-preview-icon">${icon}</span><span class="cs-preview-name">${sanitize(t.name)}</span></div>`;
  }).join('');
  const more = res.moreCount > 0 ? `<div class="cs-preview-more">+${res.moreCount} more</div>` : '';
  candySetHTML('cs-preview-list', rows + more);

  // Real numbers from the actual build, replacing the rough client-side estimate.
  candySetText('cs-stat-core', res.totalTracks);
  candySetText('cs-stat-filler', Math.max(0, res.totalTracks - (res.totalFocusPlays || 0) - (res.albumTrackCount || 0)));
  const mins = Math.round((res.totalDurationMs || 0) / 60000);
  candySetText('cs-stat-duration', mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '—');
  candySetText('cs-summary-note', res.partial
    ? 'A few songs are still resolving — the real generate step will pick them up.'
    : 'Exact counts from a live preview build.');
}
// Inline Lucide-style icons (no CDN/dependency) for the decorative UI chrome —
// mascot emoji (🦙) stay as-is, this only replaces generic disc/wand/music/sparkle glyphs.
function candyIcon(name, size = 14) {
  const paths = {
    wand: `<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>`,
    music: `<path d="M9 18V5l12-2v13"/><path d="m9 9 12-2"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
    disc: `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>`,
    sparkles: `<path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>`,
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; flex-shrink:0;" aria-hidden="true">${paths[name] || ''}</svg>`;
}
function candyAlbumHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}
/** Enforces the CS_MAX_ALBUMS cap on the checkbox itself — checking a 3rd
 *  box reverts immediately instead of building an over-the-cap combo that
 *  only gets caught once the preview/generate round-trips to the backend. */
export function candyAlbumCheckChanged(el) {
  const checkedCount = document.querySelectorAll('.cs-album-check:checked').length;
  if (el.checked && checkedCount > CS_MAX_ALBUMS) {
    el.checked = false;
    showToast(`Only ${CS_MAX_ALBUMS} albums max per playlist — uncheck one first.`);
    return;
  }
  candyUpdateEstimate();
}
export function candySwitchTab(tab) {
  document.querySelectorAll('.cs-tab[data-tab]').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.cs-panel').forEach(p => {
    p.classList.toggle('is-active', p.id === `cs-panel-${tab}`);
  });
}
function candySetStatus(kind, html) {
  const el = $('cs-status');
  if (!el) return;
  el.className = `cs-status-card is-visible cs-status-${kind}`;
  el.innerHTML = html;
}

// Quick mode picks: play counts mirror the Custom tab's prefilled rows, so the
// first pick is the one on heavy repeat and the others ride behind it.
const CANDY_QUICK_MULTS = [10, 5, 4];

/** 3 songs on their own, or 2 alongside the Arirang album. */
function candyQuickCap() { return window._candyStar?.quickAlbum ? 2 : 3; }

export function candyQuickToggle(btn) {
  const cs = window._candyStar;
  if (!cs) return;
  const key = btn.dataset.key;
  const at = cs.quickPicks.indexOf(key);
  if (at >= 0) cs.quickPicks.splice(at, 1);
  else if (cs.quickPicks.length < candyQuickCap()) cs.quickPicks.push(key);
  candyQuickRefresh();
}

export function candyQuickAlbumToggle() {
  const cs = window._candyStar;
  if (!cs) return;
  cs.quickAlbum = !!$('cs-quick-album')?.checked;
  // Switching the album on tightens the cap — the newest pick gives way, and
  // the count line below says where things stand.
  while (cs.quickPicks.length > candyQuickCap()) cs.quickPicks.pop();
  candyQuickRefresh();
}

function candyQuickRefresh() {
  const cs = window._candyStar;
  if (!cs || !(cs.goalSongs || []).length) return;
  const cap = candyQuickCap();
  const picked = cs.quickPicks.length;

  document.querySelectorAll('.cs-goal-pick').forEach(b => {
    const on = cs.quickPicks.includes(b.dataset.key);
    b.classList.toggle('is-picked', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    // At the cap the unpicked chips stop responding rather than silently
    // swapping something out from under the user.
    b.disabled = !on && picked >= cap;
  });

  const count = $('cs-quick-count');
  if (count) {
    count.textContent = picked
      ? `${picked} of ${cap} songs picked${cs.quickAlbum ? ' · album on' : ''}`
      : `Pick up to ${cap} song${cap === 1 ? '' : 's'}${cs.quickAlbum ? ' · album on' : ''}`;
  }
  const btn = $('cs-quick-btn');
  if (btn) btn.disabled = !picked;
}

export async function renderCandyStar() {
  const container = $('candystarContent');
  if (!container) return;
  container.innerHTML = `<div class="cs-wrap cs-skeleton" aria-busy="true" aria-label="Loading the candy machine">
    <div class="cs-skel-bar"></div>
    <div class="cs-skel-bar is-tall"></div>
    <div class="cs-skel-bar"></div>
  </div>`;

  const opt = await Api.call('getAlpacaOptions', { agentNo: STATE.agentNo }, { dedupe: false, cache: false });
  if (!opt || !opt.success) {
    container.innerHTML = `<div class="archive-card" style="color:var(--red-core); text-align:center; padding:30px;">Couldn't load the generator${opt?.error ? ` — ${sanitize(opt.error)}` : ''}.</div>`;
    return;
  }

  window._candyStar = {
    songByLabel: {}, songByLabelLower: {}, songByNameLower: {}, keyToLabel: {},
    songList: opt.songs || [], albums: opt.albums || [], frequentSongs: [],
  };
  // Names shared by 2+ catalog entries (e.g. a base track + its remixes) stay
  // ambiguous on purpose — songByNameLower only gets a key when exactly one
  // entry has that exact name, so typing just the bare name is safe.
  const nameGroups = {};
  const songByKey = {};
  (opt.songs || []).forEach(s => {
    const label = `${s.name} — ${(s.artists || []).join(', ')}`;
    window._candyStar.songByLabel[label] = s.key;
    window._candyStar.songByLabelLower[label.toLowerCase()] = s.key;
    window._candyStar.keyToLabel[s.key] = label;
    songByKey[s.key] = s;
    const nameLower = s.name.toLowerCase();
    (nameGroups[nameLower] = nameGroups[nameLower] || []).push(s.key);
  });
  Object.entries(nameGroups).forEach(([nameLower, keys]) => {
    if (keys.length === 1) window._candyStar.songByNameLower[nameLower] = keys[0];
  });
  // This week's actual goal names, resolved against the live catalog —
  // a name the catalog doesn't have yet (see file header: bts_song_catalog
  // starts empty until an admin runs the refresh) just gets skipped rather
  // than showing a broken pick.
  const currentGoalNames = candyCurrentGoalNames();
  const goalSongs = currentGoalNames
    .map(name => { const key = candyResolveSongKey(name); return key ? songByKey[key] : null; })
    .filter(Boolean);
  window._candyStar.frequentSongs = goalSongs;
  window._candyStar.goalSongs = goalSongs;
  window._candyStar.quickPicks = [];
  window._candyStar.quickAlbum = false;
  window._candyStar.arirangAlbum = (opt.albums || []).find(a => /arirang/i.test(a.name)) || null;

  // Picking beats listing: all six goals in one playlist dilutes every one of
  // them, so Quick offers the same songs as choices with a hard cap.
  const goalChips = goalSongs.length
    ? goalSongs.map(s => `<button type="button" class="cs-goal-chip cs-goal-pick" data-key="${sanitize(s.key)}" aria-pressed="false" onclick="candyQuickToggle(this)">${sanitize(s.name)}</button>`).join('')
    : currentGoalNames.length
      // The goal names exist, they just aren't in the (possibly still-empty)
      // catalog yet — show them anyway so "current goals" isn't a lie, just
      // not clickable since there's no catalog key to build a playlist entry from.
      ? currentGoalNames.map(g => `<span class="cs-goal-chip">${sanitize(g)}</span>`).join('')
      : `<span class="cs-goal-chip is-empty">No active goals right now</span>`;

  container.innerHTML = `
  <div class="cs-wrap">
    <div class="cs-tabs" role="tablist">
      <button type="button" class="cs-tab is-active" data-tab="quick" role="tab" aria-selected="true" onclick="candySwitchTab('quick')">${candyIcon('wand')} Quick</button>
      <button type="button" class="cs-tab" data-tab="custom" role="tab" aria-selected="false" onclick="candySwitchTab('custom')">${candyIcon('music')} Custom</button>
    </div>

    <!-- QUICK -->
    <div class="cs-panel is-active" id="cs-panel-quick" role="tabpanel">
      <div class="archive-card" style="text-align:center;">
        <div class="cs-hero-icon">🦙</div>
        <div style="font-size:14px; font-weight:900; color:#fff; margin-bottom:8px;">One tap, one alpaca</div>
        <div style="font-size:11.5px; color:var(--text-muted); line-height:1.6; margin-bottom:12px; max-width:420px; margin-left:auto; margin-right:auto;">
          ${goalSongs.length
            ? `Pick the goal songs you want on repeat — <b>up to 3</b>. All of them in one playlist and each one gets diluted, so it's better to make more than one alpaca.`
            : `We build a playlist around the current streaming goals, woven with other songs so it plays naturally.`}
        </div>
        <div class="cs-quick-chips">${goalChips}</div>
        ${goalSongs.length && window._candyStar.arirangAlbum ? `
        <label class="cs-quick-album">
          <input type="checkbox" id="cs-quick-album" onchange="candyQuickAlbumToggle()">
          <span class="cs-quick-album-box">✓</span>
          <span>Weave in the <b>${sanitize(window._candyStar.arirangAlbum.name)}</b> album · ${window._candyStar.arirangAlbum.count} tracks
            <span class="cs-quick-album-hint">with the album on, pick at most 2 songs</span>
          </span>
        </label>` : ''}
        ${goalSongs.length ? `<div class="cs-quick-count" id="cs-quick-count"></div>` : ''}
        <button type="button" class="btn-red" id="cs-quick-btn" onclick="candyGenerate('quick')">🦙 Make me an alpaca</button>
        <div class="cs-cost-note">🪽 Costs 1 Wing · up to 3 Alpacas a day</div>
      </div>
    </div>

    <!-- CUSTOM -->
    <div class="cs-panel" id="cs-panel-custom" role="tabpanel">
      <div class="cs-builder-grid">
        <div class="cs-builder-main">
          <div class="archive-card">
            <div style="font-size:13px; font-weight:900; color:var(--red-core); letter-spacing:0.04em; margin-bottom:6px; text-transform:uppercase;">${candyIcon('disc')} What do you want on repeat?</div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:14px; line-height:1.5;">
              Pick a song and how many times you want to hear it (e.g. 12× Swim · 6× Come Over) — we'll weave in enough extra tracks so it still plays like a real playlist.
              Every playlist needs exactly <b>2 songs + 1 album</b>, <b>1 song + 2 albums</b>, or <b>1 song + 1 album</b> — nothing else.
            </div>

            <div class="cs-col-headers"><span>Song</span><span>Times</span><span></span></div>
            <div id="cs-focus-rows">${candyFocusRow(10)}${candyFocusRow(5)}</div>
            <button type="button" class="cs-add-row" onclick="candyAddFocusRow()">+ Add another song</button>

            ${(opt.albums || []).length ? `
            <div class="cs-album-label-row">
              <label class="cs-field-label">Want a full album woven in too? · ${opt.albums.length} available, ${CS_MAX_ALBUMS} max</label>
              <div class="cs-album-actions">
                <span class="cs-album-selected-count" id="cs-album-selected-count"></span>
              </div>
            </div>
            <div id="cs-album-checks" class="cs-album-grid">
              ${opt.albums.map((a, i) => `<label class="cs-album-card" title="${sanitize(a.name)}" style="--art-hue:${candyAlbumHue(a.name)}deg;">
                <input type="checkbox" class="cs-album-check" id="cs-album-${i}" data-album-id="${sanitize(a.id)}" value='${sanitize(JSON.stringify(a.trackKeys))}' onchange="candyAlbumCheckChanged(this)">
                <span class="cs-album-card-art">${candyIcon('disc', 16)}</span>
                <span class="cs-album-meta">
                  <span class="cs-album-name">${sanitize(a.name)}</span>
                  <span class="cs-album-count">${a.count} tracks</span>
                </span>
                <span class="cs-album-card-check">✓</span>
              </label>`).join('')}
            </div>` : ''}

            <!-- Mobile-only — desktop gets this same live data in the sticky sidebar. -->
            <div class="cs-mobile-details">
              <button type="button" class="cs-mobile-details-toggle" onclick="candyToggleMobileDetails()" aria-expanded="false" aria-controls="cs-mobile-details-body">
                <span>Track details</span>
                <span class="cs-mobile-details-arrow">▾</span>
              </button>
              <div class="cs-mobile-details-body" id="cs-mobile-details-body">
                <div class="cs-summary-lines">
                  <div class="cs-summary-line"><span>Focus songs</span><span id="cs-stat-focus-mobile">0</span></div>
                  <div class="cs-summary-line"><span>Album tracks</span><span id="cs-stat-album-mobile">0</span></div>
                  <div class="cs-summary-line"><span>Filler tracks</span><span id="cs-stat-filler-mobile">—</span></div>
                  <div class="cs-summary-line"><span>Runtime</span><span id="cs-stat-duration-mobile">—</span></div>
                </div>
                <div class="cs-summary-note" id="cs-summary-note-mobile">Plus filler tracks woven in automatically to keep it feeling natural.</div>
                <div class="cs-summary-preview-title" style="margin-top:12px; margin-bottom:8px;">Track order</div>
                <div class="cs-preview-list" id="cs-preview-list-mobile">
                  <div class="cs-preview-empty">Add a song to see the track order.</div>
                </div>
              </div>
            </div>

            <label class="cs-field-label" for="cs-name" style="margin-top:16px;">Playlist name</label>
            <input id="cs-name" class="input-field" placeholder="Leave blank for a random name">
          </div>
        </div>

        <!-- Desktop-only sticky summary — replaces the mobile bottom bar so
             Generate is always visible without scrolling the whole form. -->
        <aside class="cs-builder-summary">
          <div class="cs-summary-card">
            <div class="cs-summary-title">Your playlist</div>
            <div class="cs-summary-big"><span id="cs-stat-core">0</span> songs</div>
            <div class="cs-summary-lines">
              <div class="cs-summary-line"><span>Focus songs</span><span id="cs-stat-focus">0</span></div>
              <div class="cs-summary-line"><span>Album tracks</span><span id="cs-stat-album">0</span></div>
              <div class="cs-summary-line"><span>Filler tracks</span><span id="cs-stat-filler">—</span></div>
              <div class="cs-summary-line"><span>Runtime</span><span id="cs-stat-duration">—</span></div>
            </div>
            <div class="cs-summary-note" id="cs-summary-note">Plus filler tracks woven in automatically to keep it feeling natural.</div>

            <div class="cs-summary-preview">
              <div class="cs-summary-preview-head">
                <span class="cs-summary-preview-title">Track order</span>
              </div>
              <div class="cs-preview-list" id="cs-preview-list">
                <div class="cs-preview-empty">Add a song to see the track order.</div>
              </div>
            </div>

            <button type="button" class="btn-red" onclick="candyGenerate('custom')">${candyIcon('music')} Generate in Spotify</button>
            <div class="cs-cost-note">🪽 Costs 1 Wing · up to 3 Alpacas a day</div>
          </div>
        </aside>
      </div>

      <div class="cs-actionbar">
        <div class="cs-actionbar-total">
          <span>Estimated</span>
          <span id="cs-estimate-val">0 tracks</span>
        </div>
        <button type="button" class="btn-red" onclick="candyGenerate('custom')">${candyIcon('music')} Generate in Spotify</button>
      </div>
    </div>

    <div id="cs-status" class="cs-status-card"></div>
  </div>`;

  candySyncRowControls();
  candyQuickRefresh();
  candyUpdateEstimate();
}

export async function candyGenerate(mode) {
  const payload = { action: 'generateAlpaca', agentNo: STATE.agentNo, mode };

  // Quick is a pre-filled Custom: the picked goal songs are the focus tracks,
  // so it goes down the same path with default play counts. Only when the goal
  // songs couldn't be resolved does it fall back to letting the backend choose.
  if (mode === 'quick' && (window._candyStar?.goalSongs || []).length) {
    const cs = window._candyStar;
    if (!cs.quickPicks.length) {
      candySetStatus('error', '⚠️ Pick at least one song first.');
      return;
    }
    payload.mode = 'custom';
    payload.focus = cs.quickPicks.map((key, i) => ({ key, multiplier: CANDY_QUICK_MULTS[i] || 4 }));
    payload.album = cs.quickAlbum && cs.arirangAlbum ? cs.arirangAlbum.trackKeys : [];
    payload.name = '';
  }

  if (mode === 'custom') {
    const { focus, album, albumIds, unmatched } = candyCollectCustom({ flagInvalid: true });
    if (unmatched.length) {
      candySetStatus('error', `⚠️ Couldn't match <b>${sanitize(unmatched.slice(0, 3).join(', '))}</b> to a song — start typing and pick from the dropdown that appears, or check the spelling.`);
      return;
    }
    if (!focus.length) {
      candySetStatus('error', '⚠️ Add at least one song with a count.');
      return;
    }
    payload.focus = focus;
    payload.album = album;
    payload.albumIds = albumIds;
    payload.name = $('cs-name')?.value?.trim() || '';
  }

  candySetStatus('loading', `<span class="cs-spinner"></span><span>Building your alpaca… 🦙<br><span style="color:var(--text-ghost); font-size:10.5px;">this can take ~20s</span></span>`);
  const res = await Api.call('generateAlpaca', payload, { dedupe: false, cache: false, timeout: 180000 });

  if (res && res.success) {
    candySetStatus('success', `<span style="font-size:16px;">✅</span><span><b>${sanitize(res.name)}</b> is ready — <a href="${res.url}" target="_blank" style="color:#1DB954; font-weight:800;">open in Spotify ↗</a>
      <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${res.trackCount} tracks</div></span>`);
    showToast('Alpaca created 🦙', 'success');
  } else {
    candySetStatus('error', `<span style="font-size:16px;">⚠️</span><span>${sanitize(res?.error || 'Generation failed.')}</span>`);
  }
}
