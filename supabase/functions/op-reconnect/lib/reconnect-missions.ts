// Co-op variants of the `reconnect` goal kind — 'connect' (invite a specific
// agent who's also restoring this district; once they accept, everyone
// contributes toward their own frozen track/album goals, or a shared track
// target if the goal carries one — see refreshMission) and 'invite' (same
// direct-ask shape, satisfied on acceptance alone, no streaming required).
// Both variants pair up the same way now: one person invites, the other
// accepts. There used to be an open-matchmaking shortcut for 'connect'
// (tap "join" and get paired with whoever else tapped it) — removed per
// the site owner: two strangers ending up 'joined' with no invite ever
// sent between them looked like (and functionally was) an unrequested
// auto-accept.
//
// Folded in from the old post-restoration "Reconnect Mission" bonus stage —
// same underlying rc_reconnect_missions/rc_reconnect_participants tables,
// but this now GATES restoration instead of following it. Config always
// comes from the CALLER's own frozen `rc_player_districts.goals.reconnect`
// (set once at activation by districts.ts's freezeGoals(), never a live
// rc_goals re-read) — a district can host several reconnect goals with
// different configs at once, so every mission is scoped by goal_id, not
// just district_id: agents only ever match within the same frozen goal
// instance. See migration 037_rc_reconnect_goal_kind.sql.
//
// Reward is NOT awarded here — completion just flips mission status to
// 'complete'; handlers.ts's buildState() awards XP/Fuel once, when the
// WHOLE district (solo goals + reconnect) completes, avoiding a double
// payout from two separate reward pipelines. That district-completion
// reward is a flat amount (config.ts's xpRules().districtXp) — the same
// for every district whether or not it happens to carry a reconnect goal.
// There used to be a separate rc_config 'reconnect_rewards' row (xp/fuel)
// from back when reconnect was its own post-restoration bonus stage; it
// went unread the moment this became a gate instead, and was deleted
// outright (not just left dormant) after confirming with the site owner
// that reconnect should stay a pure requirement — no bonus on top of the
// district's own reward, same as any other goal here.

import type { SupabaseDB, GameContent } from './config.ts'
import type { FrozenReconnectGoal } from './districts.ts'
import { kstDateOf, todayKst, addDaysStr } from './kst.ts'

/** How long a teammate can go without streaming anything before the person
 *  carrying the mission may drop them.
 *
 *  Deliberately measured as "has streamed nothing at all recently", not "is
 *  contributing less than me". Rate of contribution is a terrible basis for
 *  removal here: modes legitimately scale effort (a Hard-mode agent needs 30
 *  streams per XP against an Easy agent's 10), people have different amounts
 *  of time, and letting someone be kicked for being slower invites exactly
 *  the resentment and pressure this is meant to prevent — including being
 *  dropped right before completion after doing real work. Going quiet for
 *  days is objective, is what "stuck" actually looks like, and is the only
 *  case where one agent is genuinely holding another back. */
const IDLE_DAYS = 2

/** How long an unanswered invite stays live before it stops counting.
 *
 *  A pending invite makes its recipient unavailable to everyone else
 *  (isSpokenFor), so an invite nobody answers quietly takes an agent off the
 *  board — for up to the mission's full 7 days, since nothing below the
 *  mission level ever expired. That is the one place waiting genuinely costs
 *  an ACTIVE player something: the invitee may never have opened the app,
 *  while everyone who could have paired with them sees them as taken.
 *
 *  Deliberately not applied to missions themselves. Agents sit unpaired here
 *  for days while streaming every single day (17 of 20 checked were active
 *  that same day), so expiring their mission would delete the state of the
 *  most active players and reset the contribution their pooled progress is
 *  counted from — see contributionSince/joined_at. An invite going stale
 *  costs nobody anything; a mission going stale costs the person still
 *  playing. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000

/** An 'invited' row nobody answered inside INVITE_TTL_MS. Treated as gone
 *  everywhere it is read, whether or not the cleanup delete has run yet —
 *  the delete only happens when someone loads that specific mission, so
 *  read-time interpretation (same philosophy as derive.ts's rollups) is what
 *  actually guarantees a stale invite can never block anyone. */
function inviteExpired(row: { status?: string; joined_at?: string } | null | undefined): boolean {
  if (!row || row.status !== 'invited' || !row.joined_at) return false
  return Date.now() - new Date(row.joined_at).getTime() > INVITE_TTL_MS
}

/** The caller's own active restoration attempt on this district (and
 *  whatever reconnect goal was frozen into it, if any) — the only source of
 *  truth for "what mission am I even trying to do." */
async function myActivePd(supabase: SupabaseDB, agentNo: string, districtId: string) {
  const { data } = await supabase.from('rc_player_districts')
    .select('status, goals').eq('agent_no', agentNo).eq('district_id', districtId).maybeSingle()
  return data || null
}

function myReconnectGoal(pd: any): FrozenReconnectGoal | null {
  const r = pd?.goals?.reconnect
  return r && (r.variant === 'connect' || r.variant === 'invite') ? r : null
}

/** One open mission this agent participates in, optionally narrowed to a
 *  specific goal_id and/or participant status. Scoped by goal_id when
 *  looking up "my own" mission (an agent's frozen goal_id is singular per
 *  district); left district-wide when checking an INVITEE, since they may
 *  have a different reconnect goal (or none) of their own.
 *
 *  An agent is only ever SUPPOSED to hold one open-mission membership per
 *  goal, but nothing before this actually enforced that — accepting a new
 *  invite never checked whether the invitee already had a real one going
 *  (see respondReconnectInvite's own new guard for the fix), and years of
 *  that gap left dozens of agents sitting in half a dozen or more open
 *  memberships each for the same goal at once. When that happens, always
 *  picking the most-recently-joined one (the old, only rule here) could
 *  land on a stray solo mission instead of the real, active, jointly-
 *  progressing one — which is exactly what happened to one half of a pair
 *  who could see each other's shared progress from one side but not the
 *  other. Now: prefer whichever candidate this agent is genuinely PAIRED
 *  in (someone else also 'joined' there) over one where they're sitting
 *  alone; only fall back to "most recent" among ties or when none are
 *  paired. Doesn't clean up the extra rows — see foldAwayDanglingMissions
 *  for that — just makes sure the right one is ever seen. */
async function findMyMission(
  supabase: SupabaseDB, agentNo: string, districtId: string,
  opts: { goalId?: string; status?: 'invited' | 'joined' } = {},
) {
  let mq = supabase.from('rc_reconnect_missions').select('id').eq('district_id', districtId).eq('status', 'open')
  if (opts.goalId) mq = mq.eq('goal_id', opts.goalId)
  const { data: openMissions } = await mq
  const missionIds = (openMissions || []).map((m: any) => m.id)
  if (!missionIds.length) return null

  let pq = supabase.from('rc_reconnect_participants').select('mission_id').eq('agent_no', agentNo).in('mission_id', missionIds)
  if (opts.status) pq = pq.eq('status', opts.status)
  const { data: rows } = await pq.order('joined_at', { ascending: false })
  if (!rows || !rows.length) return null

  let bestMissionId = rows[0].mission_id
  if (rows.length > 1) {
    const { data: allParticipants } = await supabase.from('rc_reconnect_participants')
      .select('mission_id, status').in('mission_id', rows.map((r: any) => r.mission_id))
    const joinedCount = new Map<string, number>()
    for (const p of allParticipants || []) {
      if (p.status !== 'joined') continue
      joinedCount.set(p.mission_id, (joinedCount.get(p.mission_id) || 0) + 1)
    }
    const paired = rows.find((r: any) => (joinedCount.get(r.mission_id) || 0) > 1)
    if (paired) bestMissionId = paired.mission_id
  }

  const { data: mission } = await supabase.from('rc_reconnect_missions').select('*').eq('id', bestMissionId).maybeSingle()
  return mission
}

