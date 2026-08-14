// A simple suggestions box — see migrations/051_rc_suggestions.sql for the
// "why". One-way by design: an agent can drop an idea, but nothing here
// reads them back out to other agents. No voting, no categories, no public
// list.

import type { SupabaseDB } from './config.ts'
import { todayKst } from './kst.ts'

const MAX_LEN = 240
// Loose spam guard, not a debate-club rate limit — enough to stop an
// accidental multi-tap or a flood, generous enough that nobody genuinely
// posting a few real ideas in one sitting ever hits it.
const MAX_PER_DAY = 5

export async function submitSuggestion(supabase: SupabaseDB, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const body = String(params.body || '').trim().slice(0, MAX_LEN)
  if (!body) return { success: false, error: 'body_required' }

  const today = todayKst()
  const { count } = await supabase.from('rc_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('agent_no', agentNo).gte('created_at', `${today}T00:00:00Z`)
  if ((count || 0) >= MAX_PER_DAY) return { success: false, error: 'daily_limit_reached' }

  const { error } = await supabase.from('rc_suggestions').insert({ agent_no: agentNo, body })
  if (error) return { success: false, error: error.message }
  return { success: true }
}
