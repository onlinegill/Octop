# Agent Teams: Inbox + Callback Design

**Status:** Implemented (harness `teams/` + octop `GlobalProcessor` as `TeamProcessor`)
**Scope:** `octop-harness` (primary implementation) + `octop` (host adaptation)
**Related:** [agent-call-agent.md](./agent-call-agent.md), [agent-delegation.md](./agent-delegation.md)

> Note: the earlier `AgentMailbox` (which transparently enqueued all `stream`/`call` calls) is superseded by this design.
> Core idea: `stream`/`call` return to their **original direct** behavior; interop capability is consolidated into one **global inbox** +
> an optional **callback processor**; the related code is centralized under `octop_harness/teams/`.

---

## 1. Goals

1. A single global `HarnessAgentInboxManager` (inbox queue) that manages the inbox messages of all agents,
   each message carrying: `target` (recipient), `source`, `source_thread_id`, `status`, and other key information.
2. `HarnessAgentManager` offers two usage modes:
   - **Without inbox**: the parameters and behavior of `stream` / `call` are **exactly as before the refactor** (direct to the agent, no queue).
   - **With inbox**: provide a `callback` (process method/class) at construction. Once provided, the manager enables inbox
     queue processing: receive message → `target.call` → get result → compose prompt, then request
     the `source` agent + `source_thread_id` via `call` → expose the return through the callback (proactive push).
3. The `peer_agent` tool does not live in `builtin/`. Add an `octop_harness/teams/` directory that centralizes the inbox_manager,
   tools, and callback definitions. The tools **are not part of the agent's default tool set**; they are provided by the manager only when "teams" are enabled.
4. The `ask_agent` tool: **synchronous blocking** by default, waiting for the result; **only when the manager is configured with a callback** does it go async
   — posting a message to `HarnessAgentInboxManager` and immediately returning an `id`.

---

## 2. Module layout

```
octop_harness/teams/
  __init__.py        # exports public symbols
  inbox.py           # InboxMessage, InboxStatus, HarnessAgentInboxManager
  processor.py       # TeamProcessor protocol, ReplyEvent, default prompt composition
  tools.py           # build_team_tools(manager) -> [agent_list, ask_agent]
  util.py            # pure functions such as extract_call_response / first_user_text
```

Remove: `octop_harness/mailbox.py`, `octop_harness/peer.py` (their contents are split into `teams/`).

---

## 3. Data model

### 3.1 `InboxMessage` (queue item)

```python
InboxStatus = Literal["queued", "running", "replying", "done", "failed", "cancelled"]

@dataclass
class InboxMessage:
    id: str
    target_agent_id: str            # recipient: the agent that will run the task
    source_agent_id: str            # originating agent (the one to reply to)
    source_thread_id: str | None    # thread on source to land the reply (preserves context)
    message: str                    # task content
    user_id: str | int
    status: InboxStatus = "queued"
    original_user_prompt: str | None = None   # used for prompt composition
    error_text: str | None = None
    created_at: datetime
    updated_at: datetime
    metadata: dict[str, Any] = {}             # passed through to the callback (session_key, etc.)
```

> Both the `target.call` result and the composed reply to `source` are **local process values** inside the worker and are not attached to `InboxMessage`:
> they are not persisted; history comes from the checkpoint, and there is no scenario that looks up results afterward; `reply_text` is passed through to `on_reply` via `ReplyEvent`.

### 3.2 `ReplyEvent` (callback output)

```python
@dataclass
class ReplyEvent:
    inbox_id: str
    status: Literal["done", "failed", "cancelled"]
    source_agent_id: str
    source_thread_id: str | None
    target_agent_id: str
    user_id: str | int
    reply_text: str | None          # the proactive reply body composed by the source agent
    error_text: str | None
    metadata: dict[str, Any]
```

### 3.3 `TeamProcessor` (process method/class)

```python
class TeamProcessor(Protocol):
    # Compose "target result -> prompt for source"; teams provides a default implementation, overridable
    def compose_followup(self, msg: InboxMessage, result_text: str) -> str: ...

    # Finally expose the source's reply to the host (write thread / IM push / WS notification)
    async def on_reply(self, event: ReplyEvent) -> None: ...
```