/** A mission this agent has ALREADY completed for this specific goal, if
 *  any. findMyMission only ever looks at 'open' missions — correct for
 *  every WRITE path here (you can't invite into, get removed from, or
 *  respond to an invite on a mission that's already resolved), but wrong
 *  for "what's my current status," which is exactly what getMissionStatus
 *  and getReconnectMission use this for.
 *
 *  Checked BEFORE findMyMission at both call sites, not just as its
 *  fallback — a goal, once complete, must never look open again, but years
 *  of dangling solo missions (opened before a partner showed up, then never
 *  cleaned up — foldAwayDanglingMissions only runs on the ACCEPTING side of
 *  a later invite, never for the agent who just goes on to open or get
 *  invited into a separate mission the normal way) mean plenty of agents
 *  still hold an open membership for this same goal_id alongside their real
 *  completed one. findMyMission's "prefer paired" rule (see its own doc
 *  comment) only tells genuinely-active pairs apart from solo stragglers
 *  AMONG OPEN missions — it has no idea a completed one exists, and two
 *  people who each still have a stray open row can even look "paired" to
 *  each other there purely by accident, which is exactly what happened to
 *  AGENT015 and AGENT030: both had already finished Haegeum's reconnect
 *  goal together in one mission, but each also still had a leftover 'joined'
 *  row in an old dangling mission from days earlier — and because both rows
 *  were in the SAME old mission, findMyMission read it as a real pairing and
 *  returned it before this fallback ever ran, making their finished goal
 *  look freshly reset back to open.
 *
 *  Before this file's very first version of the fallback (findMyMission
 *  first, this only as a backstop when nothing open existed at all), a
 *  genuinely finished reconnect goal disappeared the instant its mission
 *  left 'open' if the agent had no other open row: the very next poll found
 *  nothing, sent them back to "team up," and let them re-open a mission and
 *  redo the whole shared-track grind — with a brand-new joined_at, so none
 *  of their already-earned contribution carried over either. Some agents
 *  did this three, four, even six times over. Checking here first closes
 *  both that gap and the "shadowed by a stray open row" gap in one rule:
 *  complete always wins once it exists, full stop. */
