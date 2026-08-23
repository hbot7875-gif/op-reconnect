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

function candyGuideShortMode(label, fallback) {
  return String(label || fallback || '').split(/\s+[—–]\s+/)[0].trim();
}

function candyGoalGuideMarkup() {
  const cs = window._candyStar || {};
  const guides = cs.districtGuides || [];
  if (!guides.length) return '';
  const selected = guides.find(d => d.id === cs.guideDistrictId) || guides[0];
  const modes = cs.guideModes || [];
  return `
    <section class="cs-goal-guide" aria-labelledby="cs-goal-guide-title">
      <button type="button" class="cs-goal-guide-toggle" id="cs-goal-guide-title" aria-expanded="false" aria-controls="cs-goal-guide-panel" onclick="candyToggleGoalGuide()">
        <span class="cs-goal-guide-symbol" aria-hidden="true">◎</span>
        <span class="cs-goal-guide-toggle-copy">
          <b>District playlist guide</b>
          <small>See what each district needs before you build.</small>
        </span>
        <span class="cs-goal-guide-open">View goals <span aria-hidden="true">▾</span></span>
      </button>
      <div class="cs-goal-guide-panel" id="cs-goal-guide-panel" hidden>
        <div class="cs-goal-guide-controls">
          <label>
            <span>District</span>
            <select id="cs-guide-district" onchange="candySelectGuideDistrict(this.value)">
              ${guides.map(d => `<option value="${sanitize(d.id)}"${d.id === selected.id ? ' selected' : ''}>${sanitize(d.name)}${d.isCurrent ? ' · current' : ''}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Goal size for</span>
            <select id="cs-guide-mode" onchange="candySelectGuideMode(this.value)">
              ${modes.map(mode => `<option value="${sanitize(mode.id)}"${mode.id === cs.guideMode ? ' selected' : ''}>${sanitize(candyGuideShortMode(mode.label, mode.id))}</option>`).join('')}
            </select>
          </label>
        </div>
        <div id="cs-goal-guide-content"></div>
      </div>
    </section>`;
}

function candyReconnectGuideText(goal) {
  const agents = goal.requiredAgents ? `${goal.requiredAgents} agents` : 'Team mission';
  if (goal.sharedTrack) {
    const target = goal.sharedTrack.target ? ` · ${goal.sharedTrack.target} streams together` : '';
    return `${agents} · ${goal.sharedTrack.label}${target}`;
  }
  if (goal.variant === 'connect' || goal.variant === 'invite') {
    return `${agents} · each person streams their own district goal`;
  }
  return 'Puzzle mission · no special playlist target';
}

function candyGoalGuideRow(kind, goal) {
  const target = goal.targets?.[window._candyStar?.guideMode] ?? Object.values(goal.targets || {})[0] ?? '—';
  const isTrack = kind === 'track';
  const canUse = isTrack ? !!goal.catalogKey : !!goal.catalogAlbumId;
  const detail = isTrack
    ? (goal.artist || 'BTS')
    : `${goal.trackCount || 0} tracks · every track needs ${target} play${Number(target) === 1 ? '' : 's'}`;
  const targetUnit = isTrack ? 'streams' : 'full rounds';
  const dataAttr = isTrack
    ? `data-key="${sanitize(goal.catalogKey || '')}"`
    : `data-album-id="${sanitize(goal.catalogAlbumId || '')}"`;
  const handler = isTrack ? 'candyGuideUseTrack(this)' : 'candyGuideUseAlbum(this)';
  return `<div class="cs-guide-goal-row">
    <span class="cs-guide-goal-icon" aria-hidden="true">${isTrack ? candyIcon('music', 15) : candyIcon('disc', 15)}</span>
    <span class="cs-guide-goal-copy"><b>${sanitize(goal.label)}</b><small>${sanitize(detail)}</small></span>
    <span class="cs-guide-goal-target"><b>${sanitize(target)}</b><small>${targetUnit}</small></span>
    <button type="button" class="cs-guide-use" ${dataAttr} onclick="${handler}"${canUse ? '' : ' disabled title="Not available in the Candy Star catalog yet"'}>${canUse ? 'Use' : 'Unavailable'}</button>
  </div>`;
}

function candyRenderGoalGuide() {
  const cs = window._candyStar || {};
  const mount = $('cs-goal-guide-content');
  if (!mount) return;
  const district = (cs.districtGuides || []).find(d => d.id === cs.guideDistrictId) || cs.districtGuides?.[0];
  if (!district) { mount.innerHTML = '<div class="cs-guide-empty">No district goals are configured yet.</div>'; return; }
  cs.guideDistrictId = district.id;
  const trackRows = (district.tracks || []).map(goal => candyGoalGuideRow('track', goal)).join('');
  const albumRows = (district.albums || []).map(goal => candyGoalGuideRow('album', goal)).join('');
  const reconnectRows = (district.reconnect || []).map(goal => `<div class="cs-guide-reconnect-row">
    <span class="cs-guide-goal-icon" aria-hidden="true">⌁</span>
    <span class="cs-guide-goal-copy"><b>${sanitize(goal.label)}</b><small>${sanitize(candyReconnectGuideText(goal))}</small></span>
  </div>`).join('');
  const counts = [
    `${(district.tracks || []).length} song${district.tracks?.length === 1 ? '' : 's'}`,
    `${(district.albums || []).length} album${district.albums?.length === 1 ? '' : 's'}`,
    `${(district.reconnect || []).length} ReConnect`,
  ].join(' · ');
  mount.innerHTML = `
    <div class="cs-guide-district-head">
      <div>
        <span class="cs-guide-ward">${sanitize(district.wardName || 'District')}</span>
        <h3>${sanitize(district.name)}</h3>
        <p>${counts}</p>
      </div>
      ${district.isCurrent ? '<span class="cs-guide-current"><i></i>Your current district</span>' : ''}
    </div>
    <div class="cs-guide-explainer">These are the <b>whole district targets</b>. Album rounds mean every listed track needs that many plays.</div>
    ${trackRows ? `<div class="cs-guide-group"><div class="cs-guide-group-title"><span>Focus songs</span><small>${district.tracks.length}</small></div>${trackRows}</div>` : ''}
    ${albumRows ? `<div class="cs-guide-group"><div class="cs-guide-group-title"><span>Albums</span><small>${district.albums.length}</small></div>${albumRows}</div>` : ''}
    ${reconnectRows ? `<div class="cs-guide-group"><div class="cs-guide-group-title"><span>ReConnect</span><small>${district.reconnect.length > 1 ? 'one is assigned at activation' : 'team goal'}</small></div>${reconnectRows}</div>` : ''}
    <div class="cs-guide-tip"><b>Playlist tip:</b> use 1–2 focus songs with 1–2 albums. For a large district, make several focused playlists instead of squeezing every goal into one.</div>`;
}

export function candyToggleGoalGuide() {
  const panel = $('cs-goal-guide-panel');
  const button = $('cs-goal-guide-title');
  if (!panel || !button) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  button.setAttribute('aria-expanded', opening ? 'true' : 'false');
  button.classList.toggle('is-open', opening);
  if (opening) candyRenderGoalGuide();
}

export function candySelectGuideDistrict(id) {
  if (!window._candyStar) return;
  window._candyStar.guideDistrictId = id;
  candyRenderGoalGuide();
}

export function candySelectGuideMode(mode) {
  if (!window._candyStar) return;
  window._candyStar.guideMode = mode;
  candyRenderGoalGuide();
}

function candyGuideOpenBuilder(anchor) {
  candySwitchTab('custom');
  requestAnimationFrame(() => {
    (anchor || document.querySelector('#cs-panel-custom .archive-card'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function candyGuideUseTrack(button) {
  const key = button?.dataset?.key;
  const cs = window._candyStar || {};
  const label = cs.keyToLabel?.[key];
  if (!key || !label) { showToast('This song is not available in the playlist maker yet.'); return; }
  const rows = [...document.querySelectorAll('#cs-focus-rows .cs-focus-row')];
  const existing = rows.find(row => row.querySelector('.cs-focus-sel')?.dataset?.resolvedKey === key);
  if (existing) {
    candyGuideOpenBuilder(existing);
    showToast('That song is already in your setup.');
    return;
  }
  let row = rows.find(item => !item.querySelector('.cs-focus-sel')?.value?.trim());
  if (!row && rows.length < CS_MAX_FOCUS_ROWS) {
    candyAddFocusRow();
    row = document.querySelector('#cs-focus-rows .cs-focus-row:last-child');
  }
  if (!row) { showToast('This setup already has 2 focus songs — remove one first.'); return; }
  const input = row.querySelector('.cs-focus-sel');
  input.value = label;
  input.dataset.resolvedKey = key;
  input.classList.remove('cs-invalid');
  candyAddRecent(key, label);
  candyUpdateEstimate();
  candyGuideOpenBuilder(row);
  showToast('Goal song added — choose how many repeats this playlist needs.');
}

export function candyGuideUseAlbum(button) {
  const albumId = button?.dataset?.albumId;
  const checkbox = [...document.querySelectorAll('.cs-album-check')].find(input => input.dataset.albumId === albumId);
  if (!checkbox) { showToast('This album is not available in the playlist maker yet.'); return; }
  if (!checkbox.checked) {
    checkbox.checked = true;
    candyAlbumCheckChanged(checkbox);
  }
  if (!checkbox.checked) return;
  candyGuideOpenBuilder(checkbox.closest('.cs-album-card'));
  showToast('Album added to your setup.');
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
const CS_HEAVY_FOCUS_PLAYS = 15;
const CS_HEAVY_FOCUS_ERROR = `A ${CS_HEAVY_FOCUS_PLAYS}× focus song needs its own playlist — remove the other focus song. You can still add albums.`;

function candyHasHeavyFocusConflict(focus) {
  const valid = Array.isArray(focus) ? focus.filter(entry => entry?.key && Number(entry.multiplier) > 0) : [];
  return new Set(valid.map(entry => entry.key)).size > 1 &&
    valid.some(entry => Number(entry.multiplier) >= CS_HEAVY_FOCUS_PLAYS);
}

export function candyAddFocusRow() {
  const wrap = $('cs-focus-rows');
  const hasHeavy = [...(wrap?.querySelectorAll('.cs-focus-mult') || [])]
    .some(input => (parseInt(input.value) || 0) >= CS_HEAVY_FOCUS_PLAYS);
  if (hasHeavy) { showToast(`${CS_HEAVY_FOCUS_PLAYS}× needs to be your only focus song.`); return; }
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
  const hasHeavy = [...(wrap?.querySelectorAll('.cs-focus-mult') || [])]
    .some(input => (parseInt(input.value) || 0) >= CS_HEAVY_FOCUS_PLAYS);
  if (wrap && addBtn) addBtn.style.display = wrap.children.length >= CS_MAX_FOCUS_ROWS || hasHeavy ? 'none' : '';
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

  candySyncRowControls();
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
    const msg = res?.error && /^(Pick exactly one of|A 15× focus song|.+ can't be used for generated playlists)/.test(res.error)
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
  if (tab === 'vault') {
    if (candyVaultState().items.length) candyRenderVault();
    else candyLoadVault(true);
  }
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

// ==================== PLAYLIST VAULT ====================

function candyVaultState() {
  if (!window._candyVault) {
    window._candyVault = { view: 'community', items: [], offset: 0, hasMore: false, loading: false, query: '' };
  }
  return window._candyVault;
}

function candyVaultDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function candyVaultFocus(config) {
  const display = Array.isArray(config?.display?.focus) ? config.display.focus : [];
  if (display.length) {
    return display.map(item => ({
      name: item.name || 'Focus song',
      plays: Number(item.plays || item.multiplier) || 0,
    }));
  }
  return (Array.isArray(config?.focus) ? config.focus : []).map(item => {
    const key = item.key || item.isrc;
    const label = window._candyStar?.keyToLabel?.[key] || 'Focus song';
    return { name: label.split(' — ')[0], plays: Number(item.multiplier) || 0 };
  });
}

function candyVaultAlbums(config) {
  if (Array.isArray(config?.display?.albums) && config.display.albums.length) return config.display.albums;
  const ids = new Set(Array.isArray(config?.albumIds) ? config.albumIds : []);
  if (ids.size) return (window._candyStar?.albums || []).filter(album => ids.has(album.id)).map(album => album.name);
  const wanted = new Set(Array.isArray(config?.album) ? config.album : []);
  if (!wanted.size) return [];
  return (window._candyStar?.albums || [])
    .filter(album => album.trackKeys?.length && album.trackKeys.every(key => wanted.has(key)))
    .slice(0, 2)
    .map(album => album.name);
}

function candyVaultRuntime(config) {
  const ms = Number(config?.runtimeMs) || 0;
  if (!ms) return '';
  const mins = Math.round(ms / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function candyVaultRecipe(item) {
  if (item.source === 'shared') return 'Shared by an agent';
  const focus = candyVaultFocus(item.config);
  const albums = candyVaultAlbums(item.config);
  const parts = [
    ...focus.map(song => `${song.name}${song.plays ? ` ×${song.plays}` : ''}`),
    ...albums.map(name => `${name} album`),
  ];
  return parts.length ? parts.join(' · ') : 'Candy Star mix';
}

function candyVaultCard(item) {
  const thumb = typeof item.config?.thumbnailUrl === 'string' && /^https:\/\//.test(item.config.thumbnailUrl)
    ? `<img src="${sanitize(item.config.thumbnailUrl)}" alt="" loading="lazy">`
    : `<span aria-hidden="true">${item.source === 'shared' ? '♫' : '🦙'}</span>`;
  const runtime = candyVaultRuntime(item.config);
  const meta = [
    item.trackCount ? `${item.trackCount} tracks` : '',
    runtime,
    item.saveCount ? `${item.saveCount} saved` : '',
  ].filter(Boolean);
  return `<article class="cs-vault-card" data-playlist-id="${sanitize(item.playlistId)}">
    <div class="cs-vault-art">${thumb}</div>
    <div class="cs-vault-body">
      <div class="cs-vault-kicker"><span>${item.source === 'shared' ? 'Shared playlist' : 'Candy Star mix'}</span><span>${sanitize(candyVaultDate(item.createdAt))}</span></div>
      <h3>${sanitize(item.name)}</h3>
      <p class="cs-vault-recipe">${sanitize(candyVaultRecipe(item))}</p>
      <div class="cs-vault-by">By ${sanitize(item.creator)}${meta.length ? ` · ${sanitize(meta.join(' · '))}` : ''}</div>
      <div class="cs-vault-actions">
        <a class="cs-vault-open" href="${sanitize(item.url)}" target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a>
        ${item.source === 'generated' && Array.isArray(item.config?.focus) && item.config.focus.length
          ? `<button type="button" class="cs-vault-action" onclick="candyRemixPlaylist('${sanitize(item.playlistId)}')">Use setup</button>` : ''}
        <button type="button" class="cs-vault-action ${item.saved ? 'is-saved' : ''}" aria-pressed="${item.saved ? 'true' : 'false'}" onclick="candyToggleVaultSave('${sanitize(item.playlistId)}')">${item.saved ? 'Saved ✓' : 'Save'}</button>
        ${item.isMine
          ? `<button type="button" class="cs-vault-delete" onclick="candyDeleteVaultPlaylist('${sanitize(item.playlistId)}')">Delete</button>`
          : `<button type="button" class="cs-vault-report" ${item.reported ? 'disabled' : ''} onclick="candyReportVaultPlaylist('${sanitize(item.playlistId)}')">${item.reported ? 'Reported' : 'Broken link?'}</button>`}
      </div>
    </div>
  </article>`;
}

function candyRenderVault() {
  const state = candyVaultState();
  const list = $('cs-vault-list');
  if (!list) return;
  const query = state.query.trim().toLowerCase();
  const visible = query
    ? state.items.filter(item => `${item.name} ${candyVaultRecipe(item)} ${item.creator}`.toLowerCase().includes(query))
    : state.items;

  if (!visible.length && !state.loading) {
    const label = state.view === 'mine' ? 'You have not added a playlist yet.'
      : state.view === 'saved' ? 'Your saved playlists will wait here.'
      : query ? 'No playlists match that search.' : 'The Vault is waiting for its first playlist.';
    list.innerHTML = `<div class="cs-vault-empty"><span>♫</span><b>${sanitize(label)}</b><small>${state.view === 'community' ? 'Generate one or share a Spotify link above.' : 'Browse Community to find one.'}</small></div>`;
  } else {
    list.innerHTML = visible.map(candyVaultCard).join('');
  }
  const more = $('cs-vault-more');
  if (more) {
    more.hidden = !state.hasMore || !!query;
    more.disabled = state.loading;
    more.textContent = state.loading ? 'Loading…' : 'Load more';
  }
}

export async function candyLoadVault(reset = true) {
  const state = candyVaultState();
  if (state.loading) return;
  state.loading = true;
  if (reset) {
    state.items = [];
    state.offset = 0;
    const list = $('cs-vault-list');
    if (list) list.innerHTML = `<div class="cs-vault-loading"><span class="cs-spinner"></span>Opening the Vault…</div>`;
  }
  const res = await Api.call('getCandyPlaylistLibrary', {
    view: state.view,
    offset: state.offset,
    limit: 24,
  });
  state.loading = false;
  if (!res?.success) {
    const list = $('cs-vault-list');
    if (list) list.innerHTML = `<div class="cs-vault-empty"><b>Couldn't open the Vault.</b><small>${sanitize(res?.error || 'Please try again.')}</small><button type="button" class="cs-vault-action" onclick="candyLoadVault(true)">Try again</button></div>`;
    return;
  }
  state.items = reset ? (res.playlists || []) : [...state.items, ...(res.playlists || [])];
  state.offset = Number(res.nextOffset) || state.items.length;
  state.hasMore = !!res.hasMore;
  candyRenderVault();
}

