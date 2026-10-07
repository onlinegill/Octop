# Segmented History Archiving: Enabling, Verifying, and Rollback

This release adds optional history storage. It does not run history data migration and does not clean up checkpoints. Off by default.

## How data is stored

Take an old conversation that has already had 100 turns:

```text
Turns 1–100       After the switch is on, turns 101–110   After the switch is off, from turn 111
existing records  history_v2.sqlite                        existing message/trajectory tables
     └──────────────────┬──────────────────────────┘
                 compatible read interface, paginated and displayed by segment
```

The switchover happens on whole-turn boundaries. A turn waiting for user approval keeps the format it started with; the format is not re-selected when it resumes.
For an old prefix, only the boundary is registered in the new archive — the body is not copied: conversations that already have a `thread_messages` projection fix their last sequence number;
conversations whose projection is not yet complete fix the checkpoint configuration at that time, and the state is restored on read through the graph's state-restoration interface.
Compatible mode does not automatically repair old projections, and it disables the bulk backfill entry point. Therefore pre-existing gaps in old data are not automatically filled by this release.

v2 turns no longer append to the old `thread_messages` and `trajectory_events`.
In the new files, `documents` stores the message structure or trajectory structure, and `bodies` stores bodies shared by content hash —
visible thinking, tool arguments, and results. Identical large fields can be referenced by both views; this is not storing two complete copies of a chat in two new databases.
Different forms of content (for example, a tool-result object and its formatted text) may still be stored separately; semantic deduplication is not promised.

Checkpoints, raw Memory records, and session JSONL still follow existing behavior.
This release does not treat "the whole project's history is now a single copy" as a goal, nor does it immediately shrink existing SQLite files.

## Checkpoint read compatibility

When segmented archiving is off, old-projection backfill can still read checkpoints. SQLite backfill uses a separate read-only connection, transaction, and content cache;
if octop-memory uses the shared-body format, you must install both the octop-memory that provides `CheckpointSerializer.with_connection` and this Octop read fix. The original inline format remains readable.
PostgreSQL does not enter the SQLite read path; it continues to restore messages through the graph. This does not change the SQLite-only limitation of segmented archiving described below.

## Enabling

Scope: the SQLite primary database, a single Octop service process. Enabling this feature on PostgreSQL is explicitly refused at startup.
Going live requires both this Octop change and the octop-harness streaming protocol change; the latter provides model message IDs and origin correlation.
Editing the source locally does not automatically upgrade the octop-harness already installed in the virtual environment.

1. Stop new requests first and wait for running tasks to finish. Keep the current application version and a full backup of the data directory.
2. Install a compatible version containing the changes above onto a copy of the test data.
3. Add `"history_v2_enabled": true` to the existing `config.json`, or set
   `OCTOP_HISTORY_V2_ENABLED=true`, then restart. The default is false.
4. The new file lives under the Octop data root as `history_v2.sqlite`, with a
   `history_v2.required` marker beside it. Do not delete or move either one separately.
5. Keep chatting in an old conversation, refresh, and page back past the switchover boundary; then test tool calls, visible thinking,
   HITL pause/resume, and process interruption. Confirm that new turns are not written to the old message/trajectory tables.

The new archive uses SQLite transactions, foreign keys, WAL, and FULL synchronization. Each save updates document and body references in the same transaction;
when updating a streaming message, it releases only the new bodies that were replaced by that document and are no longer referenced elsewhere, without cleaning up historical turns or old-database data.

In new-format turns, every body, thinking, tool argument/result, or message-state event that needs to be retained waits for the database transaction to commit before being forwarded to the Dashboard / IM;
there is no longer a 200ms rate limit or a wait for the next event. Repeated events with no content change reuse the already-committed record.
On a write failure, it stops forwarding that content and reports an error; the turn cannot be marked as successfully archived. When a request is cancelled, it waits for writes already handed to the executor to finish,
then releases the turn, so that recovery or the next round does not begin before background writes have completed.

