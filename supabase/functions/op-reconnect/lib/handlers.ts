// Route handlers — orchestration + response shaping only. Game math lives in
// derive.ts / districts.ts / transmission.ts. Codenames are public; agent
// numbers never appear in responses beyond echoing the caller's own request.

import type { GameContent, SupabaseDB, DistrictRow } from './config.ts'
import { loadContent, rankFor, xpRules, restorationDays, streamsPerXpFor } from './config.ts'
import { ensureDailyRollups, computeStreak, awardStreakBadges, totalXp, countedStreams } from './derive.ts'
import { evaluateTransmission } from './transmission.ts'
import { freezeGoals, computeBaseline, districtProgress, districtDeadline, filesRevealedCount } from './districts.ts'
import { resolveReconnectStatus } from './reconnect-goal.ts'
import { todayKst, nextKstMidnightUtc, kstDateOf } from './kst.ts'
import { getBombView, launchDefuse } from './bomb.ts'
import { getEraTimeline } from './era-timeline.ts'
import { getMyInvites } from './reconnect-missions.ts'
import { creditChargeCells } from './charge-economy.ts'
import { getAgentChargeView } from './agent-charge.ts'
import { levelFor, applyLevelUpIfNeeded, nextLevelRewards } from './leveling.ts'
import { getActiveBroadcasts } from './broadcasts.ts'

// rc_agents (migration 016) is this season's own account table — a clean
// break from the old site's `agents`. Migrations 019/020 added the columns
// that let an agent pick lb / direct-scrobble (webhook + ListenBrainz-like)
// / stats.fm / musicat as their counted source, mirrored into
// AgentSourceRow's shape.
async function getAgent(supabase: SupabaseDB, agentNo: string) {
  const { data } = await supabase
    .from('rc_agents')
    .select('agent_no, lb_username, stream_source_preference, statsfm_username, musicat_public_id')
    .eq('agent_no', String(agentNo).trim().toUpperCase())
    .maybeSingle()
  if (!data) return null
  return {
    agent_no: data.agent_no,
    lb_username: data.lb_username,
    stream_source_preference: data.stream_source_preference,
    statsfm_username: data.statsfm_username,
    musicat_public_id: data.musicat_public_id,
  }
}

async function getPlayer(supabase: SupabaseDB, agentNo: string) {
  const { data } = await supabase.from('rc_players').select('*')
    .eq('agent_no', String(agentNo).trim().toUpperCase()).maybeSingle()
  return data
}

function wardStates(content: GameContent, restored: Set<string>) {
  const unlockedWards = new Set<string>()
  const sorted = [...content.wards].sort((a, b) => a.sort_order - b.sort_order)
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { unlockedWards.add(sorted[i].id); continue }
    const prev = sorted[i - 1]
    const prevDistricts = content.districts.filter((d) => d.ward_id === prev.id && !d.is_centerpiece)
    if (prevDistricts.length > 0 && prevDistricts.every((d) => restored.has(d.id))) unlockedWards.add(sorted[i].id)
  }
  return unlockedWards
}

