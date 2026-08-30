// Pure copy/hierarchy decision for the strongest player-facing block.
// screen-district.js owns the controls; this helper makes every important
// mission state testable without a live account or production mutation.

export function reconnectPlayerNext(input = {}) {
  const need = Math.max(0, Number(input.need) || 0)
  const pendingNames = input.pendingNames || []
  const expiredCount = Math.max(0, Number(input.expiredCount) || 0)
  const idleCount = Math.max(0, Number(input.idleCount) || 0)
  const cipher = input.cipher || null
  const sharedTrack = input.sharedTrack || null

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
      body: input.isCreator ? 'Choose whether to wait or review the team in Details.' : 'You can wait or leave this quest from Details.',
    }
  }
  if (need > 0 && pendingNames.length) {
    return {
      title: 'Waiting for an invited agent',
      body: `${pendingNames.join(' and ')} ${pendingNames.length === 1 ? 'has' : 'have'} 24 hours to respond.`,
    }
  }
  if (need > 0) return { title: 'Invite one teammate', body: 'Choose the best available match or see other agents.' }
  if (cipher) return { title: `Solve cipher ${cipher.index + 1} of ${cipher.total}`, body: 'Discuss it in Team Chat, then submit one shared answer.' }
  if (input.variant === 'connect' && sharedTrack && sharedTrack.progress < sharedTrack.target) {
    const left = Math.max(0, sharedTrack.target - sharedTrack.progress)
    return {
      title: `Stream ${sharedTrack.label} ${left} more time${left === 1 ? '' : 's'}`,
      body: 'Everyone’s qualifying plays count after they join.',
    }
  }
  if (input.variant === 'connect') return { title: 'Stream an active district goal', body: 'Each ready agent needs one qualifying play after joining.' }
  return { title: 'Review the ReConnect Quest', body: 'Check the remaining step in Details.' }
}