async function findMyCompletedMission(supabase: SupabaseDB, agentNo: string, districtId: string, goalId: string) {
  const { data: completeMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('district_id', districtId).eq('goal_id', goalId).eq('status', 'complete')
  const missionIds = (completeMissions || []).map((m: any) => m.id)
  if (!missionIds.length) return null

  const { data: rows } = await supabase.from('rc_reconnect_participants')
    .select('mission_id').eq('agent_no', agentNo).eq('status', 'joined').in('mission_id', missionIds).limit(1)
  const row: any = (rows || [])[0]
  if (!row) return null

  const { data: mission } = await supabase.from('rc_reconnect_missions').select('*').eq('id', row.mission_id).maybeSingle()
  return mission
}

/** Every key from a participant's OWN frozen track/album goals — this is
 *  what "connect" checks against, not one fixed shared track. */
function ownGoalKeys(pd: any): string[] {
  const g = pd?.goals || {}
  const keys: string[] = []
  for (const t of g.trackGoals || []) keys.push(...(t.keys || []))
  for (const a of g.albumGoals || []) for (const t of a.tracks || []) keys.push(...(t.keys || []))
  return keys
}

/** rc_daily_activity buckets by KST calendar day, not UTC — a plain
 *  isoString.slice(0, 10) reads the UTC date instead, which is one day
 *  EARLY for any joined_at between 15:00 and 23:59 UTC (that whole window
 *  is already tomorrow in KST). That's not a rare edge case — it's over a
 *  third of the day — and the effect is real: a participant joining then
 *  would get their "since I joined" window silently backdated a full KST
 *  day, crediting hours of streams from before they ever joined. */
function kstDateOfIso(iso: string): string {
  return kstDateOf(Math.floor(new Date(iso).getTime() / 1000))
}

/** Real play count of a specific track's keys, from the day this participant
 *  joined onward — day-granularity, since rc_daily_activity only ever
 *  buckets by day. Uncapped, matching how every other personal count works
 *  now (see config.ts's PERSONAL_COUNT_CAP). Both refreshMission's shared
 *  and per-agent qualify checks run off this, and its return value is what
 *  ends up as each roster row's "N streams" (see shape()). */
async function contributionSince(supabase: SupabaseDB, agentNo: string, sinceIso: string, keys: string[]): Promise<number> {
  if (!keys.length) return 0
  const sinceDate = kstDateOfIso(sinceIso)
  const { data } = await supabase.from('rc_daily_activity')
    .select('track_counts').eq('agent_no', agentNo).gte('kst_date', sinceDate)
  let total = 0
  for (const row of data || []) {
    const bucket = row.track_counts || {}
    for (const k of keys) total += bucket[k]?.n || 0
  }
  return total
}

/** codename lookup for a set of agent numbers — same "agent numbers never
 *  leave the caller's own request" rule getMyInvites already follows below,
 *  now applied to the mission roster too: another participant's raw
 *  agent_no has no reason to reach the client, only their codename does. */
async function codenameMap(supabase: SupabaseDB, agentNos: string[]): Promise<Map<string, string>> {
  if (!agentNos.length) return new Map()
  const { data } = await supabase.from('rc_players').select('agent_no, codename').in('agent_no', agentNos)
  return new Map((data || []).map((p: any) => [p.agent_no, p.codename]))
}

const MAX_MESSAGE_LEN = 240

/** A mission's shared thread, oldest first — an invite's optional note and
 *  the ongoing "team chat" once paired up are the same feature (see the
 *  migration's own comment): the note is just message #1. Capped at the
 *  most recent 50 so a long-running mission's thread can't grow unbounded;
 *  nobody's realistically scrolling past that on a phone screen anyway.
 *  Only called for the interactive panel (getReconnectMission,
 *  openReconnectMission, removeReconnectParticipant) — getMissionStatus's
 *  hot polling path has no use for message history, so it skips this. */
async function missionMessages(supabase: SupabaseDB, missionId: string, meAgentNo: string) {
  const { data } = await supabase.from('rc_reconnect_messages')
    .select('agent_no, body, created_at').eq('mission_id', missionId)
    .order('created_at', { ascending: true }).limit(50)
  const rows = data || []
  const names = await codenameMap(supabase, [...new Set(rows.map((r: any) => r.agent_no))])
  return rows.map((r: any) => ({
    codename: names.get(r.agent_no) || r.agent_no,
    isMe: r.agent_no === meAgentNo,
    body: r.body,
    at: r.created_at,
  }))
}

/** Prefers the rows refreshMission already fetched and annotated with
 *  .contribution (see its doc comment) over a second identical select —
 *  only re-queries when there's no mission, or it was never refreshed this
 *  call (already 'complete'/'expired' at entry, so refreshMission returned
 *  before fetching anything). */
async function participantsFor(supabase: SupabaseDB, mission: any) {
  if (!mission) return []
  if (mission._participants) return mission._participants
  const { data } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  return data || []
}

/** meAgentNo is the CALLER's own agent number, used only to flag their own
 *  row (isMe) and whether they're the creator (isCreator) — never echoed
 *  back for anyone else. invitedBy is dropped from the response outright:
 *  nothing client-side reads it. agentNo IS included per participant again
 *  (it briefly wasn't) because removeReconnectParticipant needs to target
 *  someone specific — same "travels as data, never rendered as text" rule
 *  getInviteCandidates already follows for exactly the same reason. */
async function shape(supabase: SupabaseDB, m: any, participants: any[], meAgentNo: string) {
  const names = await codenameMap(supabase, participants.map((p) => p.agent_no))
  return {
    id: m.id,
    districtId: m.district_id,
    goalId: m.goal_id,
    requiredAgents: m.required_agents,
    status: m.status,
    createdAt: m.created_at,
    completedAt: m.completed_at,
    expiresAt: m.expires_at,
    isCreator: m.created_by === meAgentNo,
    // Only present when the frozen goal carries a sharedTrack — see
    // refreshMission. Pooled progress toward one specific track, everyone's
    // own plays (since they personally joined) counted together.
    sharedTrack: m.sharedTrackProgress || null,
    participants: participants.map((p) => ({
      agentNo: p.agent_no, // not for display — see doc comment above
      codename: names.get(p.agent_no) || p.agent_no, // fallback: retired/missing rc_players row
      isMe: p.agent_no === meAgentNo,
      status: p.status, joinedAt: p.joined_at, streamed: !!p.streamed_at,
      // An invite that ran past INVITE_TTL_MS unanswered. Still 'invited' in
      // the DB (it's kept, not deleted — see refreshMission) but counts for
      // nothing anywhere; the flag exists so the sender can be told what
      // happened instead of watching the name quietly disappear.
      inviteExpired: !!p._expired,
      // Joined, but their attempt on this district lapsed past its deadline
      // (see refreshMission). They contribute nothing and cannot see this
      // mission until they start the district again.
      leftDistrict: !!p._leftDistrict,
      // Joined and still on the district, but has streamed nothing at all
      // for IDLE_DAYS. Shown so a teammate can tell "stalled" apart from
      // "slower than me" — only the former is grounds for dropping someone.
      idle: !!p._idle,
      // Real contribution count, 'invite' variant. Only set once
      // refreshMission has actually computed one this call (see its own doc
      // comment) — null rather than 0 for "not counted this pass" (an
      // 'invited' row, or an 'invite'-variant mission with no streaming
      // requirement at all) so the client can tell "zero streams" apart
      // from "not applicable" instead of guessing from variant alone.
      streams: typeof p.contribution === 'number' ? p.contribution : null,
      // Only meaningful alongside mission.isCreator — a participant who
      // hasn't contributed anything yet (still invited, or joined but never
      // streamed) can be removed to free their slot; one who's already
      // helped can't be unfairly bumped. Extended to cover someone who DID
      // help and has since gone quiet (idle) or lost the district entirely
      // (leftDistrict): the original rule made a single stream a permanent
      // seat, which left whoever was still playing with no way out at all.
      removable: p.agent_no !== meAgentNo && (
        p.status === 'invited'
        || (p.status === 'joined' && (!p.streamed_at || p._idle || p._leftDistrict))
      ),
      // Anyone can walk away from their own mission. Previously nobody could
      // — remove-self was refused outright and only the creator could remove
      // anyone else, so an agent who ACCEPTED an invite had no lever of any
      // kind and simply waited out the 7-day expiry.
      canLeave: p.agent_no === meAgentNo,
    })),
  }
}

/** shape() plus the mission's message thread — split out from shape()
 *  itself because getMissionStatus's hot polling path calls shape() far
 *  more often than anyone's actually looking at the panel, and has no use
 *  for message history. Every caller that feeds the interactive panel
 *  (getReconnectMission, openReconnectMission, removeReconnectParticipant)
 *  uses this instead. */
async function shapeWithMessages(supabase: SupabaseDB, m: any, participants: any[], meAgentNo: string) {
  const shaped: any = await shape(supabase, m, participants, meAgentNo)
  shaped.messages = await missionMessages(supabase, m.id, meAgentNo)
  return shaped
}

/** Re-derives a mission's real state from source data: expire it if time's
 *  up, and for 'connect' check every joined participant's contribution
 *  since it's their own frozen goal config (config.sharedTrack, when set)
 *  that decides what "qualified" means:
 *   - sharedTrack set: pooled mode — every joined participant's own plays
 *     of that one track, counted from when THEY joined, add together;
 *     qualifies once the pool hits sharedTrack.target. One person could
 *     carry it alone, or it could be split any way — "combined," not "each."
 *   - sharedTrack unset: the original per-person rule — each joined
 *     participant just needs ANY stream of their own frozen track/album
 *     goals since joining.
 *  'invite' has no streaming check either way — acceptance alone qualifies.
 *  Settles (marks 'complete') the moment the required condition is met;
 *  does NOT award anything itself (see module comment).
 *
 *  Also stamps mission._participants with each joined row's own real
 *  contribution count (p.contribution) while it's already computing one for
 *  the qualify check — not persisted to the DB (there's no column for it,
 *  and it's cheap to re-derive), just carried on the in-memory object so
 *  shape()'s caller can show "GunJ — Ready · 22 streams" without a second
 *  round of the same per-agent counting. Callers should prefer
 *  mission._participants over a fresh select when it's present.
 *
 *  Still computes sharedTrackProgress/contribution for an already-'complete'
 *  mission (just skips the expiry check and the settle-to-complete write,
 *  both meaningless once it's done) — findMyCompletedMission's callers
 *  need a populated mission to actually show "Haegeum hit 100 between you,"
 *  not a bare status flag. 'expired'/'cancelled' missions skip everything;
 *  there's nothing live left to compute for those. */
async function refreshMission(
  supabase: SupabaseDB, mission: any, variant: 'connect' | 'invite',
  config?: { requiredAgents?: number; sharedTrack?: { label: string; keys: string[]; target: number } | null },
) {
  if (mission.status !== 'open' && mission.status !== 'complete') return mission

  if (mission.status === 'open' && new Date(mission.expires_at).getTime() <= Date.now()) {
    await supabase.from('rc_reconnect_missions').update({ status: 'expired' }).eq('id', mission.id).eq('status', 'open')
    mission.status = 'expired'
    return mission
  }

  const { data: rawParticipants } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id)
  // Stale invites are KEPT here, flagged rather than deleted. They already
  // block nothing (isSpokenFor ignores them, getMyInvites hides them,
  // respondReconnectInvite refuses them), so the only thing the row still
  // does is tell the person who SENT it what became of it. Deleting it made
  // the invitee silently vanish from the inviter's roster with no
  // explanation — they'd have to notice someone was missing. The creator
  // clears it with the same Cancel invite button they already had.
  const participants = (rawParticipants || []).map((p: any) => (
    inviteExpired(p) ? { ...p, _expired: true } : p
  ))
  mission._participants = participants
  const joined = participants.filter((p: any) => p.status === 'joined')
  // Who on this roster still holds an active attempt here. A partner whose
  // attempt lapsed keeps their participant row but can contribute nothing,
  // and can't even see this mission (their own panel needs an active
  // attempt) — flagged so the person still playing is told why the team
  // stopped moving instead of watching a silent stall. isSpokenFor uses the
  // same distinction to stop a dropped partner from blocking them.
  const stillOn = await agentsStillOnDistrict(supabase, mission.district_id)
  for (const p of joined) p._leftDistrict = !stillOn.has(p.agent_no)
  // Gone quiet for IDLE_DAYS — surfaced so a teammate who is carrying the
  // mission can see WHY it stopped moving, and drop them if they choose to.
  const idle = await idleAgents(supabase, joined.map((p: any) => p.agent_no))
  for (const p of joined) p._idle = idle.has(p.agent_no)

  const sharedTrack = config?.sharedTrack
  let sharedTotal = 0
  if (variant === 'connect' && sharedTrack?.keys?.length && sharedTrack.target > 0) {
    for (const p of joined) {
      const contributed = await contributionSince(supabase, p.agent_no, p.joined_at, sharedTrack.keys)
      p.contribution = contributed
      sharedTotal += contributed
      if (contributed > 0 && !p.streamed_at) {
        await supabase.from('rc_reconnect_participants')
          .update({ streamed_at: new Date().toISOString() })
          .eq('mission_id', mission.id).eq('agent_no', p.agent_no)
        p.streamed_at = new Date().toISOString()
      }
    }
    mission.sharedTrackProgress = { label: sharedTrack.label, target: sharedTrack.target, progress: Math.min(sharedTotal, sharedTrack.target) }
  } else if (variant === 'connect') {
    for (const p of joined) {
      const pd = await myActivePd(supabase, p.agent_no, mission.district_id)
      if (!pd || pd.status !== 'active') { p.contribution = 0; continue } // dropped the district — not counted until back
      const keys = ownGoalKeys(pd)
      const contributed = await contributionSince(supabase, p.agent_no, p.joined_at, keys)
      p.contribution = contributed
      if (contributed > 0 && !p.streamed_at) {
        await supabase.from('rc_reconnect_participants')
          .update({ streamed_at: new Date().toISOString() })
          .eq('mission_id', mission.id).eq('agent_no', p.agent_no)
        p.streamed_at = new Date().toISOString()
      }
    }
  }

  if (mission.status === 'open') {
    const qualified = variant === 'invite'
      ? joined.length >= mission.required_agents
      : sharedTrack?.keys?.length
        ? joined.length >= mission.required_agents && sharedTotal >= sharedTrack.target
        : joined.length >= mission.required_agents && joined.every((p: any) => p.streamed_at)

    if (qualified) {
      const { error } = await supabase.from('rc_reconnect_missions')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', mission.id).eq('status', 'open')
      if (!error) mission.status = 'complete'
    }
  }
  return mission
}

