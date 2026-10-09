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
// A player can pass one and need a look at the other. Previously these were
// stacked in one column with a shared summary line, and someone with clean
// spacing but a busy week read the red mode card as a consequence of the
// repeat check. Account sharing is neither of those, so it sits below both
// rather than becoming a third verdict.
//
// Everything here reads what getMySelfCheck already returns. No threshold, no
// flag, no count is computed in this file.

import { call } from './api.js'
import { el, esc } from './state.js'
import { getAgentNo } from './session.js'

// Names the rule, so a player can tell what to change. "repeated-play
// pattern" described a suspicion; these describe the actual spacing rule.
const SELF_CHECK_FLAG_LABEL = {
  repeat: '🔁 Same song replayed within 8 min',
  back_to_back: '⏭ Same song played twice in a row',
}

const MODE_NAMES = { exam: 'School/Exam', easy: 'Easy', steady: 'Easy+', medium: 'Medium', hard: 'Hard' }

function formatGapSeconds(s) {
  if (!Number.isFinite(s)) return ''
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return rem ? `${m}m ${rem}s` : `${m}m`
}

export function renderMoonStation(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'moon-screen')

  // No intro paragraph. The two sections are already visibly separate, and a
  // preamble explaining that they are separate only makes a routine check
  // sound like it needs defending.
  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow"><span class="moon-beacon" aria-hidden="true">🚨</span> Moon Station</span>
    <span class="pack-name">Stream review</span>
  `))

  const body = el('div', 'moon-body', '<p class="muted">Checking…</p>')
  wrap.appendChild(body)
  container.appendChild(wrap)

  call('getMySelfCheck', { agentNo: getAgentNo(), days: 7 }).then((res) => {
    body.innerHTML = ''
    if (!res.success) {
      body.appendChild(el('p', 'muted', esc(res.error || "Couldn't run the check")))
      return
    }

    const modeLabel = MODE_NAMES[res.mode] || res.mode || ''
    const excessStreamDays = res.excessStreamDays || []
    // Mode is only judged on a complete window — an incomplete sync makes a
    // low total look like a slow week, so it reports "not checked yet"
    // rather than a false pass.
    const modeReview = !res.partialHistory && excessStreamDays.length > 0
    const modeChecked = !res.partialHistory && !!res.mode

    // Sync coverage gates BOTH checks (partialHistory also turns off timing
    // flags via trustSequence), so it sits above them rather than inside
    // either one.
    if (res.partialHistory) {
      const sourceNames = { statsfm: 'Stats.fm', musicat: 'Musicat', listenbrainz: 'ListenBrainz', direct: 'scrobbler' }
      const sourceName = sourceNames[res.streamSource] || 'stream'
      const coverageCopy = res.partialReason === 'database_limit'
        ? 'Review resumes when this check is ready.'
        : 'Some recent streams may be missing. Review resumes when the full history is ready.'
      body.appendChild(el('div', 'moon-note', `
        <b>Sync catching up · ${esc(sourceName)}</b>
        <p>${esc(coverageCopy)}</p>
      `))
    }

    // ── Streaming Pattern ────────────────────────────────────────────────
    const pattern = el('section', 'moon-check')
    pattern.appendChild(el('h3', 'moon-check-title', 'Streaming pattern'))
    if (res.partialHistory) {
      // flaggedCount is 0 here because the timing rules were never RUN —
      // an incomplete window sets trustSequence: false, which suppresses
      // every flag. Reading that 0 as a pass is the same false green Mode
      // Check already avoids: both checks have to be able to say they do
      // not know yet, or a half-synced week looks like a clean one.
      pattern.appendChild(el('p', 'moon-verdict', '· Not checked yet'))
      pattern.appendChild(el('p', 'moon-check-what', 'Syncing recent streams'))
    } else {
      // Verdict and window on one line, the description under it. Two
      // stacked sentences made a one-word answer look like a paragraph.
      pattern.appendChild(el('div', 'moon-verdict-row', `
        <span class="moon-verdict${res.flaggedCount ? ' is-review' : ''}">${
          res.flaggedCount ? `⚠ ${res.flaggedCount} to review` : '✓ Clear'}</span>
        <span class="moon-count">${res.trackCount} · ${res.windowDays}d</span>
      `))
      pattern.appendChild(el('p', 'moon-check-what', 'Spacing &amp; repeats'))
    }

    // Rows Stats.fm reported twice, set aside before anything was judged.
    // Quiet and informational on purpose: the source double-reported a play,
    // which is not something the player did.
    const dupes = Number(res.ingestionDuplicates || 0)
    if (dupes) {
      pattern.appendChild(el('div', 'moon-note', `
        <b>ℹ ${dupes} duplicate report${dupes === 1 ? '' : 's'} excluded</b>
        <p>Stats.fm reported the same play more than once. Totals unchanged.</p>
      `))
    }
    // One panel for both checks, divided by an inset rule rather than two
    // full-bleed ones. They stay separate questions; they stop reading as two
    // unrelated bands floating on the page.
    const panel = el('div', 'moon-panel')
    panel.appendChild(pattern)
    body.appendChild(panel)

    // ── Mode Check ───────────────────────────────────────────────────────
    const mode = el('section', 'moon-check')
    mode.appendChild(el('h3', 'moon-check-title', 'Mode check'))
    if (!modeChecked) {
      mode.appendChild(el('p', 'moon-verdict', '· Not checked yet'))
      mode.appendChild(el('p', 'moon-check-what', 'Syncing recent streams'))
    } else if (modeReview) {
      const suggestion = MODE_NAMES[res.suggestedMode] || res.suggestedMode
      mode.appendChild(el('p', 'moon-verdict is-review', '⚠ Review mode'))
      // Two facts, not a paragraph. The day list below says which days this
      // is drawn from, so restating the count in prose adds nothing.
      mode.appendChild(el('p', 'moon-check-what', `
        Current: ${esc(modeLabel)}${suggestion ? `<br>Recent pace: ${esc(suggestion)}` : ''}
      `))
      // One busy day is not the point; the per-day list says which days this
      // is actually about. Labelled, because an unheaded run of dates under
      // a mode warning reads as evidence against the player rather than as
      // "here is what this is referring to".
      mode.appendChild(el('p', 'moon-days-title', 'Recent high-volume days'))
      mode.appendChild(el('div', 'moon-days', excessStreamDays.map((d) =>
        `<div class="moon-day"><b>${esc(d.date)}</b><span>${d.streams} streams</span></div>`).join('')))
    } else {
      mode.appendChild(el('p', 'moon-verdict', `✓ ${esc(modeLabel)} fits`))
      mode.appendChild(el('p', 'moon-check-what', 'Daily volume vs selected mode'))
    }
    panel.appendChild(mode)

    // ── Recent streams ───────────────────────────────────────────────────
    //
    // Flat rows with separators rather than a card each: an ordinary listen
    // should look ordinary. Only a row that needs a second look is tinted,
    // so the eye lands on those four and not on all twenty-five.
    const seq = el('section', 'moon-check')
    // Lighter than the checks panel on purpose: the checks are the finding,
    // the log is the evidence behind it.
    const streams = el('div', 'moon-streams')
    streams.appendChild(seq)
    seq.appendChild(el('h3', 'moon-check-title', 'Recent streams'))
    if (!res.tracks?.length) {
      seq.appendChild(el('p', 'moon-check-what', 'Nothing in the last 7 days to check yet.'))
      body.appendChild(streams)
      renderAccountConnection()
      return
    }
    // Backend hands tracks back newest-first (an activity log); reversed to
    // oldest-first because a SEQUENCE has to read top-to-bottom in the order
    // it actually happened.
    const sequence = res.tracks.slice(0, 25).slice().reverse()
    const list = el('div', 'moon-list')
    sequence.forEach((t, i) => {
      const flagged = (t.flags || []).length > 0
      const badges = (t.flags || []).map((f) =>
        `<span class="moon-flag">${SELF_CHECK_FLAG_LABEL[f] || esc(f)}</span>`).join('')
      const when = new Date(t.at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      // The repeat rule measures the gap to the previous play of THIS song,
      // which is often not the previous row — naming only "the previous
      // play" beside a repeat badge would point at a different track.
      //
      // Shown on flagged rows only. On an ordinary row it is the answer to a
      // question nobody asked, and printing it under all 25 made the two rows
      // that actually need reading look like the rest.
      const sameSong = flagged && typeof t.sinceSameSong === 'number'
        ? `<span class="moon-gap">${esc(formatGapSeconds(t.sinceSameSong))} since this song last played</span>`
        : ''
      list.appendChild(el('div', 'moon-row' + (flagged ? ' is-review' : ''), `
        <span class="moon-seq">${String(i + 1).padStart(2, '0')}</span>
        <div class="moon-row-body">
          <div class="moon-row-top">
            <span class="moon-track">${esc(t.track)}</span>
            <span class="moon-artist">${esc(t.artist || '—')}</span>
          </div>
          <div class="moon-row-meta">${esc(when)}</div>
          ${sameSong}
          ${badges ? `<div class="moon-row-flags">${badges}</div>` : ''}
        </div>
      `))
    })
    seq.appendChild(list)
    body.appendChild(streams)

    renderAccountConnection()

    // Below both checks and outside either: a shared listening identity is
    // neither a timing pattern nor a pace question, and nesting it inside one
    // of them implied it was.
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
