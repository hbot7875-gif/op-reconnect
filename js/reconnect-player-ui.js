// Pure copy/hierarchy decision for the strongest player-facing block.
// screen-district.js owns the controls; this helper makes every important
// mission state testable without a live account or production mutation.

/** What a pooled multi-track quest (mission.sharedTracks or the pre-mission
 *  config.sharedTracks) asks, in one plain sentence: the songs named by the
 *  quest's own noun and clue ("the 6 surprise songs BTS sang in Brazil on
 *  the ARIRANG tour"), and what to do with them. */
export function sharedTracksPitch(st) {
  const noun = st?.noun || 'songs'
  const what = `the ${st.total} ${noun}${st.clue ? ` ${st.clue}` : ''}`
  return st.hidden
    ? `Find out ${what} and stream each one ${st.target} times as a team. A song's name appears here the first time one of you streams it.`
    : `Stream ${what} ${st.target} times each as a team.`
}

/** The quest rules the one-line goal can't carry on its own, as short
 *  sentences: which songs count for a pooled goal (any song on an album,
 *  either of two songs), team codes that follow the streaming, who else may
 *  join, and what a goal-less team quest asks. `config` is the quest config
 *  the server sends (getReconnectMission's config). */
export function questRuleNotes(config = {}) {
  const notes = []
  const st = config.sharedTrack
  if (st) {
    const label = String(st.label || '')
    const keys = (st.keys || []).length
    if (/\balbum\b/i.test(label) || keys >= 5) {
      notes.push(`Any song from the ${label.replace(/\s*album\s*$/i, '')} album counts.`)
    } else if (/\s(\+|&|\/|and)\s/i.test(label)) {
      notes.push('Plays of either song add to the same total.')
    }
  }
  if (!st && !config.checklist && !config.sharedTracks) {
    notes.push('Each teammate streams at least one of their own district goals after joining.'
      + (config.teamBoost ? ' Finishing unlocks a Team Boost for the team.' : ''))
  }
  if (config.cipherCount > 0) {
    notes.push(`Then crack ${config.cipherCount} code${config.cipherCount === 1 ? '' : 's'} together in Team Chat.`)
  }
  if (config.openTo) notes.push(`Agents from ${config.openTo} can join your team too.`)
  return notes.join(' ')
}

/** "surprise song" / "surprise songs" — the quest's own word for its list. */
export function sharedTracksNoun(st, count) {
  const noun = st?.noun || 'songs'
  return count === 1 ? noun.replace(/s$/, '') : noun
}

