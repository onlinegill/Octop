# Expert Team Mode

The host expert is the team host: it has its own workspace, memory, and channels, and owns scheduling. Members are still ordinary experts — they can be chatted with individually and can join multiple teams. The process is a group chat posted to the timeline, and the host wraps up by summarizing and judging whether the work is done.

## Confirmed decisions

### Identity and roster

| # | Decision |
|---|------|
| 1 | Members remain independent experts and can join multiple teams at once |
| 2 | Creating a team requires at least 2 members (not counting the host) |
| 3 | Members can only be ordinary experts; teams cannot be nested |
| 4 | You can add: your own experts + experts shared with you |
| 5 | Shared experts can genuinely be assigned work; output goes into the other party's workspace/chat, but you cannot change the other party's config |
| 6 | The first version does not share teams; only the creator can chat, change members, and bind channels |
| 7 | While work is in flight, you cannot remove that member or delete that expert |

### Speaking and scheduling

| # | Decision |
|---|------|
| 8 | True group chat: member bubbles post directly to the timeline |
| 9 | The host only schedules: small talk/assignment notes can be short answers; professional work is always dispatched asynchronously to members |
| 10 | `@` only hints at priority; it does not force the work to go only to the person named |
| 11 | Members call back to the host after finishing; the host summarizes and judges whether the work is done |
| 12 | New user messages always go to the host first (even if members are still speaking) |
| 13 | Members can synchronously `ask_agent` their colleagues, but can no longer asynchronously pull people into the group |
| 14 | The host can `dispatch` multiple people in parallel in one round |
| 15 | If the other party is not running, dispatch fails, and the host falls back to the failure callback; it does not auto-start them |
| 16 | Stop only stops the host's current round; members keep running to completion and then call back |

### Sessions, storage, channels, UI

| # | Decision |
|---|------|
| 17 | Room ID = host `thread_id`; member checkpoint = `host_thread~member_id`; gateway relay + `speaker_agent_id` |
| 18 | Each writes its own workspace; team guidelines/team memory live only on the host side, and are written into the task message when dispatching |
| 19 | Channels bind only to the host |
| 20 | Visible on both sides: the team room is relayed; the member sidebar gets an extra "From team XXX" conversation |
| 21 | Teams appear in the existing chat sidebar, distinguished by a badge; the "My Teams" tab only creates and edits |
| 22 | The right-side member bar lists only members, not the host |
| 23 | The host's capabilities are limited to member-related tools: `agent_list` + async `ask_agent` + memory/time; no filesystem/browser/search/MCP/skills/plugins; create/edit has no skill / subagent / plugin / persona |

## Identity model

A team is not a parallel entity but a special expert with `agents.kind = team`:

