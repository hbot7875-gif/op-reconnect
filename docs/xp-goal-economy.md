# OP: RECONNECT — XP Goal Economy

Status: implemented 2026-08-06

This document is the source of truth for how XP is earned in OP: RECONNECT. The purpose of the rule is to keep progression tied to the game’s assigned missions. Listening to any random BTS track must not become an easy, passive XP shortcut.

## Core rule

XP comes from the active district’s assigned gameplay:

1. **Track Goals** — streams matching a listed Track Goal can earn stream XP.
2. **Album Goals** — streams matching a listed Album Goal track can earn stream XP.
3. **Reconnect Goal** — this must be completed to finish the district. It does not turn unrelated streams into XP.
4. **District restoration** — completing the Track, Album, and Reconnect checklist restores the district and grants the district-completion reward. The current default is **+50 XP**.

If a player has no active district, ordinary streams do not generate stream XP.

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
- The optional **Today / Daily Transmission** task. It no longer grants a separate +10 XP.
- Red Zone participation. It protects the shared network and grants the Red Zone participation badge, but it is not a fourth XP source.
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

> Only assigned goal streams generate stream XP. Complete Track, Album, and Reconnect goals to restore a district and receive its completion reward.

## Historical behavior

This change applies to new calculations. XP already earned and stored before this rule was introduced is not removed, so existing players do not unexpectedly lose levels or ranks.

## Implementation map

- `supabase/functions/op-reconnect/lib/derive.ts` — eligible goal-stream counting and XP ledger calculation.
- `supabase/functions/op-reconnect/lib/districts.ts` — frozen goal data and activation-day baseline.
- `supabase/functions/op-reconnect/lib/handlers.ts` — active district XP scope and player-state totals.
- `supabase/functions/op-reconnect/lib/bomb.ts` — Red Zone badge reward without XP.
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
- [x] Red Zone grants a badge rather than XP.
- [x] District completion still requires the Reconnect Goal.
- [x] Frontend production build succeeds.
