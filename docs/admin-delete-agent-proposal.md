# Proposal B — replace `adminDeleteAgent`'s manual list with `rc_purge_agent_data`

**PROPOSAL ONLY. Nothing in this document is implemented.** It is deliberately
kept separate from the mission-preservation fix (A), which changes one statement
in one SQL function and can ship on its own.

## Why this exists

`lib/admin-agent.ts:298` maintains its own list of tables to clear when an agent
is deleted. Its own docstring says the point is *"exactly one place that knows
how to fully remove an agent, not two that can drift apart."*

There are now two, and they have drifted. `rc_purge_agent_data` was added later
(Stage 2A, `20260928060000`) and is what voluntary retirement and the daily
inactivity cron both call. `adminDeleteAgent` is still wired at `index.ts:266`
and still runs its own list.

## Exact behavioural differences

Measured from the two sources, not from memory.

### 1. Ten tables the admin path never cleans

```
rc_defuse_messages                 rc_recelebrate_passes
rc_engagement_events               rc_recelebrate_presence
rc_feed_events                     rc_reconnect_messages
rc_recelebrate_after_party_claims  rc_share_snapshots
rc_recelebrate_battle_streams      rc_suggestions
```

None of these has an FK cascade from `rc_agents`, so after an admin delete the
rows simply remain, keyed to an agent number that no longer exists. For a test
account that is untidy. For a real person it means their feed history,
engagement events, chat messages and suggestions survive a deletion that told
them everything was removed.

### 2. Two tables the admin path *destroys* that the canonical path preserves

| Table | `rc_purge_agent_data` | `adminDeleteAgent` |
|---|---|---|
| `generated_playlists` | `set agent_no = null` — the playlist stays, the author link goes | **`DELETE`** — the playlist is destroyed |
| `rc_reconnect_missions` | `set created_by = '__deleted__'` (after fix A) | **`DELETE`** — cascades to every participant row and message |

The second is the same cross-agent bug fix A addresses, still live on this path.
The first is new: community playlists other players may have saved are deleted
outright.

### 3. Proof files are never queued

`rc_purge_agent_data` calls `rc_queue_agent_proof_files(r.agent_no)` **before**
deleting the vote rows, because once `rc_vma_votes` is gone the storage paths are
unrecoverable. `adminDeleteAgent` contains no reference to it.

An admin delete therefore leaves that agent's VMA proof screenshots in Storage
permanently, outside `rc_storage_deletion_queue` and outside any retention
sweep. There is no later process that can find them — the only record of their
paths was in the rows just deleted. This is how orphaned files are created, and
it is almost certainly part of the 92-orphan backlog.

### 4. `rc_badge_art.uploaded_by` is left dangling

The canonical path nulls it, keeping the artwork for the badges other agents
wear. The admin path does not touch `rc_badge_art` at all, so `uploaded_by`
keeps pointing at a deleted agent number.

### 5. Not transactional

`rc_purge_agent_data` is a PL/pgSQL function: one transaction, all-or-nothing,
and it takes `for update of a` on the agent row so two purges cannot interleave.

`adminDeleteAgent` issues each delete as a separate PostgREST call in a `for`
loop and returns `delete_failed:<table>:<message>` on the first error. Each call
is its own transaction, so a failure part-way leaves the agent **partially
deleted** — some data gone, the `rc_agents` row still present, and the
`rc_deleted_agent_log` entry already written. That is exactly the failure mode
the comment at `admin-agent.ts:325` records happening twice before
(`rc_vma_votes`, then `rc_backup_requests`).

### 6. Authorization — unchanged by this proposal

| | |
|---|---|
| `adminDeleteAgent` | `auth: 'admin'` → `isAdminAuthorized(params)` at `index.ts:351` |
| `retireAccount` | the player's own session |
| `rc_delete_inactive_agents_scheduled` | pg_cron, `SECURITY DEFINER` |

`rc_purge_agent_data` is `SECURITY DEFINER` and does no authorization of its own
— it trusts its caller, as it already does for the other two paths. Calling it
from `adminDeleteAgent` keeps the existing admin check exactly where it is. **No
authorization change is proposed.**

### 7. Deletion log — near-identical, one difference

Both insert into `rc_deleted_agent_log` before deleting, with the same columns
and the same codename lookup from `rc_players`. The reason string differs:
`params.reason || 'manual_admin'` (TS) versus the `p_reason` argument (SQL).
Passing the TS value straight through preserves current behaviour.

There is one duplicate-logging risk to handle: `adminDeleteAgent` writes the log
row itself, and `rc_purge_agent_data` writes one too. The replacement must drop
the TS insert, or the admin path would log every deletion twice.

## Proposed change

Replace the body of `adminDeleteAgent` between the `agent_not_found` check and
the return with a single RPC call:

```ts
  const { data: purged, error } = await supabase
    .rpc('rc_purge_agent_data', { p_agent_no: agentNo, p_reason: params.reason || 'manual_admin' })
  if (error) return { success: false, error: `purge_failed:${error.message}` }
  if (!purged) return { success: false, error: 'agent_not_found' }
  return { success: true, deleted: { agentNo, handle: agent.handle } }
```

Deleted along with it: the 23-entry `deletes` array, the two `update … null`
calls, the `rc_agents` delete, and the `rc_deleted_agent_log` insert (which
moves into the function). The `/^AGENT\d{3,}$/` guard and the admin auth check
stay exactly as they are.

`adminDeleteInactiveAgents` loops `adminDeleteAgent`, so it inherits the fix
with no change of its own.

## What this changes for the operator

- An admin delete becomes atomic instead of resumable-by-hand
- It starts queueing proof files, so admin deletions stop creating orphans
- It stops destroying `generated_playlists` and ReConnect missions
- Ten more tables actually get cleared
- Error strings change from `delete_failed:<table>:<msg>` to `purge_failed:<msg>`,
  which loses the per-table detail. The function raises with the failing
  statement's own message, so the information is still in the error, just not in
  the prefix — worth confirming that is acceptable before implementing

## What needs deciding before implementation

1. **Fix A should land first.** Otherwise this path starts calling a function
   that still deletes missions, and the cross-agent bug simply moves.
2. **The error-string change** above is user-visible in the admin UI.
3. **Should the fallback stay?** `settings.ts` falls back to deactivation when
   the RPC is missing. `adminDeleteAgent` has no equivalent; a missing RPC would
   just fail. That is arguably correct for an admin action, but it is a choice.

Not implemented. No files changed by this proposal.