export function reconnectPlayerNext(input = {}) {
  const need = Math.max(0, Number(input.need) || 0)
  const pendingNames = input.pendingNames || []
  const expiredCount = Math.max(0, Number(input.expiredCount) || 0)
  const idleCount = Math.max(0, Number(input.idleCount) || 0)
  const cipher = input.cipher || null
  const sharedTrack = input.sharedTrack || null
  const checklist = input.checklist || null
  const sharedTracks = input.sharedTracks || null
  const myChecklistDone = Math.max(0, Number(input.myChecklistDone) || 0)
  // A recruit joined from another district: inviting and dropping teammates
  // belong to the district's own agents, so never tell them to do either.
  const recruit = input.recruit ? { from: input.recruit.districtName || 'this district' } : null

  if (input.status === 'complete') return { title: 'Quest complete — finish the district', body: '' }
  if (input.myStatus === 'invited') {
    return {
      title: 'Accept or decline the invitation',
      body: input.variant === 'invite'
        ? 'Accepting completes this ReConnect Quest for both agents.'
        : 'Accept to join this team before streaming toward its goal.',
    }
  }
  if (cipher && Number(cipher.attemptsLeft) <= 0) {
    return { title: 'No attempts left — ask for help', body: 'Your team cannot submit another answer on this district attempt.' }
  }
  if (expiredCount > 0 && need > 0) return { title: 'Invite expired — choose another teammate', body: 'That seat is open again.' }
  if (idleCount > 0) {
    return {
      title: 'A teammate has gone quiet',
      body: recruit ? `${recruit.from} agents can drop them and invite someone new.`
        : input.isCreator ? 'Choose whether to wait or review the team in Details.' : 'You can wait or leave this quest from Details.',
    }
  }
  if (need > 0 && pendingNames.length) {
    const who = pendingNames.join(' and ')
    const uncovered = need - pendingNames.length
    // A spot nobody's been invited to yet: say so, or "waiting" next to a
    // Find teammates button reads as two contradicting instructions.
    if (uncovered > 0 && !recruit) {
      return {
        title: `Invite ${uncovered === 1 ? 'one more teammate' : `${uncovered} more teammates`}`,
        body: `${who} ${pendingNames.length === 1 ? 'has' : 'have'} 24 hours to accept your invite.`,
      }
    }
    return { title: `Waiting for ${who}`, body: 'They have 24 hours to accept your invite.' }
  }
  if (need > 0 && recruit) {
    return { title: 'Your team is filling its last seat', body: `${recruit.from} agents send the invites. Every play you stream now already counts.` }
  }
  if (need > 0) return { title: need === 1 ? 'Invite one teammate' : `Invite ${need} teammates`, body: 'Tap Find teammates to pick who to invite.' }
  if (cipher) return { title: `Solve cipher ${cipher.index + 1} of ${cipher.total}`, body: 'Discuss it in Team Chat, then submit one shared answer.' }
  if (input.variant === 'connect' && sharedTrack && sharedTrack.progress < sharedTrack.target) {
    const left = Math.max(0, sharedTrack.target - sharedTrack.progress)
    return {
      title: `Stream ${sharedTrack.label} ${left} more time${left === 1 ? '' : 's'}`,
      body: 'Everyone’s qualifying plays count after they join.',
    }
  }
  if (input.variant === 'connect' && sharedTracks && sharedTracks.cleared < sharedTracks.total) {
    const rows = sharedTracks.tracks || []
    const hiddenLeft = sharedTracks.hidden ? rows.filter((t) => !t.quiz && !t.revealed).length : 0
    const quizLeft = rows.filter((t) => t.quiz && !t.done).length
    const left = Math.max(0, rows.filter((t) => !t.quiz).reduce((s, t) => s + (sharedTracks.target - (Number(t.progress) || 0)), 0))
    if (hiddenLeft > 0) {
      return {
        title: `Find ${hiddenLeft} more ${sharedTracksNoun(sharedTracks, hiddenLeft)}`,
        body: `A song's name appears once any teammate streams it. Up to ${sharedTracks.target} plays each count.${quizLeft ? ' The one that isn’t on Spotify is a quiz — guess it.' : ''}`,
      }
    }
    if (left > 0) {
      return {
        title: `Stream ${left} more time${left === 1 ? '' : 's'} together`,
        body: `Every song needs ${sharedTracks.target} plays between you.${quizLeft ? ' And guess the one that isn’t on Spotify.' : ''}`,
      }
    }
    return { title: 'Guess the last song', body: 'It isn’t on Spotify — read the hint and type your guess.' }
  }
  if (input.variant === 'connect' && checklist && myChecklistDone < checklist.total) {
    const left = checklist.total - myChecklistDone
    return {
      title: `Stream ${left} more track${left === 1 ? '' : 's'} from the list`,
      body: `${myChecklistDone}/${checklist.total} cleared — each teammate completes their own list.`,
    }
  }
  if (input.variant === 'connect' && checklist) return { title: 'Waiting on the rest of the team', body: 'Your list is complete — each teammate still needs to finish their own.' }
  if (input.variant === 'connect') return { title: 'Stream an active district goal', body: 'Each ready agent needs one qualifying play after joining.' }
  return { title: 'Review the ReConnect Quest', body: 'Check the remaining step in Details.' }
}
