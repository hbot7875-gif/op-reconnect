// Moon Station — the player's own stream check, as a screen.
//
// This was a sheet over a blurred game screen, which stopped fitting once it
// carried two independent checks, a duplicate-report note, a sync note, an
// account warning and a 25-row sequence. A modal that scrolls that far is a
// screen wearing a popup's clothes, so it is one now: normal viewport, normal
// scroll, tab bar visible, MOON lit while you are here.
//
// It reports TWO separate things and must never merge them:
//
//   Streaming Pattern  song spacing and consecutive repeats (flaggedCount)
//   Mode Check         whether recent daily volume still fits the chosen mode
//
// A player can pass one and need a look at the other. They now sit as two
// metric cards side by side rather than two stacked sections — same two
// answers, a third of the height — and the mode answer keeps its own line
// inside its own card so it can still never be read as a consequence of a
// timing flag.
//
// Everything here reads what getMySelfCheck already returns. No threshold, no
// flag, no count is computed in this file.

import { call } from './api.js'
import { el, esc } from './state.js'
import { getAgentNo } from './session.js'

// Names the rule, so a player can tell what to change. "repeated-play
// pattern" described a suspicion; these describe the actual spacing rule.
const SELF_CHECK_FLAG_LABEL = {
  repeat: '↻ Replayed too soon',
  back_to_back: '⏭ Played twice in a row',
}

// The one rule that has a published number, and the number police-check
// actually measures against (REPEAT_MIN_GAP_SECONDS, 8 minutes, from the
// playlist validator's MIN_GAP_MS). back_to_back has no threshold — it is
// about adjacency, not time — so it deliberately has no entry here and the
// row shows none. Never invent a threshold for a rule that has none.
const SELF_CHECK_FLAG_THRESHOLD = {
  repeat: 'Review threshold: 8 minutes',
}

const MODE_NAMES = { exam: 'School/Exam', easy: 'Easy', steady: 'Easy+', medium: 'Medium', hard: 'Hard' }

const SOURCE_NAMES = {
  statsfm: 'Stats.fm', musicat: 'Musicat', listenbrainz: 'ListenBrainz', direct: 'your scrobbler',
}
const sourceName = (s) => SOURCE_NAMES[s] || 'your stream source'

/** How many rows the log shows at once. The CHECKS always run on the whole
 *  window; this is a display cap, and every line that quotes it says so. */
const SHOWN = 25

function formatGapSeconds(s) {
  if (!Number.isFinite(s)) return ''
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return rem ? `${m}m ${rem}s` : `${m}m`
}

/** "4 min ago" / "2 h ago" / "3 days ago". Rounded down, so it never claims
 *  something is more recent than it is. */
function formatAgo(seconds) {
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 90) return 'just now'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const secondsSince = (iso) => {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null
}

/**
 * The freshness block, which answers THREE different questions and is
 * careful never to answer one of them with another's evidence:
 *
 *   is the connection working     res.connection
 *   has anything arrived          res.newestStreamAt
 *   is the window fully known     res.partialHistory
 *
 * The bug this replaces: an agent who had not listened all week was shown a
 * sync warning, because "no recent streams" was read as "sync is broken".
 * A quiet week is now its own message and says the connection is fine, and a
 * genuine connection problem is only ever reported from the collector's own
 * checkpoint — never inferred from an absence of plays.
 *
 * `unobservable` is the honest answer for a pushed source: a scrobbler that
 * stops pushing leaves no record of having stopped, so for those the newest
 * play is the only evidence and the copy says so rather than guessing.
 */
