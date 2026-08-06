# BOTZ Network Redesign — design notes & implementation plan

Status: **design settled, nothing built yet.** This captures the brain-dump from chat,
organized by system, plus every place it collides with what's already live. All open
questions below are now resolved — see "Proposed phased plan" for build order.

## 1. Lore / framing

> After the collapse of the old tracking network, HT lost contact with hundreds of agents
> worldwide. HT built a new intelligence network called BOTZ using the ARMY Bomb — but the
> network is unstable. Every stream you log restores pieces of the network. As more data
> returns, districts and missions unlock.

**Chapter 1: Operation Reconnect**

Onboarding beat:
- "Welcome, Agent." → enter a name → assigned an Agent Number.
- Warning, delivered in-fiction: there are infiltrators in the network too — don't reveal
  your Agent Number to anyone.

This is mostly copy — closest existing hook is `js/ui-onboarding.js` (name entry →
agent number reveal) and `js/ui-auth.js`. Op-reconnect already frames the world as "the
city went dark, streaming restores it" (see `index.html`'s landing copy and
`screen-world.js`'s header comments) — BOTZ/HT/infiltrator framing would layer on top of
that, not replace it. **HT already exists** as this game's in-fiction narrator (see the
"HQ to HT rename" commits in git history) — so this slots in rather than introducing a
new entity.

## 2. Weekly Mission Board (new screen/concept)

Three missions, presented together, resetting weekly:

1. 🎵 Complete all Track Goals
2. 💿 Complete all Album Goals
3. Reconnect Mission — one special co-op task per district (e.g. "need 4 agents to help
   restore this")

**Already exists, partially:** every district already has exactly these three goal kinds —
`track`, `album`, `reconnect` — per district (`supabase/functions/op-reconnect/lib/goals.ts`,
`js/ui-district.js`). What's missing is a **weekly rollup screen** that shows them as a
named "Mission Board" across the agent's whole week, rather than only visible one district
at a time inside that district's own screen. This is closer to a new *view* over existing
data than a new mechanic — the lowest-risk item in this whole doc.

## 3. ARMY Bomb rework — fuel-furnace charge model

This is the big one, and it's a **different mechanic from the ARMY Bomb that's live today**,
not an addition to it. Current system (`supabase/functions/op-reconnect/lib/bomb.ts`):
charge is a *network-wide, pooled* rolling window of everyone's counted streams, decays
back toward zero on its own as the window rolls forward, drives a shared XP multiplier
(1.0–1.5×), and getting fully unlocked eras extends the pool window (see the Era Timeline
work). No per-agent inventory, nothing to "run out of," nobody's account resets.

The new proposal, as I understand it:
- The Bomb should always be charging, and **drains** when there's no fuel.
- **Fuel / Botz**: a per-agent consumable. Earned from album-goal streams — 20 streams = 1
  fuel/botz. 1 fuel/botz keeps the Bomb charged for up to 4 hours.
- **Lit-up Eras**: stream an era's tracks one by one to "light up" that era for the week.
  While lit, it keeps the Bomb charged for 24 hours. **Doesn't carry over** — resets every
  week, unlike the Era Timeline's own cumulative, all-time, never-reset design (see
  `era-timeline.ts`'s header comment — this is a direct contradiction to flag, not an
  oversight to quietly resolve one way).
- A lit-up era is worth **10 hours** of charge (separately stated) — doesn't obviously
  reconcile with "keeps it charged for 24 hours" above; likely one of these is the actual
  number and the other is a draft value. Needs a decision (see Open questions).
- **7 continuous days with zero charge → the agent "dies"** and gets sent back to their
  first district (Home Base). A real, punishing reset — nothing like this (permadeath /
  rollback) exists anywhere in the current game, which is deliberately generous: failed
  Red Zone defuses "brown out" the *network*, never take anything from an individual
  agent, and a lapsed district restoration just goes back to "available," never resets
  progress on anything else.
- **Auto-mode**: the Bomb can be set to auto-consume fuel/botz from the agent's Pack to
  keep itself charged without manual action.
- **Visual**: a campfire-style animation — modeled on *99 Nights in the Forest* (Roblox),
  where you feed wood into a fire — adapted here as feeding fuel/botz into the ARMY Bomb to
  keep it lit.

## 4. XP rules by mode

> 10 streams = 1 XP (easy) · 20 streams = 1 XP (medium) · 30 streams = 1 XP (hard)

