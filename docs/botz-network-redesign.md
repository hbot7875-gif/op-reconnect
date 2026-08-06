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

**Phase 2 — new economy primitives — ✅ DONE**
- `charge_cells` balance per agent (`rc_players`), earned automatically at 20:1 from
  album-goal-track streams only — `districts.ts`'s new `albumGoalStreamTotal()` isolates
  those from general streaming by reusing `districtProgress()`'s own per-track windowed-
  plays math, since the daily rollup pipeline (`derive.ts`) only ever sees an aggregate
  counted total with no concept of which goal a stream belonged to. Awarded idempotently
  via a stored per-activation baseline (`rc_player_districts.charge_cells_awarded`), same
  shape as every other per-activation reward in this game. See `lib/charge-economy.ts`.
  Named "Charge Cells", not "fuel/botz" — see the naming-collision note above.
- Magic Shop screen (`js/magic-shop.js`, backend `lib/magic-shop.ts`): sells Wings (up to
  3/day for 1 XP — spent via a real negative `rc_xp_ledger` entry, flagged in code as a
  design tension since level/rank have never had to handle XP decreasing before) and a
  one-time Ticket (claimed once Level 7 / 3 restored districts / 50 XP is cleared — no
  separate cost specified, so eligibility is the price). BTS merch is a "coming soon"
  placeholder — no catalog or pricing exists to build against.
- **Update: now done, on explicit request.** `generateAlpaca` (`candy-star.ts`) is capped
  at 3 real generations/day per agent and costs 1 Wing each — this does reverse the
  function's originally-ported "no daily limit" design decision, which is now recorded
  purely as history in that file's header comment rather than as the current behavior.
  `previewAlpaca` (dry runs — no DB write, no Spotify write) stays completely free; the
  gate only applies right before the real `generatePlaylist()` call. The daily count reads
  `generated_playlists` rows created today (KST), so a failed attempt never eats into the
  limit — only successful generations are ever inserted there.

**Phase 3 — Bomb charge model change — ✅ CORE SHIPPED, one piece deliberately deferred**
- New `rc_agent_charge` table (`agent_no`, `charged_until`, `auto_feed`, blackout markers) —
  charge is an absolute expiry computed at read time, not a decaying counter, matching
  derive.ts's "interpret at read time, nothing decrements in the background" philosophy.
  `lib/agent-charge.ts`'s `getAgentChargeView()` is the one function handlers.ts calls each
  poll: it catches up auto-feed retroactively, checks Lit-up Eras, then evaluates the
  blackout consequences. New client screen `js/agent-charge.js` (Pack → Personal Charge):
  shows hours remaining, feeds Charge Cells (4h each, `feedCharge`), toggles auto-feed
  (`setAutoFeed`), and lists this week's lit eras.
- **Two-tier blackout, exactly as specified in the follow-up clarification** (not just the
  original 7-day figure): 7 continuous days dark abandons the active district back to
  available (same shape as the existing restoration-deadline lapse); **14 days triggers a
  full wipe — every restored district reverts, XP/badges/items stay banked.** Both are
  rescued reactively by spending streak-freeze charges (1 day covered each) right at the
  moment a threshold would otherwise trip, not spent proactively. Both consequences are
  idempotent (nothing left to re-wipe once applied) and clear automatically the moment the
  agent charges again.
- Lit-up Eras: `rc_agent_lit_eras` (agent, era, week). Streaming every track in a whole era
  during the current KST week (Monday-keyed) lights it for +10h, once per era per week,
  checked BEFORE the blackout evaluation each poll so a freshly-lit era can rescue an
  agent from going dark in the same request. Reuses `era-timeline.ts`'s `ERA_CATALOG`
  (now exported) for the track lists, but scores per-agent/per-week, not network-wide/
  all-time — genuinely a different question from that file's own rollup.
