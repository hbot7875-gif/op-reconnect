// Who is signing up, and how much setup they see. Someone who came from a
// MAMA voting link (/battle → /game?screen=voting, or a remembered ?team=
// invite) came to vote: they get voting copy on the sign-up form and skip
// the codename/mode/streams screens — a codename is picked for them (they
// can change it in Settings) and they land on the voting screen. Everyone
// else still picks a codename and a streaming mode.

const WORDS = ['Purple', 'Borahae', 'Galaxy', 'Magic', 'Butter', 'Moon', 'Star', 'Bloom', 'Euphoria', 'Spring']

/** True when this visit started from a voting link. */
export function fromVotingLink(search, invite) {
  try {
    if (new URLSearchParams(search || '').get('screen') === 'voting') return true
  } catch { /* unreadable query: not a voting link */ }
  return !!invite
}

/** A public codename for an agent who skipped picking one, e.g.
 *  "PurpleStar4821". Letters and digits only, 3-24 characters, never
 *  "AGENT…" — the same rules joinGame checks. `rand` returns [0, 1). */
export function suggestCodename(rand = Math.random) {
  const pick = () => WORDS[Math.floor(rand() * WORDS.length) % WORDS.length]
  let a = pick()
  let b = pick()
  if (b === a) b = WORDS[(WORDS.indexOf(a) + 1) % WORDS.length]
  const n = String(1000 + Math.floor(rand() * 9000) % 9000)
  return `${a}${b}${n}`
}