function freshnessNote(res) {
  const name = sourceName(res.streamSource)
  const lastSync = res.sinceLastSuccessSeconds
  const hasStreams = !!res.newestStreamAt

  if (res.connection === 'failing' || res.connection === 'stale') {
    return {
      tone: 'is-review',
      title: `${name} is not syncing`,
      // "since then" needs a "then". A failing collector can have no
      // successful poll on record at all, and the sentence pointed at a
      // timestamp that was not there.
      body: lastSync === null
        ? `No successful sync has been recorded, so the checks below cover only what has already reached us.`
        : `Last successful sync ${formatAgo(lastSync)}. Anything played since then has not arrived yet, so the checks below cannot see it.`,
    }
  }
  if (res.connection === 'source_changed') {
    // They switched provider. The old provider's history is still in the
    // window, so this must not say "nothing has come through" — it says
    // which connection the checks can and cannot vouch for.
    const previous = sourceName(res.previousSource)
    return {
      tone: '',
      title: `${name} has not reported in yet`,
      body: hasStreams
        ? `The streams below arrived before you switched${res.previousSource ? ` from ${previous}` : ''}. ${name} has not sent anything yet; new plays appear once it does.`
        : `${name} has not sent anything yet. New plays appear once it does.`,
    }
  }
  if (res.connection === 'never_synced') {
    const gate = res.pollGateSeconds
    const everyFew = gate ? ` Syncs run about every ${Math.round(gate / 60)} minutes once the connection is live.` : ''
    return {
      tone: '',
      title: `Waiting for the first ${name} sync`,
      // Never claim an empty history when there is a history. Streams can
      // already be present from a scrobbler pushing directly while the
      // polled connection has not run once.
      body: hasStreams
        ? `The streams below have already arrived, but ${name} has not completed a sync yet, so more may still be missing.${everyFew}`
        : `Nothing has come through yet.${everyFew}`,
    }
  }
  if (res.partialHistory) {
    // Coverage gates BOTH checks: partialHistory also sets trustSequence
    // false, so no timing flag was computed at all.
    return {
      tone: '',
      title: `Sync catching up · ${name}`,
      body: res.partialReason === 'database_limit'
        ? 'Review resumes when this check is ready.'
        : 'Some recent streams may be missing, so neither check has run yet. Review resumes when the full window is ready.',
    }
  }
  if (!hasStreams) {
    // An empty window is not a fault, and the copy has to say which of the
    // two it is.
    return {
      tone: '',
      title: 'No streams in this window',
      body: res.connection === 'unobservable'
        ? `Nothing was received from ${name} in the last ${res.windowDays} days. There is nothing to review — if you were listening, check that your scrobbler is still connected.`
        : `${name} is connected and syncing normally${lastSync === null ? '' : ` (last sync ${formatAgo(lastSync)})`}. Nothing was played in the last ${res.windowDays} days, so there is nothing to review.`,
    }
  }
  return null
}

/** The quiet always-on footer. Two labels, each naming exactly what it
 *  measures: when a play last ARRIVED, and when the collector last RAN.
 *  They were one line reading "last sync" before, which meant a player
 *  looking at a healthy connection and an old play saw one timestamp and
 *  could not tell which of the two it described. */
function freshnessFooter(res) {
  const parts = []
  const received = secondsSince(res.newestStreamAt)
  if (received !== null) parts.push(`Latest stream received ${formatAgo(received)}`)
  if (res.connection !== 'unobservable' && res.sinceLastSuccessSeconds !== null) {
    parts.push(`${sourceName(res.streamSource)} last synced ${formatAgo(res.sinceLastSuccessSeconds)}`)
  }
  return parts.join(' · ')
}

/** Whether the timing rules actually ran on this row. False on an
 *  incomplete window (no rule ran at all) and on a row whose source gave no
 *  artist (it names no recording either rule can act on). */
const wasChecked = (res, t) => !res.partialHistory && t.identified !== false
const isFlagged = (t) => (t.flags || []).length > 0

