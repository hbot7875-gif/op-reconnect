// "Your last attempt" — what an ended district attempt reached, its deadline
// and every goal it did NOT achieve (getGameState's districtLapses, built by
// lib/district-lapse.js). Without it a lapsed district came back as a bare
// "Light it up" at 0%, which players read as their progress being wiped.
// DOM-free so the copy is testable.

function escHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char])
}

function when(iso, withTime = true) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, withTime
    ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' })
}

const REASONS = {
  deadline: 'The deadline passed before every goal was finished, so the attempt was reset.',
  reset: 'The deadline passed and you chose to reset the attempt.',
  blackout: 'Your Personal Charge went dark, which resets a district in progress.',
}

function missedLine(item) {
  if (item.kind === 'track') {
    return `<li><b>${escHtml(item.label)}</b> — ${item.progress}/${item.target} plays</li>`
  }
  if (item.kind === 'album') {
    const short = (item.shortTracks || []).map((t) => `${escHtml(t.label)} needed ${t.need} more`)
    if (item.moreTracks) short.push(`${item.moreTracks} more track${item.moreTracks === 1 ? '' : 's'}`)
    return `<li><b>${escHtml(item.label)}</b> album — ${item.progress}/${item.target} passes${short.length ? `<small>${short.join(' · ')}</small>` : ''}</li>`
  }
  return `<li><b>ReConnect team quest</b>${item.label ? ` (${escHtml(item.label)})` : ''} — ${item.progress}/${item.target} pooled</li>`
}

/** Inner HTML for the card; '' when there is nothing to show. */
export function lastAttemptHtml(lapse) {
  if (!lapse) return ''
  const { done = {}, missed = [] } = lapse
  const doneParts = []
  if (done.tracksTotal) doneParts.push(`${done.tracks}/${done.tracksTotal} track goals`)
  if (done.albumsTotal) doneParts.push(`${done.albums}/${done.albumsTotal} albums`)
  if (done.team != null) doneParts.push(done.team ? 'team quest ✓' : 'team quest ✗')
  return `
    <div class="la-head">⏳ Your last attempt reached <b>${Number(lapse.percent) || 0}%</b></div>
    <div class="la-dates">Started ${escHtml(when(lapse.activatedAt, false))} · Deadline <b>${escHtml(when(lapse.deadlineAt))}</b></div>
    <p class="la-reason">${escHtml(REASONS[lapse.reason] || REASONS.deadline)}</p>
    ${doneParts.length ? `<div class="la-done">Finished: ${doneParts.join(' · ')}</div>` : ''}
    ${missed.length ? `<div class="la-missed-title">Not achieved</div><ul class="la-missed">${missed.map(missedLine).join('')}</ul>` : ''}
    <p class="la-foot">Progress doesn't carry over. If you start again, you begin from 0% with a new deadline.</p>`
}
