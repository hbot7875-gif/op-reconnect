// Authored-pass preview harness — PREVIEW ONLY, not imported by main.js.
//
// Renders each affected area twice from one mock payload: the current
// build on the left, the proposal on the right (wrapped in .ap-after,
// which is the only thing css/authored-pass.css targets). Same markup,
// same data, same components — the only variable is the stylesheet, so
// any difference you see is the change itself and nothing else.
//
// Follows the pack-preview.js pattern already established in this repo:
// self-contained markup built against the real data shapes, so no
// production module has to be edited to look at a proposal.

const el = (tag, cls, html) => {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (html !== undefined) n.innerHTML = html
  return n
}

/* ── mock payload — field names match handlers.ts buildState() ──────── */
const SWEEP = {
  todayDone: false,
  todayDoneCount: 2,
  weeklyRequired: 20,
  weekDone: false,
  xpOnComplete: 40,
  weeklyXpOnComplete: 120,
  weekDates: ['2026-08-17', '2026-08-23'],
  tracks: [
    { id: 't1', name: 'Spring Day', artist: 'BTS', todayDone: true, todayCount: 3, weeklyTotal: 18, weeklyRequired: 20, weeklyDone: false,
      days: [{ done: true, count: 4 }, { done: true, count: 3 }, { done: false, count: 0 }, { done: true, count: 5 }, { done: true, count: 3 }, { done: true, count: 3 }, { future: true }] },
    { id: 't2', name: 'Dynamite', artist: 'BTS', todayDone: true, todayCount: 2, weeklyTotal: 20, weeklyRequired: 20, weeklyDone: true,
      days: [{ done: true, count: 4 }, { done: true, count: 4 }, { done: true, count: 3 }, { done: true, count: 3 }, { done: true, count: 4 }, { done: true, count: 2 }, { future: true }] },
    { id: 't3', name: 'Blue & Grey', artist: 'BTS', todayDone: false, todayCount: 0, weeklyTotal: 11, weeklyRequired: 20, weeklyDone: false,
      days: [{ done: true, count: 3 }, { done: false, count: 0 }, { done: true, count: 4 }, { done: false, count: 0 }, { done: true, count: 4 }, { done: false, count: 0 }, { future: true }] },
    { id: 't4', name: 'Mikrokosmos', artist: 'BTS', todayDone: false, todayCount: 0, weeklyTotal: 9, weeklyRequired: 20, weeklyDone: false,
      days: [{ done: true, count: 3 }, { done: true, count: 3 }, { done: false, count: 0 }, { done: false, count: 0 }, { done: true, count: 3 }, { done: false, count: 0 }, { future: true }] },
  ],
}

const BOMB = {
  communityStreams: 48213,
  chargeWindowDays: 5,
  cityRecovery: 34,
  defuse: null,
}

/* ── ITEM 1 · Signal Sweep ───────────────────────────────────────────
   Two copy sets. Only the state words change — the feature, its name,
   its kicker and its structure are untouched. */
const COPY = {
  before: {
    today: (m, done, total) => (m.todayDone ? 'SECURED' : `${done}/${total} TODAY`),
    week: (m, gaps) => (m.weekDone ? 'WEEK CLEAR' : `${gaps} behind this week`),
    reward: (m) => (m.todayDone ? `+${m.xpOnComplete} XP secured today` : `Complete all four today · +${m.xpOnComplete} XP`),
    weekReward: (m) => (m.weekDone ? `+${m.weeklyXpOnComplete} XP secured this week` : `Clear all four at ${m.weeklyRequired}× this week · +${m.weeklyXpOnComplete} XP`),
    sheetTitle: (m, done, total) => (m.todayDone ? 'BOTZ signal stabilized' : `${done}/${total} signals recovered`),
    statToday: (m) => (m.todayDone ? 'SECURED' : 'PENDING'),
    statWeek: (m, gaps) => (m.weekDone ? 'CLEAR' : `${gaps} GAP${gaps === 1 ? '' : 'S'}`),
    trackToday: (t) => (t.todayDone ? `✓ Done today (${t.todayCount}×)` : 'Not streamed today yet'),
  },
  after: {
    today: (m, done, total) => (m.todayDone ? 'Done today' : `${done}/${total} today`),
    week: (m, gaps) => (m.weekDone ? 'Week done' : `${gaps} to go this week`),
    reward: (m) => (m.todayDone ? `+${m.xpOnComplete} XP earned today` : `Finish all four today · +${m.xpOnComplete} XP`),
    weekReward: (m) => (m.weekDone ? `+${m.weeklyXpOnComplete} XP earned this week` : `All four at ${m.weeklyRequired}× this week · +${m.weeklyXpOnComplete} XP`),
    sheetTitle: (m, done, total) => (m.todayDone ? 'All four done today' : `${done} of ${total} done today`),
    statToday: (m) => (m.todayDone ? 'Done' : 'Not yet'),
    statWeek: (m, gaps) => (m.weekDone ? 'Done' : `${gaps} to go`),
    trackToday: (t) => (t.todayDone ? `✓ Done today (${t.todayCount}×)` : 'Not streamed today yet'),
  },
}