export function renderMoonStation(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'moon-screen')

  // Page identity. MOON STATION is the name of a place in the game, so it
  // is the headline — not an eyebrow above the name of a report. The
  // station does one thing and "Stream Check" says it in two words; the
  // earlier "Stream review / Streaming signal analysis" pair described a
  // tool rather than a destination.
  wrap.appendChild(el('div', 'moon-head', `
    <span class="moon-sigil" role="img" aria-label="Moon Station">👮‍♂️</span>
    <span class="moon-head-text">
      <span class="moon-title">Moon Station</span>
      <span class="moon-subtitle">Stream Check</span>
    </span>
  `))

  const body = el('div', 'moon-body', '<p class="muted">Checking…</p>')
  wrap.appendChild(body)
  container.appendChild(wrap)

  mountCompactHud()

  call('getMySelfCheck', { agentNo: getAgentNo(), days: 7 }).then((res) => {
    body.innerHTML = ''
    if (!res.success) {
      body.appendChild(el('p', 'muted', esc(res.error || "Couldn't run the check")))
      return
    }

    // Nothing arrived, so neither check has anything to run on. Distinct
    // from both "clear" and "still syncing": a pass on an empty window is a
    // verdict nobody earned.
    const nothingToCheck = !res.trackCount
    const excessStreamDays = res.excessStreamDays || []
    const modeLabel = MODE_NAMES[res.mode] || res.mode || ''
    const modeReview = !res.partialHistory && excessStreamDays.length > 0
    const modeChecked = !res.partialHistory && !nothingToCheck && !!res.mode

    // Freshness sits above both checks because it gates both: an incomplete
    // window turns off every timing flag, and a dead connection means the
    // checks are reading an old week.
    const fresh = freshnessNote(res)
    if (fresh) {
      body.appendChild(el('div', `moon-note${fresh.tone ? ` ${fresh.tone}` : ''}`, `
        <b>${fresh.tone === 'is-review' ? '⚠ ' : ''}${esc(fresh.title)}</b>
        <p>${esc(fresh.body)}</p>
      `))
    }

    // ── The two checks, as two metric cards ──────────────────────────────
    const panel = el('div', 'moon-panel')
    const metrics = el('div', 'moon-metrics')

    // Card A — patterns to review. Its number is the whole answer, so the
    // number is the biggest thing in the card and the rule name sits under
    // it rather than in a sentence beside it.
    //
    // Three appearances, because "nothing found" and "nothing ran" are not
    // the same result and the card must not look the same for both:
    //
    //   is-review     flags exist      crimson number, crimson card
    //   is-settled    checked, none    gold number, faint gold edge
    //   (neither)     nothing checked  em dash, neutral — never a pass
    const patternChecked = !res.partialHistory && !nothingToCheck
    const patternTone = !patternChecked ? '' : res.flaggedCount ? ' is-review' : ' is-settled'
    const patternValue = patternChecked ? String(res.flaggedCount) : '—'
    const patternSub = res.partialHistory
      ? 'Not checked yet'
      : nothingToCheck
        ? `No streams in ${res.windowDays} days`
        : 'Spacing &amp; repeats'
    metrics.appendChild(el('div', `moon-metric is-flags${patternTone}`, `
      <span class="moon-metric-label"><span class="moon-metric-icon" aria-hidden="true">⚠</span> Patterns to review</span>
      <span class="moon-metric-value">${esc(patternValue)}</span>
      <span class="moon-metric-sub">${patternSub}</span>
    `))

    // Card B — how much was looked at, and separately whether that volume
    // still fits the mode the player chose. They share a card because they
    // describe the same window, but they are independent checks: the mode
    // answer gets its own heading under a divider so the big number can
    // never be read as the thing the verdict is about.
    const modeVerdict = !modeChecked
      ? { cls: '', text: '· Not checked yet' }
      : modeReview
        ? { cls: ' is-review', text: `⚠ Review ${esc(modeLabel)}`,
            note: res.suggestedMode ? `Recent pace: ${esc(MODE_NAMES[res.suggestedMode] || res.suggestedMode)}` : '' }
        : { cls: ' is-clear', text: `✓ ${esc(modeLabel)} fits` }
    metrics.appendChild(el('div', 'moon-metric is-count', `
      <span class="moon-metric-label"><span class="moon-metric-icon" aria-hidden="true">◉</span> Streams checked</span>
      <span class="moon-metric-value">${res.trackCount}</span>
      <span class="moon-metric-sub">Last ${res.windowDays} days</span>
      <span class="moon-metric-split" role="separator"></span>
      <span class="moon-metric-sublabel">Mode check</span>
      <span class="moon-metric-mode${modeVerdict.cls}">${modeVerdict.text}</span>
      ${modeVerdict.note ? `<span class="moon-metric-note">${modeVerdict.note}</span>` : ''}
    `))
    panel.appendChild(metrics)

    // What a flag is, directly under the number that counts them. A figure
    // beside a red icon reads as a penalty unless something says otherwise,
    // and nothing here is a penalty.
    panel.appendChild(el('p', 'moon-fineprint',
      'Flags indicate patterns worth reviewing, not violations. No automatic deductions.'))

    // A verdict reached on an incomplete week has to say so where the
    // verdict is, not only in the note above.
    if (res.connection === 'failing' || res.connection === 'stale') {
      panel.appendChild(el('p', 'moon-fineprint',
        'Covers the streams that have arrived so far. Anything played since the last sync is not included.'))
    }

    // Rows that reached the ledger twice, set aside before anything was
    // judged. Deliberately not attributed to Stats.fm: two causes produce
    // this now, and naming one of them is wrong for the other's agents.
    const dupes = Number(res.ingestionDuplicates || 0)
    if (dupes) {
      panel.appendChild(el('div', 'moon-note', `
        <b>ℹ ${dupes} duplicate report${dupes === 1 ? '' : 's'} excluded</b>
        <p>The same play was reported more than once, so the extra copies were
        set aside before these checks ran. Your stream totals are unchanged.</p>
      `))
    }

    // The days behind a mode review. One busy day is not the point, so the
    // list says which days this is actually drawn from.
    if (modeReview) {
      const days = excessStreamDays.map((d) =>
        `<div class="moon-day"><b>${esc(d.date)}</b><span>${d.streams} streams</span></div>`).join('')
      // is-quiet: supporting evidence for the verdict above, not a second
      // warning competing with it.
      panel.appendChild(el('div', 'moon-note is-quiet', `
        <b>Recent high-volume days</b>
        <div class="moon-days">${days}</div>
      `))
    }
    body.appendChild(panel)

    // ── Recent streams ───────────────────────────────────────────────────
    const streams = el('div', 'moon-streams')
    const seq = el('section', 'moon-check')
    streams.appendChild(seq)
    seq.appendChild(el('h3', 'moon-check-title', 'Recent streams'))

    const all = res.tracks || []
    if (!all.length) {
      seq.appendChild(el('p', 'moon-check-what', `Nothing in the last ${res.windowDays} days to check yet.`))
      body.appendChild(streams)
      renderAccountConnection()
      return
    }

    // Counts are over EVERY reviewed stream, not over the 25 on screen —
    // getMySelfCheck returns the whole window, so filtering can be honest
    // about its totals instead of describing a slice. The list itself still
    // shows at most 25, and the scope line under it says so for whichever
    // filter is active.
    const flaggedAll = all.filter(isFlagged)
    const clearAll = all.filter((t) => !isFlagged(t) && wasChecked(res, t))
    const FILTERS = [
      { id: 'all', label: 'All', rows: all },
      { id: 'flagged', label: 'Flagged', rows: flaggedAll },
      { id: 'clear', label: 'Clear', rows: clearAll },
    ]
    let active = 'all'

    // Filtering by outcome is meaningless when no rule ran, so an
    // incomplete window gets no filters rather than three that all mean the
    // same thing.
    const filterable = !res.partialHistory
    const bar = el('div', 'moon-filters')
    bar.setAttribute('role', 'tablist')
    bar.setAttribute('aria-label', 'Filter the stream log by review outcome')
    if (filterable) seq.appendChild(bar)

    const scope = el('p', 'moon-scope')
    seq.appendChild(scope)
    const legend = el('p', 'moon-legend')
    seq.appendChild(legend)
    const list = el('div', 'moon-list')
    seq.appendChild(list)

    function paint() {
      const current = FILTERS.find((f) => f.id === active) || FILTERS[0]
      const rows = current.rows

      if (filterable) {
        bar.innerHTML = FILTERS.map((f) => `
          <button class="moon-filter${f.id === active ? ' sel' : ''}" type="button" role="tab"
            data-filter="${f.id}" aria-selected="${f.id === active}">
            ${f.label}<span class="moon-filter-n">${f.rows.length}</span>
          </button>`).join('')
        for (const btn of bar.querySelectorAll('.moon-filter')) {
          btn.onclick = () => { active = btn.dataset.filter; paint() }
        }
      }

      // Says what was reviewed and what is on screen, which are different
      // numbers. Never calls a visible subset the total.
      const verb = res.partialHistory ? 'received' : 'reviewed'
      const noun = active === 'all' ? `${verb}` : current.label.toLowerCase()
      scope.textContent = rows.length > SHOWN
        ? `Newest ${SHOWN} of ${rows.length} ${noun} · oldest first`
        : `${rows.length} ${noun} · oldest first`

      // Backend hands tracks back newest-first (an activity log); reversed
      // to oldest-first because a SEQUENCE has to read top-to-bottom in the
      // order it actually happened. Filtering never reorders.
      const shown = rows.slice(0, SHOWN).slice().reverse()
      const anyUnchecked = shown.some((t) => !wasChecked(res, t))
      // A legend for marks that are not on screen explains nothing.
      legend.hidden = !shown.length
      legend.innerHTML = res.partialHistory
        ? '<span class="moon-mark is-unchecked">·</span> not checked — the window is still syncing'
        : '<span class="moon-mark is-clear">✓</span> no timing pattern found'
          + ' <span class="moon-mark is-review">⚠</span> worth a second look'
          + (anyUnchecked ? ' <span class="moon-mark is-unchecked">·</span> no artist, so not checked' : '')

      list.innerHTML = ''
      if (!shown.length) {
        list.appendChild(el('p', 'moon-empty', active === 'flagged'
          ? `No flagged streams in the last ${res.windowDays} days.`
          : `No clear streams in the last ${res.windowDays} days.`))
        return
      }
      shown.forEach((t, i) => {
        const flagged = isFlagged(t)
        const when = new Date(t.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        const day = new Date(t.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        // Three states, never two. A tick is only earned by a row the rules
        // actually ran on — an incomplete window runs none, and a row with
        // no artist names no recording either rule can reach.
        const mark = !wasChecked(res, t)
          ? { cls: 'is-unchecked', glyph: '·', label: 'Not checked' }
          : flagged
            ? { cls: 'is-review', glyph: '⚠', label: 'Worth a second look' }
            : { cls: 'is-clear', glyph: '✓', label: 'No timing pattern found' }

        // The repeat rule measures the gap to the previous play of THIS
        // song, which is often not the previous row — naming only "the
        // previous play" beside a repeat badge would point at a different
        // track. Shown on flagged rows only.
        const gap = flagged && typeof t.sinceSameSong === 'number'
          ? formatGapSeconds(t.sinceSameSong) : ''
        const reasons = flagged ? (t.flags || []).map((f) => {
            const label = SELF_CHECK_FLAG_LABEL[f] || f
            const text = f === 'repeat' && gap ? `${label} after ${gap}` : label
            const threshold = SELF_CHECK_FLAG_THRESHOLD[f]
            return `<span class="moon-reason">${esc(text)}${
              threshold ? `<em>${esc(threshold)}</em>` : ''}</span>`
          }).join('') : ''

        list.appendChild(el('div', 'moon-row' + (flagged ? ' is-review' : ''), `
          <span class="moon-seq">${String(i + 1).padStart(2, '0')}</span>
          <div class="moon-row-body">
            <span class="moon-track">${esc(t.track)}</span>
            <span class="moon-row-meta">${esc(t.artist || '—')} <i>·</i> ${esc(day)} ${esc(when)}</span>
            ${reasons ? `<div class="moon-row-flags">${reasons}</div>` : ''}
          </div>
          <span class="moon-mark ${mark.cls}" role="img" aria-label="${esc(mark.label)}"
            title="${esc(mark.label)}">${mark.glyph}</span>
        `))
      })
    }
    paint()

    const footer = freshnessFooter(res)
    if (footer) seq.appendChild(el('p', 'moon-fineprint', esc(footer)))
    body.appendChild(streams)

    renderAccountConnection()

    // Below both checks and outside either: a shared listening identity is
    // neither a timing pattern nor a pace question, and nesting it inside
    // one of them implied it was.
    function renderAccountConnection() {
      const alts = res.possibleAlts || []
      if (!alts.length) return
      const lines = alts.map((a) =>
        `${esc(a.via)} is also linked to <b>${esc(a.handle || a.agentNo)}</b> (${esc(a.agentNo)})`).join('<br>')
      const card = el('section', 'moon-check')
      card.appendChild(el('h3', 'moon-check-title', 'Account connection'))
      card.appendChild(el('div', 'moon-alt', `
        <b>⚠ This streaming account is also linked to another agent file</b>
        <p>${lines}</p>
      `))
      body.appendChild(card)
    }
  })
}

// ── the compact header, Moon Station only ─────────────────────────────────
//
// #hud is global and already sticky, and main.js repaints it for every
// screen, so its behaviour must not change anywhere else. This adds a body
// class while Moon Station is mounted and nothing more: every rule that
// condenses the header is written under that class, so City, Pack, Candy,
// BOTZ, Rankings and Settings keep the header they have.
//
// What condenses is the XP block only — a progress bar, not an action. Every
// button in the header (dossier, codename eye, sync, signals, ReConnect
// status) stays mounted and tappable at both sizes, because "collapsed"
// must not mean "fewer things you can do".
//
// The threshold has hysteresis (condense past 140px, restore under 70px) so
// a scroll that hovers near the boundary cannot flicker, and the height
// change is transitioned rather than snapped so the content below settles
// instead of jumping.
const HUD_CONDENSE_AT = 140
const HUD_RESTORE_AT = 70
let hudScrollHandler = null

function mountCompactHud() {
  if (hudScrollHandler) return
  document.body.classList.add('moon-hud-compact')
  let condensed = false
  let queued = false
  const apply = () => {
    queued = false
    const hud = document.getElementById('hud')
    if (!hud) return
    const y = window.scrollY || document.documentElement.scrollTop || 0
    if (!condensed && y > HUD_CONDENSE_AT) { condensed = true; hud.classList.add('is-condensed') }
    else if (condensed && y < HUD_RESTORE_AT) { condensed = false; hud.classList.remove('is-condensed') }
  }
  hudScrollHandler = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(apply)
  }
  window.addEventListener('scroll', hudScrollHandler, { passive: true })
  apply()
}

/** Called by main.js when navigating away, so the listener and the class
 *  never outlive the screen that asked for them. */
export function teardownMoonStation() {
  if (!hudScrollHandler) return
  window.removeEventListener('scroll', hudScrollHandler)
  hudScrollHandler = null
  document.body.classList.remove('moon-hud-compact')
  document.getElementById('hud')?.classList.remove('is-condensed')
}
