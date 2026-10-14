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
// .github/workflows/mnet-auto-verify.yml) so it doesn't wait for the 5-minute
// schedule. Optional: GITHUB_DISPATCH_TOKEN is an Edge Function secret — a
// fine-grained token for this repo only, with just "Actions: Read and write"
// (it can start a workflow; it cannot read or change code). Fire-and-forget —
// the upload's response never waits on GitHub, and a failure only means the
// schedule picks the proof up instead.
function wakeChecker() {
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN') ?? ''
  if (!token) return
  const repo = Deno.env.get('GITHUB_DISPATCH_REPO') ?? 'hbot7875-gif/op-reconnect'
  const sent = fetch(`https://api.github.com/repos/${repo}/actions/workflows/mnet-auto-verify.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'op-reconnect',
    },
    body: JSON.stringify({ ref: 'master' }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined)
  // deno-lint-ignore no-explicit-any
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(sent)
}
export const submitMnetProof = async (sb: SupabaseDB, p: P) => {
  const r = await mnet(sb, p)
  if ((r as { success?: boolean })?.success) wakeChecker()
  return r
}
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
