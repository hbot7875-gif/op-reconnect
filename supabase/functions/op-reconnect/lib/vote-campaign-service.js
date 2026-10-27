// Voting campaigns — server side (MAMA 2026 first). See migration
// 20261013150000 for the tables and the atomic functions this calls.
//
// Plain JS with every outside dependency passed in (database client, X
// verifier, clock), so Node can test the exact flows the Edge Function runs.
// vote-campaign.ts is the thin Deno wrapper the router calls.
//
// Trust boundaries, in one place:
//   * agentNo is only ever the session-verified caller (index.ts checks the
//     session before any 'agent' route runs).
//   * Browser OCR arrives as `clientChecks`, is reduced to three booleans and
//     stored as a hint. It never reaches a status decision.
//   * An Mnet proof is stored as 'verifying'. Only a trusted reviewer OCR run
//     or an admin decision (admin key) moves it on.
//   * An X proof is decided from what THIS server fetched from X, plus the
//     post id's own timestamp. Anything short of a confident pass is review.
//   * Rewards are never computed here — the database reads the event's own
//     config and applies them only when a proof becomes verified.
import {
  kstDayOf, addDays, campaignPhase, missionById, parseXPostUrl, snowflakeTime, normalizeHandle,
  parseOembed, decideXProof, missingHashtags, cityPhase, inPromo, sanitizeMnetChecks, sanitizeClientCertChecks, decideMnetChecks,
  normalizeCertificateNumber, participationMinuteKey, validUtcOffset, duplicateNotices, votingStreak, missionStates, missionProgress, giftState, pulseView,
  REVIEW_REASONS, reviewReason, duplicateReason, duplicateAlerts,
} from './vote-campaign-rules.js'

export const PROOF_BUCKET = 'campaign-proofs'
const SIGNED_URL_TTL_SECONDS = 10 * 60
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png' }
const HEX64 = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const fail = (error, extra = {}) => ({ success: false, error, ...extra })
const agentOf = (params) => String(params.agentNo || '').trim().toUpperCase()

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** HMAC-SHA256(key, campaign|kind|value) as hex. The key lives only in the
 *  Edge Function's environment, so a stored fingerprint can't be reversed
 *  or tested against a guessed number from database contents alone. */
export async function certFingerprint(key, campaignId, kind, value) {
  const enc = new TextEncoder()
  const k = await globalThis.crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await globalThis.crypto.subtle.sign('HMAC', k, enc.encode(`${campaignId}|${kind}|${value}`))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function decodeBase64(b64) {
  try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) } catch { return null }
}

async function loadCampaign(db, id) {
  if (!/^[a-z0-9_]{3,40}$/.test(String(id || ''))) return null
  const { data } = await db.from('rc_vote_campaigns').select('*').eq('id', id).eq('active', true).maybeSingle()
  return data || null
}

/** The campaign the player page should show: the open one, else (players
 *  only) one in its battle's promo window, else the one that closed most
 *  recently (so a ready Voting Gift is still reachable). The admin queue
 *  never jumps to a round that can't have proofs yet. */
async function currentCampaign(db, now, { promo = false } = {}) {
  const { data } = await db.from('rc_vote_campaigns').select('*').eq('active', true)
    .order('closes_at', { ascending: false }).limit(5)
  const rows = data || []
  return rows.find((c) => campaignPhase(c, now) === 'open')
    || (promo && rows.find((c) => inPromo(c, now)))
    || rows.find((c) => campaignPhase(c, now) === 'closed') || null
}

// ── X verification (swappable) ─────────────────────────────────────────

/**
 * The verifier abstraction: anything with verify({ postId }) that returns
 * { ok: true, authorHandle, hashtags } or { ok: false, reason }. The first
 * implementation is X's public oEmbed endpoint (no key). If X changes it,
 * swap this object; the decision logic does not move.
 */
