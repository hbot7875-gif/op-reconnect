// Pooled multi-track ReConnect quests (config.sharedTracks) — pure rules,
// shared by reconnect-missions.ts and Node tests.
//
// The team pools its plays per track: every joined member's plays of a
// track, since they joined, add to that track's own total, and the quest
// completes when every track reaches `target`. With `hidden`, a track's
// name stays on the server until the team has streamed it once — the
// panel shows "Song 3 · ???" until then, so the songs are found, not read.
//
// A track that can't be streamed (not on Spotify) is a quiz instead: it
// carries a hint and answer keys, and is done the moment any teammate
// guesses it (rc_reconnect_missions.solved_tracks).
//
// config.sharedTracks = {
//   target: 30,              plays per track, pooled across the team
//   hidden: true,            names revealed one by one as they're found
//   noun: 'surprise songs',  what the list is called (default 'songs')
//   clue: 'BTS sang in …',   what they are — the hint that makes them findable
//   tracks: [{ label, keys, group? }            group: "Day One", a heading
//          | { label, group?, quiz: { hint, answerKeys } }]
// }

const isQuiz = (t) => Array.isArray(t?.quiz?.answerKeys) && t.quiz.answerKeys.length > 0

/** The validated config, or null when the goal doesn't carry one. */
export function sharedTracksConfig(cfg) {
  const st = cfg?.sharedTracks
  const target = Number(st?.target) || 0
  const tracks = Array.isArray(st?.tracks)
    ? st.tracks.filter((t) => t && ((Array.isArray(t.keys) && t.keys.length) || isQuiz(t)))
    : []
  if (!target || !tracks.length) return null
  return { target, hidden: !!st.hidden, tracks, noun: String(st.noun || 'songs'), clue: st.clue ? String(st.clue) : null }
}

/** Track numbers (1-based) a teammate has guessed, from the mission row. */
export function solvedSet(solvedTracks) {
  return new Set((Array.isArray(solvedTracks) ? solvedTracks : []).map((s) => Number(s?.n)).filter(Boolean))
}

/** Per-track pooled plays: `totals` is one Map(key -> plays) per member
 *  (live members and leavers alike — a leaver's plays up to their exit
 *  stay in, so the team never loses ground when someone leaves). A quiz
 *  track counts as the full target once solved, nothing before. */
export function pooledTrackPlays(tracks, totals, solved = new Set(), target = 0) {
  return tracks.map((t, i) => (isQuiz(t)
    ? (solved.has(i + 1) ? target : 0)
    : totals.reduce((sum, m) => sum + t.keys.reduce((s, k) => s + (m.get(k) || 0), 0), 0)))
}

/** One member's plays across the list, each track capped at the target —
 *  their share of the pooled meter (and the number a Quest exit freezes). */
export function memberSharedPlays(tracks, total, target) {
  return tracks.reduce((sum, t) => sum + (isQuiz(t) ? 0 : Math.min(target, t.keys.reduce((s, k) => s + (total.get(k) || 0), 0))), 0)
}

/** Is `key` (already normKeyFull'd) the answer to quiz track `n`? */
export function quizAnswerMatches(st, n, key) {
  const t = st?.tracks?.[n - 1]
  return !!key && isQuiz(t) && t.quiz.answerKeys.includes(key)
}

/** What the team sees. Names of tracks nobody has found yet are left out
 *  entirely while hidden — not masked in the browser — and everything is
 *  revealed once the quest is complete. A quiz's hint always shows; its
 *  answer keys never do. */
export function sharedTracksView(st, plays, { complete = false, solvedTracks = [] } = {}) {
  const by = new Map((Array.isArray(solvedTracks) ? solvedTracks : []).map((s) => [Number(s?.n), s?.by || null]))
  const rows = st.tracks.map((t, i) => {
    const n = plays[i] || 0
    const revealed = !st.hidden || complete || n > 0
    const row = {
      n: i + 1,
      group: t.group ? String(t.group) : null,
      label: revealed ? String(t.label) : null,
      revealed,
      progress: Math.min(n, st.target),
      done: n >= st.target,
    }
    if (isQuiz(t)) {
      row.quiz = true
      row.hint = String(t.quiz.hint || '')
      row.solvedBy = by.get(i + 1) || null
    }
    return row
  })
  return {
    target: st.target,
    hidden: st.hidden,
    noun: st.noun,
    clue: st.clue,
    total: rows.length,
    found: rows.filter((r) => r.revealed).length,
    cleared: rows.filter((r) => r.done).length,
    quizzes: rows.filter((r) => r.quiz).length,
    progress: rows.reduce((s, r) => s + r.progress, 0),
    goal: st.target * rows.length,
    tracks: rows,
  }
}

/** True once every track has reached the target. */
export const sharedTracksDone = (st, plays) => st.tracks.every((_, i) => (plays[i] || 0) >= st.target)

/** The config as it may reach a browser before a mission exists: counts,
 *  groups and quiz hints only while hidden, never a label or a key. */
export function publicSharedTracks(cfg) {
  const st = sharedTracksConfig(cfg)
  if (!st) return null
  return {
    target: st.target,
    hidden: st.hidden,
    noun: st.noun,
    clue: st.clue,
    total: st.tracks.length,
    tracks: st.tracks.map((t, i) => ({
      n: i + 1, group: t.group ? String(t.group) : null, label: st.hidden ? null : String(t.label),
      ...(isQuiz(t) ? { quiz: true, hint: String(t.quiz.hint || '') } : {}),
    })),
  }
}
