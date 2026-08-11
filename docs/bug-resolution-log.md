# Bug & complaint resolution log

See also: [`test-account-and-session-tokens.md`](./test-account-and-session-tokens.md)
for what AGENT001 (the "test" account) is and exactly how session tokens get
minted, used, and cleaned up to verify a fix against the real deployed
backend rather than just reading the code.

A record of every real player-reported bug handled so far, organized by
**symptom** rather than by date — when the next "X isn't counting" or "my
partner can't see me" report comes in, the goal is to jump straight to a
short diagnostic checklist instead of re-deriving it from scratch.

Each entry: what was reported, what the actual root cause turned out to
be, how it was diagnosed, and the fix. Commit messages have the full
detail; this is the index that tells you which past incident (and which
commit) a new complaint probably matches.

---

## Symptom: "This song isn't counting toward my goal / era card / XP"

By far the most common complaint shape. It has shown up with **four
different, unrelated root causes** — always work through them in this
order, cheapest check first:

1. **Does the play exist at all?**
   `select track_name, artist_name, listened_at from rc_scrobbles where agent_no='AGENTxxx' and lower(track_name) like '%keyword%'`
   If nothing comes back under any spelling, the agent likely hasn't
   actually streamed it (or it never synced from their source) — not a
   counting bug. See *"So 4 More" — no bug* below.

2. **Does the real title normalize to the SAME key the goal/era expects?**
   Run the track name through `normalizeKey(stripVersionSuffix(name))`
   (text.ts) by hand, or just diff two title strings character by
   character. Punctuation placement (`Pt.3` vs `Pt. 3`, a comma, an
   ellipsis `…` vs `...`) changes the key even though it reads as "the
   same song" to a person. See *BTS Cypher Pt.3* below.

3. **Is the play's artist attribution getting filtered out?**
   `track_counts[key].a` is a per-artist breakdown; only artists in
   `rc_config.bts_artists` (or a per-track override, see below) count.
   Official BTS collabs are sometimes scrobbled under the FEATURED
   artist's name alone, with no "BTS" token at all — those plays are real
   but silently zeroed. See *Boy With Luv / Halsey* and the network-wide
   audit below.

4. **Is a per-day baseline value wrong?**
   Goal/album progress subtracts `baseline` from ONLY the activation
   day's own bucket (`districts.ts`'s `windowedPlays`) — not from the
   whole history. A baseline set to "historical total" instead of
   "pre-activation-moment count on the activation day specifically" will
   double-subtract and can zero out real post-activation plays. This is a
   repair-time mistake, not a player-facing bug — only relevant if
   someone (an admin) manually patched `rc_player_districts.baseline`
   recently. See *AGENT000's Neuron/HOTS baseline* below.

5. **Is it a weekly reset, not a bug?**
   Era/"Emergency" Cards (`agent-charge.ts`) only count the CURRENT KST
   week (Monday reset). A real play from last week won't show this week.
   Regular goal/album progress isn't weekly — it's since district
   activation.

### Incidents

**Boy With Luv (feat. Halsey) not counting — AGENT046.**
Root cause: her scrobble's artist field was literally `"Halsey"`, no
"BTS" token. `bts_artists` allowlist didn't include Halsey.
Fix (first pass): added `"halsey"` to the global `bts_artists` list.
→ superseded below once the same bug showed up for artists who
*also* have unrelated solo songs with colliding titles.

