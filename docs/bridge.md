# Bridge (Octop ↔ Octop instance bridge)

> Status: in progress (Phase 0–3 skeleton landed). The naming and scope in this document are authoritative; the implementation lives under `infra/bridge/`.  
> Unrelated to same-machine agent interop: see [agent-call-agent.md](./agent-call-agent.md) (`ask_agent` does not participate in cross-instance calls).

At the user level, connect to another Octop (in the cloud or another local machine), view the peer's expert list in the local dashboard, pull conversation records on demand, and talk to peer experts just as you would select a local expert (symmetrically: the peer can also reach this machine through the same bridge). A conversation runs only on the **instance where the expert lives**; the initiating side does not persist the full history.

## 1. Requirements conclusions

| Item | Conclusion |
|------|------------|
| Connection granularity | User level: address + username + password; the password is stored encrypted to simplify auto-reconnect |
| Multiple nodes | The same user can connect to several remote Octops at once |
| Topology | Either side can initiate the connection; one logical connection shares a single `connection_id` |
| Experts | Pull the list online; a shadow entry point; do not copy the workspace; do not install as a local runnable agent |
| Visibility scope | Matches what that account can see on the peer machine (no extra "federated visibility" toggle) |
| UI | Remote has its own entry point/grouping, not mixed in with local experts |
| Conversation execution | The harness runs only on the expert's side; the initiating side does not change its harness |
| History | Pulled on demand; the authoritative copy is on the expert's side; the initiating side keeps only a transient session and does not write local `threads` |
| Attachments | Supported; files land in the expert's side `inbound/` |
| Frontend calls | The browser talks only to the local API; after identifying a remote target locally, requests are forwarded over the bridge |
| Remote agent id | `bridge:{connection_id}:{remote_agent_id}` |
| Transport | WebSocket for the federated long connection; on top of it, a **general HTTP tunnel** is primary; special capabilities get explicit RPC later |
| Non-goals | Reworking `ask_agent` / the harness cross-instance protocol; dual-writing the full chat record on both sides; the browser connecting directly to the peer baseURL |

## 2. Overall architecture

```
┌─────────────────────┐         Bridge WS (either side may initiate)   ┌─────────────────────┐
│ Local Octop         │◄───────────────────────────────────────────────►│ Peer Octop          │
│                     │   HTTP tunnel + turn streaming multiplexing      │                     │
│ Dashboard ──HTTP──► │                                                 │ ◄──HTTP── Dashboard │
│   localhost API     │                                                 │   peer API          │
│         │           │                                                 │         │           │
│   infra/bridge      │                                                 │   infra/bridge      │
│   (identifies       │                                                 │   (executes tunnel  │
│    bridge:* /       │                                                 │    requests)        │
│    forwards /       │                                                 │                     │
│    receives tunnel) │                                                 │                     │
│         │           │                                                 │         │           │
│ local agent+harness │                                                 │ peer agent+harness  │
└─────────────────────┘                                                 └─────────────────────┘
```

![Figure 2-1 Overall architecture: two Octop instances connected over the Bridge WebSocket](./assets/bridge-architecture.png)
<!-- Image brief: a flat technical architecture diagram, 16:9. Left: a server icon labeled "Local Octop"; right: labeled "Peer Octop"; in the middle a bold double-headed arrow labeled "Bridge WebSocket (either side may initiate)", with a finer note "HTTP tunnel + turn streaming multiplexing". Draw on each side: Dashboard (browser connects only to the local machine), localhost/peer API, the infra/bridge module, and local/peer agent+harness. Emphasize that the machine-to-machine bus is an independent Bridge WS and does not reuse the browser Hub. Modern SaaS blue-grey palette, monospaced sans-serif, generous whitespace. (Note: architecture diagrams with exact text are best generated with Mermaid/Excalidraw; AI-generated images are conceptual only, with text conveyed in the caption) -->

- **Harness / GlobalProcessor** keep single-machine semantics; the bridge only delivers requests to the peer for execution and returns the response.
- The Dashboard's `WebSocketHub` serves only browser↔local; **the machine-to-machine bus is an independent Bridge WS** — do not reuse the Hub.
- NAT: when the peer's HTTP is often unreachable, traffic goes over the established Bridge WS tunnel (especially when the cloud accesses a home local instance).

## 3. Module boundaries

