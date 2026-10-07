# Agent Peer Calls (harness teams)

> For the architecture and inbox design, see [agent-interop-mailbox.md](./agent-interop-mailbox.md).  
> For background collaboration, see [agent-delegation.md](./agent-delegation.md).

## Principles

**`@` Agent** = before entering the main stream, perform one synchronous `call_peer` for each `@`-mentioned Agent; inject the result into `system`, then continue with the main Agent.

**`ask_agent`** = the model itself decides whether to collaborate; `mode=sync` returns immediately, `mode=background` goes through the harness inbox + `GlobalProcessor.on_reply` delivery.

## User side: `@` Agent

1. The input box `@Researcher` → the request carries `target_agent_ids`
2. `AgentManager.apply_mention_agent_calls` → `HarnessAgentManager.team.apply_mentions`
3. Each Agent's reply is injected into `system`, then the current Agent streams

## Agent-side tools (harness `teams/tools.py`)

| Tool | Purpose |
|------|---------|
| `agent_list` | Lists the Agents the current user can collaborate with |
| `ask_agent` | Synchronous or background collaboration (see [agent-delegation.md](./agent-delegation.md)) |

Injected in `AgentManager._build_harness_config` via `team.team_tools()` (on par with the cron tools).

## Execution stack

```text
User @ Agent
  → AgentManager.apply_mention_agent_calls
  → TeamManager.apply_mentions → call_peer (sync)

ask_agent mode=sync
  → TeamManager.call_peer

ask_agent mode=background
  → TeamManager.submit_peer → inbox worker → GlobalProcessor.on_reply
```

## Related files

- `octop_harness/teams/` — inbox, `TeamManager`, `build_team_tools`
- `infra/gateway/processor.py` — `GlobalProcessor` (message routing + `TeamProcessor` callbacks)
- `api/routers/chat.py`, `infra/gateway/processor.py` — `@` and slash commands

## Follow-ups (optional)

- `call` timeouts and auditing
- Show "background research in progress" progress in the parent thread