**Network-wide collab-artist audit — 18 tracks.**
Prompted by: "check for any other [collabs] not getting counted."
Method: computed `normKeyFull()` for every ERA_CATALOG + rc_goals track
title, then scanned all of `rc_daily_activity` for artist strings on
those exact keys that fail `artistAllowed()`. Found RM's Indigo collabs
(Anderson .Paak, Paul Blanco, Mahalia, Erykah Badu, Tablo, Kim Sawol,
Colde, youjeen, parkjiyoon), Jin's Echo (YENA), j-hope's Hope On The
Street (Gaeko, YOON MIRAE, benny blanco, Nile Rodgers, HUH YUNJIN), V's
Winter Ahead (Park Hyo-shin, 47 real plays affected), and official
remixes (Butter/Megan Thee Stallion, Idol/Nicki Minaj, The Truth
Untold + MIC Drop remix/Steve Aoki).
Key decision: **rejected** adding these names to the global
`bts_artists` list — Tablo has his own unrelated songs called "Home" and
"Tomorrow" that coincidentally share titles with other BTS tracks; adding
him globally would misattribute those too.
Fix: built `rc_config.track_artist_overrides` — a per-*song* (not
per-artist) allowlist. `text.ts`'s `countedArtistPlays(breakdown, allow,
trackKey, overrides)` is now the ONE shared implementation every counting
path uses (previously 7 different files each had their own inline copy
of the same reduce). Migrated the earlier Halsey fix into this same
mechanism for consistency.
Commits: `128ebd3` (network-wide fix).

**BTS Cypher Pt.3 not counting for Dark & Wild era card — AGENT044.**
Root cause: her real scrobble title, `"BTS Cypher, Pt. 3: KILLER (feat.
Supreme Boi)"`, normalizes to `"bts cypher pt 3 killer"` (space between
"pt" and "3"). `ERA_CATALOG`'s hardcoded `"BTS Cypher PT.3: KILLER"`
normalizes to `"bts cypher pt3 killer"` (no space). Confirmed via the
real Candy Star catalog that BOTH title variants genuinely exist as
separate metadata entries for the same song — not a typo, a real dual
naming convention in the wild.
Fix: gave `ERA_CATALOG` an alias mechanism it never had (unlike
`rc_goals` tracks, which already support a `keys`/`aliases` array for
exactly this). `era-timeline.ts`'s `EraTrackEntry` is now
`string | {title, aliases}`; `eraTrackKeys()`/`eraTrackTitle()` helpers
sum every alias's play count together as one track. Both consumers
(`getEraTimeline`, `computeWeeklyEraCards`) updated to use the shared
helpers instead of their own bare `normKeyFull(title)` call.
Commit: `2f8f58b`.

**Signal Sweep (side-missions.ts) undercounting Wild Flower / Don't Say
You Love Me / Haegeum / Killin' It Girl.**
Root cause: same family as the collab-artist audit above, but inverted —
instead of a global allowlist missing a featured artist, this file had
its OWN narrow per-track allowlist (`['RM','Rap Monster']` for Wild
Flower, etc.) that a play's artist tag had to word-match before it
counted at all, stricter than every other counting path in the codebase.
Plenty of scrobble sources attribute a member's solo track to `"BTS"`
rather than the member's own name — that combination never matched, so
real plays silently didn't count, with no error shown.
Found by comparing against the Arirang Mission reference this loop was
carried forward from (`testarirang` repo's `findDailyTrackScrobbles` /
`findTrackScrobbles`): it matches by track title alone, no artist check
at all — and this file's own sibling `transmission.ts` already does the
same for its `frozen.keys` tally (`bucket[k]?.n`, unfiltered).
Fix: dropped the per-track `artistAliases` filter entirely; `countTrack`
now sums the key's raw `.n` total, matching both the reference and the
sibling file. Safe because none of these four titles collide with a
different artist's differently-named catalog — there was no real
collision risk the filter was protecting against.
Commit: `9b7111d`.

