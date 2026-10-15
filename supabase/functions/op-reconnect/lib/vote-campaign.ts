// Voting campaigns (MAMA 2026 first) — the Deno entry points the router
// calls. All logic lives in vote-campaign-service.js so Node can test it;
// see that file for the trust boundaries and migration 20261013150000 for
// the tables and atomic functions.
import type { SupabaseDB } from './config.ts'
import { cachedJson } from './cache.ts'
import {
  getVotingBanner as banner, getPublicBattle as publicBattle, getVotingStatus as status, submitMnetProof as mnet, submitXProof as x,
  setXHandle as handle, openVotingGift as gift, adminListCampaignProofs as list,
  adminRecordCampaignChecks as record, adminReviewCampaignProof as review, oembedXVerifier,
  startVotingTeamChoice as teamStart, chooseVotingTeam as teamChoose, claimBattleGift as battleGift,
  claimBattleWinner as battleWinner,
} from './vote-campaign-service.js'
import { runVotePulse } from './vote-pulse-service.js'
import {
  getBattleTeam as hubTeam, setBattleInstagram as hubIg, getBattleChat as hubChat, sendBattleChat as hubSend,
  reactBattleChat as hubReact, reportBattleChat as hubReport, muteBattleChat as hubMute,
  adminListBattleChat as hubAdminList, adminModerateBattleChat as hubAdminModerate,
} from './battle-hub-service.js'

type P = Record<string, unknown>

// The team-score aggregate goes through the shared rc_cache row (60s), so a
// City poll costs one cache read rather than a count over every proof.
export const getVotingBanner = (sb: SupabaseDB, agentNo: string) =>
  banner(sb, agentNo, new Date(), { cache: (key: string, ttl: number, f: () => Promise<unknown>) => cachedJson(sb, key, ttl, f) })
export const getVotingStatus = (sb: SupabaseDB, p: P) => status(sb, p)
// Public: the battle page and share poster. Same shared 60s cache row.
export const getPublicBattle = (sb: SupabaseDB) =>
  publicBattle(sb, new Date(), { cache: (key: string, ttl: number, f: () => Promise<unknown>) => cachedJson(sb, key, ttl, f) })
// A stored certificate wakes the automatic checker (GitHub Actions,
// .github/workflows/mnet-auto-verify.yml) right away. GITHUB_DISPATCH_TOKEN
// is an Edge Function secret — a fine-grained token for this repo only, with
// just "Actions: Read and write" (it can start a workflow; it cannot read or
// change code). GitHub's own schedule is far too irregular to rely on, so
// rc-mnet-verify-kick (pg_cron, every 2 minutes) calls cronMnetVerifyKick to
// send the same nudge again while a certificate is still waiting.
// → { dispatched, status } and never throws.
async function wakeChecker(): Promise<{ dispatched: boolean; status: number | string }> {
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN') ?? ''
  if (!token) {
    console.warn('mnet auto-verify: GITHUB_DISPATCH_TOKEN is not set; only the schedule will run the checker')
    return { dispatched: false, status: 'no_token' }
  }
  const repo = Deno.env.get('GITHUB_DISPATCH_REPO') ?? 'hbot7875-gif/op-reconnect'
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/mnet-auto-verify.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'op-reconnect',
      },
      body: JSON.stringify({ ref: 'master' }),
      signal: AbortSignal.timeout(5000),
    })
    if (res.status !== 204) console.warn(`mnet auto-verify: workflow dispatch answered ${res.status}`)
    return { dispatched: res.status === 204, status: res.status }
  } catch (e) {
    console.warn(`mnet auto-verify: workflow dispatch failed: ${(e as Error)?.message || e}`)
    return { dispatched: false, status: 'network' }
  }
}
export const submitMnetProof = async (sb: SupabaseDB, p: P) => {
  const r = await mnet(sb, p)
  if ((r as { success?: boolean })?.success) {
    // Fire-and-forget: the upload's response never waits on GitHub.
    const nudge = wakeChecker()
    // deno-lint-ignore no-explicit-any
    ;(globalThis as any).EdgeRuntime?.waitUntil?.(nudge)
  }
  return r
}
// pg_cron safety net (rc_invoke_mnet_verify_kick): only called while a
// certificate has been waiting for a minute or more.
export const cronMnetVerifyKick = async () => ({ success: true, ...(await wakeChecker()) })
export const submitXProof = (sb: SupabaseDB, p: P) => x(sb, p, { verifier: oembedXVerifier() })
export const setXHandle = (sb: SupabaseDB, p: P) => handle(sb, p)
export const openVotingGift = (sb: SupabaseDB, p: P) => gift(sb, p)
export const startVotingTeamChoice = (sb: SupabaseDB, p: P) => teamStart(sb, p)
export const chooseVotingTeam = (sb: SupabaseDB, p: P) => teamChoose(sb, p)
export const claimBattleGift = (sb: SupabaseDB, p: P) => battleGift(sb, p)
export const claimBattleWinner = (sb: SupabaseDB, p: P) => battleWinner(sb, p)
export const adminListCampaignProofs = (sb: SupabaseDB, p: P) => list(sb, p)
// CERT_FINGERPRINT_KEY: an Edge Function secret (never in the database).
export const adminRecordCampaignChecks = (sb: SupabaseDB, p: P) =>
  record(sb, p, { fingerprintKey: Deno.env.get('CERT_FINGERPRINT_KEY') ?? '' })
export const adminReviewCampaignProof = (sb: SupabaseDB, p: P) => review(sb, p)
// BTS X Vote Pulse collector (scheduled; display only). The Apify token is
// an Edge Function secret — never in the database or the client.
export const cronVotePulse = (sb: SupabaseDB) => runVotePulse(sb, { token: Deno.env.get('APIFY_TOKEN') ?? '' })

// MAMA Event Hub — Team and Chat (battle-hub-service.js, migration
// 20261015150000). Chat's moments read the same shared 60s battle cache.
export const getBattleTeam = (sb: SupabaseDB, p: P) => hubTeam(sb, p)
export const setBattleInstagram = (sb: SupabaseDB, p: P) => hubIg(sb, p)
export const getBattleChat = (sb: SupabaseDB, p: P) =>
  hubChat(sb, p, new Date(), { cache: (key: string, ttl: number, f: () => Promise<unknown>) => cachedJson(sb, key, ttl, f) })
export const sendBattleChat = (sb: SupabaseDB, p: P) => hubSend(sb, p)
export const reactBattleChat = (sb: SupabaseDB, p: P) => hubReact(sb, p)
export const reportBattleChat = (sb: SupabaseDB, p: P) => hubReport(sb, p)
export const muteBattleChat = (sb: SupabaseDB, p: P) => hubMute(sb, p)
export const adminListBattleChat = (sb: SupabaseDB, p: P) => hubAdminList(sb, p)
export const adminModerateBattleChat = (sb: SupabaseDB, p: P) => hubAdminModerate(sb, p)
