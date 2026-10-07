# Manually compacting memory.sqlite online

## User commands and behavior

Upgrade Octop and octop-memory to 0.9.11 or later, and restart Octop once to load the control entry point. After that, no restart is needed for further compaction:

```bash
octop memory list             # only list compactable agent names and IDs; no maintenance triggered
octop memory slim             # use the configured default agent; pick by number if there is no default
octop memory slim --agent ID  # specify directly when the ID is known
octop memory slim --all       # compact every eligible agent in the list, one after another
```

You do not need to remember agent names or IDs; when there is no default agent, the command lists running agents that use a compatible SQLite memory store, and you just enter a number. When names collide, use the ID shown alongside them to disambiguate; Ctrl+C exits the selection without triggering compaction.
If you have chosen a default agent with `octop agent use`, that choice is reused and the target ID is printed before execution.
The local source tree can also run from the octop-memory directory:

```bash
./scripts/memory-slim --online       # also supports default agent or numbered selection
./scripts/memory-slim --online ID    # specify an ID
./scripts/memory-slim --online --all # compact every eligible agent in order
```

`--all` fetches the `memory list` candidate set once at startup. Its scope is all running agents, belonging to any user under the current OCTOP_HOME, that use a compatible SQLite memory store; it does not start stopped agents and does not scan offline stores in other directories.
It ignores the saved default agent, but cannot be combined with an explicit `--agent` (including the root-command argument) or `OCTOP_AGENT`.
The terminal shows `[1/3] name [ID]` plus that agent's phase, elapsed time, and scan count; each one finishes and resumes before the next begins.
Each store is backed up separately, and its before/after sizes are shown separately. On failure or a dropped connection the batch stops immediately, reports how many completed and how many were not run, and does not retry automatically. Closing the terminal still lets the host finish the job already started; subsequent items that were not yet submitted will not run.
`octop --json memory slim --all` progress carries `agent_id`, `index`, and `total_agents`, and the batch's final state is `batch_done` or `batch_failed`. `memory list` can be used to preview the scope in advance; it does not itself perform compaction.

The terminal commands above trigger maintenance directly — they are not a preview. They connect to the same running OCTOP_HOME instance and do not start a second copy of Octop;
no database path is specified, and the service uses the SQLite file that agent actually opened.
The original `octop-memory db slim FILE` / `scripts/memory-slim FILE` remain the offline preview entry points.

The terminal and chat page show: waiting for the current task to finish → backup → deduplicate historical context → compact → resume.
While waiting, the current conversation is not forcibly interrupted; if no idle window is found within 120 seconds the command fails and exits without migrating.
Once maintenance begins, new stream/call/HITL resumes wait on the existing invocation gate; the page polls status every two seconds, shows elapsed time, and pauses sending. The terminal refreshes the current phase and elapsed time every second, and during deduplication shows scanned/total rows;
when output goes to a file or pipe, a line is appended immediately whenever the phase or scan count changes, and a heartbeat line is appended every five seconds otherwise, for easy log inspection.
Backup/VACUUM does not provide fake percentages or remaining time; an increase in elapsed time only means the service connection is still responding, not that a proportion has completed.
The memory panel's RPC returns `AGENT_BUSY` during maintenance, to avoid a synchronous SQLite lock wait blocking status polling; it can be retried afterward.
The gate is released on success or failure, and the send button recovers. Agents with other independent databases remain usable.

Backups live next to the original file, named `memory.sqlite.before-slim.<randomID>.bak`, and are never deleted or overwritten automatically.
When the command finishes it shows the main file's size change and the backup path; `octop --json memory slim --agent main` emits line-by-line JSON progress.
JSON progress includes `elapsed_seconds`. `octop --json memory list` returns the selectable list; in JSON mode, when there is no default agent and `--agent` was not specified, it prints the list and then exits with a non-zero status, without auto-selecting or waiting for interaction.
Closing the terminal does not cancel a database job that has already started. If the service connection drops, check the page/log status before retrying,
and do not restore an old backup over data written in the meantime.

## PostgreSQL notes and maintenance boundaries

A single PostgreSQL agent returns its own message: PG may also contain duplicate data or bloat, but this command does not yet support PG compaction — only SQLite; no compaction was performed this time, and you can keep chatting. The empty-candidate message likewise explains the SQLite scope and that PG is not yet wired up, to avoid mistaking "the command is unsupported" for "the database needs no maintenance." English and Chinese are kept in sync.