**Partial collision with what's live.** Today (`config.ts`'s `xpRules`/`modeMultiplier`),
`streamsPerXp` is a flat `10` for everyone regardless of mode — mode instead scales the
*variety cap* (how many plays of one track count per day), not the XP conversion rate
itself. The proposal makes streams-per-XP mode-dependent directly. These aren't
compatible as written; adopting the new numbers means replacing the current lever, not
adding to it.

## 5. Magic Shop (new marketplace)

Buys: fuel/botz, BTS merch, tickets, "Wings."

- **Tickets**: gated behind Level 7+, 3 restored districts, 50 XP.
- **Wings**: up to 3/day purchasable from the shop; 3 Wings cost 1 XP.
- **Spending Wings**: 1 Wing → craftable into 1 "Alpaca" via a "Candy Star generator."

**Naming collision, not a design problem:** "Candy Star Generator" already exists in this
codebase (`supabase/functions/op-reconnect/lib/candy-star-rules.ts`,
`js/screen-candystar.js`) — it's a *playlist-rule-compliance + procedural cover art
generator*, ported from the arirang-btsbackend project, completely unrelated to crafting a
collectible. The new "Wings → Alpaca" crafting idea needs its own name (or its own screen
under a shared "Candy Star" brand, if the overlap is intentional) so it isn't confused
with the existing tool of the same name.

There's also no "BTS merch" storefront today — `js/items.js` tracks merch **earned as
district-restoration rewards**, not something purchased with a currency. A Magic Shop
would be the first real currency-sink/storefront in the game.

## What's genuinely new vs. what already exists

| Idea | Status |
|---|---|
| Weekly Mission Board | New *view* over existing per-district goal data |
| Lore/onboarding copy (BOTZ, infiltrators) | Pure copy addition |
| Fuel/Botz currency + per-agent furnace charge model | New — **full replacement** of `bomb.ts`'s shared network-wide charge with a per-agent one; needs a new table |
| Lit-up Eras (weekly, non-cumulative) | New — conflicts with Era Timeline's cumulative design |
| 7-day blackout → reset to Home Base | New, but resolved: escapable via existing streak-freeze charges |
| Mode-based streams-per-XP | New — replaces current mode→variety-cap lever |
| Magic Shop / Wings / Tickets / merch purchases | New — first real currency-sink in the game |
| Wings → Alpaca | Not new — a currency gate in front of the *existing* Candy Star Generator; "Alpaca" is flavor text for its playlist output |
| Campfire/fuel-feeding animation | New — pure client-side, no backend dependency |
| Red Zone consequence (personal charge hit, not brownout) | Smallest change in this doc — target/contribution/reward machinery is unchanged |

## Design decisions (all resolved)

1. **Resolved: per-agent.** Fuel/botz charges the ARMY Bomb, and the Bomb's charge is a
   *maintenance requirement* to keep already-restored districts alive — not just an XP
   multiplier the way it works today. Track/album/reconnect goals stay a separate concern
   (they *restore* districts; charge *keeps them* restored). And the Bomb itself is
   **per-agent**, not one shared network number: each agent maintains their own
   charge/fuel, earned from their own album streams, and only their own districts are at
   risk if it runs out.
   This is a full replacement of `bomb.ts`'s current model, not an addition to it — the
   existing `rc_bomb_state` table is one shared row read by every agent; a per-agent
   charge needs its own row per agent (new table, e.g. `rc_agent_charge`), and the
   network-wide "community charge → shared XP multiplier" mechanic either goes away
   entirely or survives as a separate, smaller bonus layer on top of everyone's individual
   charge (not decided — flag if you want the shared multiplier kept alongside this).
   It also means the Era Timeline → charge-window bonus shipped a few turns ago
   (`era-timeline.ts`'s `completedEraCount()` extending `bomb.ts`'s shared window) needs
   rethinking once the Bomb goes per-agent — that bonus was built for the shared-pool
   model and doesn't have an obvious per-agent equivalent yet.
2. **Resolved: 10 hours.** One lit-up era keeps the (now per-agent) Bomb charged for 10
   hours — the 24-hour figure was the draft value, not the real one.
3. **Resolved (as recommended): kept visibly separate.** The Era Timeline chip strip stays
   cumulative/all-time (season-long trophy case). "Lit up" eras are a separate, smaller
   weekly indicator that resets — same underlying track-streaming action, two different
   displays with two different lifespans.