async function buildState(supabase: SupabaseDB, content: GameContent, agent: any, player: any) {
  const rules = xpRules(content)
  // modeMultiplier no longer scales the variety cap — mode-based streams-per-XP
  // (streamsPerXpFor, above) is the one difficulty lever now; stacking both would
  // punish harder modes twice for the same choice. See docs/botz-network-redesign.md
  // decision 5.
  const cap = rules.varietyCapBase
  const allowlist: string[] = content.config.bts_artists || []
  const today = todayKst()

  // A level-up's timed personal boost, if still active — stacks on top of
  // the ARMY Bomb's community multiplier for today's XP only.
  const personalBoostMult = player.boost_expires_at && new Date(player.boost_expires_at).getTime() > Date.now()
    ? Number(player.boost_multiplier) || 1
    : 1

  // Bomb view first — Red Zone (target/contribution/reward) is still
  // network-wide, but its own charge/multiplier are retired (BOTZ redesign
  // Phase 3 — see agent-charge.ts). personalBoostMult above is the only
  // multiplier real XP still gets.
  const bomb = await getBombView(supabase, content, player.agent_no)
  const agentCharge = await getAgentChargeView(supabase, content, player.agent_no)
  const eraTimeline = await getEraTimeline(supabase, content)
  // Pending reconnect-mission invites — small, agent-scoped, cheap to
  // recompute every poll (unlike eraTimeline's network-wide scan, this is
  // just this one agent's own rc_reconnect_participants rows).
  const { invites } = await getMyInvites(supabase, content, player.agent_no)
  const rollups = await ensureDailyRollups(supabase, agent, player, content, bomb.multiplier, personalBoostMult)
  const todayRow = rollups.find((r) => String(r.kst_date) === today) || null

  const { data: pdRows } = await supabase.from('rc_player_districts').select('*')
    .eq('agent_no', player.agent_no).order('activated_at')
  const restored = new Set<string>((pdRows || []).filter((r: any) => r.status === 'restored').map((r: any) => r.district_id))
  const activePd = (pdRows || []).find((r: any) => r.status === 'active') || null

  // ── Active district progress (+ completion latch) ──────────
  let activeDistrict: any = null
  let restoredNow = false
  let expiredDistrict: { id: string; name: string } | null = null
  // Set below if creditChargeCells() awards anything this request — added to
  // player.charge_cells for the response, since `player` was already fetched
  // before the credit landed in the DB.
  let chargeCellsEarnedNow = 0
  // "Only ever go up" (resources.js) — start from the baked-in lifetime
  // total, add whatever's live below. A just-completed district's
  // contribution gets baked in this same pass, so it's added once, not
  // twice, whether or not restoredNow ends up true.
  const resources = { signal: player.lifetime_signal || 0, fuel: player.lifetime_fuel || 0, intel: player.lifetime_intel || 0 }
  if (activePd) {
    const districtRow = content.districts.find((d) => d.id === activePd.district_id)
    const activationDate = kstDateOf(Math.floor(new Date(activePd.activated_at).getTime() / 1000))
    const { data: windowRollups } = await supabase.from('rc_daily_activity')
      .select('kst_date, track_counts, transmission')
      .eq('agent_no', player.agent_no).gte('kst_date', activationDate).order('kst_date')
    // Charge Cells (BOTZ redesign Phase 2) — same album-goal stream data this
    // request already fetched for districtProgress, no extra query.
    chargeCellsEarnedNow = await creditChargeCells(supabase, content, player.agent_no, activePd, windowRollups || [])
    const progress = districtProgress(activePd.goals, activePd.baseline || {}, windowRollups || [], activePd.activated_at, content)
    const deadline = districtDeadline(activePd.activated_at, restorationDays(content))
    // districtProgress().complete only covers solo track+album goals — the
    // reconnect goal (if any was frozen in) needs its own live resolution
    // (mission/puzzle-attempt rows), so it's layered on here rather than
    // inside districts.ts's pure, DB-free districtProgress().
    const reconnect = await resolveReconnectStatus(supabase, content, player.agent_no, activePd.district_id, activePd.goals.reconnect)
    const districtComplete = progress.complete && (!reconnect || reconnect.done)

    // The week ran out before restoration finished — the attempt lapses.
    // Deleting the row (rather than some 'expired' status) is deliberate:
    // nothing was ever baked into lifetime resources for an in-progress
    // district (see the "still in progress" branch below), so there's
    // nothing to unwind — the district just goes back to available and
    // the agent can start it again.
    if (!districtComplete && deadline.expired) {
      await supabase.from('rc_player_districts').delete()
        .eq('agent_no', player.agent_no).eq('district_id', activePd.district_id).eq('status', 'active')
      expiredDistrict = { id: activePd.district_id, wardId: districtRow?.ward_id || null, name: districtRow?.name || activePd.district_id }
    } else {

    const { data: fileRows } = await supabase.from('rc_files').select('slot, title, body')
      .eq('district_id', activePd.district_id).order('slot')
    const files = fileRows || []
    const completedGoals = progress.trackGoals.filter((g) => g.done).length
    const revealed = districtComplete ? files.length
      : filesRevealedCount(completedGoals, progress.trackGoals.length, files.length)

    let xpAwarded: number | null = null
    let itemDropped: any = null

    if (districtComplete) {
      await supabase.from('rc_player_districts')
        .update({ status: 'restored', completed_at: new Date().toISOString() })
        .eq('agent_no', player.agent_no).eq('district_id', activePd.district_id).eq('status', 'active')
      restored.add(activePd.district_id)
      restoredNow = true
      // Ward badge when every non-centerpiece district in the ward is restored
      const ward = content.districts.filter((d) => d.ward_id === districtRow?.ward_id && !d.is_centerpiece)
      if (ward.length > 0 && ward.every((d) => restored.has(d.id))) {
        await supabase.from('rc_badges').upsert(
          { agent_no: player.agent_no, badge_id: `ward:${districtRow?.ward_id}` },
          { onConflict: 'agent_no, badge_id', ignoreDuplicates: true })
      }

      // District-completion XP, once — dedup_key means a re-poll of this
      // same completion (before the client acknowledges restoredNow)
      // can't double-award.
      xpAwarded = rules.districtXp
      await supabase.from('rc_xp_ledger').upsert(
        { agent_no: player.agent_no, amount: xpAwarded, source: 'district',
          dedup_key: `district:${player.agent_no}:${activePd.district_id}`, meta: { districtId: activePd.district_id } },
        { onConflict: 'dedup_key', ignoreDuplicates: true })

      // The drop — one item, once per district. Guarded on an existing row
      // rather than a ledger dedup_key since rc_player_items has no unique
      // constraint to upsert against; a second completion poll would
      // otherwise roll (and hand out) a second item.
      const { data: existingDrop } = await supabase.from('rc_player_items')
        .select('id').eq('agent_no', player.agent_no).eq('district_id', activePd.district_id).limit(1).maybeSingle()
      if (!existingDrop) {
        const { data: rolledId } = await supabase.rpc('rc_roll_item')
        if (rolledId) {
          const { data: itemRow } = await supabase.from('rc_items').select('*').eq('id', rolledId).maybeSingle()
          if (itemRow) {
            await supabase.from('rc_player_items').insert({ agent_no: player.agent_no, item_id: rolledId, district_id: activePd.district_id })
            itemDropped = { itemId: itemRow.id, name: itemRow.name, kind: itemRow.kind, era: itemRow.era, rarity: itemRow.rarity, blurb: itemRow.blurb }
          }
        }
      }

      // Bake this district's resource contribution into the lifetime total.
      const trackProg = progress.trackGoals.reduce((s, g) => s + Math.min(g.progress, g.target), 0)
      const fuelProg = progress.albums.reduce((s, a) => s + Math.min(a.passesDone, a.target), 0)
      const intelProg = 1 + files.length
      resources.signal += trackProg
      resources.fuel += fuelProg
      resources.intel += intelProg
      await supabase.rpc('rc_add_resources', { p_agent_no: player.agent_no, p_signal: trackProg, p_fuel: fuelProg, p_intel: intelProg })
    } else {
      // Still in progress — live contribution, not yet baked in anywhere.
      resources.signal += progress.trackGoals.reduce((s, g) => s + Math.min(g.progress, g.target), 0)
      resources.fuel += progress.albums.reduce((s, a) => s + Math.min(a.passesDone, a.target), 0)
      resources.intel += revealed
    }

    activeDistrict = {
      id: activePd.district_id,
      wardId: districtRow?.ward_id || null,
      name: districtRow?.name || activePd.district_id,
      echoOf: districtRow?.echo_of || null,
      activatedAt: activePd.activated_at,
      expiresAt: deadline.expiresAt,
      daysLeft: Math.ceil(deadline.msLeft / 86400000),
      restoredNow,
      xpAwarded,
      itemDropped,
      trackGoals: progress.trackGoals,
      albums: progress.albums,
      reconnect,
      files: files.map((f: any, i: number) => i < revealed
        ? { slot: f.slot, title: f.title, body: f.body, revealed: true }
        : { slot: f.slot, title: 'ENCRYPTED', revealed: false }),
      memory: districtComplete ? districtRow?.memory || null : null,
    }
    }
  }

  // ── Map ────────────────────────────────────────────────────
  const unlockedWards = wardStates(content, restored)
  const wards = [...content.wards].sort((a, b) => a.sort_order - b.sort_order).map((w) => {
    const districts = content.districts.filter((d) => d.ward_id === w.id && !d.is_centerpiece)
    const restoredCount = districts.filter((d) => restored.has(d.id)).length
    const complete = districts.length > 0 && restoredCount === districts.length
    // Built from the actual is_centerpiece rows, not rc_wards.centerpiece_name
    // — that column only ever held one name, which broke the moment Echo
    // Quarter's migration seeded four (one per season-one team). This is
    // ward-count-agnostic: a ward with one centerpiece returns a one-item
    // array, same shape either way, so the client never special-cases count.
    const centerpieces = content.districts
      .filter((d) => d.ward_id === w.id && d.is_centerpiece)
      .map((d) => ({ name: d.name, lit: complete }))
    return {
      id: w.id, name: w.name,
      status: complete ? 'restored' : unlockedWards.has(w.id) ? 'active' : 'locked',
      centerpieces,
      restoredCount, totalCount: districts.length,
    }
  })
  const completedAtByDistrict = new Map<string, string>(
    (pdRows || []).filter((r: any) => r.completed_at).map((r: any) => [r.district_id, r.completed_at]))
  const districts = content.districts.map((d) => {
    let status = 'locked'
    if (d.is_centerpiece) {
      const wardComplete = wards.find((w) => w.id === d.ward_id)?.status === 'restored'
      status = wardComplete ? 'centerpiece_lit' : 'centerpiece_dark'
    } else if (restored.has(d.id)) status = 'restored'
    else if (activePd?.district_id === d.id && !restored.has(d.id)) status = 'active'
    else if (unlockedWards.has(d.ward_id)) status = 'available'
    return {
      id: d.id, wardId: d.ward_id, sequence: d.sequence, name: d.name,
      echoOf: d.echo_of, status,
      memory: status === 'restored' || status === 'centerpiece_lit' ? d.memory : null,
      completedAt: completedAtByDistrict.get(d.id) || null,
    }
  })

  // ── Player / today ─────────────────────────────────────────
  const xp = await totalXp(supabase, player.agent_no)
  const level = levelFor(content, xp)
  const levelUp = await applyLevelUpIfNeeded(supabase, content, player, xp)
  const freezeChargesAvailable = (player.streak_freeze_charges || 0) + (levelUp?.streakFreezeGranted || 0)
  const joinedDate = kstDateOf(Math.floor(new Date(player.joined_at).getTime() / 1000))
  const streak = await computeStreak(supabase, player.agent_no, content, cap, freezeChargesAvailable, joinedDate)
  await awardStreakBadges(supabase, player.agent_no, streak.current)
  const { data: badgeRows } = await supabase.from('rc_badges').select('badge_id').eq('agent_no', player.agent_no)

  // ── The shelf + Pack collection ──────────────────────────────
  const { data: itemRows } = await supabase.from('rc_player_items')
    .select('id, item_id, district_id, used_at, rc_items(name, kind, era, rarity, blurb)')
    .eq('agent_no', player.agent_no)
  const items = (itemRows || []).map((r: any) => ({
    id: r.id,
    itemId: r.item_id,
    name: r.rc_items?.name,
    kind: r.rc_items?.kind,
    era: r.rc_items?.era,
    rarity: r.rc_items?.rarity,
    blurb: r.rc_items?.blurb,
    districtId: r.district_id,
    districtName: r.district_id ? (content.districts.find((d) => d.id === r.district_id)?.name || null) : null,
    usedAt: r.used_at,
  }))

  const bucket = todayRow?.track_counts || {}
  const counted = countedStreams(bucket, allowlist, cap)
  let transmission: any = null
  if (todayRow?.transmission) {
    const evald = evaluateTransmission(todayRow.transmission, bucket, allowlist)
    transmission = {
      text: todayRow.transmission.text,
      templateId: todayRow.transmission.templateId,
      progress: evald.progress,
      required: todayRow.transmission.required,
      done: todayRow.transmission_done || evald.done,
      xpOnComplete: rules.transmissionXp,
    }
  }

  // Site-owner announcements — folded into the response every screen's poll
  // already fetches (main.js, every 90s) rather than a separate mechanism.
  // See lib/broadcasts.ts / migrations/031_rc_broadcasts.sql.
  const broadcasts = await getActiveBroadcasts(supabase)

  return {
    success: true,
    joined: true,
    player: {
      codename: player.codename, mode: player.mode, xp,
      rank: rankFor(content, xp),
      level: { ...level, nextRewards: nextLevelRewards(content) },
      streakFreezeCharges: streak.freezeChargesRemaining,
      boost: levelUp
        ? { multiplier: levelUp.boostMultiplier, expiresAt: levelUp.boostExpiresAt }
        : (player.boost_expires_at && new Date(player.boost_expires_at).getTime() > Date.now()
          ? { multiplier: player.boost_multiplier, expiresAt: player.boost_expires_at }
          : null),
      streak,
      badges: (badgeRows || []).map((b: any) => b.badge_id),
      // BOTZ redesign Phase 2 — see charge-economy.ts / magic-shop.ts.
      chargeCells: (player.charge_cells || 0) + chargeCellsEarnedNow,
      wings: player.wings || 0,
      tickets: player.tickets || 0,
    },
    levelUp,
    map: { wards, districts },
    activeDistrict,
    expiredDistrict,
    resources,
    items,
    bomb,
    agentCharge,
    eraTimeline,
    invites,
    broadcasts,
    transmission,
    today: {
      kstDate: today,
      countedStreams: counted,
      rawStreams: todayRow?.raw_streams || 0,
      varietyCap: cap,
      // Today's own frozen mode (see derive.ts's dayMode), not the player's
      // live mode — matches whatever rate today's XP actually got awarded
      // at, even if the player has since switched modes.
      xpToday: Math.floor(counted / streamsPerXpFor(content, todayRow?.mode || player.mode)) + (transmission?.done ? rules.transmissionXp : 0),
      resetsAtUtc: nextKstMidnightUtc(),
    },
  }
}