**"We Are Bulletproof Pt.2" never lighting up on the School Trilogy era
card — AGENT039, plus a network-wide audit finding 4 more of the same
class.**
Root cause: identical bug shape to BTS Cypher Pt.3 above. AGENT039's
scrobbles were 100% the comma-punctuated `"We Are Bulletproof, Pt. 2"`,
which normalizes to `"we are bulletproof pt 2"` (space before the
digit) — the catalog's plain `"We Are Bulletproof Pt.2"` normalizes to
`"we are bulletproof pt2"` (no space, since there's no space in the raw
title either). Two different keys for one song; none of their plays
were ever visible to the per-agent weekly era-card check.
Since this was reported as "this is the 2nd issue with era card," did a
full network-wide audit instead of a one-track patch: pulled every
distinct real `track_counts` key against every `ERA_CATALOG` track's
expected key(s), and flagged pairs that become IDENTICAL once
whitespace is stripped — precise enough to separate "same song, comma
vs. period spacing" from two genuinely different songs that happen to
share a word (a looser word-overlap pass tried first threw ~70 false
positives: "Like" vs "Like Animals", "Stay" vs "Stay Gold", "Run" vs
"Run BTS" — all real, correctly-distinct songs).
Found 4 more real ones this way, all sharing the comma-before-"Pt."
split: BTS Cypher Pt.1, BTS Cypher Pt.2: Triptych, and Airplane Pt.2 —
plus Paldogangsan, which has a genuine two-word "Paldo Gangsan" variant
in the wild (not punctuation, but the same "real metadata disagrees on
the title" root cause). All 5 given the same `{title, aliases}`
treatment. Every OTHER catalog track came back clean — nonzero,
correctly-pooled — confirming this wasn't a wider systemic gap.
Commit: `b0ed814`.

**"So 4 More" not counting — AGENT027. Not a bug.**
Checked her entire scrobble history under every spelling variant —
zero plays, ever, of this specific track, while every OTHER Dark & Wild
track had real recent plays. Concluded she likely hasn't actually
streamed it yet, or it's from before her connected source
(`musicat`) started syncing. No fix applied; explained the diagnostic
distinction (this vs. a real miscount) to the reporter.

**AGENT000's Neuron / Hope On The Street baseline — a repair-created bug.**
Root cause: an EARLIER manual repair (adding 4 real tracks to her frozen
Hope On The Street tracklist) set each new track's `baseline` to her
*cumulative historical* play count (e.g. 2, from two days before
activation). But `windowedPlays()` only ever subtracts baseline from the
ACTIVATION DAY's own bucket — days before activation are already
excluded from the count entirely by the date-window filter. Using a
multi-day historical total there double-subtracted, zeroing out real
plays she made *after* activating.
Diagnosis: pulled raw `rc_scrobbles.listened_at` timestamps and confirmed
every single Aug-10 play (her activation day) happened hours after her
actual activation moment — so the correct baseline was 0, not 2.
Fix: reset all 6 affected baseline values to 0. This immediately
completed her album goal (the minimum-across-tracks pass count went from
0 to 2/2).
Lesson: **when hand-repairing `baseline`, it must represent "plays on the
activation-day bucket specifically, before the activation moment" — never
a multi-day historical total.** Get exact scrobble timestamps and compare
against `activated_at` before setting any baseline by hand.

---

## Symptom: "My reconnect partner and I see different things" / "can't invite anyone" / "streams decreasing"

**Completed missions reverting to "not done" — reported as "streams
decreasing," multiple agents (18 affected, some redid the whole grind up
to 6 times).**
Root cause: `findMyMission()` — "what mission am I in for this goal" —
only ever looked at `status = 'open'` missions. The instant a mission
settled to `'complete'` (mid-poll, inside `refreshMission`), the *next*
poll couldn't find it: `mission: null`, `reconnect.done` reverted to
`false`, sending the agent back to "Team up..." and letting them re-open
a fresh mission with a brand-new `joined_at` (so contribution counted
from zero again).
Fix: `findMyCompletedMission()` fallback when there's no open mission.
Also had to make `refreshMission()` still compute `sharedTrackProgress`
for an already-`complete` mission (it used to short-circuit immediately
for anything non-`open`, which would've left the fallback showing a bare
status with no progress numbers).
Commit: `fb94d1a`.