function sweepPanel(m, copy) {
  const done = m.todayDoneCount
  const total = m.tracks.length
  const gaps = m.tracks.filter((t) => !t.weeklyDone).length
  const section = el('section', 'side-missions' + (m.todayDone ? ' is-cleared' : ''))
  section.innerHTML = `
    <div class="side-mission-head">
      <div><span class="side-mission-kicker">Stabilize the BOTZ signal</span><h3>Signal Sweep</h3></div>
      <div class="side-mission-status">
        <span class="side-mission-today">${copy.today(m, done, total)}</span>
        <span class="side-mission-week-tag${m.weekDone ? ' is-done' : ''}">${copy.week(m, gaps)}</span>
      </div>
    </div>
    <p class="side-mission-rule">Stream each track <b>1×</b> today <em>and</em> <b>${m.weeklyRequired}×</b> total this week.</p>
    <p class="side-mission-reset">Daily resets at midnight KST &middot; week resets Monday KST</p>
    <div class="side-mission-tracks"></div>
    <div class="side-mission-reward">${copy.reward(m)}</div>
    <div class="side-mission-week-reward${m.weekDone ? ' is-done' : ''}">${copy.weekReward(m)}</div>`

  const list = section.querySelector('.side-mission-tracks')
  for (const t of m.tracks) {
    const pct = Math.min(100, Math.round((t.weeklyTotal / t.weeklyRequired) * 100))
    const row = el('button', 'side-mission-track' + (t.todayDone ? ' is-done' : ''))
    row.type = 'button'
    row.innerHTML = `
      <span class="side-track-check">${t.todayDone ? '✓' : '○'}</span>
      <span class="side-track-copy"><b>${t.name}</b><i>${t.artist} &middot; ${t.todayDone ? 'Done today' : 'Not streamed today'}</i></span>
      <span class="side-track-week">${t.weeklyTotal}/${t.weeklyRequired}</span>
      <span class="side-track-bar"><i style="width:${pct}%"></i></span>`
    list.appendChild(row)
  }
  return section
}

function sweepSheet(m, copy) {
  const done = m.todayDoneCount
  const total = m.tracks.length
  const gaps = m.tracks.filter((t) => !t.weeklyDone).length
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const sheet = el('div', 'sheet side-mission-sheet')
  sheet.append(el('div', 'eyebrow', 'SIGNAL SWEEP'), el('h3', '', copy.sheetTitle(m, done, total)))
  const status = el('div', 'side-sheet-status')
  status.innerHTML = `
    <div class="side-sheet-stat"><span>Today</span><b class="${m.todayDone ? 'ok' : 'warn'}">${copy.statToday(m)}</b></div>
    <div class="side-sheet-stat"><span>This week</span><b class="${m.weekDone ? 'ok' : 'warn'}">${copy.statWeek(m, gaps)}</b></div>`
  sheet.appendChild(status)
  for (const t of m.tracks.slice(0, 3)) {
    const row = el('div', 'side-sheet-track')
    row.innerHTML = `
      <div class="side-sheet-title"><b>${t.name}</b><span>${t.weeklyTotal}/${t.weeklyRequired} this week</span></div>
      <div class="side-sheet-today ${t.todayDone ? 'ok' : 'warn'}">${copy.trackToday(t)}</div>
      <div class="side-sheet-days">${t.days.map((d, i) => `
        <span class="${d.future ? 'future' : d.done ? 'done' : 'miss'}"><i>${days[i]}</i><b>${d.future ? '·' : d.count}</b></span>`).join('')}</div>`
    sheet.appendChild(row)
  }
  return sheet
}

/* ── ITEM 2 · identity + photo chrome ────────────────────────────────
   Four crest states in a row so "does the glow report anything" can be
   answered by looking, not by reading CSS. In the current build all
   four glow identically. */
const PHOTO = 'https://lcvmwlioqpyaprxicdfl.supabase.co/storage/v1/object/public/badge-art/set1/taehyung.jpg'