| Path | Responsibility |
|------|----------------|
| `infra/bridge/connections.py` | Connection CRUD, encrypted credentials, `connection_id`, multiple nodes |
| `infra/bridge/transport.py` | Outbound WS client + inbound WS endpoint; reconnect; dedupe/merge by `connection_id` |
| `infra/bridge/http_tunnel.py` | General `method/path/query/headers/body` ↔ response; chunking, timeouts, cancellation |
| `infra/bridge/router.py` | Local side: route over the tunnel when the target is `bridge:*` (or an explicit connection context) |
| `infra/bridge/chat_bridge.py` | Remote chat: local chat WS ↔ peer turn stream over the bridge |
| `api/routers/bridge.py` | Connection-management HTTP (probe/add/list/delete/connect/rename); Dashboard entry point is **Settings → Remote Bridge** (`/bridge`, below Knowledge Base) |

### Probe (does not persist)

Before adding a connection you can `POST /api/bridge/probe`: log in to the peer over HTTP with the supplied `peer_base_url` + username/password, then pull `GET /api/agents?scope=mine`, returning a list of expert summaries (`agent_id` / `name` / `description` / absolute `icon_url`, etc.). It does **not** write `bridge_connections` and does **not** establish a Bridge WS. The "Probe" button in the Dashboard add drawer calls this endpoint.

"Save and connect" persists only after login + Bridge WS `hello_ack` succeeds; on failure it rolls back. The management API authenticates by connection owner (a logged-in user can manage their own bridges). The inbound tunnel allows reads/writes **within an agent's scope** (chat, workspace, cron, status, plus tools / plugins / channels marked as limited in personalization, including `PATCH …/tool-settings` and `POST …/reload`), plus read-only composer: `GET /api/providers/resolved`, `GET /api/providers/active-model`, `GET /api/knowledge-bases`, `GET /api/knowledge-bases/capability`, and the Chat dock browser viewer: `GET /api/browser/env-status`, `GET /api/browser/harness-sessions`, `POST /api/browser/sessions/{id}/handoff`. Skill packs, global ACP, connector management, and knowledge-base management are marked peer-only in the Dashboard and should be operated on the peer. Admin / auth / Bridge control-plane are not tunnelled. `history-migration` is handled locally only. An inbound hello must not hijack another party's `connection_id`. The legacy entry point `/admin/advanced?tab=bridge` redirects to `/bridge`.


Dependencies: `api` → `infra/bridge` → the existing `infra` (peer login, peer execution of agents/history/upload).  
Forbidden: `bridge` → `api/` / `cli/` / `launch.py` (peer turn / browser runner are injected by `build_app`); forbidden to use the Dashboard Hub as the machine-to-machine channel.

## 4. Connections and identity

### 4.1 Pairing flow

1. The user fills in locally: `base_url`, `username`, `password`.
2. The initiator calls the peer's `POST /api/auth/login` over HTTP to get a token (**the first pairing assumes the initiator can reach the peer over HTTP**; if unreachable, the other side must initiate or a separate pairing code is needed — before implementation, fix one cold-start path).
3. Generate a `connection_id` (ULID); after the handshake frame is confirmed, **both sides store the same id**.
4. Establish the Bridge WS; thereafter traffic prefers the tunnel (especially to reach instances behind NAT).
5. The password and token are **stored encrypted**; reconnect prefers refresh, falling back to password login.

![Figure 4-1 Pairing flow: from form fill to establishing the Bridge WS](./assets/bridge-pairing-flow.png)
<!-- Image brief: a horizontal step/sequence diagram. ① User fills base_url + username + password; ② the local machine sends an HTTP login to the peer to exchange a token (arrow to the peer); ③ generate a ULID connection_id; ④ after the handshake frame is confirmed, both sides each store the same id (two database icons showing the same id); ⑤ establish the Bridge WS, traffic prefers the tunnel. Use numbered dots or swimlanes, blue-grey tech style. (An exact flowchart is best done with Mermaid; AI images are conceptual only) -->

### 4.2 Storage (illustrative)

Suggested table name: `bridge_connections`.

| Column | Description |
|--------|-------------|
| `connection_id` | The logical connection id shared by both sides |
| `owner_user_id` | The local user |
| `peer_base_url` | Peer address |
| `peer_username` | Peer login name |
| `display_name` | **Required**, unique per user; the display name used for the group switch on the chat page |
| `notes` | Optional note, shown locally only |
| `password_encrypted` | Encrypted password |
| `access_token_encrypted` / refresh / expiry | Session |
| `created_at` / `last_seen_at` / `status` | Metadata |