export async function getGameState(supabase: SupabaseDB, params: any) {
  const content = await loadContent(supabase)
  const agent = await getAgent(supabase, params.agentNo)
  if (!agent) return { success: false, error: 'Agent not found' }
  const player = await getPlayer(supabase, params.agentNo)
  if (!player) {
    return {
      success: true, joined: false,
      intro: content.config.intro || {},
      modes: content.config.modes || {},
      ranks: content.config.ranks || [],
    }
  }
  return buildState(supabase, content, agent, player)
}

export async function joinGame(supabase: SupabaseDB, params: any) {
  const content = await loadContent(supabase)
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const agent = await getAgent(supabase, agentNo)
  if (!agent) return { success: false, error: 'Agent not found' }
  if (await getPlayer(supabase, agentNo)) return { success: false, error: 'already_joined' }

  const codename = String(params.codename || '').trim()
  if (!/^[\p{L}\p{N} ._-]{3,24}$/u.test(codename)) return { success: false, error: 'codename_invalid' }
  if (/^\d+$/.test(codename) || /^agent\s*\d+$/i.test(codename)) return { success: false, error: 'codename_invalid' }
  const mode = ['easy', 'medium', 'hard'].includes(params.mode) ? params.mode : 'easy'

  const { error: insErr } = await supabase.from('rc_players')
    .insert({ agent_no: agentNo, codename, mode })
  if (insErr) {
    return { success: false, error: String(insErr.code) === '23505' ? 'codename_taken' : insErr.message }
  }
  const player = await getPlayer(supabase, agentNo)

  // Auto-activate the tutorial district with a frozen mini-checklist.
  const tutorial = content.districts.find((d) => d.is_tutorial)
  if (tutorial) {
    const rollups = await ensureDailyRollups(supabase, agent, player, content)
    const todayRow = rollups.find((r) => String(r.kst_date) === todayKst())
    const frozen = freezeGoals(content, mode, tutorial)
    const cap = xpRules(content).varietyCapBase // tutorial ignores multiplier
    const baseline = computeBaseline(todayRow?.track_counts || {}, frozen, cap)
    await supabase.from('rc_player_districts').upsert(
      { agent_no: agentNo, district_id: tutorial.id, status: 'active', goals: frozen, baseline },
      { onConflict: 'agent_no, district_id', ignoreDuplicates: true })
  }
  return buildState(supabase, content, agent, player)
}

