# octop_ui Large-Payload Bypass Design Spec (artifact-stripping approach)

> Related issue: onlinegill/Octop #1032 (bilibili plugin returns an oversized result)
> Status: v2 · three-way review merged (2026-09-23)
> Review: three independent reviews (step-5-preview and two others) all returned **APPROVE WITH CHANGES**; every required change has been incorporated into this document (review logs under `tmp/spec-review-*.log`).
> Every claim in this document is double-verified by both code reading and runtime PoC (`tmp/verify_offload_poc.py`, a real LangGraph agent loop, including an in-place mutation mode re-check).

## 1. Problem

The built-in `bilibili-anime` plugin's tool `bilibili_search_anime` (`src/octop/infra/agents/plugins/bundled/bilibili-anime/main.py:138-196`):

1. After searching for a show, it calls `_fetch_episodes()` once per season for up to 8 seasons (`max_seasons` defaults to 5, capped at 8, `main.py:168`) to pull **all episodes** (`main.py:169-174`, no per-season episode cap);
2. It serializes the whole `{octop_ui, data, text}` into a single JSON string and returns it as the tool result (`main.py:186-196`).

For a long show like *A Record of a Mortal's Journey to Immortality*: 5 seasons × 100+ episodes × ~150-250 characters each yields a typical tool result of 13-24 KB (PoC reproduced 22.5 KB / 200 episodes).

## 2. Root cause

This string simultaneously serves four kinds of consumers:

| Consumer | Need | Path |
|---|---|---|
| LLM context | As small as possible | `ToolMessage.content` enters state and is carried in full on the next model call |
| History persistence | Needs complete data for replay | `thread_messages` (recorder main path `message_to_dict`) |
| Dashboard real-time rendering | Needs complete data | WS `tool_result` frame (`model_dump`) |
| Plugin UI (`ui/index.js`) | Needs complete data | `props.data` ← parses the tool output |

The model's and the UI's needs are opposed. **Truncation is not viable** (the UI would lose episodes), so the data plane (large payload) and the control plane (summary + render hints) must be separated "after the tool runs, before the ToolMessage enters state".

## 3. Verified facts

| # | Fact | Evidence |
|---|---|---|
| F1 | `AgentMiddleware.awrap_tool_call` can intercept tool results and replace the ToolMessage (langchain 1.3.18); implementing only the sync version raises NotImplementedError | `langchain/agents/middleware/types.py:756-823`; Octop precedent `infra/agents/middleware/thread_artifacts.py:186-193` |
| F2 | The middleware-chain assembly site can inject `row`/`ws` via closure | `manager.py:3026-3041` (`ws` constructed at `manager.py:2912-2917`) |
| F3 | The model request conversion (`convert_to_openai_messages`) does not include the artifact field, so artifacts do not enter model context | `langchain_core/messages/utils.py:1653-1680`; PoC [3]; harness's memory/compaction modules never read artifacts (verified by grep) |
| F4 | WS real-time frames are serialized via `model_dump()`, including the artifact; the team relay also passes it through unchanged | `api/routers/chat/sse.py:9-21`, `ws.py:70-75`, `teams/team_manager.py:754-773`; PoC [5] |
| F5 | The persistence main path `message_to_dict` → `messages_from_dict` round-trips and preserves the artifact | `history_projection.py:64-80`, `history.py:291-313`; PoC [4] |
| F6 | **History API serialization drops the artifact**: the tool_result block outputs only content | `api/routers/chat/serialize.py:937-941` |
| F7 | **The dashboard real-time path prefers content**, and the `ToolCallData` type has no artifact field and `closeToolCall` does not extract it | `chatStore.ts:1703-1756`, `1759-1858`; `sseHelpers.ts:11-22` |
| F8 | **The dashboard history path reads only the output field** | `dashboard/src/utils/messageParser.ts:210-232` |
| F9 | `patchResult` is a purely front-end in-memory operation with no server write-back channel; a refresh loses it | `chatStore.ts:1865-1901`; `host.ts:65-68` |
| F10 | The recorder fallback branch (when a chunk lacks messages) rebuilds a ToolMessage without the artifact; the regular path (`_live_wire` → `message_to_dict`) includes it. The fallback is currently nearly unreachable (the harness tool_result chunk always carries messages) | `recorder.py:177-194`; `harness_agent/protocols/langgraph.py:228-234` |
| F11 | Trajectory events store only content (`projector.py:85-103`), so stripping automatically shrinks that payload; clip only affects the summary field | `trajectory/projector.py:285-294`; `tests/unit/trajectory/test_trajectory_list_summarize.py:68` |
| F12 | `PluginContext` has no workspace/agent context; plugin tools are pure functions | `harness_agent/plugins/context.py:17-115`, `tools.py:78-90` |
| F13 | The plugin UI host has its own authenticated `request()` | `dashboard/src/plugins/toolRenderers/host.ts:69-71` |
| F14 | The workspace download route requires the agent to be running and forces attachment disposition — hence the "workspace file + download URL" approach is abandoned | `api/common/workspace.py:37-68`, `api/routers/workspace.py:328-364` |
| F15 | Mobile has no octop_ui consumer (`mobile/tools.py:29` is the Android UI dump path); the CLI repl does not read content | `infra/mobile/tools.py`, `cli/repl/render.py:194` |
| F16 | The plugin UI echoes the full patch back with `{...d, ...next}` (purely front-end in-memory) | `bilibili-anime/ui/index.js:42-45`; `parseToolOutput.ts:66-88` |
| F17 | The team host allowlist has only 5 built-in tools; plugin tools are denied on the host; a team member is an independent agent with the full tool + middleware set | `infra/agents/teams/service.py:32-50`, `manager.py:3233-3235` |
| F18 | Backup export copies `thread_messages` row-by-row, so the artifact survives in `message_json` | `infra/backup/chats.py:81-110` |
| F19 | `thread_fork.py:223-228` injects messages (including artifacts) into a new checkpoint — but per F3, artifacts never enter model requests; fork only copies checkpoint storage and **does not re-inject context** | `infra/agents/thread_fork.py:223-228` + F3 |
| F20 | None of the current 26 octop_ui plugins' `data` contains a `file://`/workspace media path (grep zero hits) | `src/octop/infra/agents/plugins/bundled/` |

