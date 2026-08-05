// Solo puzzle variants of the `reconnect` goal kind — 'sotd' (guess a song
// from a hint), 'cipher' (guess a song from its initials), 'memory' (guess
// a piece of story/lore, admin-authored, deliberately NOT the district's
// real `memory` text — that's hidden until restoration completes to avoid
// spoiling the payoff). All three share one mechanic: one admin-authored
// {prompt, answerLabel, answerAliases}, up to 2 attempts, untimed, matched
// via the same normKeyFull/goalKeys normalization every other goal in this
// game already uses. This is a deliberate simplification of the old
// arirang site's SOTD/Cipher (which were calendar-day-rotating, admin-
// authored-daily, and Cipher had a speed-decay timer) — see the reconnect
// goal-kind plan for why.
//
// Never awards XP/Fuel itself — completion reward happens once, when the
// WHOLE district completes, in handlers.ts's buildState().

import type { SupabaseDB } from './config.ts'
import type { FrozenReconnectGoal } from './districts.ts'
import { normKeyFull } from './text.ts'

const MAX_ATTEMPTS = 2

async function getAttemptRow(supabase: SupabaseDB, agentNo: string, districtId: string, goalId: string) {
  const { data } = await supabase.from('rc_reconnect_puzzle_attempts')
    .select('*').eq('agent_no', agentNo).eq('district_id', districtId).eq('goal_id', goalId).maybeSingle()
  return data || { agent_no: agentNo, district_id: districtId, goal_id: goalId, attempts: 0, solved: false }
}

/** Called by reconnect-goal.ts's resolveReconnectStatus on every state poll
 *  — read-only, never leaks the answer. */
export async function getPuzzleStatus(supabase: SupabaseDB, agentNo: string, districtId: string, frozenReconnect: FrozenReconnectGoal) {
  const row = await getAttemptRow(supabase, agentNo, districtId, frozenReconnect.id)
  return {
    variant: frozenReconnect.variant,
    done: !!row.solved,
    attempts: row.attempts,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts),
    prompt: frozenReconnect.config.prompt as string,
  }
}

/** Player submits a guess for their own frozen puzzle. Rejects if there's
 *  no active puzzle-kind reconnect goal, it's already solved, or attempts
 *  are exhausted. */
export async function submitReconnectPuzzleAnswer(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const answer = String(params.answer || '').trim()
  if (!answer) return { success: false, error: 'answer_required' }

  const { data: pd } = await supabase.from('rc_player_districts')
    .select('status, goals').eq('agent_no', agentNo).eq('district_id', districtId).maybeSingle()
  const reconnect: FrozenReconnectGoal | null = pd?.goals?.reconnect || null
  const puzzleVariants = new Set(['sotd', 'cipher', 'memory'])
  if (pd?.status !== 'active' || !reconnect || !puzzleVariants.has(reconnect.variant)) {
    return { success: false, error: 'no_active_puzzle' }
  }

  const row = await getAttemptRow(supabase, agentNo, districtId, reconnect.id)
  if (row.solved) return { success: false, error: 'already_solved' }
  if (row.attempts >= MAX_ATTEMPTS) return { success: false, error: 'no_attempts_left' }

  const answerKeys: string[] = reconnect.config.answerKeys || []
  const guessKey = normKeyFull(answer)
  const solved = answerKeys.includes(guessKey)
  const attempts = row.attempts + 1

  const { error } = await supabase.from('rc_reconnect_puzzle_attempts').upsert({
    agent_no: agentNo, district_id: districtId, goal_id: reconnect.id,
    attempts, solved, solved_at: solved ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'agent_no, district_id, goal_id' })
  if (error) return { success: false, error: error.message }

  return { success: true, solved, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) }
}