**One side of a pair sees the other + real combined progress; the other
side sees no partner and a smaller/wrong number — AGENT017 + AGENT079.**
Root cause: DIFFERENT from the above. `findMyMission()` always picked
whichever open-mission membership had the most recent `joined_at` — with
no way to tell a real, jointly-progressing pairing apart from an
accidental extra one. One agent had accumulated 8 separate open
memberships for the same goal; her *most recent* one happened to be a
stray solo mission opened AFTER she was already properly paired in an
earlier one.
Scope check: **22 agents** currently hold 2+ simultaneous open
memberships for the same goal (worst case: 10). Root enabler: accepting
a new invite never checked whether the invitee was already genuinely
paired elsewhere first.
Fix: `findMyMission()` now prefers a candidate where the agent is
genuinely PAIRED (someone else also `'joined'` there) over one where
they're alone — self-healing, no data repair needed.
`respondReconnectInvite` now refuses (`already_paired_elsewhere`) to
accept a new invite if already paired elsewhere for the same goal, so it
can't recur. Left the ~22 agents' stray extra rows in place — harmless
now that resolution can't be fooled by them, and they get swept up
automatically the next time that agent genuinely re-pairs (see below).
Commit: `7325001`.

**Lone mission-openers invisible to each other in the invite dropdown.**
Root cause: `getInviteCandidates`/`inviteReconnectMission` treated "has a
participant row in ANY open mission" as fully unavailable. But opening
your OWN mission (the mandatory first step before you can invite anyone)
makes you a participant of it too — so every agent who'd taken that step
became invisible to every other agent who'd done the same. After an
earlier matchmaking-removal reset knocked ~140 formerly-paired missions
down to one participant each, this was most of the active population.
Fix: `isSpokenFor()` — only treat someone as unavailable if they're
pending on someone else's invite, or already genuinely paired (not just
sitting alone in their own still-empty mission). Verified: one agent's
candidate list went from returning almost nobody to 51 real codenames.
Commit: `7f2921c`.

**Accepting an invite silently reset a solo opener's already-earned
contribution to zero.**
Follow-on bug from the fix above: folding away a dangling solo mission
(so it doesn't linger as clutter once its opener joins someone else)
deleted the old mission outright — but the NEW mission stamps a fresh
`joined_at = now()`, and contribution is calculated from `joined_at`
forward. Anyone who'd been streaming for days while sitting alone
waiting for a partner had that history zeroed the moment someone finally
invited them.
Fix: before deleting the dangling mission, capture its `joined_at` and
backdate the new mission's participant row to match (earliest one found,
if there were several). Verified live: an agent with 17 real accumulated
streams over "5 days" solo kept all 17 after accepting a different
invite, instead of resetting to 0.
Commit: `e06986a`.

**Completed mission "got reset" back to open — AGENT015 + AGENT030,
Haegeum's connect-2-agents goal.**
Follow-on gap in the very first fix above (`findMyCompletedMission` as a
fallback). That fallback only ever ran when `findMyMission` (open-only)
found NOTHING — but an agent could still hold a stray open membership
for the same goal from an old dangling mission (opened before a partner
showed up, never folded away because `foldAwayDanglingMissions` only
runs on the ACCEPTING side of a later invite, never for an agent who
goes on to open or get invited into a separate mission normally).
AGENT015 and AGENT030 had genuinely completed the goal together in one
mission — but each ALSO still had a leftover `'joined'` row in the SAME
old dangling mission from days earlier. Because both rows were in that
one mission, `findMyMission`'s "prefer paired" rule (see above) read it
as a real, active pairing and returned it before the completed-mission
fallback ever ran, making their finished goal look freshly reopened.
Scope check: **13 more agents** network-wide were in some version of
this same trap (a joined row in both a complete and an open mission for
the same goal) — mostly solo dangling missions from the same old
matchmaking-removal mess, not just paired ones.
Fix: `findMyCompletedMission` is now checked FIRST at every read/guard
call site, not as a fallback — once a goal is complete, nothing else
should ever be able to make it look open again. Also deleted 52
network-wide open missions that were provably dead (every joined
participant in each had already completed the same goal elsewhere),
freeing a few pending invitees stuck on invites that could never
resolve.
Commit: `d12638b`.

