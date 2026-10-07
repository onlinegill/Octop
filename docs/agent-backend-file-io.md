# Agent Content-File Backend Hardening Plan

> Goal: Octop server-side reads/writes of agent workspace **content files** always go through `agent.backend` (or `resolve_harness_backend`), never through `Path(...).write_text` / `read_text` directly on disk.  
> Memory-related paths are excepted. Do not add a unified I/O abstraction layer.

---

## 1. Background and problem

Currently some code still reads and writes content files to the local `~/.octop/agents/<agent_id>/` even when the agent has a remote backend (S3/COS, etc.) configured, which causes:

- The user configured a backend and agent tools read from remote storage;
- The Octop server still writes SOUL / seeds / syncs plugin skills, etc. locally;
- Some Dashboard read paths prefer local, so what is shown diverges from the real storage.

With no backend configured (the default), the harness uses `filesystem` + `virtual_mode`, with `root_dir` mounted from `workspace_dir` (i.e. `~/.octop/agents/<id>/`) when the backend is created. In that case writing directly to disk and writing through the backend hit **the same physical file**, but remote backend scenarios must uniformly go through the backend.

---

## 2. Core principles

### 2.1 Swap only the IO channel, not the path

Before and after the change the code operates on **the same file**, and path strings **keep the project's existing form**; Octop does not rewrite paths.

```python
# Before
workspace_dir = paths.ensure_agent_workspace(agent_id)
(workspace_dir / "SOUL.md").write_text(text, encoding="utf-8")

# After — the path string is unchanged, only the IO changes
soul_path = str(workspace_dir / "SOUL.md")
backend = await agent_registry.resolve_harness_backend(agent_id)
await backend.aupload_files([(soul_path, text.encode("utf-8"))])
```

- **Do not** "convert" `~/.octop/agents/<id>/SOUL.md` into another naming scheme such as `/SOUL.md` or `SOUL.md` in the Octop layer.
- Expert templates, skills, seeds, etc.: the path passed to the backend is the same string form as the previous `disk_path = workspace_dir / rel`.

### 2.2 How to obtain the backend

| Scenario | Usage |
|----------|-------|
| Agent already running | `agent.backend` |
| Before start / not running | `await agent_registry.resolve_harness_backend(agent_id)` |

`resolve_harness_backend` already calls `resolve_backend(spec, workspace_dir=str(workspace))`; `root_dir` is mounted **when the backend is created**, and routine reads/writes pass only the business path.

### 2.3 Do not add a `workspace_io` module

Call the backend protocol directly:

- Read: `aread(path)`, `als(path)`, `adownload_files([path])`
- Write: `aupload_files([(path, bytes)])`
- Search: `aglob` / `agrep`

