# OP: RECONNECT — XP Goal Economy

Status: implemented and updated 2026-08-07

This document is the source of truth for how XP is earned in OP: RECONNECT. The purpose of the rule is to keep progression tied to the game’s assigned missions. Listening to any random BTS track must not become an easy, passive XP shortcut.

## Core rule

XP comes from the active district’s assigned gameplay:

1. **Track Goals** — streams matching a listed Track Goal can earn stream XP.
2. **Album Goals** — streams matching a listed Album Goal track can earn stream XP.
3. **Reconnect Goal** — this must be completed to finish the district. It does not turn unrelated streams into XP.
4. **District restoration** — completing the Track, Album, and Reconnect checklist restores the district and grants the district-completion reward. The current default is **+50 XP**.
5. **Side Missions** — stream Wild Flower, Don't Say You Love Me, Haegeum, and Killin' It Girl at least once each in a KST day. Clearing all four grants **+10 XP once that day**. Each track also has a 20-stream weekly survival target.

If a player has no active district, ordinary streams do not generate stream XP. A successful Red Zone is the one explicit event-based exception described below.

## Red Zone XP pool

- A Red Zone starts with an admin-editable total XP pool. The default is **500 XP**.
- Every agent must log at least **7 counted event streams** to qualify.
- An agent below 7 does not add progress to the defuse target and does not share the reward.
- When the target is reached, the complete pool is divided as evenly as possible across all qualified agents.
- Whole-number rounding never creates or loses XP. Any remainder is distributed deterministically, one extra XP at a time.
- Example: with a 500 XP pool and 3 qualified agents, the shares are 167, 167, and 166 XP.
- Stream totals are snapshotted when the Red Zone launches, so activity from earlier that KST day cannot qualify retroactively.
- Qualified agents also receive the Red Zone participation badge.

## Stream-to-XP rates

The player’s selected mode controls both mission size and the stream-to-XP rate:

| Mode | Accounts | Goal size | XP rate |
| --- | --- | --- | --- |
| Easy | 1 device | Normal targets | 10 assigned goal streams = 1 XP |
| Medium | 2–4 accounts | 2× targets | 20 assigned goal streams = 1 XP |
| Hard | 5–6 accounts | 4× targets | 30 assigned goal streams = 1 XP |

The day keeps the mode with which it was first recorded. Switching modes later cannot rewrite that day’s XP rate.

## What does not earn XP

- BTS streams that do not match the active district’s Track or Album Goals.
- Streams made before the player taps **Begin Restoration**.
- Daily Transmission has been retired and cannot award XP.
- Red Zone activity below the 7-stream qualification minimum.
- Charge Cells, lit eras, wings, streak freezes, merch, tickets, collectibles, or passive ARMY Bomb charge.

XP can still be spent in the Magic Shop where the game explicitly allows it. Spending XP is not an XP reward.

## Counting safeguards

- Only the frozen goals assigned when the district begins are eligible. Later admin edits do not change an in-progress district.
- Goal labels and configured aliases are normalized before matching stream data.
- Only configured BTS artist names are accepted for XP.
- The per-track daily variety cap still applies.
- If the same track appears in multiple Track or Album Goals, each stream is counted once for XP.
- An activation-day baseline is stored when restoration begins. This prevents earlier streams from being converted into XP retroactively.
- Older active districts without the new union baseline use a conservative fallback so they cannot over-award XP.
- A personal timed level-up boost may multiply eligible goal-stream XP while it is active. The shared ARMY Bomb charge does not multiply personal XP.

## Reconnect Goal behavior

Reconnect Goals are completion gates rather than generic stream counters. Depending on the configured variant, the player may need to solve a cipher, identify a Song of the Day, complete a puzzle, or reconnect with other agents.

Track and Album progress alone cannot restore a district when a Reconnect Goal is assigned. All required parts must be complete before the district reward is issued.

## Other reasons streams still matter

Restricting XP does not make non-goal listening meaningless. Depending on the mechanic, verified BTS streams may still:

- help keep the personal ARMY Bomb charged;
- contribute to the shared network ARMY Bomb;
- support Red Zone defense;
- maintain the player’s streaming streak;
- light era backup power;
- earn Charge Cells when they are Album Goal streams.

These systems support survival, restoration, and resources without silently creating XP.

## Player-facing copy

The Agent Manual, onboarding mode picker, HUD mode picker, Settings mode explanation, City Today tile, Red Zone sheet, and admin Red Zone panel must all use the same rule:

> Assigned goal streams generate regular XP. During a Red Zone, reach 7 event streams to qualify for a share of its XP pool.

## Historical behavior

This change applies to new calculations. XP already earned and stored before this rule was introduced is not removed, so existing players do not unexpectedly lose levels or ranks.

## Implementation map

- `supabase/functions/op-reconnect/lib/derive.ts` — eligible goal-stream counting and XP ledger calculation.
- `supabase/functions/op-reconnect/lib/districts.ts` — frozen goal data and activation-day baseline.
- `supabase/functions/op-reconnect/lib/handlers.ts` — active district XP scope and player-state totals.
- `supabase/functions/op-reconnect/lib/bomb.ts` — Red Zone qualification, progress, exact pool division, XP ledger awards, and badge reward.
- `migrations/045_rc_red_zone_xp_pool.sql` — Red Zone minimum and launch-time stream baseline.
- `supabase/functions/op-reconnect/lib/config.ts` — active XP configuration fields.
- `js/agent-manual.js` — short player explanation.
- `js/screen-world.js` and `js/bomb-sheet.js` — Today and Red Zone reward wording.
- `js/ui-onboarding.js`, `js/ui-hud.js`, and `js/screen-settings.js` — mode-rate wording.
- `admin.html` — Red Zone admin explanation.

## Verification checklist

- [x] An assigned Track Goal stream can contribute toward XP.
- [x] An assigned Album Goal track stream can contribute toward XP.
- [x] An unrelated BTS stream contributes zero XP.
- [x] No active district means zero stream XP.
- [x] Overlapping goal assignments do not double-count XP.
- [x] Pre-activation streams do not become XP.
- [x] Today grants no bonus XP.
- [x] Red Zone requires at least 7 event streams per qualifying agent.
- [x] Red Zone divides its editable XP pool without creating or losing XP.
- [x] Pre-launch same-day streams cannot qualify for Red Zone rewards.
- [x] District completion still requires the Reconnect Goal.
- [x] Frontend production build succeeds.