/** Called by reconnect-goal.ts's resolveReconnectStatus on every state poll
 *  — the caller's own frozen reconnect goal is already known (never
 *  re-derived live), so this just resolves live mission state against it. */
export async function getMissionStatus(supabase: SupabaseDB, agentNo: string, districtId: string, frozenReconnect: FrozenReconnectGoal) {
  const variant = frozenReconnect.variant as 'connect' | 'invite'
  let mission = await findMyCompletedMission(supabase, agentNo, districtId, frozenReconnect.id)
    || await findMyMission(supabase, agentNo, districtId, { goalId: frozenReconnect.id })
  if (mission) mission = await refreshMission(supabase, mission, variant, frozenReconnect.config)
  const participants = await participantsFor(supabase, mission)
  return { variant, done: mission?.status === 'complete', mission: mission ? await shape(supabase, mission, participants, agentNo) : null }
}

/** Read-only, richer than getMissionStatus: for the interactive player
 *  panel. No more open-matchmaking preview here — pairing up now always
 *  means one specific person invites another (see getInviteCandidates),
 *  never "whoever taps join first gets paired with a stranger." Per the
 *  site owner: strangers ending up 'joined' together with no invite ever
 *  sent between them read as an unrequested auto-accept, which it
 *  effectively was from either player's point of view. */
export async function getReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!districtId) return { success: false, error: 'district_required' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: true, available: false }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: true, available: false }

  let mission = await findMyCompletedMission(supabase, agentNo, districtId, reconnect.id)
    || await findMyMission(supabase, agentNo, districtId, { goalId: reconnect.id })
  if (mission) mission = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)

  const participants = await participantsFor(supabase, mission)

  return {
    success: true, available: true, variant: reconnect.variant,
    config: { requiredAgents: reconnect.config.requiredAgents, sharedTrack: reconnect.config.sharedTrack || null },
    mission: mission ? await shapeWithMessages(supabase, mission, participants || [], agentNo) : null,
  }
}

/** Every open-mission participant row for this reconnect goal, grouped by
 *  mission id — the shared data both getInviteCandidates and
 *  inviteReconnectMission need to tell "genuinely paired up already" apart
 *  from "opened their own still-empty mission" (see isSpokenFor). */