Existing thin helpers (such as `api/common/workspace.py`'s `coerce_read_content`, `gateway/backend_files.backend_download_bytes`) can be reused without wrapping them in a new layer.

### 2.4 What `workspace_dir` is still for

`~/.octop/agents/<id>/` remains the harness `workspace_dir`, used for:

- `root_dir` mounting when constructing the backend (filesystem by default);
- **local artifacts** such as checkpoints, sessions JSONL, and the octop-memory SQLite (not managed by the backend protocol);
- the terminal PTY cwd (see the exception in §6).

**Content files** (md, skills, etc.) are no longer `read_text`/`write_text`-ed by Octop against this directory.

---

## 3. Scope

### 3.1 Included (must go through the backend)

| Type | Typical path (example, subject to the actual `workspace_dir` join) |
|------|--------------------------------------------------------------------|
| Bootstrap templates | `{workspace_dir}/AGENTS.md`, `BOOTSTRAP.md`, … |
| Persona | `{workspace_dir}/SOUL.md` |
| Skills | `{workspace_dir}/skills/<name>/SKILL.md` |
| Expert templates | Each relative path under `{workspace_dir}/` |
| Workspace config md | `{workspace_dir}/USER.md`, `HEARTBEAT.md`, etc. |
| Dashboard workspace API | Already goes through the backend, keep |
| Context-usage estimation | Reads `AGENTS.md`, `USER.md`, `SOUL.md`, etc. (see §3.2) |
| Bootstrap status | Checks `BOOTSTRAP.md`, `.bootstrapped` |
| Workspace content in system backup | Switch to `export_workspace_zip(backend)` |

### 3.2 Memory exemptions (not forced this round)

| Type | Note |
|------|------|
| `MEMORY.md` | Long-term memory |
| `daily/YYYY-MM-DD.md` | Daily memory; reads already go through the backend, deletion may stay a local `unlink` for now |
| `sessions/*.jsonl` | Chat-history fallback |
| octop-memory / checkpoint | Bound to `workspace_dir`; not backend content files |

### 3.3 Out of scope

- Skill scripts inside the Expert library (executed by the agent at runtime via harness tools)
- `~/.octop/plugins/` install, `~/.octop/security/` tool guard
- Expert catalog bundled-source reads

---

## 4. Change list

### 4.1 Write paths (highest priority)

| Location | Current | Change |
|----------|---------|--------|
| `infra/agents/manager.py` `_seed_workspace` | `init_workspace(ws_dir)` writes locally | `init_workspace(tmp_dir)` → collect files → `backend.aupload_files`, with path `str(workspace_dir / rel)` |
| `infra/agents/persona/` (SOUL / persona render) | `Path.write_text` | Make it async, take `backend` as a parameter; `aupload_files([(str(workspace_dir / "SOUL.md"), ...)])` |
| `infra/agents/manager.py` `_start_agent` | Calls `write_soul_md(workspace_dir=...)` | `resolve_harness_backend` first, then write SOUL |
| `infra/agents/plugins/manager.py` `sync_skills_to_workspace` | `shutil.copytree` to local | Rename to `sync_skills_to_backend`; walk the plugin dir → `aupload_files`, with path `str(workspace_dir / "skills" / name / ...)` |
| `infra/agents/manager.py` `_apply_expert_template` | Local `write_text` + optional `aupload_files` | **Remove the local write**; path uses `str(ws / rel_path.lstrip("/"))`, matching the previous `disk_path` |
| `infra/agents/manager.py` `_ensure_skills_dir` | Local `mkdir` | Remove (uploads create directories implicitly) |
| `infra/utils/browser_media.py` | Screenshots written to local `outbound/screenshots` | After the screenshot, `aupload_files` to the same logical path, or short-term mark as local-backend only |

### 4.2 Read paths

| Location | Current | Change |
|----------|---------|--------|
| `infra/agents/context_breakdown.py` | `_read_workspace_text(workspace_dir, name)` | Change to `backend.aread(str(workspace_dir / name))`; `MEMORY.md` may keep the memory-exemption policy |
| `infra/agents/manager.py` `_bootstrap_pending` | Reads local `BOOTSTRAP.md`, `.bootstrapped` | Make it async and decide via `backend.aread` / `exists` |
| `api/routers/agents.py` / `experts.py` | Calls `_bootstrap_pending(workspace)` | Pass in the backend |
| `api/routers/chat/serialize.py` | Sessions prefer local | **Memory exemption**: keep or document; non-memory logic does not read local content files |

### 4.3 Gateway and backup

| Location | Current | Change |
|----------|---------|--------|
| `infra/gateway/backend_files.py` | `Path.read_bytes` fallback when preview fails | Drop the silent fallback for agent-workspace staging; host temp files can still upload first, then be read via the backend |
| `infra/backup/system_archive.py` | tar packages the local `agent_workspace` | Use `export_workspace_zip(backend)` per agent |
| `infra/backup/workspace_archive.py` | replace mode `_clear_local_workspace` | Remote replace needs to list backend files then overwrite; or add a doc warning + later support for delete |

### 4.4 Already compliant (only check path conventions when aligning)

- `api/routers/workspace.py`
- `api/routers/skills.py`
- `api/routers/agent_files.py` (daily read)
- `infra/gateway/media.py` `AgentBackedMediaBackend`

If any of the above modules uses a form such as `/skills/...` that is inconsistent with the disk path, align it with the product convention: **unify to the `str(workspace_dir / ...)` form** (consistent with this round's principle).

---

## 5. Startup sequence (after the change)

```
create(agent)
  ├─ DB insert
  ├─ backend = resolve_harness_backend(agent_id)
  ├─ _seed_workspace(agent_id)     # tmp → aupload_files, path prefixed with workspace_dir
  ├─ write_soul_md(backend, ...)   # if needed
  ├─ create_agent(..., init_workspace=False)
  └─ _apply_expert_template(...)   # aupload_files only
```

- No `Path.write_text` on content files anywhere.
- `init_workspace=False`: avoids the harness writing locally again and creating a dual track; seeding is done by Octop through the backend.

---

## 6. Explicit exceptions

| Scenario | Handling |
|----------|----------|
| **Terminal** `api/routers/terminal.py` | PTY cwd remains `workspace_dir`; with a remote backend the UI is disabled or shows "local backend only" |
| **Memory deletion** `agent_files.delete_daily_memory` | Keep local `unlink` for now; unify once the backend supports delete |
| **sessions JSONL** | Memory exemption |
| **Default filesystem** | When `root_dir` = `workspace_dir`, `aupload_files` and the old `write_text` land on the same file, so default users notice nothing |

---

## 7. Compatibility and migration

### 7.1 Existing agent + remote backend + files local, remote empty

Do an idempotent migration in `_start_agent` or a one-off CLI:

1. `resolve_harness_backend(agent_id)`
2. If the backend root listing is empty and the local `workspace_dir` has content files
3. `aupload_files` the local files (excluding memory-exempt directories) to the backend, path still `str(workspace_dir / rel)`

### 7.2 Default filesystem users

No migration steps; only the IO channel changes, the physical path does not.

---

## 8. PR split

| PR | Content | Risk |
|----|---------|------|
| **PR-1** | Write paths: seed, soul, plugins, expert template; remove local dual writes | Medium |
| **PR-2** | Read paths: context_breakdown, bootstrap_pending | Low |
| **PR-3** | Gateway fallback removal, system backup via backend | Medium |
| **PR-4** | Remote-backend migration logic + tests | Low |

Each PR runs `make all` independently; smoke-test the default filesystem before merging (create agent, read SOUL, list skills).

---

## 9. Test plan

| Type | Content |
|------|---------|
| Unit | `FakeBackend` records `aupload_files` path and bytes; after creating an agent, assert the path is the absolute form under `workspace_dir` |
| Unit | `_apply_expert_template` no longer calls `Path.write_text` |
| Unit | `bootstrap_pending` decides via the backend |
| Integration | Default filesystem: after creating an expert agent, `GET workspace/file` matches disk |
| Integration | Mock remote backend: after `aupload_files` receives the files, local staging has no corresponding content files (except memory/checkpoint directories) |

---

## 10. Definition of done

- [ ] `infra/agents/manager.py`, `persona.py`, `plugins/manager.py` contain no `write_text` / `copytree` on content files (except memory-exempt paths)
- [ ] `context_breakdown`, `bootstrap_pending` read via the backend
- [ ] `gateway/backend_files` has no local fallback for agent workspace
- [ ] `system_archive` backups include backend content
- [ ] `make all` green; `cd dashboard && npx tsc -b` when the dashboard is involved
- [ ] Code review: new agent content-file IO must show `backend.aread` / `aupload_files`, never `ensure_agent_workspace(...) / "xxx").write_text`

---

## 11. References

- Backend resolution: `infra/agents/manager.py` → `resolve_harness_backend`
- Harness mounting: `octop_harness.backends.resolve_backend(spec, workspace_dir=...)`
- Compliant examples: `api/routers/workspace.py`, `api/routers/skills.py`
- Path layout: `infra/utils/paths.py` → `agent_workspace` / `ensure_agent_workspace`

---

## 12. Local root_dir and the execute jail (addendum)

When the agent backend is local `local_shell` and **Linux + `virtual_mode=True` + `root_dir` not host `/` + the host has `bwrap`** all hold, the harness routes to `BubbledLocalShellBackend` **before constructing the backend**, wrapping `execute` (including Skill scripts) in bubblewrap: the work root is bound to `/`, aligned with the file tools' virtual paths. Otherwise (`root_dir` is the host root, non-Linux, no bwrap, `filesystem`) it uses the regular `HarnessLocalShellBackend`: no directory jail, but with **octop-harness >= 1.0** and `virtual_mode` + a non-host `root_dir`, it still rewrites virtual absolute paths in `execute` commands to under that `root_dir` before running on the host.

`scripts/install.sh` (and the desktop Linux install script) makes a best effort to install `bubblewrap` on **Linux**; when saving a local `root_dir`, the dashboard also calls `POST /api/filesystem/ensure-bwrap` to do the same best-effort install. On macOS / without bwrap there is no directory jail, and the file tools still rely on the deepagents `virtual_mode`; `BackendWorkspace` read/materialize path fallback is unchanged: absolute paths first map virtually to `root_dir`, then to the raw host path; relative paths try `{root_dir}/{rel}` first, then `{workspace_dir}/{rel}`. Dashboard path I/O: use ``dashboard/src/utils/workspaceIoPath.ts`` for download/file API paths
(host absolute stays ``file://…``). Dock tab identity may still ``canonicalizeDockFilePath``;
do not collapse host abs before calling BackendWorkspace.

---

## 13. Docker sandbox backend

When you need to isolate the agent's filesystem tools and `execute` inside a Docker container, configure harness `type: "docker"` (requires `octop-harness[docker]` and a working local Docker daemon).

The host ``workspace_dir`` is written into ``config_json.workspace_dir`` **when the expert is created** (default
``{OCTOP_HOME}/agents/<agent_id>/``; overridable at creation). **All backend types** share this
path as the harness ``HarnessAgentConfig.workspace_dir``:

| Backend | Expert-visible content | Host ``workspace_dir`` |
|---------|------------------------|------------------------|
| ``local_shell`` / ``filesystem`` | Usually aligned to this directory (or ``root_dir``) | sessions / memory / checkpoints |
| ``docker`` | The **same-named absolute path inside the container** (no bind-mount) | Same as above |
| Object storage, etc. | Remote objects; local materialization/cache per backend | Same as above |

Auto-compaction and `/compact` write the evicted original text to
``{artifacts_root}/conversation_history/{session_id}.md``. For local
``local_shell`` / ``filesystem``, the harness ``MountedCompositeBackend`` pulls
``artifacts_root`` into the workspace (Octop: ``.octop/conversation_history/``).
``docker`` / ``opensandbox`` / COS, etc. **do not** have this wrapping: offload may land at
``/conversation_history/`` inside the container. Auto-compaction still continues summarizing if the write fails
(``file_path=None``); a failed ``/compact`` write fails the whole operation without changing conversation state.

The harness side only honors the ``workspace_dir`` passed by the caller; Docker by default mirrors it to the in-container workspace root.

### Written directly in the agent `config_json.backend`

```json
{
  "backend": {
    "type": "docker",
    "image": "python:3.12-slim",
    "sandbox_scope": "agent",
    "sandbox_prefix": "octop_sandbox",
    "allow_network": false,
    "memory": "512m"
  }
}
```

Fields:

| Field | Description |
|-------|-------------|
| `sandbox_scope` | `agent` (default) / `user` / `fixed` |
| `sandbox_prefix` | Container name prefix; Octop injects `octop_sandbox` by default; the library defaults to `sandbox` |
| `sandbox_id` | Required for `fixed` |
| `username` | Used for `user`; when omitted, Octop injects the expert owner's username |
| `previewable` | Only affects the Admin "My storage" browse button; defaults to true only for `fixed`. Expert workspaces are always previewable |
| `volumes` | User-configured mounts, passed through unchanged; **do not** auto-create a named volume |

Container naming:

- `agent` → `{prefix}_agent_{agentId}` (e.g. `octop_sandbox_agent_ZE6GR2`)
- `user` → `{prefix}_{username}` (multiple experts for the same user share one sandbox)
- `fixed` → `sandbox_id`

Lifecycle: create if absent; `close` / deleting the expert does **not** delete the container; only an explicit `destroy()` stops+removes it (deleting the files inside the container too).

### Or via storage_backends (`kind=docker`) + a named reference

- `bucket` or `config_json.image`: image name (required)
- The Admin form can configure `sandbox_scope` / `sandbox_prefix` / `sandbox_id` / `username`, written into `config_json`
- Other optional fields: `allow_network`, `memory`, `cpus`, `pids_limit`, `command_timeout`, `volumes`, etc.

```json
{ "type": "named", "name": "my-docker-sandbox" }
```

Behavior notes:

- **Same-named path, lands in two places (no auto-mounting)**:
  - Expert ``workspace_dir`` (written to config/library at creation; Octop default ``{OCTOP_HOME}/agents/<id>/``): host holds sessions / memory / checkpoints
  - The same absolute path inside the container: the expert-visible workspace (determined by the passed ``workspace_dir``; overridable with ``workspace_path``; falls back to ``/workspace`` when neither is set)
- **Sandbox FS**: `ls` / `read` / `write` / `execute` all happen inside the container, via the Docker Python SDK
- **Expert workspace** (expert page file tree / SOUL.md, etc.) is always previewable; it goes through the agent backend API (for Docker, the same-named path inside that expert's container)
- **Admin storage browsing** (`/admin/backend`): controlled by `previewable`; for Docker only `fixed` is browsable by default; the `agent`/`user` buttons are greyed out, but "Probe" still verifies connectivity (a test sandbox)
- `allow_network=false` by default; enable explicitly when pip/curl is needed
- Before startup it confirms the image is local; if missing it tries to pull
- Images are pulled automatically when the Admin enables the Docker storage backend or clicks "Test availability"
- The storage-backend browse API supports the docker kind (when `previewable`); probing uses a test-id sandbox
- The Docker card on the Admin "Supported types" page can configure the sandbox image; after opening the config drawer it can probe the local Docker and offers one-click install / copy script / install prompt