The underlying octop-memory already has normal PG VACUUM / VACUUM FULL operational capability, but that is not the backend of the current conversational command.
A normal VACUUM mainly reclaims space for reuse inside the database; FULL rewrites the table and blocks reads and writes. The PG checkpoint table may be shared by multiple agents/users within the same database, so FULL cannot be invoked by pausing only the current agent. Going forward it would be better to first provide a read-only diagnostic that does not block chat,
and then offer administrator maintenance operations based on the actual benefit and sharing scope. This round only performs read-only evaluation and message fixes; PG compaction was not enabled.

2026-09-18 wording regression: memory/slash memory/i18n 117 passed, 2 deselected; Ruff/format and strict mypy 499 files passed. The running Octop was not restarted; the new messages take effect only after the updated code is loaded.

## Implementation and consistency boundaries

### Triggering from a conversation

The web chat box of a logged-in Octop instance, or the local CLI conversation, supports the following commands without needing to know the agent name:

```text
/memory slim                       view the effect, impact, and current agent target
/memory slim --all                 view all of one's own online candidates and the batch impact
/memory slim --confirm             confirm compacting the current agent now
/memory slim --all --confirm       confirm compacting all of one's own online candidates one by one now
/memory status                     view the phase, elapsed time, scanned rows, and result of the most recent compaction
```

These are registered slash commands and are not executed through model judgment; `/memory` or a wrong argument just returns usage.
Without `--confirm` they only show the purpose, history retention, extra backup space, send pausing, and the note that the duration cannot be estimated, plus
the candidate names/IDs and the confirmation command; they do not create a maintenance task, backup, or reservation, and do not affect chat. This is an operational description and scope preview,
which neither scans checkpoints nor computes the expected savings. On confirmed execution the currently eligible candidates are recomputed and permissions are re-verified.
With `--confirm` the command returns an acceptance receipt immediately; the host holds the background job, and the web page reuses the maintenance notice and the send pause/resume logic.
The conversational `--all` has a different scope from the local admin CLI: it selects only the current user's own agents, and does not include other users' or shared agents.
A single host allows only one maintenance task at a time, and the whole conversational batch is also mutually exclusive; ownership is re-verified before the task runs and when status is read.
Each candidate is backed up separately and processed in order; on failure the batch stops and the remaining items are marked as not run. Closing the page does not cancel an accepted background batch;
shutting down the service waits for the running SQLite job to finish and does not start further candidates. Status lives only in memory, and a new task replaces the old status.
While the current chat input is paused during maintenance you can see the page notice, and after it resumes use `/memory status` to see the result.
The maintenance notice explicitly covers all of that agent's sessions, and you can switch to another agent that is not under maintenance. After 60 seconds it adds the large-store/disk
duration note; there is no fake remaining time. On a polling failure it marks the current status as possibly stale and keeps retrying, and does not treat the failure as send-resumed.
The API keeps the manual-maintenance done/failed/skipped terminal states (`kind=memory_slim`), and the page clearly shows resumed-in-use or not-run,
stops the spinner and timer, and lets the user click "Got it" to dismiss the result notice; the next maintenance shows the notice again.

IM is not yet opened up: the existing IM `user_id` is the agent owner used for session storage, not a verifiable maintenance identity of the sender.
An IM channel entering `/memory` will prompt you to use the web page or local CLI and will not start maintenance; ordinary chat and model replies do not trigger it.
The web command catalog and `/help` automatically show new commands, with no extra frontend hardcoding required.

The command catalog declares via `persist_checkpoint=False` that a maintenance receipt is saved only to the chat display record and is not written into the LangGraph checkpointer being compacted, so the receipt does not wait on a SQLite lock.
Control-plane history projections that are already ready still save the command and reply; sessions whose history migration is not yet complete only guarantee that the current receipt is visible, and it may not be retained after a refresh.
This neither deletes existing history nor changes the capture/recall flow of ordinary chat. Failure details are written to the service log, and chat only reports the failure;
a completed result shows the backup file name, while the full backup path can still be viewed from the local CLI.

### Coordination and storage

- A machine-local loopback channel from `cli/commands/memory.py` → `infra/agents/memory_slim_control.py`.
  The control port is random and binds only to 127.0.0.1; `OCTOP_HOME/memory-slim-control.json` contains a private token,
  published atomically via a temporary file with mode 0600 (on Windows it relies on the user-directory ACL). The permission semantics follow the local CLI's filesystem trust.
  No unauthenticated remote HTTP admin entry point is provided. The file is removed on normal exit, and an old token cannot invoke a new process.
- `launch.py` starts/stops the control listener; `AgentManager.memory_slim` holds the task coordinator, and Manager shutdown waits for maintenance to finish before closing the Agent.
  After the listener is closed no new job is accepted, and service shutdown waits for the running SQLite worker to finish before shutting down the runtime.