async function openMissionRosters(supabase: SupabaseDB, districtId: string, goalId: string) {
  const { data: openMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('district_id', districtId).eq('goal_id', goalId).eq('status', 'open')
  const missionIds = (openMissions || []).map((m: any) => m.id)
  const byMission = new Map<string, any[]>()
  if (!missionIds.length) return byMission
  const { data: rows } = await supabase.from('rc_reconnect_participants')
    .select('mission_id, agent_no, status, joined_at').in('mission_id', missionIds)
  for (const r of rows || []) {
    if (!byMission.has(r.mission_id)) byMission.set(r.mission_id, [])
    byMission.get(r.mission_id)!.push(r)
  }
  return byMission
}

/** The bulk counterpart to findMyCompletedMission: everyone who has ALREADY
 *  finished this reconnect goal. Inviting one of them is a dead end — their
 *  own panel resolves findMyCompletedMission first (see its doc comment:
 *  "complete always wins once it exists"), so it renders "Done — you teamed
 *  up…" and never draws the Accept button at all. The invite still lands in
 *  their notification list (getMyInvites doesn't consult completed missions),
 *  giving them a badge they cannot act on, while the inviter waits on an
 *  acceptance that can never come and isSpokenFor marks the invitee
 *  unavailable to everyone else. Same class of trap as the 52 provably-dead
 *  missions swept in commit d12638b. */
async function agentsDoneWithGoal(supabase: SupabaseDB, districtId: string, goalId: string): Promise<Set<string>> {
  const { data: completeMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('district_id', districtId).eq('goal_id', goalId).eq('status', 'complete')
  const missionIds = (completeMissions || []).map((m: any) => m.id)
  if (!missionIds.length) return new Set()
  const { data: rows } = await supabase.from('rc_reconnect_participants')
    .select('agent_no').eq('status', 'joined').in('mission_id', missionIds)
  return new Set((rows || []).map((r: any) => r.agent_no as string))
}

/** Everyone on this goal who is genuinely free to be invited right now, with
 *  how long they've been sitting there. Shared by getInviteCandidates (the
 *  pickable list) and countWaitingAgents (the "N agents are waiting" nudge)
 *  so the two can never disagree about who counts as waiting.
 *
 *  An agent can hold more than one stray open mission here (see
 *  foldAwayDanglingMissions' own comment on why those linger), so waitingSince
 *  is the EARLIEST joined_at across all of them — how long they've actually
 *  been waiting for a partner, not how recently they re-opened. */
function freeAgentsWithWait(rosters: Map<string, any[]>, eligible: string[], done: Set<string>, stillOnDistrict: Set<string>) {
  const out: { agentNo: string; waitingSince: string | null }[] = []
  for (const agentNo of eligible) {
    if (done.has(agentNo)) continue
    if (isSpokenFor(rosters, agentNo, stillOnDistrict)) continue
    let since: string | null = null
    for (const participants of rosters.values()) {
      const mine = participants.find((p) => p.agent_no === agentNo)
      if (!mine?.joined_at) continue
      if (!since || mine.joined_at < since) since = mine.joined_at
    }
    out.push({ agentNo, waitingSince: since })
  }
  return out
}

/** "N other agents are waiting for a partner here" — the same free-agent set
 *  getInviteCandidates offers, counted for an agent who may not have opened a
 *  mission of their own yet. That's the whole point: the pickable list used to
 *  be reachable only AFTER opening a mission, so nobody standing at the
 *  "Open a mission" button could tell whether anyone was actually there to
 *  team up with. Returns 0 rather than erroring for anyone not eligible. */
export async function countWaitingAgents(supabase: SupabaseDB, agentNo: string, pd: any): Promise<number> {
  if (pd?.status !== 'active') return 0
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return 0
  const { data: activeRows } = await supabase.from('rc_player_districts')
    .select('agent_no, goals').eq('district_id', pd.district_id).eq('status', 'active')
  const eligible = (activeRows || [])
    .filter((r: any) => r.agent_no !== agentNo && r.goals?.reconnect?.id === reconnect.id)
    .map((r: any) => r.agent_no as string)
  if (!eligible.length) return 0
  const rosters = await openMissionRosters(supabase, pd.district_id, reconnect.id)
  const done = await agentsDoneWithGoal(supabase, pd.district_id, reconnect.id)
  // activeRows is already every active attempt on this district, so the
  // dropped-partner set comes free here — no extra round trip.
  const stillOn = new Set<string>((activeRows || []).map((r: any) => r.agent_no as string))
  return freeAgentsWithWait(rosters, eligible, done, stillOn).length
}

/** True only when genuinely unavailable for a NEW invite on this goal:
 *  pending someone else's invite, or already paired with someone in an
 *  open mission. Being the sole, still-empty opener of your OWN mission
 *  does NOT count — accepting an invite elsewhere quietly folds that
 *  mission away (see respondReconnectInvite's cleanup).
 *
 *  Without this distinction every agent who took the obvious first step —
 *  "Open a mission" is the only button shown before you've teamed up —
 *  became invisible to every OTHER agent who'd done the same, since each
 *  one's own solo mission counted as "already in a mission." After the
 *  matchmaking-removal reset knocked ~140 formerly-2-person missions down
 *  to one participant each, that was most of the active population:
 *  dozens of agents each sitting in their own dead-end mission, mutually
 *  invisible, with nothing in the UI explaining why. */
function isSpokenFor(rosters: Map<string, any[]>, agentNo: string, stillOnDistrict?: Set<string>): boolean {
  for (const participants of rosters.values()) {
    const mine = participants.find((p) => p.agent_no === agentNo)
    if (!mine) continue
    // A stale invite no longer holds anyone: see INVITE_TTL_MS. Without this
    // an unanswered invite kept its recipient off everyone else's list for
    // the mission's whole 7 days. `continue`, never `return false` — this
    // agent may still be genuinely paired in a DIFFERENT mission further
    // down the loop, and a dead invite here must not mask that.
    if (mine.status === 'invited') {
      if (inviteExpired(mine)) continue
      return true
    }
    // Only a partner who can still actually play this district counts as
    // pairing you up. An agent whose attempt ran past its 7-day deadline has
    // their rc_player_districts row DELETED (handlers.ts) but keeps their
    // participant row here — so without this check they'd go on holding
    // their partner hostage from every other pairing while contributing
    // nothing (refreshMission already zeroes a dropped agent's contribution)
    // and being unable to see the mission themselves, since their own panel
    // needs an active attempt to render at all. The mission is not deleted:
    // if they re-activate the district they simply start counting again.
    if (mine.status === 'joined' && participants.some((p) =>
      p.agent_no !== agentNo && p.status === 'joined' && (!stillOnDistrict || stillOnDistrict.has(p.agent_no))
    )) return true
  }
  return false
}

/** Everyone still holding an ACTIVE attempt on this district — the set
 *  isSpokenFor uses to tell a real partner from one who has dropped out.
 *  Deliberately keyed on the district alone, not the frozen goal, to match
 *  refreshMission's own myActivePd(agent, mission.district_id) check: an
 *  active attempt is what decides whether someone can contribute here. */
async function agentsStillOnDistrict(supabase: SupabaseDB, districtId: string): Promise<Set<string>> {
  const { data } = await supabase.from('rc_player_districts')
    .select('agent_no').eq('district_id', districtId).eq('status', 'active')
  return new Set((data || []).map((r: any) => r.agent_no as string))
}

/** Of the agents given, which have logged NO streams at all in the last
 *  IDLE_DAYS days. One query for the whole roster rather than per-agent —
 *  refreshMission already runs on every poll and does enough round trips.
 *  Uses raw_streams (any listening at all), not counted-toward-this-goal:
 *  the question being answered is "has this person gone quiet", and someone
 *  streaming daily but on the wrong tracks is present and reachable, not
 *  stuck — that is a conversation for the team chat, not grounds for a kick. */
async function idleAgents(supabase: SupabaseDB, agentNos: string[]): Promise<Set<string>> {
  const idle = new Set<string>(agentNos)
  if (!agentNos.length) return idle
  const since = addDaysStr(todayKst(), -IDLE_DAYS)
  const { data } = await supabase.from('rc_daily_activity')
    .select('agent_no, raw_streams, kst_date')
    .in('agent_no', agentNos).gte('kst_date', since)
  for (const r of data || []) if ((r.raw_streams || 0) > 0) idle.delete(r.agent_no)
  return idle
}

/** Who the caller can actually invite — since agent numbers are never
 *  shown to players anymore (see shape()'s codename resolution), "invite
 *  by agent number" was a dead end: nothing in the game ever tells you
 *  anyone else's number. This is the fix — everyone else actively
 *  restoring the same district with the same frozen reconnect goal, who
 *  isn't genuinely spoken for elsewhere, so the player picks a codename
 *  instead of typing a number they can't know. agentNo still rides along
 *  per candidate (the invite call needs it) but is never meant to be
 *  displayed — same as shape()'s participants. */
export async function getInviteCandidates(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!districtId) return { success: false, error: 'district_required' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: true, candidates: [] }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: true, candidates: [] }

  const { data: activeRows } = await supabase.from('rc_player_districts')
    .select('agent_no, goals').eq('district_id', districtId).eq('status', 'active')
  const eligible = (activeRows || [])
    .filter((r: any) => r.agent_no !== agentNo && r.goals?.reconnect?.id === reconnect.id)
    .map((r: any) => r.agent_no as string)
  if (!eligible.length) return { success: true, candidates: [] }

  const rosters = await openMissionRosters(supabase, districtId, reconnect.id)
  const done = await agentsDoneWithGoal(supabase, districtId, reconnect.id)
  const stillOn = new Set<string>((activeRows || []).map((r: any) => r.agent_no as string))
  const free = freeAgentsWithWait(rosters, eligible, done, stillOn)
  if (!free.length) return { success: true, candidates: [] }

  const names = await codenameMap(supabase, free.map((f) => f.agentNo))
  // Longest-waiting first, not alphabetical: the list is now a queue of real
  // people to help rather than a menu to pick from, so whoever has been
  // stuck the longest should be the first name anyone sees.
  const candidates = free
    .map((f) => ({ agentNo: f.agentNo, codename: names.get(f.agentNo) || f.agentNo, waitingSince: f.waitingSince }))
    .sort((a, b) => {
      if (a.waitingSince && b.waitingSince) return a.waitingSince.localeCompare(b.waitingSince)
      if (a.waitingSince) return -1
      if (b.waitingSince) return 1
      return a.codename.localeCompare(b.codename)
    })
  return { success: true, candidates }
}