function crestRow(after) {
  const wrap = el('div', 'ap-crest-row')
  const specs = [
    { cls: '', label: 'no badge', inner: '<b>⟭⟬</b>' },
    { cls: ' has-badge', label: 'badge', inner: '<b>🎖️</b>' },
    { cls: ' has-photo', label: 'photo', inner: `<img class="hud-crest-photo" src="${PHOTO}" alt="">` },
    { cls: ' has-badge has-photo' + (after ? ' is-rare' : ''), label: 'rare + photo', inner: `<img class="hud-crest-photo" src="${PHOTO}" alt="">` },
  ]
  for (const s of specs) {
    const cell = el('div', 'ap-crest-cell')
    cell.innerHTML = `<span class="hud-crest${s.cls}"><i></i>${s.inner}</span><small>${s.label}</small>`
    wrap.appendChild(cell)
  }
  const streaks = el('div', 'ap-crest-cell ap-streak-cell')
  streaks.innerHTML = `
    <span class="hud-streak${after ? ' is-cold' : ''}">○ 0D</span>
    <span class="hud-streak">🔥 7D</span>
    <small>streak: 0 vs 7</small>`
  wrap.appendChild(streaks)
  return wrap
}

function rankRows(after) {
  const wrap = el('div', 'rank-list')
  const rows = [
    { place: '🥇', name: 'Nightflare', lvl: 12, xp: 6140, top: true, photo: true },
    { place: '🥈', name: 'Moonwake', lvl: 11, xp: 5820, top: true, photo: false },
    { place: 4, name: 'Sablewing', lvl: 9, xp: 4110, top: false, photo: true },
    { place: 5, name: 'Quietfox', lvl: 8, xp: 3902, top: false, photo: false },
  ]
  for (const r of rows) {
    const row = el('div', 'rank-row' + (r.top ? ' is-top' : ''))
    row.innerHTML = `
      <span class="rank-place">${r.place}</span>
      <span class="rank-agent-icon">${r.photo ? `<img class="rank-agent-photo" src="${PHOTO}" alt="">` : '⟭⟬'}</span>
      <span class="rank-main">
        <span class="rank-name">${r.name}</span>
        <span class="rank-sub">Level ${r.lvl}</span>
      </span>
      <span class="rank-xp">${r.xp.toLocaleString()} <span class="rank-xp-unit">total XP</span></span>`
    wrap.appendChild(row)
  }
  return wrap
}

function badgeSummary() {
  const wrap = el('div', 'bdr-summary')
  wrap.innerHTML = `
    <span class="bdr-summary-mark">🎖️</span>
    <div><div class="bdr-count">14 of 42 unlocked</div>
    <div class="bdr-summary-note">Tap a badge to see its story</div></div>`
  return wrap
}

/* ── ITEM 3 · Candy Star card ────────────────────────────────────── */
function candyCard() {
  const card = el('div', 'archive-card')
  card.style.textAlign = 'center'
  card.innerHTML = `
    <div class="cs-hero-icon">🦙</div>
    <div style="font-size:14px; font-weight:900; color:#fff; margin-bottom:8px;">One tap, one alpaca</div>
    <div style="font-size:11.5px; color:var(--muted); line-height:1.6; max-width:420px; margin:0 auto 12px;">
      Pick the goal songs you want on repeat — <b>up to 3</b>.</div>
    <button type="button" class="btn-red">🦙 Make me an alpaca</button>
    <div class="cs-cost-note">🪽 Costs 1 Wing · up to 5 Alpacas a day</div>`
  return card
}

/* ── ITEM 4 · bomb sheet + progress sheet ────────────────────────── */
const R = 54
const CIRC = 2 * Math.PI * R

function gauge(frac) {
  const g = el('div', 'bg-gauge')
  g.innerHTML = `
    <svg viewBox="0 0 130 130" aria-hidden="true">
      <circle class="bg-track" cx="65" cy="65" r="${R}"></circle>
      <circle class="bg-fill" cx="65" cy="65" r="${R}" transform="rotate(-90 65 65)"
        stroke-dasharray="${(CIRC * frac).toFixed(1)} ${CIRC.toFixed(1)}"></circle>
    </svg>
    <div class="bg-read"><div class="bg-pct">${Math.round(frac * 100)}<i>%</i></div>
    <div class="bg-lbl">charged</div></div>`
  return g
}