- The conversation reuses the existing `SlashCtx.agent_manager`, with `handlers/memory.py` calling its `memory_slim` →
  `MemorySlimCoordinator.start_chat/chat_status`; batches reuse the same `_run`, idle reservation, and SQLite worker.
  The backend catalog serves both `/help` and the web command menu; no new remote admin HTTP endpoint is added.
- `MemorySlimCoordinator` reuses the idle reservation of `AgentManager.try_begin_history_backfill/end_history_backfill`,
  which is mutually exclusive with the existing history backfill; they already cover stream/call/resume admission.
  A single host compacts only one store at a time. There is no automatic threshold trigger and no periodic full compaction.
- It accepts only SQLite agents that are running and have a `CompactSqliteSaver` and an independent-connection decoder.
  The accompanying octop-memory must provide `application.checkpoint_maintenance.slim_live_checkpoints`;
  a version mismatch, disabled memory, PostgreSQL, or a non-running agent all fail before any rewrite.
- The online store uses WAL. Each migration batch runs `BEGIN IMMEDIATE` before reading/altering rows, to avoid overwriting concurrent writes with old values.
  This round scans a fixed upper bound on rowid and does not endlessly chase newly added rows. Content and references are committed in the same transaction; history IDs, metadata,
  parent, writes, and business memory are not deleted. The online path performs no history trimming, reverse expansion, or orphan-blob GC.
- Compatible read connections/caches are retained, so existing SQLite read snapshots keep reading consistent content; background capture/extraction writes are serialized
  by the SQLite write lock, rather than manufacturing "idleness" by closing connections or skipping capture. A full backup and verification are performed before any rewrite.
- VACUUM may wait for other transactions. While a long read transaction still holds WAL, it reports "deduplication complete but space reclaim incomplete";
  it releases the chat reservation and keeps the readable mixed format and the backup, without falsely reporting full compaction complete or auto-rolling back.
- This mode targets one running Octop-managed store. It cannot upgrade an independently running old reader, and cannot guarantee compatibility when other processes
  use an old-format reader or a custom store-writing script; they must be upgraded in unison before deployment. Other writes sharing the same store are still affected by the SQLite lock.

## Verification

2026-09-18 non-compactable-reason diagnostic fix: a single agent's preview first verifies ownership, then diagnoses the runtime, clearly distinguishing
not running, memory not enabled, a non-SQLite backend (e.g. PostgreSQL), and a missing accompanying online-compaction interface.
It fixes the misleading "no candidates" message shown when an already-running PostgreSQL agent was filtered out; the candidate list also checks the
`slim_live_checkpoints` capability, to avoid an old install package being misreported as online-compactable. No backend was switched automatically and no runtime was updated.
Targeted memory/slash memory/i18n regression: 117 passed, 2 deselected (existing socket cases excluded this round);
strict mypy 499 files, Ruff/format passed. Here only the PostgreSQL rejection message is verified; no new PG compaction capability was added.

2026-09-18 confirmation and maintenance-notice rework: the two repos checked out `feature/memory-slim-tool` from their respective current HEAD, keeping
all uncommitted changes. Octop's original branch was `feature/octop-harness-bump`, and octop-memory's original branch was `main`.

- The above conversation/maintenance regression plus `tests/integration/test_memory_api.py`: 201 passed, covering preview with no task/no rewrite,
  execution after confirmation, permissions, and interface terminal states; `uv run --no-sync mypy --strict src/octop`: 499 files passed.
- `npm test -- src/pages/Chat/hooks/useMemoryMaintenance.test.ts src/pages/Chat/components/MemoryMaintenanceBanner.test.tsx`:
  9 passed, covering the long-duration explanation, reconnect retries, send resumption after completion/failure, and a dismissible result; `npm run build` passed.
- This round does not change the in-store migration implementation and does not repeat the full gate; the prior full-gate environment limits are below. Nothing was committed, deployed, or run against a real store.

2026-09-18 conversational entry point supplement:

```bash
PYTHONPATH=../octop-memory/src:src uv run --no-sync pytest tests/unit/agents/test_memory_slim.py tests/unit/gateway/test_slash*.py tests/unit/gateway/test_message_keys.py tests/unit/gateway/test_gateway.py tests/unit/history/test_projection.py tests/unit/i18n -q
```