- The default `compose_followup` implementation lives in `teams/processor.py` (equivalent to today's `delegation/synthesis.py`).
- `on_reply` is the single exit point for "letting the user perceive a proactive push"; the host delivers text here.

---

## 4. `HarnessAgentInboxManager`

```python
class HarnessAgentInboxManager:
    def __init__(self, *, caller: AgentCaller, processor: TeamProcessor) -> None: ...

    def enqueue(
        self, *,
        target_agent_id: str,
        source_agent_id: str,
        source_thread_id: str | None,
        message: str,
        user_id: str | int,
        original_user_prompt: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str: ...                       # returns the inbox id, immediately

    def get(self, inbox_id: str) -> InboxMessage | None: ...
    def list(self, *, target=None, source=None, status=None) -> list[InboxMessage]: ...
    def cancel(self, inbox_id: str) -> bool: ...

    def start(self) -> None: ...
    async def shutdown(self) -> None: ...
```

- `AgentCaller` is a minimal protocol (implemented by `HarnessAgentManager`):
  `async def call(self, agent_id: str, request: ChatRequest) -> dict[str, Any]`.
- Internally: `dict[id -> InboxMessage]` for status lookup + the delivery queue.
- **Concurrency model**: a single worker consumes serially; the same `target` is naturally serial.
  (Optional enhancement: per-`target` queues in parallel, concurrent across targets — V2, not this release.)

### 4.1 Worker processing flow

```text
take InboxMessage(status=queued)
  status=running
  result = await caller.call(target_agent_id, ChatRequest(message, thread=new thread))
  result_text = extract_call_response(result)            # local variable

  status=replying
  prompt = processor.compose_followup(msg, result_text)
  reply  = await caller.call(source_agent_id, ChatRequest(prompt, thread=source_thread_id))
  reply_text = extract_call_response(reply)               # local variable

  status=done
  await processor.on_reply(ReplyEvent(... reply_text=reply_text ...))
exception -> status=failed, on_reply(status=failed, error_text=...)   # let the source agent give a fallback explanation
```

Concurrency: **a single global worker consumes serially** (no per-target queues).

Key points:
- The second `call` lands on `source_thread_id`, and the langgraph checkpointer automatically merges this round into the parent conversation,
  naturally "handling it together with the earlier question".
- `on_reply` only handles **delivering already-generated text** (it no longer triggers an agent), so the host-side implementation is extremely thin.

---

## 5. `HarnessAgentManager` changes

### 5.1 Construction and switch

```python
HarnessAgentManager(
    providers=...,
    langfuse=...,
    team_processor: TeamProcessor | None = None,   # providing this enables team/inbox
)
```

- `team_processor is None` → no inbox is created; `stream`/`call` are direct.
- `team_processor` non-empty → creates `HarnessAgentInboxManager(caller=self, processor=...)`.
- Attribute `team_enabled: bool`; `set_team_processor(...)` supports injection after startup (needed by Octop's assembly order).

### 5.2 `stream` / `call`: return to the original implementation

Undo the mailbox wrapping and restore the pre-refactor direct `entry.agent.stream/call` + `_cancel_events`.
**The public signatures and behavior are unchanged.**

### 5.3 Interop API (for tools/host to call)

```python
async def call_peer(self, *, from_agent_id, to_agent_id, message, user_id, source="ask_agent") -> PeerResult
    # sync: self.call(to_agent_id, ...) directly, return the response

def submit_peer(self, *, from_agent_id, to_agent_id, message, user_id,
                source_thread_id, original_user_prompt=None, metadata=None) -> str
    # async: requires team_enabled, otherwise errors; inbox.enqueue(...) returns the id

async def apply_mentions(self, *, from_agent_id, user_id, mention_agent_ids, prompt, messages) -> list
    # user @: for each target, call_peer(sync) in parallel, injecting a system message (consistent with today)
```

### 5.3 team tools

```python
def team_tools(self) -> list[StructuredTool]:
    return build_team_tools(self)        # agent_list + ask_agent
```

- Added to the agent tools only when the caller (Octop) explicitly requests them; **not written into HarnessAgent's default tools**.

---

## 6. team tools (`teams/tools.py`)

### `ask_agent` behavior

| Condition | Behavior |
|-----------|----------|
| Default / `team_enabled=False` | **Synchronous blocking** `call_peer` → returns `response` |
| `team_enabled=True` and the model picks `mode=background` | `submit_peer` → enters the inbox, returns `{job_id, status:"queued"}`, and notes that it will reply proactively later |

- The `mode` field is only effective when `team_enabled`; when not enabled it is ignored and sync is forced.
- Context (`from_agent_id`, `user`, `session_key`/`thread_id`) is read from `langgraph.config.get_config().configurable`, consistent with today.
- For `submit_peer`, `source_agent_id = from_agent_id` and `source_thread_id = current thread_id`.

---

## 7. Octop adaptation

### 7.1 Implement `TeamProcessor`

`infra/gateway/processor.py` — `GlobalProcessor` implements `TeamProcessor` (`compose_followup` / `on_reply`)

```python
class DelegationProcessor(TeamProcessor):
    def compose_followup(self, msg, result_text) -> str:
        return build_completion_prompt(...)            # reuses synthesis.py

    async def on_reply(self, event: ReplyEvent) -> None:
        # source.call has already written the reply into the source_thread checkpoint;
        # here we only need to notify the user interface of a new message:
        #   - Dashboard: mark unread + WS-push a "new reply" notification
        #   - IM: Gateway.push_text(channel, reply_text)
```

- `Gateway.push_text_from_session` is no longer needed to re-run the parent agent (the synthesis is already done in the inbox's `source.call`).
- The `agent_delegations` table may optionally be kept: record state in `on_reply` / `enqueue` to support the `/delegations` list and
  cancel; execution itself does not depend on the DB.

### 7.2 Assembly

```python
delegation_processor = DelegationProcessor(gateway=..., thread_registry=...)
harness = HarnessAgentManager(providers=..., team_processor=delegation_processor)
# or after boot: harness.set_team_processor(delegation_processor)
```

### 7.3 Tool registration

`AgentManager._build_harness_config`: `merged_tools.extend(self._harness_manager.team_tools())`
(only Octop uses the manager, consistent with "enable only when the manager is used").

### 7.4 Entry points unchanged

`chat.py` SSE, `ws_chat.py` + `processor.iter_turn_chunks`, IM → none of the protocols change;
`@` still goes through `apply_mentions` (synchronously). External HTTP/WS/SDK callers are unaffected.

---

## 8. End to end: background research scenario

```text
User asks the main Agent (thread T) -> the main Agent calls ask_agent(mode=background, Researcher)
  -> manager.submit_peer(target=Researcher, source=MainAgent, source_thread_id=T)
  -> inbox.enqueue -> returns id, the tool immediately replies "running in background"
The main Agent continues talking with the user (thread T, direct call/stream, unaffected by the inbox)

inbox worker:
  Researcher.call(task)            -> result_text
  compose_followup(original_q, result) -> prompt
  MainAgent.call(thread=T, prompt)   -> reply_text (already merged into T's context)
  processor.on_reply(reply_text)     -> Dashboard/IM proactively pushes to the user
```

---

## 9. Differences from the current implementation (refactor checklist)

### octop-harness

| File | Action |
|------|--------|
| `mailbox.py` | **Delete** |
| `peer.py` | **Split** → `teams/util.py` (helpers) + `teams/inbox.py` (data/manager) |
| `manager.py` | Restore `stream`/`call` to direct; add `team_processor`, `team_enabled`, `team_tools`, `call_peer`/`submit_peer`; use `call_peer` in `apply_mentions` |
| `builtin/tools/peer_agent.py` | **Move** → `teams/tools.py` (`build_team_tools`) |
| `teams/inbox.py`, `teams/processor.py`, `teams/tools.py`, `teams/util.py` | **Add** |
| `tests/test_mailbox.py` | Replace with `tests/test_inbox.py` |
| `tests/test_peer_agent.py` | Adjust to import from `teams` |

### octop

| File | Action |
|------|--------|
| `infra/gateway/processor.py` | `GlobalProcessor` implements `TeamProcessor`; `on_reply` delivers unread/IM |
| `infra/agents/manager.py` | Construct `team_processor=...`; register `team_tools()`; pass through `apply_mention_agent_calls` |
| `infra/agents/agent_call.py` | Re-export from `octop_harness.teams.util` |
| `api/routers/chat.py`, `infra/gateway/processor.py` | Import-path adjustments, logic unchanged |
| Related unit tests | Adjusted to follow the imports |

---

## 10. Implementation phases

1. **teams skeleton**: `teams/util.py` + `teams/inbox.py` (`InboxMessage`, `HarnessAgentInboxManager`) + `teams/processor.py` (protocol + default compose).
2. **manager wiring**: restore `stream`/`call`; `team_processor` switch; `call_peer`/`submit_peer`/`apply_mentions`/`team_tools`.
3. **teams/tools.py**: `agent_list` + `ask_agent` (sync by default, background supported when team-enabled).
4. **harness tests**: `test_inbox.py` (enqueue→target.call→source.call→on_reply), `test_team_tools.py`.
5. **Octop wiring**: `DelegationProcessor`, assembly, tool registration, delete old paths; regress with `uv run pytest -m "not live"`.

---

## 11. Decisions (confirmed)

1. **inbox concurrency**: a single **global serial worker**. No per-target queues.
2. **Persistence**: **purely in-memory**, not persisted; history comes from the langgraph checkpoint.
3. **`on_reply` delivery**: **whole-segment push** (`call` produces no tokens), not streaming.
4. **`compose_followup` ownership**: belongs to `TeamProcessor`, **customizable by the host** (teams provides a default implementation).
5. **Failure semantics**: when target fails, **still `on_reply(status=failed)`**, letting the source agent give the user a fallback explanation.
6. **`InboxMessage` fields**: do not store `result_text` / `reply_text` (worker-local variables); the message keeps only routing/status information.