function bombSheet() {
  const sheet = el('div', 'sheet bomb-dash')
  sheet.appendChild(el('div', 'eyebrow', 'ARMY BOMB'))
  sheet.appendChild(el('div', 'bd-status', 'Network stable'))
  sheet.appendChild(gauge(0.62))
  sheet.appendChild(el('p', 'muted bd-note', "Everyone streaming right now feeds this — the network's shared vitality signal."))
  const stats = el('div', 'bg-stats')
  for (const [l, v] of [['Streams today', BOMB.communityStreams.toLocaleString()], ['Charge window', `${BOMB.chargeWindowDays}d`], ['City recovery', `${BOMB.cityRecovery}%`]]) {
    stats.appendChild(el('div', 'bg-stat', `<span class="bs-v">${v}</span><span class="bs-l">${l}</span>`))
  }
  sheet.appendChild(stats)
  sheet.appendChild(el('div', 'bd-block', `
    <div class="bd-block-head">Red Zone</div>
    <div class="dim">No active threats. If the network is attacked, it shows up here and on the home screen.</div>`))
  sheet.appendChild(el('div', 'bd-block', `
    <div class="bd-block-head">Your network</div>
    <div class="bd-line"><span>Districts restored</span><b>78 / 230</b></div>
    <div class="bd-line"><span>Wards online</span><b>2 / 8</b></div>
    <div class="bd-line"><span>Working on</span><b>Dazzledew Fountain</b></div>`))
  return sheet
}

function progressSheet() {
  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', 'LEVEL 12'))
  sheet.appendChild(el('h3', '', 'Signal Runner'))
  sheet.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1"><div class="pfill" style="width:64%"></div></div>
    <span class="count">640 / 1000 this level</span>`))
  sheet.appendChild(el('div', 'dim', '6,140 total XP'))
  sheet.appendChild(el('div', 'bd-block', `
    <div class="bd-block-head">Next level rewards</div>
    <div class="bd-line"><span>Deadline Extension</span><b>+1</b></div>
    <div class="bd-line"><span>Streak freeze</span><b>+1</b></div>`))
  sheet.appendChild(el('div', 'bd-block', `
    <div class="bd-block-head">Rank</div>
    <div class="bd-line"><span>Current</span><b>Field Operative</b></div>
    <div class="bd-line"><span>Next rank</span><b>Senior Operative</b></div>
    <div class="bd-line"><span>Badges earned</span><b>14</b></div>`))
  return sheet
}

/* ── harness ─────────────────────────────────────────────────────── */
function pair(title, note, build) {
  const sec = el('section', 'ap-section')
  sec.appendChild(el('h2', 'ap-h2', title))
  if (note) sec.appendChild(el('p', 'ap-note', note))
  const grid = el('div', 'ap-grid')
  for (const side of ['before', 'after']) {
    const col = el('div', 'ap-col')
    col.appendChild(el('div', `ap-tag ap-tag-${side}`, side === 'before' ? 'BEFORE — current build' : 'AFTER — proposed'))
    const stage = el('div', 'ap-stage' + (side === 'after' ? ' ap-after' : ''))
    stage.appendChild(build(side === 'after'))
    col.appendChild(stage)
    grid.appendChild(col)
  }
  sec.appendChild(grid)
  return sec
}

export function renderAuthoredPreview(root) {
  root.appendChild(pair(
    'A · Panel — in progress',
    'Nothing is cleared yet, so nothing is gold. The count is purple because purple means "active" everywhere else in the game; the reward lines are neutral because they are a record, not an achievement.',
    (after) => sweepPanel(SWEEP, after ? COPY.after : COPY.before)))

  // The cleared state is where the inversion is most visible: "done"
  // currently renders GREEN — a colour in no token — while gold sits a
  // few hundred pixels away on the map meaning exactly the same thing.
  const CLEARED = {
    ...SWEEP, todayDone: true, todayDoneCount: 4, weekDone: true,
    tracks: SWEEP.tracks.map((t) => ({ ...t, todayDone: true, weeklyDone: true, weeklyTotal: 20, todayCount: 3 })),
  }
  root.appendChild(pair(
    'B · Panel — cleared',
    'Exactly one gold element: the status word "Done today". The four track checks are gold glyphs on a hollow ring rather than filled discs, and the reward lines stay neutral — so the eye lands on the statement, not on four copies of the evidence.',
    (after) => sweepPanel(CLEARED, after ? COPY.after : COPY.before)))

  // Mixed on purpose: today cleared, week not. That puts .ok and .warn
  // side by side in one sheet, which is the only way to see that the
  // two states currently read as green-vs-gold instead of gold-vs-purple.
  const MIXED = { ...SWEEP, todayDone: true, todayDoneCount: 4, weekDone: false }
  root.appendChild(pair(
    'C · Detail sheet — the seven-day strip',
    'The part revision 1 got most wrong. Before: six filled tiles competing with the one word that actually reports the week. After: the cell is graphite because it is evidence, and a single 3px gold dot in the corner is the confirmation. Missed days read as absence through a dashed hollow edge and reduced opacity — no colour introduced. Future days stay solid and fainter, so they never read as a miss.',
    (after) => sweepSheet(MIXED, after ? COPY.after : COPY.before)))
}