/** Opens a fresh mission for the caller's own frozen reconnect goal and
 *  auto-joins them as its first participant. */
export async function openReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: false, error: 'not_available' }
  // Checked in this order (completed first) so an agent who also still has
  // a leftover dangling open mission for this same goal — see
  // findMyCompletedMission's doc comment — gets told the true, better
  // reason ("you already finished this") instead of the generic
  // "already_in_mission", which would read as if they still had something
  // left to do here.
  if (await findMyCompletedMission(supabase, agentNo, districtId, reconnect.id)) return { success: false, error: 'already_completed' }
  if (await findMyMission(supabase, agentNo, districtId)) return { success: false, error: 'already_in_mission' }

  const { data: mission, error } = await supabase.from('rc_reconnect_missions').insert({
    district_id: districtId, goal_id: reconnect.id, required_agents: reconnect.config.requiredAgents,
    // Vestigial NOT NULL columns from the old shared-track design — no
    // longer read anywhere; kept populated only to satisfy the constraint.
    track_label: `reconnect:${reconnect.variant}`, track_artist: null, track_aliases: [],
    created_by: agentNo,
  }).select().single()
  if (error) return { success: false, error: error.message }

  await supabase.from('rc_reconnect_participants').insert({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })
  // Refresh once even though nothing can have qualified yet — for
  // sharedTrack missions this is what puts the 0/target shape on the very
  // first response, instead of the caller having to poll again to see it.
  const fresh = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
  const participants = await participantsFor(supabase, fresh)
  return { success: true, mission: await shapeWithMessages(supabase, fresh, participants, agentNo) }
}

// Open-matchmaking join (joinReconnectMission / rc_reconnect_join_open)
// removed — pairing up now always goes through invite + accept, never a
// tap-to-join-a-stranger shortcut. See getReconnectMission's comment.

/** An agent already in their own open mission invites someone else who is
 *  also actively restoring this district (any reconnect variant, or none —
 *  confirmed with the user this is "recruit a real co-restorer," not an
 *  open invite to anyone registered). Sits as 'invited' until accepted. An
 *  optional params.message becomes the first line of the mission's shared
 *  thread — see the migration's own comment on why an invite note and the
 *  ongoing team chat are one feature, not two. */
export async function inviteReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const inviteeAgentNo = String(params.inviteeAgentNo || '').trim().toUpperCase()
  if (!inviteeAgentNo) return { success: false, error: 'invitee_required' }
  if (inviteeAgentNo === agentNo) return { success: false, error: 'cannot_invite_self' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: false, error: 'not_available' }

  let mission = await findMyMission(supabase, agentNo, districtId, { goalId: reconnect.id })
  if (!mission) return { success: false, error: 'not_in_mission' }
  mission = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }
  // Same relaxed check getInviteCandidates uses — a lone opener sitting
  // alone in their own still-empty mission isn't "already in a mission" in
  // any sense that should block this invite; only genuinely being spoken
  // for (pending elsewhere, or already paired with someone) does.
  const rosters = await openMissionRosters(supabase, districtId, reconnect.id)
  if (isSpokenFor(rosters, inviteeAgentNo, await agentsStillOnDistrict(supabase, districtId))) {
    return { success: false, error: 'already_in_mission' }
  }

  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  const joinedCount = (participants || []).filter((p: any) => p.status === 'joined').length
  if (joinedCount >= mission.required_agents) return { success: false, error: 'mission_full' }

  const inviteePd = await myActivePd(supabase, inviteeAgentNo, districtId)
  if (inviteePd?.status !== 'active') return { success: false, error: 'invitee_not_eligible' }

  // An expired invite to this same person is deliberately kept as a record
  // for whoever sent it (see refreshMission), but (mission_id, agent_no) is
  // the primary key — so re-inviting them would collide with that dead row
  // and surface a raw Postgres duplicate-key error. Clear it first, scoped
  // by BOTH status and age so this can only ever remove a provably expired
  // invite: a still-live pending one and a joined member are untouchable.
  await supabase.from('rc_reconnect_participants').delete()
    .eq('mission_id', mission.id).eq('agent_no', inviteeAgentNo).eq('status', 'invited')
    .lt('joined_at', new Date(Date.now() - INVITE_TTL_MS).toISOString())

  const { error } = await supabase.from('rc_reconnect_participants')
    .insert({ mission_id: mission.id, agent_no: inviteeAgentNo, status: 'invited', invited_by: agentNo })
  if (error) return { success: false, error: error.message }

  const note = String(params.message || '').trim().slice(0, MAX_MESSAGE_LEN)
  if (note) await supabase.from('rc_reconnect_messages').insert({ mission_id: mission.id, agent_no: agentNo, body: note })

  // Codename, not the agent number the inviter just typed — same
  // agent-numbers-stay-server-side rule as everywhere else in this file,
  // and a friendlier confirmation ("Invited Euphoria") than an echo.
  const { data: inviteePlayer } = await supabase.from('rc_players').select('codename').eq('agent_no', inviteeAgentNo).maybeSingle()
  return { success: true, inviteeCodename: inviteePlayer?.codename || inviteeAgentNo }
}

/** Post a line to the caller's own mission's shared thread — open to
 *  anyone currently 'invited' OR 'joined' there, not just the pair who've
 *  actually accepted, so someone can ask a question before deciding.
 *  Doesn't reshape/return the mission itself; the frontend already calls
 *  getReconnectMission right after (same pattern as invite/accept/remove),
 *  which picks up the new line via shapeWithMessages. */