**"Can't invite anyone" — AGENT000, Hopesize Station. Not a bug.**
Only 4 agents had ever activated that district, already split into two
separate 2-person teams (each needing a 3rd for the 3-agent requirement).
Nobody was left over to invite; both teams were genuinely stuck until a
5th agent showed up. Explained the population math rather than "fixing"
anything — this is a real constraint of requiring 3 distinct agents on a
district very few people have tried yet, worth remembering for future
district design.

---

## Symptom: "My XP/Level doesn't match what I expect"

**Expired boost blocked further XP until real streams "caught up."**
Reported as "XP not increasing." Root cause: a day's XP was recomputed
from scratch every poll — `(day's total streams / perXp) * current
boost` — floored at the higher of old/new (an earlier fix, to stop a
boost's expiry from clawing back XP already earned). That stopped the
clawback but created a new problem: once a boost pushed the stored XP
ahead of what plain streaming would give, every REAL stream after the
boost expired had to out-earn that inflated number before the display
moved again.
Fix: track XP incrementally. Each award reads back `meta.counted` (the
counted-total as of the LAST award), takes the delta since then, and
ADDS that delta's XP at whatever multiplier applies right now — never
recomputes/replaces the whole day. Verified: 20 streams under a 2×
boost → 4 XP; boost expires, 20 more streams → 6 (4 locked in + 2 new),
where the old code would've stayed stuck at 4 until the day's raw total
passed 40.
Commit: `48b41ef`.

**Level 2 showing "57 XP needed" instead of 58 (and similar ±1 wobbles at
other levels).**
Root cause: pure floating-point representation error. `50 * 1.15` is
mathematically exactly `57.5`, but JS represents `1.15` slightly short,
so the raw product comes out `57.49999999999999` and `Math.round()`
rounds it DOWN. (Levels 6 and 7 round the *other* way, to 101/116
instead of 100/115, for the same reason.)
Fix: nudge by `1e-9` before rounding (`levelCost()` in leveling.ts) —
comfortably bigger than the actual ~1e-14 error, comfortably smaller than
any gap that should legitimately flip a real value's rounding.
Commit: `0b7fe37`.

**"My XP is 102 but I'm still Level 2" / leaderboard shows a different
number than the HUD. Not a bug — a labeling gap.**
Two different, both-correct stats: the HUD/progress-sheet number is
progress *within the current level* (resets each level); the leaderboard
number is *lifetime total* XP. Nothing distinguished them visually.
Fix: relabeled the leaderboard's unit from "XP" to "total XP".
Commit: `1144ea1`.

**Follow-up: "keep xp same value in level like in ranking page."**
The leaderboard relabel above fixed the leaderboard side but left the
Level detail sheet showing only the in-level number with no qualifier —
still reads as a mismatch the moment someone checks both screens, since
neither one used to say which kind of XP it meant.
Fix: added a second line to the Level sheet showing the SAME lifetime
total (`state.player.xp` — already computed and sent to the client,
just never displayed there) with the SAME "total XP" wording the
Ranking board uses, right under the in-level progress bar. Both numbers
now visible together, each clearly labeled, instead of picking one.
Commit: `9b7111d`.

---

## Symptom: UI doesn't do what it visually promises

**Candy Star Custom builder: a clearly-valid "2 songs + 1 album" combo
rejected as invalid — specifically for "HOPE ON THE STREET VOL.1."**
Root cause: the album checkbox embeds its whole tracklist as JSON inside
a **single-quoted** HTML attribute (`value='...'`). The escaping function
used there (`esc`/`sanitize`) escapes `< > & "` but not a literal
apostrophe — safe for the double-quoted attributes used everywhere else
in the codebase, but not this one. That album has a track called
*"i don't know (with HUH YUNJIN of LE SSERAFIM)"* — the apostrophe closed
the attribute early, corrupting everything after it in the tag. Reading
it back either failed to parse (silently swallowed by a `try/catch`) or
returned a truncated array, so the album's real tracklist never fully
matched → silently contributed 0 albums to the combo count instead of 1.
This was the THIRD pass at this exact combo-check area (see git history:
"Fix getAlpacaOptions dropping album id", "Fix Candy Star combo check
flagging valid album picks as invalid") — this specific edge case only
shows up for an album with an apostrophe in a track title, which is why
it survived both earlier fixes.
Diagnosis method: reproduced the exact same request against the live
backend with a manually-clean trackKeys array (succeeded), which proved
the bug was in what the CLIENT sent, not the server's matching logic —
then inspected the live DOM's checkbox `value` attribute directly.
Fix: single quotes → double quotes on that one attribute.
Commit: `5a509e5`.

---

## General lessons for next time

- **"Not counting" has (at least) four unrelated root causes** — data
  doesn't exist, key doesn't normalize the same, artist gets filtered,
  baseline is wrong. Check in that order; don't assume it's the same bug
  as last time.
- **Prefer fixing the query/resolution logic over patching data** when a
  bug is structural (wrong mission resolved, wrong baseline). A data
  patch fixes one agent; a logic fix self-heals everyone and can't be
  gotten subtly wrong the way a hand-typed baseline number can (see the
  Neuron incident — a repair created a NEW bug).
- **Every fix here that touched live data was verified against a live
  reproduction first** — either the real deployed backend via curl +
  minted test-account session tokens (AGENT001, codename "test" — always
  fully cleaned up afterward: delete test rows, clear session_token), or
  by replicating the exact production algorithm in a throwaway Node
  script against real (read-only) query results. Never fix-and-hope on
  this kind of bug; the math is almost always subtler than it first
  looks.
- **`rc_config` values (`bts_artists`, `track_artist_overrides`,
  `level_curve`, `level_rewards`, `era_timeline`) are live and
  redeploy-free** — check these first for anything that looks like a
  tunable number before assuming a code change is needed.
- **Frozen goals never retroactively change.** An admin content edit
  only affects agents who activate *after* it ships. An agent already
  active with stale frozen goals needs a direct, careful data repair
  (see the baseline lesson above for how NOT to do that repair).
- **A "check X, fall back to Y" pattern is only as safe as X's blast
  radius.** The reconnect-mission fix history above is really the same
  gap discovered twice: first "no fallback to a completed mission at
  all," then "the fallback never runs because the open-only lookup found
  *something*, even if it's the wrong something." When a fallback exists
  because one state should always beat another (complete beats open,
  here), check the higher-priority state FIRST — don't wire it in as a
  last resort for when the primary lookup finds literally nothing.
- **When auditing title-normalization mismatches network-wide, compare
  keys with whitespace stripped, not word-overlap.** Word-overlap
  (Jaccard on the space-split tokens) sounds like the right tool but
  actually punishes the exact bug being hunted — "pt2" (merged) vs. "pt
  2" (split) share only 3 of their ~5 "words" — while over-matching
  genuinely different songs that share one real word ("Like" vs "Like
  Animals"). Stripping whitespace and checking for exact equality is
  the precise test for "same song, comma/period spacing disagreement"
  and produced zero false positives across the whole `ERA_CATALOG` (see
  the Bulletproof Pt.2 incident above) where the looser pass had ~70.
- **The `testarirang` repo (github.com/hbot7875-gif/testarirang) is a
  working reference for anything carried forward from Arirang Mission**
  (Signal Sweep, the 148 Protocol, era/album tracking) — when a ported
  feature's counting logic looks stricter or different from a sibling
  file in this codebase, diff it against the reference's equivalent
  function before assuming the stricter version is intentional.