## 4. Approach

### 4.1 New middleware `OctopUiOffloadMiddleware`

Location: `src/octop/infra/agents/middleware/octop_ui_offload.py`. Implement `awrap_tool_call` (the async version, F1):

1. `result = await handler(request)`; if not a ToolMessage (including Command) → return unchanged;
2. Stripping conditions (all must hold; otherwise return unchanged):
   - `result.content` is a str of length ≥ `_OFFLOAD_MIN_CHARS = 4000` (module-level constant);
   - the content parses as a JSON object containing a non-empty `octop_ui.renderer`;
   - the top-level `data` key exists and is non-empty (do not strip `None`/`{}`/`[]`);
   - the content does not contain `file://` (guards the media/path extraction consumers, see §4.6);
3. Strip action (**in-place mutation**, no new ToolMessage; preserve `id`/`name`/`tool_call_id`/`status`/`response_metadata`/`additional_kwargs` — PoC [0] verified the fields survive):
   - `result.artifact = data` (the whole `data` key moves; sibling fields such as `results[i].episodes_error` move with `data`; the remaining envelope fields are kept as-is);
   - `result.content =` the envelope without `data` + `"data_ref": "artifact"`;
4. On any exception: log a warning + increment a METRICS counter, and return unchanged.

**Mount position**: append to the **end (innermost) of the `agent_middleware` list**, assembled at `manager.py:3026-3041`. Rationale: langchain semantics are "the first list item = outermost"; the innermost sees the raw tool return first, and after stripping all outer middleware (harness PII/media, Octop's) observe a consistent view. The impact on `ThreadArtifactsMiddleware._paths_from_content` is double-guarded by F20 + the `file://` guard condition.

**Why middleware beats changing the plugin SDK (`response_format="content_and_artifact"`)**: `_to_structured_tool` currently does not pass through response_format (F12), and changing the SDK would still require each plugin to change its return value; middleware takes effect for all 26 existing octop_ui plugins with zero changes and automatically covers future plugins.

**Why the "workspace file + download URL" approach is abandoned**: the download route requires the agent to be running (F14), so the history player would break once the agent stops; storing the artifact inside the message record has no dependency on agent state, and the storage footprint is the same as today.

### 4.2 History API exposes the artifact

Add an `artifact` field to the tool_result block at `serialize.py:937-941` (**only** when the ToolMessage has a non-empty artifact; an additive change that does not break existing consumers).

Supporting docs: `docs/api.md` notes the new tool_result block field and the semantics of `data_ref: "artifact"` possibly appearing in `output`; CHANGELOG notes the behavior change (see §5 release constraints).

### 4.3 Full dashboard implementation path (the largest gap confirmed by review, addressed point by point)

1. Add `artifact?: unknown` to the `ToolCallData` interface (`dashboard/src/pages/Chat/hooks/sseHelpers.ts:11-22`);
2. `closeToolCall` (`chatStore.ts:1759-1858`): extract the artifact from the ToolMessage in the WS frame messages and write it to `toolData.artifact` (F4 already proved the chain does not drop fields: `ws.py:70-75` → `chatStore.ts:2236` → `parseHarnessChunk.ts:268-274` pass it through unchanged);
3. History path: `extractToolData` (`messageParser.ts:210-232`) reads `block.artifact` (provided by §4.2);
4. Rendering: `MessageBubble.tsx` `ToolDetailsInline` (~lines 356-432) — when `parsed.data === undefined` and `data_ref === "artifact"`, use `toolData.artifact` as `props.data`;
5. **Parse precedence (prevent patch bounce-back)**: an explicit `data` key always takes precedence over `data_ref`→artifact. Because `mergePatchedToolOutput` writes the patched `data` back into the output string while `data_ref` remains, without a defined precedence the UI would jump back to the old state after the user selects an episode (`parseToolOutput.ts:66-88`).

### 4.4 Recorder fallback branch adds the artifact

Pass through the artifact when `recorder.py:186-194` rebuilds the ToolMessage. The trigger probability is extremely low (F10), but the consequence is permanent history data loss, so this is cheap insurance; add logging too.

### 4.5 thread_fork path: no code change

F19 already argued: artifacts do not enter model requests (F3), and fork only copies checkpoint storage with no context re-injection. The harness's memory/compaction paths never read artifacts (F3 evidence). This spec does not change fork; add one post-fork case to the integration tests to prevent regression (§6).

### 4.6 Guarding the media/path extraction consumers

`ThreadArtifactsMiddleware` (`thread_artifacts.py:314`) and the `tool_media.py` enrichment function extract file paths/media blocks from content. If a future plugin embeds a `file://` path inside octop_ui `data`, stripping would break those extractions. The guard = the `file://` exclusion condition in §4.1 (present → fall back to old behavior) + F20 being zero today + a guard case in the test plan.

### 4.7 Explicitly out of scope

- Do not change the harness_agent plugin SDK; do not change any existing plugin code;
- Do not touch `patchResult` (F9 verified there is no write-back channel);
- trajectory does not expose the artifact (F11; that surface shrinks automatically after stripping);
- Do not add server-side persistence of patch state (if done in the future, store only UI-state deltas, and never accept a client's full data to overwrite storage);
- The bilibili tool's model-side pagination parameters (`season_id`/`page`) are an optional later enhancement, not in this spec;
- Do not introduce a workspace-file secondary channel for very large artifacts (e.g. >100 KB) — revisit if needed later.

## 5. Risks and release constraints

| Risk | Assessment | Mitigation |
|---|---|---|
| **Frontend and backend must ship in the same batch** | Backend first, frontend not updated → the stripped envelope renders empty in an old frontend. The wheel embeds the dashboard build artifact, so it is naturally atomic ✅ | Note in CHANGELOG for self-hosted split deployments; put third-party API consumer migration guidance in `docs/api.md` |
| Old and new messages coexist | Old messages lack `data_ref`/artifact, new ones have them | Both frontend parse paths must be compatible (§4.3.4-4.3.5); tests cover it |
| WS frame bandwidth | The artifact enters the frame via `model_dump`; the size is the same as today (today it all goes through content) | No regression |
| DB row size | Unchanged (content → artifact is the same bytes moving) | — |
| Model loses episode-level visibility | content keeps only the `text` summary (count + default season titles), so asking "what is episode 5 called" fails | Record the behavior change in CHANGELOG; a paginated query tool is a later enhancement |
| ACP clients | `harness_agent/acp/server.py:124-136` reads only content → the IDE sees the slim envelope | Acceptable (it could not render the UI anyway); note it in docs |
| context_usage estimation | `harness_agent/context_usage.py` estimates tokens from content; after stripping the estimate matches the model's reality | An improvement |
| IM channels | They send only tool_start/tool_end hint lines + media events and do not read the envelope | No change (F15, `stream_project.py:166-207`) |
| team mode | The host has no plugin tools to intercept (F17); members work normally and the relay passes the artifact through (F4) | Disable this item |

## 6. Test plan

Backend:
- Middleware unit tests (new `tests/unit/agents/middleware/test_octop_ui_offload.py`): strip / small payload untouched / non-JSON untouched / no `octop_ui` untouched / empty `data` untouched / contains `file://` untouched / bad JSON untouched / Command result untouched / in-place mutation preserves `id`/`tool_call_id`/`name`/`status` / exceptions swallowed and counted;
- `serialize.py` serialization case with an artifact;
- Integration: agent stream with a large octop_ui payload → WS frame content already compressed and artifact present; history API returns the artifact; after fork, the new thread's first call does not blow up.

Frontend:
- `extractToolResultOutput` / `closeToolCall`: when content+artifact are in the same frame, the artifact lands in `toolData`;
- `extractToolData` history path reads the artifact;
- `parseOctopToolOutput`: `data` takes precedence over `data_ref`; old format (inline data) is compatible;
- `ToolDetailsInline` renders from the artifact when `data_ref` is present.

Regression: `make all` + `cd dashboard && npx tsc -b`.

The mechanism layer is pre-verified: `tmp/verify_offload_poc.py` (including the in-place mutation mode; all assertions pass).

## 7. Open questions → closed by review

- Q1 team mode: **Closed**. The host allowlist has only 5 built-in tools (F17); plugin tools are not mounted, so there is no tool to intercept; members work normally.
- Q2 recorder fallback: **Closed**. The regular path already carries the artifact; the fallback is nearly unreachable, and §4.4 is a cheap insurance fix.
- Q3 threshold 4000: **Adopted**. The other 25 plugins' normal output is <2-3 KB, so this does not misfire; the bilibili default parameters almost always trigger it (as expected — it is exactly the target).
- Q4 API compatibility: **Closed**. The artifact field is additive; the `output` semantic change is handled via `docs/api.md` + CHANGELOG.
- Q5 IM channels: **Closed**. What IM users see is identical before and after stripping.
- Q6 WS chain: **Closed**. No fields are dropped in the frame; the gap is in the frontend landing, captured as §4.3 action items.