export function candyVaultView(view) {
  const state = candyVaultState();
  if (!['community', 'mine', 'saved'].includes(view) || state.view === view) return;
  state.view = view;
  document.querySelectorAll('.cs-vault-filter').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  candyLoadVault(true);
}

export function candyVaultSearch(input) {
  candyVaultState().query = input.value || '';
  candyRenderVault();
}

export function candyLoadVaultMore() { candyLoadVault(false); }

export function candyToggleVaultShare() {
  const form = $('cs-vault-share-form');
  const button = $('cs-vault-share-toggle');
  if (!form) return;
  form.hidden = !form.hidden;
  if (button) button.setAttribute('aria-expanded', form.hidden ? 'false' : 'true');
  if (!form.hidden) $('cs-vault-url')?.focus();
}

export async function candyShareVaultPlaylist() {
  const input = $('cs-vault-url');
  const button = $('cs-vault-share-btn');
  const message = $('cs-vault-share-message');
  const url = input?.value?.trim() || '';
  if (!url) { if (message) message.textContent = 'Paste a Spotify playlist link first.'; return; }
  if (button) { button.disabled = true; button.textContent = 'Checking Spotify…'; }
  if (message) message.textContent = '';
  const res = await Api.call('shareCandyPlaylist', { url });
  if (button) { button.disabled = false; button.textContent = 'Add to Vault'; }
  if (!res?.success) { if (message) message.textContent = res?.error || 'Could not add that playlist.'; return; }
  if (input) input.value = '';
  if (message) message.textContent = res.alreadyThere ? 'That playlist is already in the Vault.' : `${res.name} was added for everyone.`;
  const state = candyVaultState();
  state.view = 'community';
  document.querySelectorAll('.cs-vault-filter').forEach(b => b.classList.toggle('is-active', b.dataset.view === 'community'));
  await candyLoadVault(true);
}