export async function sendReconnectMessage(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const body = String(params.message || '').trim().slice(0, MAX_MESSAGE_LEN)
  if (!body) return { success: false, error: 'message_required' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: false, error: 'not_available' }

  const mission = await findMyMission(supabase, agentNo, districtId, { goalId: reconnect.id })
  if (!mission) return { success: false, error: 'not_in_mission' }
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { error } = await supabase.from('rc_reconnect_messages')
    .insert({ mission_id: mission.id, agent_no: agentNo, body })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** The mission creator frees up a slot occupied by someone who hasn't
 *  contributed anything yet — still 'invited' (never accepted) or 'joined'
 *  but never streamed. Confirmed with the site owner: creator-only, and
 *  only against zero-contribution participants, so nobody who's actually
 *  helped can be unfairly bumped right before (or after) they contribute. */
export async function removeReconnectParticipant(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const targetAgentNo = String(params.targetAgentNo || '').trim().toUpperCase()
  if (!targetAgentNo) return { success: false, error: 'target_required' }
  // Removing YOURSELF is leaving, and is always allowed. It used to be
  // refused outright, which — combined with "only the creator may remove
  // anyone" below — meant an agent who accepted an invite had no way out of
  // a stalled pairing at all, short of waiting out the mission's 7 days.
  const isLeaving = targetAgentNo === agentNo

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: false, error: 'not_available' }

  let mission = await findMyMission(supabase, agentNo, districtId, { goalId: reconnect.id })
  if (!mission) return { success: false, error: 'not_in_mission' }
  if (!isLeaving && mission.created_by !== agentNo) return { success: false, error: 'not_mission_creator' }
  mission = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { data: target } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id).eq('agent_no', targetAgentNo).maybeSingle()
  if (!target) return { success: false, error: 'not_in_mission' }
  // Having contributed once used to buy a permanent seat, so a teammate who
  // helped and then vanished could hold the mission (and the person still
  // playing) hostage until it expired. Someone who has gone quiet for
  // IDLE_DAYS, or lost the district outright, can now be dropped — but a
  // teammate who is still streaming stays protected no matter how much
  // slower they are than whoever is doing the removing. See IDLE_DAYS.
  if (!isLeaving && target.status === 'joined' && target.streamed_at) {
    const stillOn = await agentsStillOnDistrict(supabase, districtId)
    const idle = await idleAgents(supabase, [targetAgentNo])
    if (stillOn.has(targetAgentNo) && !idle.has(targetAgentNo)) {
      return { success: false, error: 'already_contributed' }
    }
  }

  const { error } = await supabase.from('rc_reconnect_participants')
    .delete().eq('mission_id', mission.id).eq('agent_no', targetAgentNo)
  if (error) return { success: false, error: error.message }

  const { data: freshParticipants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  // Walking out of a mission nobody else joined leaves an empty shell that
  // can never do anything — same dead-end foldAwayDanglingMissions clears
  // elsewhere, so clear it here rather than leaving it as clutter that also
  // shows up in every "N agents waiting" count.
  if (isLeaving && !(freshParticipants || []).some((p: any) => p.status === 'joined')) {
    await supabase.from('rc_reconnect_missions').delete().eq('id', mission.id).eq('status', 'open')
    return { success: true, left: true, mission: null }
  }
  if (isLeaving) return { success: true, left: true, mission: null }

  return { success: true, mission: await shapeWithMessages(supabase, mission, freshParticipants || [], agentNo) }
}

/** The invited agent accepts (joins a real slot) or declines (row removed
 *  outright). Resolved district-wide, not goal-scoped — the invitee may
 *  have a different reconnect goal of their own (or none). */
export async function respondReconnectInvite(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const accept = !!params.accept

  let mission = await findMyMission(supabase, agentNo, districtId, { status: 'invited' })
  if (!mission) return { success: false, error: 'no_pending_invite' }

  // Checked BEFORE refreshMission below, which sweeps stale invites itself:
  // let it run first and the row is already gone by the time we'd look, so
  // the honest "this expired" answer degrades into the vaguer "you have no
  // pending invite here" — the one case this message exists for.
  const { data: earlyInvite } = await supabase.from('rc_reconnect_participants')
    .select('status, joined_at').eq('mission_id', mission.id).eq('agent_no', agentNo).eq('status', 'invited').maybeSingle()
  if (inviteExpired(earlyInvite)) {
    await supabase.from('rc_reconnect_participants').delete().eq('mission_id', mission.id).eq('agent_no', agentNo).eq('status', 'invited')
    return { success: false, error: 'invite_expired' }
  }

  const { data: goal } = await supabase.from('rc_goals').select('variant, config').eq('id', mission.goal_id).maybeSingle()
  const variant = goal?.variant === 'connect' || goal?.variant === 'invite' ? goal.variant : null
  if (!variant) return { success: false, error: 'no_pending_invite' }
  mission = await refreshMission(supabase, mission, variant, goal?.config)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { data: invite } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id).eq('agent_no', agentNo).eq('status', 'invited').maybeSingle()
  if (!invite) return { success: false, error: 'no_pending_invite' }

  if (!accept) {
    await supabase.from('rc_reconnect_participants').delete().eq('mission_id', mission.id).eq('agent_no', agentNo)
    return { success: true, joined: false }
  }

  // Nothing used to stop an agent from accepting a brand-new invite while
  // already genuinely paired in a DIFFERENT open mission for this exact
  // goal — years of that gap left dozens of agents holding half a dozen or
  // more simultaneous open memberships each, which could shadow their real,
  // actively-progressing pairing behind a stray one findMyMission happened
  // to resolve to instead (see its own doc comment). Block it here instead:
  // decline (or just ignore) the invite and stay with the team you're
  // already on rather than quietly duplicating yourself across missions.
  // Excludes THIS mission from the check — the agent's own pending invite
  // row here would otherwise always read as "spoken for" and block every
  // accept, including the legitimate first one.
  const rostersForGuard = await openMissionRosters(supabase, districtId, mission.goal_id)
  rostersForGuard.delete(mission.id)
  if (isSpokenFor(rostersForGuard, agentNo, await agentsStillOnDistrict(supabase, districtId))) {
    return { success: false, error: 'already_paired_elsewhere' }
  }

  // rc_reconnect_accept_invite re-checks the invite and capacity, and
  // flips the status, all as one row-locked unit — the old separate
  // count-then-update here let two invitees accepting a mission's last
  // slot within milliseconds of each other both land as 'joined'.
  const { data: rpcData, error: rpcError } = await supabase.rpc('rc_reconnect_accept_invite', {
    p_mission_id: mission.id, p_agent_no: agentNo,
  })
  const result = !rpcError && Array.isArray(rpcData) ? rpcData[0] : null
  if (rpcError || !result?.joined) return { success: false, error: result?.error || rpcError?.message || 'join_failed' }
  await foldAwayDanglingMissions(supabase, agentNo, mission.id, mission.goal_id)
  await refreshMission(supabase, mission, variant, goal?.config)
  return { success: true, joined: true }
}

/** Accepting an invite can leave a DIFFERENT mission this same agent opened
 *  earlier — back when they had no better option — sitting around with
 *  them as its only participant. Nobody could ever join it now: they're
 *  the reason it existed, and isSpokenFor above already treats "joined
 *  here" as unavailable everywhere else once someone else joins THIS
 *  mission with them. Left alone it's just permanent clutter, so fold it
 *  away the moment they land somewhere real instead. Scoped to the same
 *  goal_id and to missions where they're still the ONLY joined
 *  participant — a mission they're genuinely paired up in elsewhere is
 *  none of this call's business.
 *
 *  Deleting that old mission outright would silently erase real progress:
 *  contribution counts run off joined_at (see contributionSince), and
 *  rc_reconnect_accept_invite just stamped a brand-new joined_at = now()
 *  on this agent's row in the mission they're landing in. Anyone who'd
 *  been streaming for days while sitting alone waiting for a partner would
 *  have that entire history zeroed out the moment someone finally invited
 *  them — punishing exactly the agent who did the most to get here. So
 *  this backdates the new row to the EARLIEST joined_at among whatever
 *  solo missions it's folding away, instead of leaving today's acceptance
 *  moment stand as if nothing happened before it. */