| | Expert (`kind=expert`) | Team host (`kind=team`) |
|--|--|--|
| Workspace / checkpoint / memory | Yes | Yes (team memory root) |
| System prompt | Expert template | Hidden scheduling template + runtime "digest then rewrite" constraint (invisible in the user's expert library) |
| Tools | The full working set | Lightweight + `agent_list` + async `ask_agent` |
| Visible peers | Other experts of the same user by default | Only `team_peers` = team members |
| Channels | Bindable (1:1) | Bindable (team entry point) |

`team_id` = host `agent_id`. The member roster is written only in the host workspace's `.octop/manifest.json` (`kind` + `members`). `agents.kind = team` is only a list index.

## Data

A team host is still an ordinary `agents` row (`kind=team`, migration `016_agent_teams`). The roster lives only in the workspace manifest:

```json
{
  "kind": "team",
  "members": ["expert-a", "expert-b"]
}
```

The `member_ids` of `GET /api/teams` / `GET /api/agents` are both read from this manifest. There is no members table.

The UNIQUE constraint on `threads.thread_id` is not split. LangGraph checkpoints are still isolated per expert.

History attribution: messages fanned in to the host conversation mark the speaker on `additional_kwargs.speaker_agent_id` (and the history JSON's `agent_id`). Multiple experts are not written into the same checkpoint.

In-flight dispatch: in-process `TeamJobTracker`, idempotently accounted per inbox `job_id` (`prepare_peer_session` starts it; either `record_peer_turn` / `on_reply` ends it, and failures also release it). Locks disappear after a restart, so the roster can be changed again.

For expert peer calls (non-team), as long as a `source_thread_id` is carried, the session also goes through `peer:{room}` instead of reusing the callee's 1:1 DM. After upgrading, peer history in old DMs is not carried over automatically.

## Runtime

### octop-harness

octop-harness adds `peer_invoke_mode: "sync" | "async" | "both"` (default `both`, preserving old behavior):

- `sync`: inject only synchronous `ask_agent`
- `async`: inject only async dispatch (fire-and-forget)
- `both`: one tool with two modes

Octop sets ordinary experts to `peer_invoke_mode=sync` (1:1 chat: the result returns to the tool); team hosts are set to `async` with `team_peers` = member ids (group chat: posts to the timeline). The host's own conversation requests also carry `peer_invoke_mode=async`. On runtimes that still default to `ask_agent mode=sync`, Octop rewrites the host's `call_peer` to members into an inbox `submit_peer` to guarantee fire-and-forget. The async pipeline does group-chat dual-write by inbox / room, and does not decide whether to post to the timeline based on `kind=team`.

The inbox is concurrent per callee: the same member is serial, different members are parallel; host callbacks are serial by source `thread_id`.

The callback loop stays as it is: after the inbox completes, the platform wakes the host (`compose_followup`), rather than the member calling the host itself. The team host's callback prompt requires judging completion, not restating the member's body already posted to the timeline. The wrap-up goes through the room stream (the same WS as member live-posting), no longer a full `team_snapshot`.

When a member is dispatched by a team, the request-level override sets `peer_invoke_mode=sync` and narrows `team_peers` to colleagues, forbidding further async pulls into the group. The Human the member receives is the task spec rewritten by the host, not the user's original words; the group chat record (user / host / already-posted members) is only System background. The member checkpoint remains `host_thread~member_id`. The host system prompt asks it to digest first and then rewrite, forbidding forwarding verbatim.

### Octop host assembly

`_build_harness_config` when `kind=team`:

- Does not mount cron / knowledge / mobile / plugin / MCP / skill packs
- On startup uses `init_workspace=False`, so it does not copy harness `_builtin_skills` / built-in subagents
- `tools_disabled` keeps only `agent_list` / `ask_agent` / memory / `current_time` (including the filesystem and `task`, which are otherwise non-disableable)
- `team_peers` = members
- Seeds into the workspace `SOUL.md` (host persona) + `AGENTS.md` (coordination/dispatch guidelines) + `.octop/manifest.json` (`kind=team` and `members`)

A dispatched member still uses its own workspace. If the other party's `last_state` is not running, the harness call fails and the host falls back to the failure callback.

Stop: Dashboard cancellation cancels only the host's current stream; member tasks queued/running in the inbox are not cancelled.

## Room and relay

```text
conversation_id = host thread_id
  ├── host LangGraph thread = conversation_id
  ├── member A checkpoint = conversation_id~A
  └── member B checkpoint = conversation_id~B
```

- The user always talks to the host; the WS subscribes to the room `conversation_id`
- Room streaming frames carry the speaker: `agent` and `agent_id` (the host's own tokens are also tagged with the host id; the host's `done` is not, making it easy for the frontend to end the round)
- A member's own conversation list gets an extra thread (a derived id), titled "From team {name}"; its session_key is `team:{room_thread}`, not occupying the member's 1:1 `dm` conversation
- The `@` list narrows to members in team chat; it is only a hint and does not pre-invoke

The room WS relays member replies token by token; fan-in only adds a snapshot when there was no live push. Streaming frames identify the speaker with `agent` / `agent_id`. IM channels cannot see the room WS: after a successful dispatch it immediately pushes "Asked {member} to handle it, please wait…"; after the member wraps up it pushes the full message with the speaker's name; the host's wrap-up is pushed as "[Host summary]…". A channel bound to a team host is forced to `response_mode=stream` at registration, to avoid an invoke folding away the dispatch narrative.

## HTTP

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/teams` | The current user's teams (with member summaries) |
| POST | `/api/teams` | Create a host + at least 2 members |
| GET | `/api/teams/{team_id}` | Details |
| PATCH | `/api/teams/{team_id}` | Change name/model/greeting/members (rejected for a member that is in flight) |
| DELETE | `/api/teams/{team_id}` | Delete the team host |

`GET /api/agents` gains `kind`; team rows carry `member_ids`. `kind=team` cannot be `is_shared`.

Error codes: `TEAM_NOT_FOUND`, `TEAM_MEMBERS_TOO_FEW`, `TEAM_MEMBER_INVALID`, `TEAM_MEMBER_BUSY`, `TEAM_NOT_SHAREABLE`.

## Frontend

Experts page tabs: `My Experts | My Teams | Expert Library | Market`.

- My Experts: filter `kind !== team`
- My Teams: cards/empty-state guidance; create/edit only needs name, model, color, greeting, members; channels go through the existing channel config (bound to the host)
- Sidebar: teams get a team badge
- Right side of team chat: member bar (not including the host)
- Bubbles: `speaker_agent_id` maps to the expert's avatar/name; the host uses its own avatar

## Hidden template

`src/octop/infra/agents/teams/template/`, not exposed through `GET /api/experts`. `template_name = team-host` is an internal marker only.

## Non-goals (first version)

- Team sharing, nested teams, auto-starting disabled members
- Multiple experts sharing the same `threads.thread_id`
- Members asynchronously pulling people into the group
- Shared team workspace
- Out-of-process persistence of the harness inbox (in-flight tasks are lost on restart)