178 passed, covering conversational triggering against a real temporary SQLite, history retention, user isolation, batch serialization/mutual exclusion, ownership changes,
failure and shutdown stopping subsequent items, prohibition of IM owner fallback authorization, disabled users, progress/result, gateway injection, and
maintenance receipts not touching the checkpointer. strict mypy 499 files, Ruff/format passed.
Then a check for "owner changes while waiting for an active conversation to end" was added: the owner is re-verified after acquiring the maintenance reservation, and 6 chat
coordinator cases passed on a targeted rerun (including the added case), with strict mypy passing again; no backup is created and no store is rewritten when authorization is not granted.
No frontend source files or in-store storage implementation were changed; the full gate was not repeated, and its existing environment limits are below. Nothing was deployed, restarted, or compacted against a real store.

Temporary databases verify reader snapshots, concurrent replacement/addition between batches, migration failures, backup readability, and history retention.
Coordinator tests cover waiting for an active call, new calls waiting during maintenance, release on success/failure, waiting for the worker to finish on cancellation,
machine-local control authentication/progress, and CLI Chinese output. Frontend tests cover each blocking phase and send resumption after success/failure.

```bash
# Run from the Octop repository, loading the accompanying octop-memory source.
PYTHONPATH=../octop-memory/src:src uv run --no-sync pytest tests/unit/agents/test_memory_slim.py tests/unit/i18n -q
cd dashboard
npm test -- src/pages/Chat/hooks/useMemoryMaintenance.test.ts
npm run build
```

This round only tested against temporary stores; no running production process was updated and no real user store was compacted.

2026-09-18 selection and continuous-progress supplement verification: coordinator/CLI/control channel/i18n 81 passed in total, covering numbered selection,
re-entering an invalid number, duplicate-name identification, empty lists, read-only discovery, JSON forbidding auto-selection, and continuing to send elapsed-time heartbeats
when there is no state change during the backup phase. strict mypy 498 files passed; the local script's `--online --help` and a shell syntax check passed.
This round did not change storage migration/frontend code and did not repeat the full test suite; the existing environment limits of the full gate are below.

2026-09-18 `--all` supplement verification: the targeted tests above were updated to 88 passed, adding serial execution, the default item not interfering,
batch and per-item progress, human-readable/JSON output, failure/disconnect stopping, argument conflicts, and empty-list coverage.
strict mypy 498 files, Ruff/format, and the wrapper's `--online --all --help` passed. No real store compaction was performed.

2026-09-18 verification results:

- octop-memory checkpoint compaction: 37 passed (including a long reader and concurrent writes).
- Octop coordinator/machine-local control/CLI/memory panel protection + original memory API integration + i18n: 90 passed.
  The machine-local socket test only passed after allowing just this temporary test (the default sandbox does not permit bind); no real user store was used.
- Broader agent manager, startup, and CLI registry regression: 153 passed, 1 skipped; the only initial failure was the
  socket bind permission above, which passed in the subsequently allowed test.
- Ruff/format and strict mypy (Octop 498 files, octop-memory 107 files) passed;
  the frontend's 2 phase-resumption tests, TypeScript compilation, and the production build passed.
- Neither repo's full gate was fully green: octop-memory's 24 existing tests failed accessing a non-writable default user directory;
  Octop's full run hit a PermissionError when the old captcha test bound a port, so the full run was aborted after confirming the environmental cause,
  and re-running that file located it as 2 passed / 1 error. The aborted results and the PostgreSQL skip were not counted as passes.
- Multi-GiB stores, full production IM end-to-end, and long-term disk growth were not tested; this round did not commit, deploy, or restart a real Octop.

## 2026-09-20 pre-commit verification and dependency convergence

- The maintenance target is held by `AgentManager.memory_slim`, and shutdown waits for maintenance to finish before closing the Agent;
  Gateway, SlashCtx, and OctopServer no longer add dedicated pass-through fields. The CLI control entry point obtains the current runtime per request,
  and supports loading the AgentManager after the first configuration is complete.
- `/memory` declares `persist_checkpoint=False` in the catalog; the processor reads the save policy uniformly,
  and ordinary commands and aliases keep writing to the checkpoint and the ready chat display record.
- `UV_CACHE_DIR=/tmp/octop-uv-cache PYTHONPATH=../octop-memory/src:src make all RUN='uv run --no-sync' PYTEST_JOBS=4`:
  3361 passed, 18 skipped; Ruff/format and mypy (499 source files) passed.
- `cd dashboard && npm test -- src/pages/Chat/components/MemoryMaintenanceBanner.test.tsx src/pages/Chat/hooks/useMemoryMaintenance.test.ts`:
  9 passed. The commit hook also runs a change-aware check and `npm run build` (including `tsc -b`).
- No real memory-store compaction or PostgreSQL maintenance was performed; the online capability remains explicitly limited to compatible SQLite.