4. **Resolved.** The 7-day blackout is real, but an agent can spend existing **streak
   freeze charges** (`rc_players.streak_freeze_charges` — already live, currently protects
   the daily streak) to cover missed days and avoid the Home Base reset after a long
   absence. Reuses state that already exists rather than adding a new currency for this
   specifically — the freeze just needs to also count against blackout days, not only
   streak-break days.
5. **Resolved: replaces.** Mode-based streams-per-XP (10/20/30) replaces the current
   variety-cap-by-mode lever outright — `xpRules.streamsPerXp` becomes mode-dependent,
   `modeMultiplier`'s variety-cap job goes away rather than stacking with the new rule.
6. **Resolved — turns out there's no naming collision.** Wings are pure currency (a cost),
   spent to run the **existing** Candy Star Generator (`candy-star-rules.ts`,
   `screen-candystar.js`) — "Alpaca" is just flavor text for the playlist that generator
   produces, not a new crafted item or a new tool. This is a paywall added in front of an
   existing feature, not a new system: gate playlist generation behind spending Wings.
7. **New, from the Red Zone clarification.** During a Red Zone attack, *every* agent's
   personal charge is put at risk together, and the whole network has to co-op-stream
   toward one combined target to defuse it — combining every agent's counted streams, same
   shape as `bomb.ts`'s `rc_defuse_events`/`rc_defuse_contrib` today. This resolves the
   "does the shared mechanic survive" half of Q1: the day-to-day community-charge → shared
   XP multiplier goes away (replaced by per-agent charge), but Red Zone stays exactly what
   it already is — a rare, shared, opt-in-by-necessity co-op event layered on top of
   everyone's personal charge, not a replacement for it. Net effect: **Red Zone needs the
   least rework of anything in this doc** — its existing target/contribution/reward
   machinery carries over pretty much as-is; what changes is the *consequence* of failing
   one (today: network brownout multiplier; new: every agent's personal charge takes a hit).

## Proposed phased plan (once the above are answered)

**Phase 1 — copy & view only, no schema changes, lowest risk — ✅ DONE**
- BOTZ/infiltrator lore copy: landing page brief (`index.html`) and the agent-number
  reveal warning (`ui-auth.js`).
- Weekly Mission Board (`js/mission-board.js`), reachable from the Pack screen alongside
  The 148 Protocol and the Badge Drawer — reads existing track/album/reconnect goal state
  off `state.activeDistrict`, no new data model.

**Phase 2 — new economy primitives**
- `fuel_botz` balance per agent (new column/table), earned via album-goal streams (20:1).
- Magic Shop screen + purchase flow (fuel/botz, Wings, tickets) — first real currency sink,
  needs its own backend endpoints (`buyItem`-style, mirroring `retireAccount`'s
  password-optional/session-gated pattern).
- Ticket gate check (level/districts/XP threshold) — pure read, no new state.

**Phase 3 — Bomb charge model change**
- New `rc_agent_charge`-style table: per-agent charge level, last-fed timestamp, fuel
  balance. Replaces `bomb.ts`'s shared `rc_bomb_state` read for the "does my district stay
  alive" check. The day-to-day community-charge → shared XP multiplier goes away; Red Zone
  stays as the one surviving shared/network-wide layer (see decision 7) but its
  consequence on failure changes from a network brownout multiplier to a hit against every
  agent's personal charge.
- Retire the Era Timeline → charge-window bonus (`completedEraCount()` / `chargeWindowDays()`
  in `bomb.ts`) or rebuild it as a per-agent bonus — it was built to extend a shared
  window that no longer exists once charge is personal.
- Lit-up Eras: new per-agent-per-week state (which eras lit, 10h charge each, resets weekly).
- 7-day blackout consequence, with the streak-freeze escape hatch wired in (decision 4).
- Mode-based streams-per-XP (decision 5) fits naturally here too, since it's the same
  "how streaming converts into game currency" surface as fuel/botz earning.

**Phase 4 — Magic Shop polish + visuals**
- Gate the existing Candy Star Generator behind spending Wings (decision 6) — no new
  crafting system, just a cost check in front of a screen that already exists.
- Campfire/fuel-feeding animation on the ARMY Bomb core widget — purely additive, safe to
  build any time once Phase 2's fuel/botz balance exists to visualize.

Recommend building in that order: each phase is usable on its own, and Phase 3 (the
riskiest, most core-mechanic-altering one) is deliberately last and gated on explicit
answers rather than guesses.
