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

const SOURCE_NAMES = {
  statsfm: 'Stats.fm', musicat: 'Musicat', listenbrainz: 'ListenBrainz', direct: 'your scrobbler',
}
const sourceName = (s) => SOURCE_NAMES[s] || 'your stream source'

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
      title: `⚠ ${name} is not syncing`,
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
      title: `· ${name} has not reported in yet`,
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
      title: `· Waiting for the first ${name} sync`,
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
      title: `· Sync catching up · ${name}`,
      body: res.partialReason === 'database_limit'
        ? 'Review resumes when this check is ready.'
        : 'Some recent streams may be missing, so neither check has run yet. Review resumes when the full window is ready.',
    }
  }
  if (!hasStreams) {
    // The whole point of Phase 2. An empty window is not a fault, and the
    // copy has to say which of the two it is.
    return {
      tone: '',
      title: '· No streams in this window',
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
    // Nothing arrived, so neither check has anything to run on. Distinct
    // from both "clear" and "still syncing": a pass on an empty window is a
    // verdict nobody earned, and the harness showed exactly that — an idle
    // account was being told "✓ Clear" and "✓ Medium fits" on zero streams.
    const nothingToCheck = !res.trackCount
    const modeReview = !res.partialHistory && excessStreamDays.length > 0
    const modeChecked = !res.partialHistory && !nothingToCheck && !!res.mode

    // Freshness sits above both checks because it gates both: an incomplete
    // window turns off every timing flag, and a dead connection means the
    // checks are reading an old week. It is deliberately one block that can
    // say "working but quiet" — see freshnessNote.
    const fresh = freshnessNote(res)
    if (fresh) {
      body.appendChild(el('div', `moon-note${fresh.tone ? ` ${fresh.tone}` : ''}`, `
        <b>${esc(fresh.title)}</b>
        <p>${esc(fresh.body)}</p>
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
    } else if (nothingToCheck) {
      pattern.appendChild(el('p', 'moon-verdict', '· Nothing to check'))
      pattern.appendChild(el('p', 'moon-check-what', `No streams in the last ${res.windowDays} days`))
    } else {
      // Verdict and window on one line, the description under it. Two
      // stacked sentences made a one-word answer look like a paragraph.
      pattern.appendChild(el('div', 'moon-verdict-row', `
        <span class="moon-verdict${res.flaggedCount ? ' is-review' : ''}">${
          res.flaggedCount ? `⚠ ${res.flaggedCount} to review` : '✓ Clear'}</span>
        <span class="moon-count">${res.trackCount} · ${res.windowDays}d</span>
      `))
      pattern.appendChild(el('p', 'moon-check-what', 'Spacing &amp; repeats'))
      // What a flag is, said where the flag count is — not in a footnote
      // further down the page. A number next to a red icon reads as a
      // penalty unless something says otherwise, and nothing here is a
      // penalty: no XP moves, no streak breaks, nothing is deducted.
      if (res.flaggedCount) {
        pattern.appendChild(el('p', 'moon-fineprint',
          'A flag marks a pattern worth a second look — not a violation, and not a decision. '
          + 'Nothing is deducted and no action is taken automatically.'))
      }
      // A verdict reached on an incomplete week must say so where the
      // verdict is. The harness showed "✓ Clear" sitting under "Stats.fm is
      // not syncing", which reads as a full pass on a window that is
      // missing however long the collector has been down.
      if (res.connection === 'failing' || res.connection === 'stale') {
        pattern.appendChild(el('p', 'moon-fineprint',
          'Covers the streams that have arrived so far. Anything played since the last sync is not included.'))
      }
    }

    // Rows that reached the ledger twice, set aside before anything was
    // judged. Quiet and informational on purpose: a source reported one play
    // more than once, which is not something the player did.
    //
    // Deliberately not named as Stats.fm any more. Two causes produce this
    // now — Stats.fm serving one play at two precisions, and a player running
    // two scrobblers that both report the same play — and attributing the
    // second to Stats.fm would be wrong for exactly the agents who see it.
    const dupes = Number(res.ingestionDuplicates || 0)
    if (dupes) {
      pattern.appendChild(el('div', 'moon-note', `
        <b>ℹ ${dupes} duplicate report${dupes === 1 ? '' : 's'} excluded</b>
        <p>The same play was reported more than once, so the extra copies were
        set aside before these checks ran. Your stream totals are unchanged.</p>
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
    if (nothingToCheck) {
      // Not "still syncing": there is nothing in flight, there is just
      // nothing to measure a pace against.
      mode.appendChild(el('p', 'moon-verdict', '· Nothing to check'))
      mode.appendChild(el('p', 'moon-check-what', `No streams in the last ${res.windowDays} days`))
    } else if (!modeChecked) {
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
    const SHOWN = 25
    const sequence = res.tracks.slice(0, SHOWN).slice().reverse()
    // What this list is and is not. The checks above ran on the WHOLE window;
    // this shows the newest 25 of it. Without saying so, a player with four
    // flags and twenty-five visible rows reasonably concludes that twenty-five
    // is all that was looked at.
    // "reviewed" is a claim, so it is only made when a review actually ran.
    // On an incomplete window no timing rule ran at all, and the harness
    // showed this line still saying "25 of 30 streams reviewed" underneath
    // two checks that both said "not checked yet".
    const verb = res.partialHistory ? 'received' : 'reviewed'
    const scope = res.trackCount > SHOWN
      ? `Newest ${SHOWN} of ${res.trackCount} streams ${verb} · oldest of these first`
      : `All ${res.trackCount} stream${res.trackCount === 1 ? '' : 's'} ${verb} · oldest first`
    seq.appendChild(el('p', 'moon-check-what', esc(scope)))
    // The legend has to come BEFORE the marks it explains, and the gold tick
    // in particular has to be defined narrowly. It means the two timing rules
    // found nothing on that row. It is not a verification that the play
    // happened, that it was heard, or that it counted — none of which a
    // scrobble can show.
    // A neutral mark also appears on any row the rules could not identify,
    // so the legend has to explain it whenever one is actually on screen —
    // an unexplained glyph is worse than no glyph.
    const anyUnchecked = sequence.some((t) => t.identified === false)
    seq.appendChild(el('p', 'moon-legend', res.partialHistory
      ? '<span class="moon-mark is-unchecked">·</span> not checked — the window is still syncing'
      : '<span class="moon-mark is-clear">✓</span> no timing pattern found'
        + ' <span class="moon-mark is-review">⚠</span> worth a second look'
        + (anyUnchecked ? ' <span class="moon-mark is-unchecked">·</span> no artist, so not checked' : '')))
    const list = el('div', 'moon-list')
    sequence.forEach((t, i) => {
      const flagged = (t.flags || []).length > 0
      const badges = (t.flags || []).map((f) =>
        `<span class="moon-flag">${SELF_CHECK_FLAG_LABEL[f] || esc(f)}</span>`).join('')
      const when = new Date(t.at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      // Three states, never two. A tick is only ever earned by a row the
      // rules actually ran on, which rules out two cases:
      //
      //   partialHistory   the window is incomplete, so no rule ran at all
      //   !identified      the source gave no artist, so this row names no
      //                    recording and neither rule can reach it
      //
      // The second is rare — 3 rows in 172,344 measured — but it is exactly
      // the shape of a false pass: empty flags that look like a clean result
      // when they are really an unanswerable question.
      const mark = res.partialHistory || t.identified === false
        ? { cls: 'is-unchecked', glyph: '·', label: 'Not checked' }
        : flagged
          ? { cls: 'is-review', glyph: '⚠', label: 'Worth a second look' }
          : { cls: 'is-clear', glyph: '✓', label: 'No timing pattern found' }
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
        <span class="moon-mark ${mark.cls}" role="img" aria-label="${esc(mark.label)}"
          title="${esc(mark.label)}">${mark.glyph}</span>
      `))
    })
    seq.appendChild(list)
    // The timestamps, last, in the smallest type on the page. Both are
    // labelled for what they measure — see freshnessFooter.
    const footer = freshnessFooter(res)
    if (footer) seq.appendChild(el('p', 'moon-fineprint', esc(footer)))
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