export function oembedXVerifier(fetchImpl = globalThis.fetch, timeoutMs = 6000) {
  return {
    method: 'x_oembed',
    async verify({ postId }) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)
      try {
        // Looked up by id alone: oEmbed answers with the post's real author
        // whatever handle a pasted link claims.
        const target = encodeURIComponent(`https://x.com/i/status/${postId}`)
        const res = await fetchImpl(`https://publish.x.com/oembed?omit_script=1&dnt=true&url=${target}`,
          { signal: ctl.signal, headers: { accept: 'application/json' } })
        if (res.status === 404) return { ok: false, reason: 'not_found' }
        if (res.status === 403) return { ok: false, reason: 'forbidden' } // protected account
        if (!res.ok) return { ok: false, reason: 'unavailable' }
        const json = await res.json()
        if (!String(json?.url || '').endsWith(`/status/${postId}`)) return { ok: false, reason: 'unavailable' }
        const parsed = parseOembed(json)
        if (!parsed) return { ok: false, reason: 'unavailable' }
        return { ok: true, authorHandle: parsed.authorHandle, hashtags: parsed.hashtags }
      } catch {
        return { ok: false, reason: 'unavailable' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

// ── World-screen summary (rides getGameState) ──────────────────────────

/** battle.recruit_bonus as the pages need it, or null when off. */
function recruitBonusOf(c) {
  const r = c.battle?.recruit_bonus || {}
  const per = Math.floor(Number(r.per) || 0)
  const points = Math.floor(Number(r.points) || 0)
  return per > 0 && points > 0 ? { per, points } : null
}

/** One side's numbers: score (votes + recruit bonus), votes, bonus, and
 *  head counts. Aggregates only. */
function teamNumbers(t, b) {
  const points = Number(b?.teams?.[t.id]) || 0
  return {
    id: t.id, label: t.label, points,
    votes: b?.votes ? Number(b.votes[t.id]) || 0 : points,
    bonus: Number(b?.bonus?.[t.id]) || 0,
    qualified: Number(b?.qualified?.[t.id]) || 0,
    agents: Number((b?.sizes || b?.teamSizes)?.[t.id]) || 0,
    recruits: Number(b?.recruits?.[t.id]) || 0,
  }
}

/** Team scores from the SHARED 60s cache row (vote_battle:{id}) — the one
 *  aggregate the City banner and the public battle page both read, so it
 *  runs about once a minute however many people are looking. */
function cachedBattleScores(db, c, cache) {
  const scores = async () => {
    const { data: b } = await db.rpc('rc_campaign_battle_state', { p_campaign_id: c.id, p_agent_no: '' })
    return {
      teams: b?.teams || {}, total: Number(b?.total) || 0, frozen: !!b?.frozen, winners: b?.winners || null,
      // Aggregate head counts per side, and how many joined this round.
      sizes: b?.teamSizes || {}, recruits: b?.recruits || {},
      // The recruit bonus: score = votes + bonus (rc_campaign_battle_state).
      votes: b?.votes || null, bonus: b?.bonus || {}, qualified: b?.qualified || {},
      at: new Date().toISOString(),
    }
  }
  return cache ? cache(`vote_battle:${c.id}`, 60_000, scores) : scores()
}

/**
 * The City screen's summary (map marker + banner), riding getGameState.
 * Kept cheap on purpose — it runs on every City poll:
 *   one small campaign read, today's own proofs (indexed), the agent's own
 *   team (primary key), and the team scores from a SHARED cache row
 *   (60s, via the injected `cache`), so the score aggregate runs about once
 *   a minute for everyone rather than once per agent per poll.
 * Team totals are never computed in the browser.
 */
export async function getVotingBanner(db, agentNo, now = new Date(), { cache } = {}) {
  const { data } = await db.from('rc_vote_campaigns')
    .select('id, title, round_label, opens_at, closes_at, missions, battle').eq('active', true)
    .order('closes_at', { ascending: false }).limit(5)
  const c = (data || []).find((row) => cityPhase(row, now))
  if (!c) return null
  const phase = cityPhase(c, now)
  const today = kstDayOf(now)
  const battleOn = !!c.battle?.enabled
  const [proofsRes, teamRes, battle, dupRes] = await Promise.all([
    phase === 'open'
      ? db.from('rc_campaign_proofs').select('mission_id, vote_day, status').eq('campaign_id', c.id).eq('agent_no', agentNo).eq('vote_day', today)
      : Promise.resolve({ data: [] }),
    battleOn ? db.from('rc_campaign_teams').select('team').eq('campaign_id', c.id).eq('agent_no', agentNo).maybeSingle() : Promise.resolve({ data: null }),
    battleOn ? cachedBattleScores(db, c, cache) : Promise.resolve(null),
    // Their own certificates turned down as duplicates, for a one-time popup.
    phase === 'open'
      ? db.from('rc_campaign_proofs').select('id, vote_day, status, duplicate_kind').eq('campaign_id', c.id).eq('agent_no', agentNo)
        .eq('status', 'rejected').eq('duplicate_kind', 'certificate').gte('vote_day', addDays(today, -1)).limit(10)
      : Promise.resolve({ data: [] }),
  ])
  const states = missionStates(c, proofsRes.data || [], today)
  const progress = missionProgress(c, proofsRes.data || [], today)
  return {
    campaignId: c.id, title: c.title, roundLabel: c.round_label, phase,
    opensAt: c.opens_at, closesAt: c.closes_at, freezeAt: c.battle?.freeze_at || c.closes_at,
    alerts: duplicateAlerts(dupRes?.data || [], today),
    done: Object.values(progress).reduce((n, p) => n + p.verified, 0),
    total: Object.values(progress).reduce((n, p) => n + p.max, 0),
    battle: battleOn ? {
      myTeam: teamRes.data?.team || null,
      teams: (c.battle.teams || []).map((t) => teamNumbers(t, battle)),
      recruitBonus: recruitBonusOf(c),
      total: battle?.total || 0,
      milestones: (Array.isArray(c.battle.milestones) ? c.battle.milestones : []).map((target) => ({
        target: Number(target), reached: (battle?.total || 0) >= Number(target),
      })),
      // Only after the freeze, and only once the cached score knows it.
      winners: phase === 'final' && battle?.frozen ? battle.winners : null,
    } : null,
  }
}

// ── Public battle summary (no sign-in) ─────────────────────────────────

/**
 * The public MAMA Battle page and the share poster. Team totals, the
 * community total, milestones, phase and timing — read from the same shared
 * cache row as the City banner, never recomputed per visitor. Nothing about
 * any agent: no names, numbers, handles, proofs, team sizes or contributions.
 */
export async function getPublicBattle(db, now = new Date(), { cache } = {}) {
  const { data } = await db.from('rc_vote_campaigns')
    .select('id, title, round_label, opens_at, closes_at, battle').eq('active', true)
    .order('closes_at', { ascending: false }).limit(5)
  const c = (data || []).find((row) => row.battle?.enabled && cityPhase(row, now))
  if (!c) return fail('no_battle')
  const phase = cityPhase(c, now)
  const b = await cachedBattleScores(db, c, cache)
  const total = Number(b?.total) || 0
  const milestones = (Array.isArray(c.battle.milestones) ? c.battle.milestones : []).map((t) => ({ target: Number(t), reached: total >= Number(t) }))
  const next = milestones.find((m) => !m.reached)
  return {
    success: true,
    campaign: { id: c.id, title: c.title, roundLabel: c.round_label },
    phase,
    opensAt: c.opens_at,
    closesAt: c.closes_at,
    freezeAt: c.battle.freeze_at || c.closes_at,
    // Points, plus aggregate head counts (no agent, no names): how many
    // agents are on each side and how many joined this round.
    teams: (c.battle.teams || []).map((t) => teamNumbers(t, b)),
    recruitBonus: recruitBonusOf(c),
    total,
    milestones,
    next: next ? { target: next.target, remaining: next.target - total } : null,
    winners: phase === 'final' && b?.frozen ? b.winners || null : null,
    updatedAt: b?.at || now.toISOString(),
  }
}

// ── Player page ────────────────────────────────────────────────────────

const GIFT_KINDS = ['charge_cell', 'xp', 'streak_freeze', 'extension', 'wings', 'backup_pass']

/** What a pool can hold, for display — kinds and amounts, never weights. */
function poolKinds(pool) {
  return (Array.isArray(pool) ? pool : [])
    .filter((x) => GIFT_KINDS.includes(x?.kind) && Number(x.weight) > 0)
    .map((x) => ({ kind: x.kind, amount: Number(x.amount) || 1 }))
}

/** Battle numbers for one agent, all counted by the database.
 *  verifiedCount: any verified MAMA mission qualifies for Battle Gifts;
 *  the winner reward needs a point actually scored for the winning team. */
function battleView(c, b, team, claims, winnerClaim, verifiedCount) {
  const cfg = c.battle || {}
  const teams = (cfg.teams || []).map((t) => {
    const n = teamNumbers(t, b)
    return { ...n, size: n.agents }
  })
  const total = Number(b?.total) || 0
  const mine = Number(b?.mine) || 0
  const claimed = new Set((claims || []).map((r) => Number(r.milestone_index)))
  const targets = Array.isArray(cfg.milestones) ? cfg.milestones.map(Number).filter((x) => x > 0) : null
  const giftReady = !!targets && poolKinds(cfg.gift?.pool).length > 0
  const contributor = verifiedCount > 0
  const frozen = !!b?.frozen
  const winners = Array.isArray(b?.winners) ? b.winners : []
  const reward = Array.isArray(cfg.winner_reward) ? cfg.winner_reward.filter((x) => GIFT_KINDS.includes(x?.kind)) : []
  let winnerState = 'pending'
  if (winnerClaim) winnerState = 'claimed'
  else if (frozen && mine === 0) winnerState = 'not_contributor'
  else if (frozen && !winners.includes(team?.team)) winnerState = 'not_winner'
  else if (frozen) winnerState = 'claimable'
  return {
    teams,
    myTeam: team?.team || null,
    assignedVia: team?.via || null,
    myPoints: mine,
    total,
    recruitBonus: recruitBonusOf(c),
    opensAt: c.opens_at,
    closesAt: c.closes_at,
    freezeAt: b?.freezeAt || cfg.freeze_at || c.closes_at,
    frozen,
    winners: frozen ? winners : null,
    milestones: giftReady
      ? targets.map((target, index) => ({
        index, target, reached: total >= target, claimed: claimed.has(index),
        claimable: total >= target && contributor && !claimed.has(index),
      }))
      : null,
    giftPool: giftReady ? poolKinds(cfg.gift.pool) : [],
    contributor,
    winnerReward: reward.length ? {
      rewards: reward.map((x) => ({ kind: x.kind, amount: Number(x.amount) || 1 })),
      state: winnerState,
    } : null,
  }
}

export async function getVotingStatus(db, params, now = new Date()) {
  const agentNo = agentOf(params)
  const c = params.campaignId ? await loadCampaign(db, String(params.campaignId)) : await currentCampaign(db, now, { promo: true })
  if (!c) return fail('no_campaign')
  const today = kstDayOf(now)
  const badgeTemplate = c.rewards?.badge_template_id || null
  // Badge days may span rounds (rewards.badge_scope), as the database counts them.
  const badgeScope = [...new Set([...(Array.isArray(c.rewards?.badge_scope) ? c.rewards.badge_scope.map(String) : []), c.id])]
  const battleOn = !!c.battle?.enabled

  const [proofsRes, verifiedRes, handleRes, progressRes, opensRes, fillsRes, pulseRes, badgeRes, teamRes, battleRes, claimsRes, winnerRes, replRes] = await Promise.all([
    // Own rows only. Bounded: a short campaign, at most six proofs per day.
    db.from('rc_campaign_proofs')
      .select('id, mission_id, vote_day, status, checks, verify_note, submitted_at, verified_at, duplicate_kind, post_author')
      .eq('campaign_id', c.id).eq('agent_no', agentNo).order('submitted_at', { ascending: false }).limit(60),
    db.from('rc_campaign_proofs').select('vote_day')
      .eq('campaign_id', c.id).eq('agent_no', agentNo).eq('status', 'verified').limit(400),
    // Active accounts only: a replaced (retired) account keeps its history but no slot.
    db.from('rc_agent_x_handles').select('x_handle').eq('campaign_id', c.id).eq('agent_no', agentNo).is('retired_at', null)
      .order('created_at', { ascending: true }).limit(3),
    db.from('rc_vote_gift_progress').select('fill').eq('campaign_id', c.id).eq('agent_no', agentNo).maybeSingle(),
    db.from('rc_vote_gift_opens').select('id', { count: 'exact', head: true })
      .eq('campaign_id', c.id).eq('agent_no', agentNo).eq('kst_day', today),
    db.from('rc_vote_gift_fills').select('mission_id, vote_day, amount, created_at')
      .eq('campaign_id', c.id).eq('agent_no', agentNo).order('created_at', { ascending: false }).limit(5),
    // The shared Pulse snapshot: one cached row, written only by the
    // scheduled collector. Aggregates only.
    db.from('rc_vote_pulse').select('total_count, previous_count, last_success_at, last_status')
      .eq('campaign_id', c.id).maybeSingle(),
    badgeTemplate
      ? db.from('rc_badges').select('badge_id').eq('agent_no', agentNo).eq('badge_id', badgeTemplate).maybeSingle()
      : Promise.resolve({ data: null }),
    // Resolving here is what makes a timed-out chooser stick even if the
    // player closed the app mid-countdown: the next read assigns them.
    battleOn ? db.rpc('rc_campaign_team_resolve', { p_campaign_id: c.id, p_agent_no: agentNo }) : Promise.resolve({ data: null }),
    battleOn ? db.rpc('rc_campaign_battle_state', { p_campaign_id: c.id, p_agent_no: agentNo }) : Promise.resolve({ data: null }),
    battleOn ? db.from('rc_battle_gift_claims').select('milestone_index').eq('campaign_id', c.id).eq('agent_no', agentNo)
      : Promise.resolve({ data: [] }),
    battleOn ? db.from('rc_battle_winner_claims').select('team').eq('campaign_id', c.id).eq('agent_no', agentNo).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('rc_x_handle_replacements').select('id, old_handle, new_handle, reason, status, created_at, decided_at')
      .eq('campaign_id', c.id).eq('agent_no', agentNo).order('created_at', { ascending: false }).limit(5),
  ])
  // Extra badges (rewards.extra_badges): N days in this round alone.
  const extraBadges = (Array.isArray(c.rewards?.extra_badges) ? c.rewards.extra_badges : [])
    .filter((x) => /^[a-z0-9_]{3,60}$/.test(String(x?.template_id || '')) && Number(x.verified_days) > 0)
  const extraEarned = extraBadges.length
    ? await db.from('rc_badges').select('badge_id').eq('agent_no', agentNo).in('badge_id', extraBadges.map((x) => x.template_id))
    : { data: [] }
  const scopeRes = badgeTemplate && badgeScope.length > 1
    ? await db.from('rc_campaign_proofs').select('vote_day').in('campaign_id', badgeScope)
      .eq('agent_no', agentNo).eq('status', 'verified').limit(800)
    : verifiedRes

  const proofs = proofsRes.data || []
  const verifiedDays = [...new Set((verifiedRes.data || []).map((r) => r.vote_day))]
  const fill = Number(progressRes.data?.fill) || 0
  const opensToday = Number(opensRes.count) || 0
  const gift = c.gift || {}
  const rewards = c.rewards || {}
  const xMission = (c.missions || []).find((m) => m.kind === 'x_post')

  return {
    success: true,
    campaign: {
      id: c.id, title: c.title, roundLabel: c.round_label, opensAt: c.opens_at, closesAt: c.closes_at,
      phase: campaignPhase(c, now),
      // Before voting opens: the battle is recruiting (sides, chat, countdown).
      promo: inPromo(c, now),
      freezeAt: c.battle?.freeze_at || c.closes_at,
      // Mission config the page needs to render; nothing reward-related.
      missions: (c.missions || []).map((m) => ({
        id: m.id, kind: m.kind, label: m.label, voteUrl: m.vote_url || null,
        maxDaily: Math.max(1, Number(m.max_daily) || 1), maxHandles: Math.max(1, Number(m.max_handles) || 1),
        hashtags: m.hashtags || [], requireHandleMatch: !!m.require_handle_match,
        exclusiveHashtags: !!m.exclusive_hashtags,
        ...(m.category_label ? { categoryLabel: String(m.category_label) } : {}),
        // This round's own words for the card and the guide, when it has them.
        ...(m.rule ? { rule: String(m.rule) } : {}),
        ...(Array.isArray(m.guide) ? { guide: m.guide.map(String).slice(0, 8) } : {}),
        // The categories one Mnet round asks for (Round 2: Male, Female, and
        // VISA Fans' Choice of the Year), for the card and the guide.
        ...(Array.isArray(m.categories) ? { categories: m.categories.slice(0, 6).map((x) => ({
          name: String(x?.name || ''), pick: String(x?.pick || ''), ...(x?.tag ? { tag: String(x.tag) } : {}),
        })) } : {}),
        // For the browser's friendly pre-check only.
        ...(m.kind === 'mnet_certificate' ? { certificate: m.certificate || {} } : {}),
      })),
    },
    today,
    states: missionStates(c, proofs, today),
    todayProgress: missionProgress(c, proofs, today),
    // No internal review notes: the player only ever gets the plain duplicate word.
    todayProofs: proofs.filter((p) => p.vote_day === today && p.status !== 'rejected')
      .map((p) => ({ missionId: p.mission_id, status: p.status, checks: p.checks || {}, ...proofHint(p) })),
    notices: duplicateNotices(c, proofs, today),
    alerts: duplicateAlerts(proofs, today),
    stats: {
      verifiedVotes: (verifiedRes.data || []).length,
      votingDays: verifiedDays.length,
      streak: votingStreak(verifiedDays, today),
    },
    activity: proofs.slice(0, 8).map((p) => ({
      missionId: p.mission_id, voteDay: p.vote_day, status: p.status, at: p.verified_at || p.submitted_at,
    })),
    xHandleLinked: (handleRes.data || []).length > 0,
    // Their own handles, shown only back to them on their own page.
    xHandles: (handleRes.data || []).map((r) => r.x_handle),
    // Accounts that already carry a counted or pending vote can't be removed
    // by the player (no rotating accounts for extra credit) — an admin can.
    xHandleLocked: (handleRes.data || []).map((r) => r.x_handle)
      .filter((h) => proofs.some((p) => p.post_author === h && p.status !== 'rejected')),
    xHandle: handleRes.data?.[0]?.x_handle || null,
    // Their own replacement requests: the status only (Pending approval /
    // Approved / Rejected) — never the reviewer's note or name.
    xReplacements: (replRes?.data || []).map((r) => ({
      id: r.id, oldHandle: r.old_handle, newHandle: r.new_handle, reason: r.reason, status: r.status, at: r.decided_at || r.created_at,
    })),
    xReplacementsLeft: Math.max(0, maxReplacements(xMission) - (replRes?.data || []).filter((r) => r.status === 'approved').length),
    gift: {
      name: gift.name || 'Voting Gift',
      fill,
      threshold: Number(gift.threshold) || null,
      dailyCap: Number(gift.daily_open_cap) || null,
      opensToday,
      state: giftState(gift, fill, opensToday),
      pool: poolKinds(gift.pool),
      contributions: (fillsRes.data || []).map((f) => ({ missionId: f.mission_id, voteDay: f.vote_day, amount: f.amount })),
    },
    badge: badgeTemplate ? {
      templateId: badgeTemplate,
      verifiedDays: Number(rewards.badge_verified_days) || null,
      daysDone: new Set((scopeRes.data || []).map((r) => r.vote_day)).size,
      acrossRounds: badgeScope.length > 1,
      earned: !!badgeRes.data,
    } : null,
    // This round's own badges, e.g. MAMA 2026 · Daesang (7 days in Round 2).
    extraBadges: extraBadges.map((x) => ({
      templateId: x.template_id,
      name: String(x.name || ''),
      verifiedDays: Number(x.verified_days),
      daysDone: verifiedDays.length,
      earned: (extraEarned.data || []).some((r) => r.badge_id === x.template_id),
    })),
    battle: battleOn ? battleView(c, battleRes.data, teamRes.data, claimsRes.data, winnerRes.data, (verifiedRes.data || []).length) : null,
    pulse: c.pulse?.enabled ? pulseView(pulseRes.data, xMission?.hashtags || [], now) : null,
  }
}

// ── Team battle ────────────────────────────────────────────────────────

function teamOut(c, state, now = new Date()) {
  const deadline = state?.deadline ? new Date(state.deadline) : null
  return {
    success: true,
    team: state?.team || null,
    via: state?.via || null,
    // Seconds left on the SERVER's clock, so a phone with a wrong clock
    // still sees the real countdown.
    secondsLeft: deadline && !state?.team ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0,
    teams: (c.battle?.teams || []).map((t) => ({ id: t.id, label: t.label })),
  }
}

/** Opens (or continues) the 7-second choice. After the window it returns
 *  the server's own assignment instead. */
export async function startVotingTeamChoice(db, params, now = new Date()) {
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c?.battle?.enabled) return fail('battle_off')
  // Sides open with the promo window, before voting does.
  if (campaignPhase(c, now) === 'upcoming' && !inPromo(c, now)) return fail('voting_not_open')
  const { data, error } = await db.rpc('rc_campaign_team_start', { p_campaign_id: c.id, p_agent_no: agentOf(params) })
  if (error || data?.error) return fail(data?.error || 'db_error')
  return teamOut(c, data, now)
}

export async function chooseVotingTeam(db, params, now = new Date()) {
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c?.battle?.enabled) return fail('battle_off')
  const team = String(params.team || '')
  if (!(c.battle.teams || []).some((t) => t.id === team)) return fail('team_invalid')
  const { data, error } = await db.rpc('rc_campaign_team_choose', { p_campaign_id: c.id, p_agent_no: agentOf(params), p_team: team })
  if (error || data?.error) return fail(data?.error || 'db_error')
  return teamOut(c, data, now)
}

/** After the Oct 23 12:00 KST freeze: the winning team's contributors
 *  (both teams on a tie) claim the winner reward once. */
export async function claimBattleWinner(db, params) {
  const requestId = String(params.requestId || '')
  if (!UUID.test(requestId)) return fail('bad_request')
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c?.battle?.enabled) return fail('battle_off')
  const { data: r, error } = await db.rpc('rc_battle_winner_claim', {
    p_campaign_id: c.id, p_agent_no: agentOf(params), p_request_id: requestId,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error')
  return { success: true, rewards: r.rewards || [], replay: !!r.replay }
}

export async function claimBattleGift(db, params) {
  const requestId = String(params.requestId || '')
  const index = Number(params.milestoneIndex)
  if (!UUID.test(requestId) || !Number.isInteger(index) || index < 0) return fail('bad_request')
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c?.battle?.enabled) return fail('battle_off')
  const { data: r, error } = await db.rpc('rc_battle_gift_claim', {
    p_campaign_id: c.id, p_agent_no: agentOf(params), p_milestone_index: index, p_request_id: requestId,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error')
  return { success: true, rewards: r.rewards || [], replay: !!r.replay }
}

// ── Mnet ───────────────────────────────────────────────────────────────

export async function submitMnetProof(db, params, now = new Date()) {
  const agentNo = agentOf(params)
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c) return fail('no_campaign')
  const phase = campaignPhase(c, now)
  if (phase !== 'open') return fail(phase === 'upcoming' ? 'voting_not_open' : 'voting_closed')
  const mission = missionById(c, String(params.missionId || 'mnet'))
  if (!mission || mission.kind !== 'mnet_certificate') return fail('bad_mission')

  const mime = String(params.imageMime || '').toLowerCase()
  if (!MIMES[mime]) return fail('bad_image_type')
  const bytes = decodeBase64(String(params.imageBase64 || ''))
  if (!bytes || !bytes.length) return fail('proof_required')
  if (bytes.length > MAX_IMAGE_BYTES) return fail('image_too_large')
  const originalHash = String(params.originalHash || '').toLowerCase()
  if (originalHash && !HEX64.test(originalHash)) return fail('bad_original_hash')

  const voteDay = kstDayOf(now)
  const imageHash = await sha256Hex(bytes)
  const path = `${c.id}/${agentNo}/${voteDay}-${mission.id}-${imageHash.slice(0, 16)}.${MIMES[mime]}`

  const { error: upErr } = await db.storage.from(PROOF_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
  // The path is derived from the content, so "already exists" means this
  // exact upload already landed (a retry) — carry on to the idempotent RPC.
  const existed = !!upErr && /exist|duplicate|409/i.test(`${upErr.message} ${upErr.statusCode || ''}`)
  if (upErr && !existed) return fail('upload_failed')

  // A timed-out 7-second choice is settled before the proof goes in, so the
  // database's team_required rule only stops agents who truly have no side.
  if (c.battle?.enabled) await db.rpc('rc_campaign_team_resolve', { p_campaign_id: c.id, p_agent_no: agentNo })
  const { data: r, error } = await db.rpc('rc_campaign_submit_proof', {
    p_campaign_id: c.id, p_mission_id: mission.id, p_agent_no: agentNo, p_vote_day: voteDay,
    p_status: 'verifying', p_checks: {}, p_client_checks: sanitizeClientCertChecks(params.clientChecks),
    p_method: null, p_note: 'awaiting_trusted_check',
    p_proof_path: path, p_image_hash: imageHash, p_original_hash: originalHash || null,
    p_post_id: null, p_post_url: null, p_post_author: null,
  })
  if (error || !r?.success) {
    // Don't leave a file nothing points at.
    if (!existed) await db.storage.from(PROOF_BUCKET).remove([path])
    return fail(r?.error || 'db_error', r?.status ? { status: r.status } : {})
  }
  // The uploading phone's UTC offset: Mnet prints the participation time on
  // that phone's clock. Only a real offset is kept; it converts the printed
  // time for the trusted date check and never decides anything by itself.
  const offset = validUtcOffset(params.utcOffsetMinutes)
  if (offset !== null) await db.from('rc_campaign_proofs').update({ cert_utc_offset_min: offset }).eq('id', r.id)
  return { success: true, proofId: r.id, status: r.status, voteDay }
}

// ── X ──────────────────────────────────────────────────────────────────

export async function setXHandle(db, params) {
  const agentNo = agentOf(params)
  const campaignId = String(params.campaignId || '')
  const raw = String(params.xHandle ?? '').trim()
  if (!raw) return fail('bad_handle')
  const handle = normalizeHandle(raw)
  if (!handle) return fail('bad_handle')
  const { data: r, error } = await db.rpc('rc_campaign_register_x_handle', {
    p_campaign_id: campaignId, p_agent_no: agentNo, p_x_handle: handle,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error')
  return { success: true, xHandle: handle, replay: !!r.replay }
}

/** Unlink one of the player's X accounts. Only an account with no counted or
 *  pending vote can go (rc_campaign_remove_x_handle); one with votes needs an
 *  admin, so swapping accounts can never earn extra credit. */
export async function removeXHandle(db, params) {
  const agentNo = agentOf(params)
  const handle = normalizeHandle(String(params.xHandle ?? '').trim())
  if (!handle) return fail('bad_handle')
  const { data: r, error } = await db.rpc('rc_campaign_remove_x_handle', {
    p_campaign_id: String(params.campaignId || ''), p_agent_no: agentNo, p_x_handle: handle,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error')
  return { success: true, removed: handle }
}

// ── X account replacement ──────────────────────────────────────────────
// For an account that is suspended, deleted or can't be accessed and already
// carries votes. The player names the new account and picks a reason; an
// admin approves. Nothing is ever asked that would prove access (no
// passwords, codes or login details).

export const X_REPLACEMENT_REASONS = ['suspended', 'deleted', 'locked', 'other']
const maxReplacements = (mission) => Math.max(0, Number(mission?.max_replacements ?? 1) || 0)
// "@name", "name" or a pasted profile link (x.com/name, twitter.com/name).
const handleFrom = (raw) => normalizeHandle(String(raw ?? '').trim()
  .replace(/^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0])

export async function requestXReplacement(db, params) {
  const agentNo = agentOf(params)
  const oldHandle = handleFrom(params.oldHandle)
  const newHandle = handleFrom(params.newHandle)
  if (!oldHandle || !newHandle) return fail('bad_handle')
  const reason = String(params.reason || '')
  if (!X_REPLACEMENT_REASONS.includes(reason)) return fail('bad_reason')
  const note = String(params.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null
  const { data: r, error } = await db.rpc('rc_campaign_request_x_replacement', {
    p_campaign_id: String(params.campaignId || ''), p_agent_no: agentNo,
    p_old_handle: oldHandle, p_new_handle: newHandle, p_reason: reason, p_note: note,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error', r?.limit ? { limit: r.limit } : {})
  return { success: true, id: r.id, status: 'pending', oldHandle, newHandle }
}

const REPLACEMENT_STATUSES = new Set(['pending', 'approved', 'rejected'])

export async function adminListXReplacements(db, params) {
  const c = params.campaignId ? await loadCampaign(db, String(params.campaignId)) : await currentCampaign(db, new Date())
  if (!c) return fail('no_campaign')
  const status = REPLACEMENT_STATUSES.has(String(params.status)) ? String(params.status) : 'pending'
  const [{ data: rows, error }, { count: pending }] = await Promise.all([
    db.from('rc_x_handle_replacements')
      .select('id, agent_no, old_handle, new_handle, reason, note, status, created_at, decided_at, decided_by, admin_note')
      .eq('campaign_id', c.id).eq('status', status).order('created_at', { ascending: status === 'pending' }).limit(100),
    db.from('rc_x_handle_replacements').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', 'pending'),
  ])
  if (error) return fail('db_error')
  const list = rows || []
  const agents = [...new Set(list.map((r) => r.agent_no))]
  const [ig, hs, ps] = agents.length ? await Promise.all([
    db.from('rc_agents').select('agent_no, handle').in('agent_no', agents),
    db.from('rc_agent_x_handles').select('agent_no, x_handle, retired_at').eq('campaign_id', c.id).in('agent_no', agents),
    db.from('rc_campaign_proofs').select('agent_no, post_author, status, vote_day').eq('campaign_id', c.id).in('agent_no', agents).not('post_author', 'is', null),
  ]) : [{ data: [] }, { data: [] }, { data: [] }]
  const instagram = new Map((ig.data || []).map((a) => [a.agent_no, instagramOf(a.handle)]))
  return {
    success: true, campaign: { id: c.id, title: c.title }, status, pending: pending || 0,
    requests: list.map((r) => {
      const votes = (ps.data || []).filter((p) => p.agent_no === r.agent_no && p.post_author === r.old_handle && p.status !== 'rejected')
      return {
        ...r, instagram: instagram.get(r.agent_no) || null,
        oldHandleVotes: { verified: votes.filter((v) => v.status === 'verified').length, pending: votes.filter((v) => v.status !== 'verified').length,
          lastDay: votes.map((v) => v.vote_day).sort().pop() || null },
        accounts: (hs.data || []).filter((h) => h.agent_no === r.agent_no).map((h) => ({ handle: h.x_handle, retired: !!h.retired_at })),
      }
    }),
  }
}

export async function adminDecideXReplacement(db, params) {
  const requestId = Number(params.requestId)
  const decision = String(params.decision || '')
  if (!Number.isInteger(requestId) || requestId <= 0 || !['approve', 'reject'].includes(decision)) return fail('bad_params')
  const { data: r, error } = await db.rpc('rc_campaign_decide_x_replacement', {
    p_request_id: requestId, p_decision: decision, p_actor: String(params.admin || 'admin').slice(0, 40),
    p_note: params.note ? String(params.note).slice(0, 300) : null,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error', r?.status ? { status: r.status } : {})
  return { success: true, status: r.status }
}

/** A plain word the card can act on — never an internal review note.
 *  'unreadable': the trusted check couldn't read the certificate wording.
 *  'unlinked_account': an X post from an account not linked to this agent. */
function proofHint(p) {
  if (p.status !== 'review') return {}
  if (p.mission_id !== 'x' && !p.duplicate_kind && p.checks?.certificate === false) return { hint: 'unreadable' }
  if (p.verify_note === 'author_mismatch' && p.post_author) return { hint: 'unlinked_account', author: p.post_author }
  if (p.verify_note === 'extra_hashtags') return { hint: 'extra_hashtags' }
  return {}
}

export async function submitXProof(db, params, { verifier, now = new Date() } = {}) {
  const agentNo = agentOf(params)
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c) return fail('no_campaign')
  const phase = campaignPhase(c, now)
  if (phase !== 'open') return fail(phase === 'upcoming' ? 'voting_not_open' : 'voting_closed')
  const mission = missionById(c, String(params.missionId || 'x'))
  if (!mission || mission.kind !== 'x_post') return fail('bad_mission')

  const parsed = parseXPostUrl(params.postUrl)
  if (!parsed) return fail('bad_url')
  const postedAt = snowflakeTime(parsed.postId)
  if (!postedAt) return fail('bad_url')
  // The window opens part-way through a KST day (19:00 on Oct 12): a post
  // from earlier that day is on a valid day but is not a vote.
  if (postedAt < new Date(c.opens_at)) return fail('post_before_open')
  if (postedAt > new Date(c.closes_at)) return fail('post_after_close')

  const { data: registeredRows } = await db.from('rc_agent_x_handles').select('x_handle')
    .eq('campaign_id', c.id).eq('agent_no', agentNo).is('retired_at', null).limit(Math.max(1, Number(mission.max_handles) || 1))
  const registered = new Set((registeredRows || []).map((r) => r.x_handle))
  if (mission.require_handle_match && !registered.size) return fail('x_handle_required')

  // The post's own timestamp decides its day. Today counts; so does
  // yesterday, for a post made just before 00:00 KST and pasted after it.
  const voteDay = kstDayOf(postedAt)
  const today = kstDayOf(now)
  if (voteDay !== today && voteDay !== addDays(today, -1)) return fail('post_wrong_day', { postDay: voteDay })

  const fetched = await (verifier || oembedXVerifier()).verify({ postId: parsed.postId })
  const fetchedAuthor = fetched?.ok ? normalizeHandle(fetched.authorHandle) : null

  // Problems X itself confirms are explained right away instead of filling
  // the review queue: nothing is stored, the player fixes it and sends the
  // link again. Anything uncertain (X unreachable, or a linked handle in the
  // link with another author — a renamed account) still goes to review.
  if (!fetched?.ok && fetched?.reason === 'forbidden') return fail('x_post_private')
  if (!fetched?.ok && fetched?.reason === 'not_found') return fail('x_post_not_found')
  if (fetched?.ok) {
    const missing = missingHashtags(fetched.hashtags, mission.hashtags || [])
    if (missing.length) return fail('x_missing_hashtags', { missing: missing.map((h) => `#${String(h).replace(/^#/, '')}`) })
    const urlLinked = !!parsed.urlHandle && registered.has(parsed.urlHandle)
    if (mission.require_handle_match && fetchedAuthor && !registered.has(fetchedAuthor) && !urlLinked) {
      const { data: owner } = await db.from('rc_agent_x_handles').select('agent_no, retired_at')
        .eq('campaign_id', c.id).eq('x_handle', fetchedAuthor).maybeSingle()
      if (owner?.agent_no && owner.agent_no !== agentNo) return fail('x_handle_taken', { author: fetchedAuthor })
      // Their own replaced account: it keeps its old votes but earns no new ones.
      if (owner?.agent_no === agentNo && owner.retired_at) return fail('x_handle_retired', { author: fetchedAuthor })
      const maxHandles = Math.max(1, Number(mission.max_handles) || 1)
      return fail('x_account_not_linked', { author: fetchedAuthor, canLink: registered.size < maxHandles })
    }
  }
  const expectedHandle = fetchedAuthor && registered.has(fetchedAuthor)
    ? fetchedAuthor
    : parsed.urlHandle && registered.has(parsed.urlHandle) ? parsed.urlHandle : null
  const decision = decideXProof({
    fetched, requiredHashtags: mission.hashtags || [], exclusiveHashtags: !!mission.exclusive_hashtags, expectedHandle,
    requireHandleMatch: !!mission.require_handle_match, dateOk: true,
  })
  const author = fetchedAuthor

  // A timed-out 7-second choice is settled before the proof goes in, so the
  // database's team_required rule only stops agents who truly have no side.
  if (c.battle?.enabled) await db.rpc('rc_campaign_team_resolve', { p_campaign_id: c.id, p_agent_no: agentNo })
  const { data: r, error } = await db.rpc('rc_campaign_submit_proof', {
    p_campaign_id: c.id, p_mission_id: mission.id, p_agent_no: agentNo, p_vote_day: voteDay,
    p_status: decision.status, p_checks: decision.checks, p_client_checks: {},
    p_method: verifier?.method || 'x_oembed', p_note: decision.note,
    p_proof_path: null, p_image_hash: null, p_original_hash: null,
    p_post_id: parsed.postId, p_post_url: `https://x.com/${author || 'i'}/status/${parsed.postId}`, p_post_author: author,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error', r?.status ? { status: r.status } : {})
  return { success: true, proofId: r.id, status: r.status, checks: decision.checks, voteDay }
}

// ── Voting Gift ────────────────────────────────────────────────────────

export async function openVotingGift(db, params) {
  const agentNo = agentOf(params)
  const requestId = String(params.requestId || '')
  if (!UUID.test(requestId)) return fail('bad_request')
  const c = await loadCampaign(db, String(params.campaignId || ''))
  if (!c) return fail('no_campaign')
  const { data: r, error } = await db.rpc('rc_vote_gift_open', {
    p_campaign_id: c.id, p_agent_no: agentNo, p_request_id: requestId,
  })
  if (error || !r?.success) return fail(r?.error || 'db_error')
  return { success: true, rewards: r.rewards || [], fillRemaining: r.fillRemaining ?? null, replay: !!r.replay }
}

// ── Admin review ───────────────────────────────────────────────────────

const X_CHECK_KEYS = ['date', 'found', 'publicPost', 'hashtags', 'author']
function sanitizeChecksFor(kind, raw) {
  if (kind === 'mnet_certificate') return sanitizeMnetChecks(raw)
  const out = {}
  for (const k of X_CHECK_KEYS) if (raw && typeof raw[k] === 'boolean') out[k] = raw[k]
  return out
}

const QUEUE_STATUSES = new Set(['verifying', 'review', 'verified', 'rejected'])

// Review rows read for the summary and the reason filter: enough to classify, no more.
const REVIEW_SCAN_LIMIT = 1000
const PROOF_COLS = 'id, mission_id, agent_no, vote_day, status, checks, client_checks, verify_method, verify_note, proof_path, post_url, post_author, submitted_at, reviewed_by, reviewed_at, review_note, duplicate_of, duplicate_kind, cert_utc_offset_min, image_hash, original_hash, cert_fingerprint'

const instagramOf = (handle) => {
  const h = String(handle || '').trim().replace(/^@+/, '')
  return h || null
}

export async function adminListCampaignProofs(db, params) {
  const c = params.campaignId ? await loadCampaign(db, String(params.campaignId)) : await currentCampaign(db, new Date())
  if (!c) return fail('no_campaign')
  const status = QUEUE_STATUSES.has(String(params.status)) ? String(params.status) : 'review'
  const reason = status === 'review' && REVIEW_REASONS.includes(String(params.reason)) ? String(params.reason) : null
  const limit = Math.min(50, Math.max(1, Number(params.limit) || 20))
  const offset = Math.max(0, Number(params.offset) || 0)
  const kindOf = (r) => missionById(c, r.mission_id)?.kind || null

  // Every proof waiting for a person, classified once: the summary counts,
  // and (with a reason) which of them this page shows.
  const [{ count }, counts, { data: pending }] = await Promise.all([
    db.from('rc_campaign_proofs').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', status),
    Promise.all(['verifying', 'review'].map((s) => db.from('rc_campaign_proofs')
      .select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('status', s))),
    db.from('rc_campaign_proofs').select('id, mission_id, verify_note, duplicate_kind')
      .eq('campaign_id', c.id).eq('status', 'review').order('submitted_at', { ascending: true }).limit(REVIEW_SCAN_LIMIT),
  ])
  const summary = Object.fromEntries([['all', 0], ...REVIEW_REASONS.map((k) => [k, 0])])
  const matching = []
  for (const r of pending || []) {
    const why = reviewReason(r, kindOf(r))
    summary.all++
    summary[why]++
    if (why === reason) matching.push(r.id)
  }

  let rows
  let total = count || 0
  if (reason) {
    total = matching.length
    const ids = matching.slice(offset, offset + limit)
    const { data, error } = ids.length ? await db.from('rc_campaign_proofs').select(PROOF_COLS).in('id', ids) : { data: [] }
    if (error) return fail('db_error')
    const at = new Map(ids.map((id, i) => [id, i]))
    rows = (data || []).filter((r) => at.has(r.id)).sort((a, b) => at.get(a.id) - at.get(b.id))
  } else {
    const { data, error } = await db.from('rc_campaign_proofs').select(PROOF_COLS)
      .eq('campaign_id', c.id).eq('status', status).order('submitted_at', { ascending: true }).range(offset, offset + limit - 1)
    if (error) return fail('db_error')
    rows = data || []
  }

  // The proof each duplicate points at. Fingerprints and hashes are compared
  // here and never leave the server.
  const relatedIds = [...new Set(rows.map((r) => r.duplicate_of).filter((id) => id !== null && id !== undefined))]
  const relatedRows = new Map()
  if (relatedIds.length) {
    const { data: rs } = await db.from('rc_campaign_proofs')
      .select('id, mission_id, agent_no, vote_day, status, proof_path, post_url, image_hash, original_hash, cert_fingerprint').in('id', relatedIds)
    for (const r of rs || []) relatedRows.set(r.id, r)
  }

  // "AGENT060 · @instagram": the Instagram account the agent signs in with.
  const agents = [...new Set([...rows.map((r) => r.agent_no), ...[...relatedRows.values()].map((r) => r.agent_no)])]
  const instagram = new Map()
  if (agents.length) {
    const { data: as } = await db.from('rc_agents').select('agent_no, handle').in('agent_no', agents)
    for (const a of as || []) instagram.set(a.agent_no, instagramOf(a.handle))
  }

  const xAgents = [...new Set(rows.filter((r) => kindOf(r) === 'x_post').map((r) => r.agent_no))]
  const handles = new Map()
  if (xAgents.length) {
    const { data: hs } = await db.from('rc_agent_x_handles').select('agent_no, x_handle').in('agent_no', xAgents)
    for (const h of hs || []) handles.set(h.agent_no, h.x_handle)
  }

  // An agent's phone offset should not move between uploads. If it has, none
  // of their offsets is trusted for the automatic date check: those proofs
  // read the printed time as KST, which sends a mismatch to a reviewer.
  const mnetAgents = [...new Set(rows.filter((r) => kindOf(r) === 'mnet_certificate').map((r) => r.agent_no))]
  const offsets = new Map()
  if (mnetAgents.length) {
    const { data: os } = await db.from('rc_campaign_proofs').select('agent_no, cert_utc_offset_min')
      .eq('campaign_id', c.id).in('agent_no', mnetAgents)
    for (const o of os || []) {
      if (o.cert_utc_offset_min === null || o.cert_utc_offset_min === undefined) continue
      if (!offsets.has(o.agent_no)) offsets.set(o.agent_no, new Set())
      offsets.get(o.agent_no).add(o.cert_utc_offset_min)
    }
  }
  // Trusted when the agent's uploads all agree, or differ by at most an hour
  // (two phones, or a neighbouring zone: +5:30 / +6:00) — a wider spread
  // still falls back to KST and a reviewer.
  const steadyOffsets = (set) => !!set && set.size > 0 && Math.max(...set) - Math.min(...set) <= 60
  const trustedOffset = (r) => (validUtcOffset(r.cert_utc_offset_min) !== null && steadyOffsets(offsets.get(r.agent_no)) ? r.cert_utc_offset_min : null)

  const signed = async (path) => {
    if (!path) return null
    const { data: s } = await db.storage.from(PROOF_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    return s?.signedUrl || null
  }

  const proofs = await Promise.all(rows.map(async (r) => {
    const { proof_path, cert_utc_offset_min, image_hash, original_hash, cert_fingerprint, ...rest } = r
    const mission = missionById(c, r.mission_id)
    const o = r.duplicate_kind ? relatedRows.get(r.duplicate_of) : null
    return {
      ...rest, kind: mission?.kind || null, missionLabel: mission?.label || r.mission_id,
      instagram: instagram.get(r.agent_no) || null,
      expectedHandle: handles.get(r.agent_no) || null, proofUrl: await signed(proof_path),
      reviewReason: r.status === 'review' ? reviewReason(r, mission?.kind) : null,
      duplicateReason: duplicateReason(r, o),
      related: o ? {
        id: o.id, agent_no: o.agent_no, instagram: instagram.get(o.agent_no) || null, status: o.status, vote_day: o.vote_day,
        missionLabel: missionById(c, o.mission_id)?.label || o.mission_id, post_url: o.post_url || null, proofUrl: await signed(o.proof_path),
      } : null,
      // What the trusted check needs for this mission, nothing more.
      certificate: mission?.kind === 'mnet_certificate' ? (mission.certificate || {}) : null,
      window: { opensAt: c.opens_at, closesAt: c.closes_at, submittedAt: r.submitted_at, utcOffsetMinutes: trustedOffset(r) },
      utcOffsetMinutes: cert_utc_offset_min ?? null,
    }
  }))

  return {
    success: true, campaign: { id: c.id, title: c.title }, status, reason, proofs, total, limit, offset,
    queue: { verifying: counts[0].count || 0, review: counts[1].count || 0 }, summary,
  }
}

async function loadProofWithMission(db, proofId) {
  const { data: p } = await db.from('rc_campaign_proofs').select('id, campaign_id, mission_id, status').eq('id', proofId).maybeSingle()
  if (!p) return { error: 'not_found' }
  const c = await loadCampaign(db, p.campaign_id)
  const mission = c ? missionById(c, p.mission_id) : null
  if (!mission) return { error: 'not_found' }
  return { proof: p, mission }
}

/** A trusted OCR run (in the admin panel, on the server-stored image)
 *  reports three booleans; the server makes the decision. */
export async function adminRecordCampaignChecks(db, params, { fingerprintKey = '' } = {}) {
  const proofId = Number(params.proofId)
  if (!Number.isInteger(proofId) || proofId <= 0) return fail('bad_params')
  const { proof, mission, error } = await loadProofWithMission(db, proofId)
  if (error) return fail(error)
  if (mission.kind !== 'mnet_certificate') return fail('bad_mission')
  const decision = decideMnetChecks(params.checks)

  // Duplicate-certificate fingerprints. The raw number and time exist only
  // in this request: normalised, HMAC'd, and dropped — never stored,
  // logged or returned. No key configured → no fingerprints, and the
  // existing image-hash + certificate checks stand alone.
  let certFp = null
  let timeFp = null
  if (fingerprintKey) {
    const len = Number(mission.certificate?.number_length) || 16
    const num = normalizeCertificateNumber(params.certificateNumber)
    if (num.length === len && /^[0-9A-Z]+$/.test(num)) certFp = await certFingerprint(fingerprintKey, proof.campaign_id, 'number', num)
    const minute = params.participationAt ? participationMinuteKey(params.participationAt) : null
    if (minute) timeFp = await certFingerprint(fingerprintKey, proof.campaign_id, 'minute', minute)
  }

  const { data: r, error: rpcErr } = await db.rpc('rc_campaign_record_trusted_checks', {
    p_proof_id: proof.id, p_status: decision.status, p_checks: decision.checks, p_note: decision.note,
    p_actor: String(params.admin || 'admin'), p_cert_fp: certFp, p_time_fp: timeFp,
  })
  if (rpcErr || !r?.success) return fail(r?.error || 'db_error', r?.status ? { status: r.status } : {})
  return { success: true, status: r.status, checks: decision.checks, fingerprinted: { number: !!certFp, time: !!timeFp } }
}

const DECISIONS = {
  verify: { to: 'verified', from: ['verifying', 'review', 'rejected'] },
  reject: { to: 'rejected', from: ['verifying', 'review'] },
  keep: { to: 'review', from: ['verifying', 'review'] },
}

export async function adminReviewCampaignProof(db, params) {
  const proofId = Number(params.proofId)
  const d = DECISIONS[String(params.decision)]
  if (!Number.isInteger(proofId) || proofId <= 0 || !d) return fail('bad_params')
  const { proof, mission, error } = await loadProofWithMission(db, proofId)
  if (error) return fail(error)
  const checks = params.checks && typeof params.checks === 'object' ? sanitizeChecksFor(mission.kind, params.checks) : null
  const note = params.note ? String(params.note).slice(0, 300) : null
  const { data: r, error: rpcErr } = await db.rpc('rc_campaign_transition', {
    p_proof_id: proof.id, p_from: d.from, p_to: d.to, p_checks: checks,
    p_method: 'admin', p_actor: String(params.admin || 'admin').slice(0, 40), p_note: note,
  })
  if (rpcErr || !r?.success) return fail(r?.error || 'db_error', r?.status ? { status: r.status } : {})
  return { success: true, status: r.status }
}