A single local user may have multiple rows (multiple remote nodes).

### 4.3 Auth and visibility

- Requests inside the tunnel execute as **that logged-in user on the peer**.
- The expert visibility scope = that user's visibility scope on the peer machine.
- There is **no correspondence** between the local user id and the peer user id.

### 4.4 Bidirectional initiation

- Either side may dial; the handshake carries `connection_id` + user proof.
- If a live connection with the same `connection_id` already exists, merge or kick the old one to avoid a double pipe.

## 5. General HTTP tunnel

The mechanism is general: any `method + path + query + headers + body` can be forwarded over the Bridge WS; product v1 first wires up expert lists, chat, history upload, and attachments. It is not a dedicated protocol "serving only these categories"; the optional path allow/deny is only a security switch.

### 5.1 Frame shape (illustrative)

```text
→ tunnel.request  { id, method, path, query, headers, body_b64? | chunks }
← tunnel.response { id, status, headers, body_b64? | chunks, done }
← tunnel.error    { id, code, message }
→ tunnel.cancel   { id }
```

- Large bodies (uploads) are chunked; cancellation and timeouts are supported.
- SSE: v1 may drop it or mark it separately; real-time chat uses the turn stream in §6 to avoid entangling it with the HTTP tunnel.

![Figure 5-1 HTTP tunnel frame flow: request/response/error/cancel frames over the Bridge WS](./assets/bridge-tunnel-frames.png)
<!-- Image brief: show four message bubbles flowing on one Bridge WS pipe: tunnel.request (id/method/path/body), tunnel.response (status/body/chunks/done), tunnel.error, tunnel.cancel. Annotate "large body chunking" and "cancellation/timeout supported". Draw as message-flow bubbles, blue-grey. (Frames with text are best shown as a Mermaid sequence diagram; AI images are conceptual only) -->

### 5.2 Local routing (the browser talks only to the local machine)

1. The Dashboard requests the local machine (list, history, upload, chat, etc.).
2. If the target is `bridge:{connection_id}:{agent_id}` (or carries a connection context):
   - rewrite the agent id in the path to the peer's real id;
   - send it to the peer over that connection's tunnel;
   - return the status/body to the browser unchanged.
3. A real local agent still goes through the existing code, with zero tunnel.

![Figure 5-2 Local routing: the browser talks only to the local machine; bridge:* targets go over the tunnel](./assets/bridge-routing.png)
<!-- Image brief: a routing-decision diagram. Browser → local API; the local router uses a diamond to test whether the target is bridge:{connection_id}:{agent_id}: if so, rewrite the real id and forward to the peer over the tunnel, returning unchanged (blue "tunnel path"); if it is a real local agent, go through the existing code with zero tunnel (green "local path"). Use two colors to distinguish the branches. (Best drawn as a Mermaid flowchart; AI images are conceptual only) -->

## 6. Remote experts and chat

### 6.1 Listing

- The Dashboard's "Remote Nodes" are grouped by connection.
- Locally, call the peer's `GET /api/agents` (or an equivalent list) over the tunnel, map the id to `bridge:{connection_id}:{id}`, then return it to the frontend.
- Do not write the local `agents` table as authoritative (an in-process short cache is optional).

### 6.2 Starting a chat

- The frontend still connects locally: `/api/agents/bridge:…/chat/ws` (or an equivalent entry point).
- The local machine recognizes `bridge:*`: it does not start a local harness; it routes user_turn / subscribe to the peer agent's chat channel.
- The peer runs `GlobalProcessor → harness` normally; chunks come back over the bridge and the local machine pushes them to the browser (frame shapes kept as close as possible to the existing dashboard chat).
- On the same Bridge WS: the **HTTP tunnel** and **turn streaming frames** are multiplexed.
- The Chat dock "remote browser" reads the peer's `env-status` / `harness-sessions` / `handoff` over the tunnel under a `bridge:*` expert, with the picture going through an explicit `browser.*` relay (`WS /api/bridge/connections/{id}/browser-stream/ws`); the standalone Remote Browser page and install/recording still talk to the local machine.

