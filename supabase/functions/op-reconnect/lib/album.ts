// The Album: Edge Function routes and the database adapter.
//
// auth: 'agent' for both routes (index.ts proves the session belongs to
// params.agentNo first). This file only talks to the database: the rules are
// album-service.js / album-rules.js, the exactly-once guarantees are the two
// RPCs in migration 20261025170000_rc_album.sql.
//
// Agent numbers stay on this side. Views name givers by codename only; a
// gift is addressed by agent number (that's how agents tell each other who
// they are) but the reply names the recipient by codename.

import type { SupabaseDB } from './config.ts'
import { throttle } from './auth.ts'
import { todayKst } from './kst.ts'
import { createAlbumService } from './album-service.js'

function cryptoRng(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
}

const agentOf = (params: any) => String(params.agentNo || '').trim().toUpperCase()

function makeStore(supabase: SupabaseDB) {
  return {
    async listCovers(agentNo: string) {
      const { data, error } = await supabase.from('rc_album_covers')
        .select('era, source, from_agent_no, earned_on').eq('agent_no', agentNo)
      if (error) throw new Error(`album covers: ${error.message}`)
      return (data || []).map((r: any) => ({
        era: r.era, source: r.source, fromAgentNo: r.from_agent_no || null, earnedOn: String(r.earned_on),
      }))
    },

    async awardDaily({ agentNo, kstDate, pick }: { agentNo: string; kstDate: string; pick: number }) {
      const { data, error } = await supabase.rpc('rc_album_award_daily', { p_agent_no: agentNo, p_kst_date: kstDate, p_pick: pick })
      if (error) return { ok: false, error: 'server_error' }
      return data || { ok: false }
    },

    async gift({ from, to, era, kstDate, minDays }: { from: string; to: string; era: string; kstDate: string; minDays: number }) {
      const { data, error } = await supabase.rpc('rc_album_gift',
        { p_from: from, p_to: to, p_era: era, p_kst_date: kstDate, p_min_days: minDays })
      if (error) return { ok: false, error: 'server_error' }
      return data?.ok ? { ok: true, era: data.era, toName: data.to_name } : (data || { ok: false, error: 'server_error' })
    },

    async giftsOn(agentNo: string, kstDate: string) {
      const [sent, received] = await Promise.all([
        supabase.from('rc_album_gifts').select('id', { count: 'exact', head: true }).eq('from_agent_no', agentNo).eq('sent_on', kstDate),
        supabase.from('rc_album_gifts').select('id', { count: 'exact', head: true }).eq('to_agent_no', agentNo).eq('sent_on', kstDate),
      ])
      return { sent: (sent.count || 0) > 0, received: (received.count || 0) > 0 }
    },

    async names(agentNos: string[]) {
      const out = new Map<string, string>()
      if (!agentNos.length) return out
      const { data } = await supabase.from('rc_players').select('agent_no, codename').in('agent_no', agentNos)
      for (const r of data || []) out.set(r.agent_no, String(r.codename || 'AGENT'))
      return out
    },

    throttle(bucket: string, max: number, windowSeconds: number) {
      return throttle(supabase, bucket, max, windowSeconds)
    },
  }
}

export function albumService(supabase: SupabaseDB) {
  return createAlbumService({ store: makeStore(supabase), rng: cryptoRng })
}

export const albumState = async (sb: SupabaseDB, p: any) =>
  ({ success: true, album: await albumService(sb).view(agentOf(p), todayKst()) })

export const albumGift = (sb: SupabaseDB, p: any) =>
  albumService(sb).sendGift(agentOf(p), { to: p.to, era: p.era }, todayKst())

/** For buildState (handlers.ts): award today's cover once the daily Signal
 *  Sweep is done, and return the short summary the game state carries.
 *  Never fails the poll — a broken Album must not break the City. */
export async function albumForState(sb: SupabaseDB, agentNo: string, today: string, sweepDone: boolean) {
  try {
    return await albumService(sb).awardDailyGoal(agentNo, today, sweepDone)
  } catch (_) {
    return null
  }
}