export async function candyToggleVaultSave(playlistId) {
  const state = candyVaultState();
  const item = state.items.find(entry => entry.playlistId === playlistId);
  if (!item) return;
  const next = !item.saved;
  const res = await Api.call('setCandyPlaylistSaved', { playlistId, saved: next });
  if (!res?.success) { showToast(res?.error || 'Could not update that save.'); return; }
  state.items.forEach(entry => {
    if (entry.playlistId === playlistId) {
      entry.saved = next;
      entry.saveCount = Math.max(0, (Number(entry.saveCount) || 0) + (next ? 1 : -1));
    }
  });
  if (!next && state.view === 'saved') state.items = state.items.filter(entry => entry.playlistId !== playlistId);
  candyRenderVault();
}

export async function candyReportVaultPlaylist(playlistId) {
  const state = candyVaultState();
  const item = state.items.find(entry => entry.playlistId === playlistId);
  if (!item || item.reported) return;
  if (!window.confirm('Report this only if the Spotify link no longer opens. Continue?')) return;
  const res = await Api.call('reportCandyPlaylist', { playlistId });
  if (!res?.success) { showToast(res?.error || 'Could not send that report.'); return; }
  if (res.hidden) state.items = state.items.filter(entry => entry.playlistId !== playlistId);
  else item.reported = true;
  candyRenderVault();
  showToast(res.hidden ? 'Broken playlist removed from the Vault.' : 'Report sent. Thank you.');
}

