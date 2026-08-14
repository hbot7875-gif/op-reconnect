// A simple public suggestions board — see migrations/051_rc_suggestions.sql
// for the "why". Deliberately minimal: no voting, no categories, no
// moderation queue. Just a chronological list anyone active can read and
// add to.

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

export async function getSuggestions(supabase: SupabaseDB, limit = 40) {
  const { data: rows } = await supabase.from('rc_suggestions')
    .select('agent_no, body, created_at').order('created_at', { ascending: false }).limit(limit)
  if (!rows || !rows.length) return { success: true, suggestions: [] }

  const agentNos = [...new Set(rows.map((r: any) => r.agent_no))]
  const { data: players } = await supabase.from('rc_players').select('agent_no, codename').in('agent_no', agentNos)
  const codenameByAgent = new Map((players || []).map((p: any) => [p.agent_no, p.codename]))

  return {
    success: true,
    suggestions: rows.map((r: any) => ({
      codename: codenameByAgent.get(r.agent_no) || 'A retired agent',
      body: r.body,
      createdAt: r.created_at,
    })),
  }
}