export async function startDistrict(supabase: SupabaseDB, params: any) {
  const content = await loadContent(supabase)
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const agent = await getAgent(supabase, agentNo)
  const player = await getPlayer(supabase, agentNo)
  if (!agent || !player) return { success: false, error: 'Not joined' }

  const district = content.districts.find((d: DistrictRow) => d.id === params.districtId)
  if (!district || district.is_centerpiece) return { success: false, error: 'district_unavailable' }

  const { data: pdRows } = await supabase.from('rc_player_districts').select('district_id, status')
    .eq('agent_no', agentNo)
  const restored = new Set<string>((pdRows || []).filter((r: any) => r.status === 'restored').map((r: any) => r.district_id))
  if ((pdRows || []).some((r: any) => r.status === 'active')) return { success: false, error: 'district_already_active' }
  if (restored.has(district.id)) return { success: false, error: 'district_already_restored' }
  if (!wardStates(content, restored).has(district.ward_id)) return { success: false, error: 'ward_locked' }
  // Tutorial districts source their checklist from config.tutorial.trackGoalId
  // (see freezeGoals), not district_id assignment — exempt from this check.
  // Requires a TRACK goal specifically, not just any goal: districtProgress's
  // allTracksDone is only ever true when trackGoals.length > 0, so a district
  // assigned only album/reconnect goals would otherwise be unwinnable.
  if (!district.is_tutorial && !content.goals.some((g) => g.kind === 'track' && g.district_id === district.id)) {
    return { success: false, error: 'district_not_configured' }
  }

  const rollups = await ensureDailyRollups(supabase, agent, player, content)
  const todayRow = rollups.find((r) => String(r.kst_date) === todayKst())
  const frozen = freezeGoals(content, player.mode, district)
  const cap = xpRules(content).varietyCapBase
  const baseline = computeBaseline(todayRow?.track_counts || {}, frozen, cap)
  const { error: insErr } = await supabase.from('rc_player_districts')
    .insert({ agent_no: agentNo, district_id: district.id, status: 'active', goals: frozen, baseline })
  if (insErr) return { success: false, error: 'district_already_started' }

  return buildState(supabase, content, agent, player)
}

/** Admin: launch a red-zone attack on the ARMY Bomb. */
export async function adminLaunchDefuse(supabase: SupabaseDB, params: any) {
  const key = Deno.env.get('SYNC_ADMIN_KEY') || ''
  if (!key || params.adminKey !== key) return { success: false, error: 'Unauthorized' }
  return launchDefuse(supabase, params)
}

export async function setMode(supabase: SupabaseDB, params: any) {
  const content = await loadContent(supabase)
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const agent = await getAgent(supabase, agentNo)
  const player = await getPlayer(supabase, agentNo)
  if (!agent || !player) return { success: false, error: 'Not joined' }
  if (!['easy', 'medium', 'hard'].includes(params.mode)) return { success: false, error: 'mode_invalid' }
  await supabase.from('rc_players').update({ mode: params.mode, updated_at: new Date().toISOString() })
    .eq('agent_no', agentNo)
  player.mode = params.mode
  return buildState(supabase, content, agent, player)
}