Each save commits only the changed messages, without iterating over and updating the whole turn. Text longer than 1024 Unicode characters is chunked at fixed boundaries,
inserting only new or changed body chunks and references; already-committed prefix chunks can be reused. The message structure and its chunk reference list still need updating,
so this does not mean the per-token database cost is only a few bytes. Per-event commit also increases the number of transactions and first-render latency —
reliability comes first; no new raw event log or second full message copy is added. The old single-body encoding remains readable; no bulk re-encoding or schema change is performed.

If the process exits before the commit, content not yet committed is not sent to the frontend by this path; if it exits after the commit but before sending,
content may appear as "already in history but not yet received by the frontend" — a refresh will read it. This guarantee presumes that SQLite and the underlying storage correctly honor persistence semantics,
and does not cover events the upstream never handed to the collector or storage-device corruption.
After a restart, accepting requests again preserves the previous turn and marks unfinished activity records as interrupted.

## Read failures and integrity

When a history request fails, the Dashboard shows the error and a retry entry point, preserving the currently displayed messages and pagination position.
A missing file, a mismatched database identity, a lost body reference, or an undecodable old record all raise errors and cannot be treated as an empty history.

Turn states include active, paused, complete, partial, failed, interrupted.
A missing tool result, a message decode failure, uncorrelatable multi-origin output, or a trajectory write failure cannot be recorded as complete.
complete only means that this collector passed the current turn's checks; it does not prove that an old conversation is intact, nor that the upstream did not drop events.

Authorized users can call `GET /api/agents/{agent_id}/threads/{thread_id}/history/export`
to download the message JSON (without UI formatting) and the latest archived turn state. The actual prefix is subject to the service's mounted settings.
This export helps distinguish "the record is still there but the UI isn't showing it" from a read failure; it does not replace a full database backup — a corrupted body will still make the export fail.

History pagination returns `next_cursor`. Clients should use it verbatim for the next page, not substitute an offset that changes with the number of new messages.
A fork takes the selected prefix from the compatible read result; the original conversation is neither backfilled nor rewritten.

## How to roll back

1. Wait for the current turn to complete, or first finish its HITL resume.
2. Set the switch to false and restart **this compatible version**.
3. The next turn reverts to the old message/trajectory format. Already-written v2 content continues to be displayed by the compatible read interface.
4. Turning the switch back on creates a new v2 segment; there is no need to migrate the intervening old-format content.

You cannot roll directly back to an old build that knows nothing about v2: it cannot display the new archive.
Turning the switch off is not the same as uninstalling the reader; you cannot roll back by deleting the new file.
If the new file is unreadable, first restore the file or fix the read problem — do not automatically "roll back" the new history to blanks in the old database.

## Backup and restore boundaries

A system backup that includes chat now carries an additional SQLite-consistent snapshot of the new archive plus the marker file.
A backup that excludes chat does not include that file. The new archive is snapshotted before the primary database, reducing the risk of a new thread referencing a missing body;
multiple databases are not a single atomic transaction, so a live backup does not guarantee that all files are at the same instant.

This release explicitly blocks existing online restore entry points and runtime database swaps involving v2 data, to prevent a restore of only the primary database causing a mismatch.
Automatic coordinated restore across the v2 multi-database set is not yet implemented; when a restore is needed, use a full data-directory backup taken while stopped:
stop the service, copy the current whole directory aside, restore the primary database, new archive and marker, agent checkpoint/workspace, and configuration from the same backup at their original paths, then start with the compatible version to check.
Do not arbitrarily splice a primary database and a new archive from different points in time. The new archive records the absolute path identity of the primary database;
restoring across machines or to a different path requires a future explicit identity-rebinding tool — this release does not automatically rewrite identity.

Until the read/write, pause/resume, rollback, and stopped-restore drills above pass, do not enable any checkpoint retention policy.