async function foldAwayDanglingMissions(supabase: SupabaseDB, agentNo: string, exceptMissionId: string, goalId: string) {
  const { data: myOtherRows } = await supabase.from('rc_reconnect_participants')
    .select('mission_id, joined_at').eq('agent_no', agentNo).eq('status', 'joined').neq('mission_id', exceptMissionId)
  let earliestJoinedAt: string | null = null
  for (const row of myOtherRows || []) {
    const { data: otherMission } = await supabase.from('rc_reconnect_missions')
      .select('id, goal_id, status').eq('id', row.mission_id).maybeSingle()
    if (!otherMission || otherMission.goal_id !== goalId || otherMission.status !== 'open') continue
    const { count } = await supabase.from('rc_reconnect_participants')
      .select('agent_no', { count: 'exact', head: true }).eq('mission_id', row.mission_id).eq('status', 'joined')
    if ((count || 0) <= 1) {
      if (!earliestJoinedAt || new Date(row.joined_at).getTime() < new Date(earliestJoinedAt).getTime()) {
        earliestJoinedAt = row.joined_at
      }
      await supabase.from('rc_reconnect_participants').delete().eq('mission_id', row.mission_id)
      await supabase.from('rc_reconnect_missions').delete().eq('id', row.mission_id)
    }
  }
  if (earliestJoinedAt) {
    await supabase.from('rc_reconnect_participants')
      .update({ joined_at: earliestJoinedAt })
      .eq('mission_id', exceptMissionId).eq('agent_no', agentNo)
  }
}

/** Every pending invite this agent hasn't answered yet — the notification
 *  bell's whole data source. Two plain queries + a JS merge rather than an
 *  embedded relational select, matching how the rest of this codebase joins
 *  (see communityStreams/awardStreakBadges) rather than depending on a
 *  guessed FK-constraint name. invited_by resolves to a codename, never the
 *  raw agent number — same "agent numbers never leave the caller's own
 *  request" rule handlers.ts documents at the top of this file's sibling. */
export async function getMyInvites(supabase: SupabaseDB, content: GameContent, agentNo: string) {
  const { data: allRows } = await supabase.from('rc_reconnect_participants')
    .select('mission_id, invited_by, status, joined_at').eq('agent_no', agentNo).eq('status', 'invited')
  // A stale invite must stop showing as a notification too, not just stop
  // blocking (isSpokenFor) — otherwise it stays a badge the agent can tap
  // forever with nothing behind it.
  const rows = (allRows || []).filter((r: any) => !inviteExpired(r))
  if (!rows.length) return { success: true, invites: [] }

  const missionIds = [...new Set(rows.map((r: any) => r.mission_id))]
  const { data: missions } = await supabase.from('rc_reconnect_missions')
    .select('id, district_id').in('id', missionIds)
  const districtByMission = new Map((missions || []).map((m: any) => [m.id, m.district_id]))

  const inviterNos = [...new Set(rows.map((r: any) => r.invited_by))]
  const { data: inviters } = await supabase.from('rc_players')
    .select('agent_no, codename').in('agent_no', inviterNos)
  const codenameByAgent = new Map((inviters || []).map((p: any) => [p.agent_no, p.codename]))

  const invites = rows
    .map((r: any) => {
      const districtId = districtByMission.get(r.mission_id) || ''
      const district = content.districts.find((d) => d.id === districtId)
      return {
        districtId,
        districtName: district?.name || districtId,
        fromCodename: codenameByAgent.get(r.invited_by) || 'an agent',
      }
    })
    .filter((i: any) => i.districtId)

  return { success: true, invites }
}

/* ── Admin ────────────────────────────────────────────────────────────── */

/** Fisher-Yates — every ordering equally likely, which is the entire point
 *  of "randomly assign" (a biased shuffle would quietly always favor
 *  whoever's agent_no sorts first). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Admin: launch a whole series of missions for one reconnect goal at once —
 * every agent actively restoring the district WITH THIS EXACT GOAL frozen
 * in, who isn't already in a live mission there, gets shuffled and split
 * into full groups of the configured size. Each group becomes its own
 * mission, everyone in it already 'joined' (no matchmaking/invite step —
 * the admin already did the assigning). Leftover agents who don't make a
 * full group sit out this round; they're still free to open/join one
 * themselves, or catch the next batch-assign.
 */
export async function adminAutoAssignMissions(supabase: SupabaseDB, params: any) {
  const goalId = String(params.goalId || '')
  if (!goalId) return { success: false, error: 'goal_required' }

  const { data: goal } = await supabase.from('rc_goals').select('*').eq('id', goalId).maybeSingle()
  if (!goal || goal.kind !== 'reconnect' || (goal.variant !== 'connect' && goal.variant !== 'invite')) {
    return { success: false, error: 'not_available' }
  }
  const requiredAgents = goal.config?.requiredAgents
  if (!Number.isFinite(requiredAgents) || requiredAgents < 2) return { success: false, error: 'not_available' }
  const districtId = goal.district_id as string

  const { data: activeRows } = await supabase.from('rc_player_districts')
    .select('agent_no, goals').eq('district_id', districtId).eq('status', 'active')
  const eligible = (activeRows || [])
    .filter((r: any) => r.goals?.reconnect?.id === goalId)
    .map((r: any) => r.agent_no as string)

  const { data: openMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('goal_id', goalId).eq('status', 'open')
  const openMissionIds = (openMissions || []).map((m: any) => m.id)
  const alreadyIn = new Set<string>()
  if (openMissionIds.length) {
    const { data: liveRows } = await supabase.from('rc_reconnect_participants')
      .select('agent_no').in('mission_id', openMissionIds)
    for (const r of liveRows || []) alreadyIn.add(r.agent_no)
  }

  const available = shuffle(eligible.filter((a) => !alreadyIn.has(a)))
  const groups: string[][] = []
  for (let i = 0; i + requiredAgents <= available.length; i += requiredAgents) {
    groups.push(available.slice(i, i + requiredAgents))
  }
  const leftover = available.length - groups.length * requiredAgents

  const created: string[] = []
  for (const group of groups) {
    const { data: mission, error } = await supabase.from('rc_reconnect_missions').insert({
      district_id: districtId, goal_id: goalId, required_agents: requiredAgents,
      track_label: `reconnect:${goal.variant}`, track_artist: null, track_aliases: [],
      created_by: '__admin__',
    }).select().single()
    if (error || !mission) continue
    await supabase.from('rc_reconnect_participants').insert(
      group.map((agentNo) => ({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })))
    created.push(mission.id)
  }

  return { success: true, missionsCreated: created.length, agentsAssigned: groups.length * requiredAgents, agentsLeftOver: leftover }
}