- **Partially resolved on a later revisit.** `bomb.ts` itself is still untouched — the
  shared `rc_bomb_state` charge, Red Zone's target/contribution/reward, and the Era
  Timeline → `chargeWindowDays()` bonus are all still live, unchanged, computed exactly as
  before. **But the community→XP multiplier half of decision 7 is now done**: `bomb.multiplier`
  no longer reaches `derive.ts`'s `awardStreamsXp` at all (stopped being threaded through
  `ensureDailyRollups`, which dropped the parameter entirely) — Personal Charge
  (`agent-charge.ts`) is the only thing that decides a player's own XP and district
  survival now. Every player-facing "×N Boost" claim that promised an XP benefit from the
  shared Bomb was removed to match: the landing page ticker's boost chip, the World screen
  status tile's "Boost ×N" line, and the Bomb detail sheet's "Boost" stat row and note text
  — all gone or reworded, not left to advertise something that stopped happening.
  `bomb.multiplier` is still computed and returned (display/atmosphere — a live "how busy
  is the network" reading — plus it still feeds brownout, which still dims visuals), it's
  just never multiplied into anyone's XP anymore. Red Zone's failure branch (brownout
  consequence) was NOT touched — that half of decision 7 ("Red Zone hits personal charge
  instead") remains its own future follow-up, not bundled into this pass.
- **✅ DONE, and later corrected.** Mode-based streams-per-XP (decision 5): `config.ts`'s
  `streamsPerXpFor()` (easy 10 / medium 20 / hard 30, admin-overridable) feeds `derive.ts`'s
  `awardStreamsXp` call and `handlers.ts`'s `xpToday` estimate — each day's rate is now
  frozen to whichever mode was active the first time that day's `rc_daily_activity` row was
  touched (new `mode` column), so switching mode mid-day can't retroactively rewrite
  already-banked XP for that day. `modeMultiplier`'s variety-cap role was removed from
  `derive.ts`/`handlers.ts` — but a first pass missed that `districts.ts`'s
  `districtProgress()`/`albumGoalStreamTotal()` scaled their own cap by the same
  `frozen.meta.multiplier`, contradicting the "goes away everywhere" claim; caught and fixed
  on revisit. `modeMultiplier` still scales goal *targets* via `frozen.meta.multiplier`
  (`districts.ts`/`goals.ts`), that part is untouched, only every variety-cap job is gone
  now. `bomb.ts`'s own separate per-agent cap (the still-deferred shared-pool system) wasn't
  touched either.

**Phase 4 — Magic Shop polish + visuals**
- Gate the existing Candy Star Generator behind spending Wings (decision 6) — no new
  crafting system, just a cost check in front of a screen that already exists. **✅ DONE**
  (see Phase 2 note above — shipped alongside the daily cap).
- **✅ DONE.** Campfire/fuel-feeding animation: the Personal Charge sheet (`js/agent-charge.js`,
  `.ac-status` in `reconnect.css`) now has embers rising behind the hours readout, scaled
  by real `hoursRemaining` via a `--fuel` custom property (same pattern as the ARMY Bomb
  sphere's `--charge`), plus a one-shot flare (`.feeding`) when a Charge Cell is fed.
- **✅ RESOLVED — no purchasable merch catalog.** Re-confirmed on revisit: merch stays
  earn-only (district-restoration rewards, `items.js`), never sold — no pricing was ever
  specified and inventing one would be guessing at the game's economy. What *was* a real
  gap: the Magic Shop screen said "Coming soon" as if merch didn't exist at all. It now
  shows the agent's real merch count (read off live game state, no new backend field) with
  a hand-off button into the Pack (`js/magic-shop.js`), instead of a placeholder.
- **Still open, blocked on pricing/catalog if ever wanted:** buying Charge Cells (fuel/botz)
  directly in the Magic Shop. Charge Cells remain earn-only via album-goal streams
  (`charge-economy.ts`) — no price was ever set for a direct purchase.
- **Explicitly kept as revised, not reverted, on revisit:** the two-tier 7-day/14-day
  blackout consequence and the 10-hour Lit-up Era duration (see decisions 2 and 4 above)
  stay as shipped — re-confirmed rather than rolled back to this doc's original draft
  numbers (7-day full Home Base reset, 24-hour era duration).

Recommend building in that order: each phase is usable on its own, and Phase 3 (the
riskiest, most core-mechanic-altering one) is deliberately last and gated on explicit
answers rather than guesses.