![Figure 6-1 Remote chat relay: frontend → local chat WS → peer harness → chunks returned](./assets/bridge-chat-relay.png)
<!-- Image brief: a remote-expert chat sequence/swimlane diagram. Swimlanes: browser / local bridge / peer harness. Frontend → local /api/agents/bridge:…/chat/ws; the local machine recognizes bridge:* and does not start a local harness, routing user_turn/subscribe to the peer chat channel; the peer GlobalProcessor→harness produces chunks, returned over the bridge, and the local machine pushes them to the browser. At the bottom, note "HTTP tunnel and turn stream multiplexed on the same Bridge WS". Blue-grey. (An exact sequence is best done with Mermaid; AI images are conceptual only) -->

### 6.3 Sessions and history

- Threads are created and persisted only on the expert's side.
- Initiating side: a connection/in-memory transient session (holding the peer `thread_id`) that does **not** write the local `threads` / `thread_messages`.
- Conversation list and history: local API → tunnel → the peer's existing history API.
- Symmetric: when the cloud chats with a local expert, the authoritative copy is local.

### 6.4 Attachments

- The frontend still `POST`s to the local `/api/agents/bridge:…/upload`.
- The local machine tunnels the request to the peer's identically named upload, and files land in the peer's `inbound/`.
- Preview/download is proxied by the local machine (again a tunnelled GET), so the browser never connects directly to the peer.

![Figure 6-2 Attachment proxy: uploads land in the peer's inbound over the tunnel; the local machine only proxies](./assets/bridge-attachment-proxy.png)
<!-- Image brief: an attachment-upload proxy diagram. Frontend POSTs to the local /upload; the local machine tunnels to the peer's identically named upload and files land in the peer's inbound/ (emphasize "files only land on the peer; the local machine only proxies"); preview/download is proxied by the local machine (again a tunnelled GET) so the browser never connects directly to the peer. Arrows carry file icons; the blue tunnel path stands out. Blue-grey. (Mermaid recommended; AI images are conceptual only) -->

## 7. Relationship to existing components

| Existing | Role in Bridge |
|----------|----------------|
| Dashboard chat WS / `WebSocketHub` | Browser↔local only |
| `GlobalProcessor` / harness | Runs only on the expert's side |
| `ask_agent` / Team | Does not participate in cross-instance calls |
| `POST …/upload` + `inbound/` | Executed on the peer; the initiator proxies |
| User JWT | Local ≠ peer; the tunnel uses the peer's login state |
| Connector (OAuth/MCP) | Unrelated; do not conflate the name with `bridge` |

## 8. Phasing

| Phase | Content |
|-------|---------|
| Phase 0 | Connection CRUD, password encryption, login/token exchange, dual-side WS, `connection_id` handshake and dedupe, tunnel ping/health |
| Phase 1 | Remote grouping list, `bridge:*` mapping, pulling agents / history over the tunnel; Dashboard remote entry point |
| Phase 2 | Local chat WS ↔ peer turn relay; transient sessions; cancellation/disconnect |
| Phase 3 | Upload/preview proxied with chunking over the tunnel |
| Phase 4 | Multi-connection stability, token refresh, path policy, observability; add explicit RPC for a very few capabilities if needed |

## 9. Risks and constraints

1. **Pairing cold start**: if the peer HTTP is unreachable when adding a connection, the first pairing cannot be completed with "login/token exchange" — it must be agreed that the reachable side initiates, or a pairing code/relay must be introduced.
2. **Tunnel surface too large**: once the protocol is general, it needs identity isolation + an optional path policy + auditing, to avoid accidentally exposing dangerous admin APIs.
3. **Double-connection race**: both sides dialing the same `connection_id` at once must be merged.
4. **Streaming chat**: do not force turns into a simulated HTTP SSE; the HTTP tunnel and turn stream are framed separately and multiplexed on the same connection.
5. **Version skew**: the handshake carries the octop / bridge protocol version; if incompatible, reject and prompt to upgrade.

## 10. Naming overview

| Purpose | Naming |
|---------|--------|
| Package | `octop.infra.bridge` |
| HTTP management API | `/api/bridge/...` |
| Remote agent id | `bridge:{connection_id}:{remote_agent_id}` |
| Table | `bridge_connections` |
| Product copy | "Remote Node" / Bridge (final naming TBD) |

The earlier discussion's `federation` / `fed:` **are no longer used**.