export async function candyDeleteVaultPlaylist(playlistId) {
  const state = candyVaultState();
  const item = state.items.find(entry => entry.playlistId === playlistId);
  if (!item?.isMine) return;
  const message = item.source === 'generated'
    ? 'Delete this playlist from the Vault and the connected Spotify library? This cannot be undone.'
    : 'Delete this shared playlist from the Vault? This cannot be undone.';
  if (!window.confirm(message)) return;
  const res = await Api.call('deleteCandyPlaylist', { playlistId });
  if (!res?.success) { showToast(res?.error || 'Could not delete that playlist.'); return; }
  state.items = state.items.filter(entry => entry.playlistId !== playlistId);
  candyRenderVault();
  showToast(res.warning || 'Playlist deleted.', res.warning ? undefined : 'success');
}

export function candyRemixPlaylist(playlistId) {
  const item = candyVaultState().items.find(entry => entry.playlistId === playlistId);
  const focus = Array.isArray(item?.config?.focus) ? item.config.focus.slice(0, CS_MAX_FOCUS_ROWS) : [];
  if (!item || !focus.length) return;
  const rows = $('cs-focus-rows');
  if (!rows) return;
  rows.innerHTML = focus.map(entry => candyFocusRow(Number(entry.multiplier) || 1)).join('');
  const display = Array.isArray(item.config?.display?.focus) ? item.config.display.focus : [];
  rows.querySelectorAll('.cs-focus-row').forEach((row, index) => {
    const entry = focus[index];
    const key = entry.key || entry.isrc;
    const named = display.find(value => value.key === key);
    const input = row.querySelector('.cs-focus-sel');
    if (input) {
      input.dataset.resolvedKey = key;
      input.value = named?.name
        ? `${named.name} — ${(named.artists || ['BTS']).join(', ')}`
        : (window._candyStar?.keyToLabel?.[key] || '');
    }
  });

  const albumIds = new Set(Array.isArray(item.config?.albumIds) ? item.config.albumIds : []);
  const albumKeys = new Set(Array.isArray(item.config?.album) ? item.config.album : []);
  let selected = 0;
  document.querySelectorAll('.cs-album-check').forEach(box => {
    let checked = albumIds.has(box.dataset.albumId);
    if (!checked && !albumIds.size && albumKeys.size) {
      try {
        const keys = JSON.parse(box.value || '[]');
        checked = keys.length > 0 && keys.every(key => albumKeys.has(key));
      } catch (_) { checked = false; }
    }
    box.checked = checked && selected++ < CS_MAX_ALBUMS;
  });
  const name = $('cs-name');
  if (name) name.value = `${item.name} remix`;
  candySyncRowControls();
  candyUpdateEstimate();
  candySwitchTab('custom');
  document.querySelector('.cs-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ((item.config.focus || []).length > CS_MAX_FOCUS_ROWS) showToast('Loaded the first two focus songs.');
  else showToast('Setup loaded — adjust anything, then generate.');
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
    districtGuides: opt.districtGuides || [], guideModes: opt.modes || [],
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
  window._candyStar.guideMode = (opt.modes || []).some(mode => mode.id === window.__rcState?.player?.mode)
    ? window.__rcState.player.mode
    : (opt.modes?.[0]?.id || 'easy');
  window._candyStar.guideDistrictId = (opt.districtGuides || []).find(d => d.isCurrent)?.id || opt.districtGuides?.[0]?.id || null;

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
      <button type="button" class="cs-tab" data-tab="vault" role="tab" aria-selected="false" onclick="candySwitchTab('vault')">${candyIcon('sparkles')} Vault</button>
    </div>

    ${candyGoalGuideMarkup()}

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
        <div class="cs-cost-note">🪽 Costs 1 Wing · up to 5 Alpacas a day</div>
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
                <input type="checkbox" class="cs-album-check" id="cs-album-${i}" data-album-id="${sanitize(a.id)}" value="${sanitize(JSON.stringify(a.trackKeys))}" onchange="candyAlbumCheckChanged(this)">
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
            <div class="cs-cost-note">🪽 Costs 1 Wing · up to 5 Alpacas a day</div>
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

    <!-- PLAYLIST VAULT -->
    <div class="cs-panel" id="cs-panel-vault" role="tabpanel">
      <section class="cs-vault-hero">
        <div>
          <span class="cs-vault-eyebrow">Community playlist library</span>
          <h2>One playlist can help everyone.</h2>
          <p>Open a ready-made mix, save it for later, or share a public Spotify playlist with the city.</p>
        </div>
        <button type="button" class="cs-vault-share-toggle" id="cs-vault-share-toggle" aria-expanded="false" onclick="candyToggleVaultShare()">+ Share playlist</button>
      </section>

      <div class="cs-vault-share" id="cs-vault-share-form" hidden>
        <label class="cs-field-label" for="cs-vault-url">Spotify playlist link</label>
        <div class="cs-vault-share-row">
          <input id="cs-vault-url" class="input-field" type="url" inputmode="url" autocomplete="off" placeholder="https://open.spotify.com/playlist/…">
          <button type="button" id="cs-vault-share-btn" class="btn-red" onclick="candyShareVaultPlaylist()">Add to Vault</button>
        </div>
        <div class="cs-vault-share-note">Spotify checks the title and public link before it appears. Up to 5 shares a day.</div>
        <div class="cs-vault-share-message" id="cs-vault-share-message" role="status"></div>
      </div>

      <div class="cs-vault-tools">
        <div class="cs-vault-filters" role="tablist" aria-label="Playlist library view">
          <button type="button" class="cs-vault-filter is-active" data-view="community" role="tab" aria-selected="true" onclick="candyVaultView('community')">Community</button>
          <button type="button" class="cs-vault-filter" data-view="mine" role="tab" aria-selected="false" onclick="candyVaultView('mine')">Mine</button>
          <button type="button" class="cs-vault-filter" data-view="saved" role="tab" aria-selected="false" onclick="candyVaultView('saved')">Saved</button>
        </div>
        <label class="cs-vault-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Search song or album" aria-label="Search playlists" oninput="candyVaultSearch(this)">
        </label>
      </div>

      <div class="cs-vault-list" id="cs-vault-list">
        <div class="cs-vault-empty"><span>♫</span><b>Open the Vault to see community playlists.</b></div>
      </div>
      <button type="button" class="cs-vault-more" id="cs-vault-more" onclick="candyLoadVaultMore()" hidden>Load more</button>
    </div>

    <div id="cs-status" class="cs-status-card"></div>
  </div>`;

  candySyncRowControls();
  candyQuickRefresh();
  const vaultState = candyVaultState();
  document.querySelectorAll('.cs-vault-filter').forEach(button => {
    const active = button.dataset.view === vaultState.view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
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
    if (candyHasHeavyFocusConflict(focus)) {
      candySetStatus('error', `⚠️ ${sanitize(CS_HEAVY_FOCUS_ERROR)}`);
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
    const vault = candyVaultState();
    vault.items = [];
    vault.offset = 0;
    candySetStatus('success', `<span style="font-size:16px;">✅</span><span><b>${sanitize(res.name)}</b> is ready — <a href="${sanitize(res.url)}" target="_blank" rel="noopener noreferrer" style="color:#1DB954; font-weight:800;">open in Spotify ↗</a>
      <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${res.trackCount} tracks${res.savedToVault === false ? ' · Vault save is retrying later' : ' · saved to the Community Vault'}</div></span>`);
    showToast('Alpaca created 🦙', 'success');
  } else {
    // The backend's real message is a rule-by-rule breakdown meant for
    // debugging a stuck generation, not something a player needs to parse —
    // this failure mode is a known, safely-retryable one (no Wing spent,
    // the playlist that failed validation is already deleted), so just say
    // that plainly instead.
    const simple = /^Spotify copy (failed live validation|could not be verified)/.test(res?.error || '')
      ? "Spotify hiccuped building this one — no Wing was spent. Just hit Generate again."
      : (res?.error || 'Generation failed.');
    candySetStatus('error', `<span style="font-size:16px;">⚠️</span><span>${sanitize(simple)}</span>`);
  }
}
