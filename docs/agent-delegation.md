# Agent Background Collaboration (harness teams + Octop delivery)

> For **synchronous peer calls** (`@` Agent, `ask_agent` sync) see [agent-call-agent.md](./agent-call-agent.md).  
> For the architecture, see [agent-interop-mailbox.md](./agent-interop-mailbox.md).

## Behavior

1. The main Agent calls **`ask_agent` (`mode=background`)**; the harness `TeamManager` enqueues the task and immediately returns a `job_id`.
2. The main conversation continues; the inbox worker runs serially: `target.call` → compose prompt → `source.call` (landing on the parent `thread_id`).
3. On completion, **`GlobalProcessor.on_reply`**: the Dashboard only does `increment_unread` (the reply is already in the checkpoint); IM channels call `Gateway.push_text`.

## Tools

| `ask_agent` mode | Behavior |
|------------------|----------|
| `sync` (default) | Block and wait for the sub-Agent's one-shot `call` result |
| `background` | Enter the harness inbox; notify proactively on completion |

Optional `user_question`: written into the inbox message, for `compose_followup` to use.

## Code retained on the Octop side

| Path | Responsibility |
|------|----------------|
| `infra/gateway/processor.py` | `GlobalProcessor` implements `TeamProcessor` (`compose_followup` / `on_reply`) |
| `infra/agents/manager.py` | Registers `team_tools()`; thin wrapper around `apply_mentions` |

**Removed**: the `agent_delegations` table, `DelegationRepo`, and the `/delegate` slash command (state is now managed by the harness inbox in-memory queue).

## What else is needed for async scenarios?

The loop is already usable. Optional enhancements (non-blocking):

- Frontend: while the user stays on the current thread, proactively `loadHistory` beyond the unread badge (or notify via SSE/WS).
- harness: expose inbox `cancel(job_id)` to a slash command or admin API (needed to cancel long-running tasks).
- In-flight tasks are lost after a restart (the inbox is purely in-memory) — if a persistent queue is needed, extend it at the harness layer rather than reimplementing it in the octop DB.
