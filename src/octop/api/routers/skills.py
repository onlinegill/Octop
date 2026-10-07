"""Skills router — per-agent ``SKILL.md`` library.

Each agent's skills live under its harness backend at ``/skills/<name>/SKILL.md``
(matching finnie's convention). This router thinly wraps the workspace
backend so the dashboard sees a *named* skills view rather than a raw
file listing:

  GET    /api/agents/{aid}/skills                 → summaries
  GET    /api/agents/{aid}/skills/{name}          → full detail (frontmatter + body)
  POST   /api/agents/{aid}/skills                 → body { name, content }
  DELETE /api/agents/{aid}/skills/{name}          → remove SKILL.md
  POST   /api/agents/{aid}/skills/{name}/enable
  POST   /api/agents/{aid}/skills/{name}/disable

A skill is considered "enabled" unless its slug is listed in
``agent.config.skills_disabled``. The enable/disable endpoints toggle
that list and hot-sync ``HarnessAgentConfig.skills_disabled`` so
``SkillFilterMiddleware`` excludes disabled skills on every turn.

Limitations
-----------
The protocol has no ``delete``: removing a skill rewrites SKILL.md to
an empty file with the leading frontmatter block ``---\\nremoved: true\\n---``
so the directory listing still shows the entry but the dashboard knows
to filter it. This is a deliberate design compromise — protocol-level
delete is the right long-term answer.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import os
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, cast

import yaml
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from octop.api.common.agent import require_agent_owner_row, require_agent_row
from octop.api.deps import current_user, get_server, require_permission
from octop.infra.agents.manager import (
    skill_package_ids_list,
)
from octop.infra.agents.manager import (
    skills_disabled_set as _disabled_set,
)
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.skills.presentation import apply_skill_presentation
from octop.infra.skills.skill_package_store import SkillPackageStore, normalize_copy_policy
from octop.infra.skills.skill_packages import (
    SkillPackageError,
    SkillPackageTooLarge,
    resolve_skill_package,
    validate_skill_slug,
)
from octop.infra.skills.skill_transfer import (
    SkillTransferConflict,
    SkillTransferNotFound,
    copy_package_skills_to_workspace,
    copy_workspace_skill_to_package,
    copy_workspace_skill_to_workspace,
)
from octop.infra.utils.locale import Locale, resolve_request_locale

logger = logging.getLogger(__name__)

router = APIRouter()

_BUILTIN_ROOT = "_builtin_skills"
_SKILLS_ROOT = "skills"


@dataclass
class _AgentCtx:
    runtime: Any
    workspace: Any
    config: dict[str, Any]


async def _ctx(
    agent_id: str,
    *,
    user: Any,
    as_user: int | None,
    server: Any,
    owner_only: bool = True,
) -> _AgentCtx:
    assert server.app_runtime is not None
    registry = server.app_runtime.agent_registry
    require = require_agent_owner_row if owner_only else require_agent_row
    row = require(agent_id, user=user, as_user=as_user, server=server)
    cfg = registry.get_config(agent_id)
    agent = registry.get_agent(agent_id)
    return _AgentCtx(runtime=row, workspace=agent.workspace, config=cfg)


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a markdown file with optional YAML frontmatter.

    Accepts both ``---``-delimited and ``+++`` (TOML) blocks; we only
    handle YAML for simplicity since finnie's skills all use YAML.
    Returns ``(metadata_dict, body)``. Malformed frontmatter is treated
    as no-frontmatter (the file is its own body).
    """
    if not text.startswith("---\n"):
        return {}, text
    # Find the closing delimiter
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    body = text[end + 4 :].lstrip("\n")
    try:
        meta = yaml.safe_load(raw) or {}
        if not isinstance(meta, dict):
            return {}, text
        return meta, body
    except yaml.YAMLError:
        return {}, text


async def _aread_text(workspace: Any, path: str) -> str | None:
    return cast(str | None, await workspace.aread_text(path))


async def _aoverwrite_text(workspace: Any, path: str, content: str) -> str | None:
    try:
        await workspace.awrite_text(path, content, force=True)
    except Exception as exc:
        return f"{exc}"
    return None


def _summary_dict(
    name: str,
    meta: dict[str, Any],
    *,
    enabled: bool,
    kind: str,
    locale: Locale | None = None,
) -> dict[str, Any]:
    out = apply_skill_presentation(
        {
            # ``slug`` is the directory name — the stable identifier used for all
            # by-name operations (detail / enable / disable / delete / install
            # check). ``name`` is the frontmatter display name, which may differ
            # from the slug (e.g. dir "tencent-meeting-skill" with frontmatter
            # name "tencent-meeting-mcp"); using ``name`` as the id 404s.
            "slug": name,
            "name": str(meta.get("name") or name),
            "description": str(meta.get("description") or ""),
            "enabled": enabled,
            "kind": kind,
        },
        meta,
        locale=locale,
    )
    return out


def _skill_manifest_path(name: str, kind: str, workspace: Any) -> str:
    root = _BUILTIN_ROOT if kind == "builtin" else _SKILLS_ROOT
    return f"{root}/{name}/SKILL.md"


async def _resolve_skill(
    workspace: Any,
    name: str,
) -> tuple[str, str, str] | None:
    """Resolve a skill by name. Workspace entries override builtin names."""
    for kind in ("workspace", "builtin"):
        manifest_path = _skill_manifest_path(name, kind, workspace)
        manifest = await _aread_text(workspace, manifest_path)
        if manifest is None:
            continue
        meta, body = _parse_frontmatter(manifest)
        if meta.get("removed"):
            continue
        return manifest_path, kind, body
    return None


async def _guard_package_only_skill_write(
    workspace: Any,
    config: dict[str, Any],
    server: Any,
    slug: str,
    user: Any = None,
) -> None:
    """Reject writes that would alter a skill supplied only by a mounted package.

    Also rejects writes to workspace copies stamped ``locked`` by a
    ``copy_policy="lock"`` package unless the requester created that package
    (or is admin) — the copy is meant to be used, not rewritten (#770).
    """
    workspace_manifest = await _aread_text(workspace, f"{_SKILLS_ROOT}/{slug}/SKILL.md")
    if workspace_manifest is not None:
        metadata, _body = _parse_frontmatter(workspace_manifest)
        if not metadata.get("removed"):
            origin = str(metadata.get("origin") or "").strip()
            if metadata.get("locked") and origin and server.services is not None:
                store = SkillPackageStore(
                    repo=server.services.skill_package_repo,
                    root=server.paths.skill_packages_dir,
                )
                origin_row = store.repo.get(origin)
                # Unknown origin stays locked for regular users (fail-safe)
                # but admins keep an escape hatch for orphaned copies.
                allowed = bool(getattr(user, "is_admin", False)) or (
                    user is not None
                    and origin_row is not None
                    and str(getattr(user, "id", "")) == origin_row.created_by
                )
                if not allowed:
                    raise OctopError(
                        ErrorCode.SKILL_PACKAGE_LOCKED,
                        f"skill {slug!r} was copied from a locked skill package",
                    )
            return

    assert server.services is not None
    store = SkillPackageStore(
        repo=server.services.skill_package_repo,
        root=server.paths.skill_packages_dir,
    )
    for package_id in skill_package_ids_list(config):
        if any(skill["slug"] == slug for skill in store.list_skill_summaries(package_id)):
            raise OctopError(
                ErrorCode.FORBIDDEN,
                f"skill {slug!r} is supplied by a mounted package",
            )


async def _enabled_skill_names(
    server: Any,
    *,
    agent_id: str,
    user: Any,
) -> set[str]:
    """Return installed, non-disabled skill names for an agent."""
    await _ctx(agent_id, user=user, as_user=None, server=server, owner_only=False)
    assert server.app_runtime is not None
    names: set[str] = set()
    for summary in await server.app_runtime.agent_registry.list_skill_summaries(agent_id):
        if summary.get("enabled"):
            names.add(str(summary["name"]))
            slug = summary.get("slug")
            if slug:
                names.add(str(slug))
    return names


async def validate_chat_skills(
    server: Any,
    *,
    agent_id: str,
    user: Any,
    names: list[str] | None,
) -> list[str] | None:
    from octop.api.common.validators import validate_chat_skills as _validate

    return await _validate(server, agent_id=agent_id, user=user, names=names)


# --- read endpoints ---------------------------------------------------------


@router.get("/agents/{agent_id}/skills")
async def list_skills(
    agent_id: str,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    await _ctx(agent_id, user=user, as_user=as_user, server=server, owner_only=False)
    assert server.app_runtime is not None
    return cast(
        list[dict[str, Any]],
        await server.app_runtime.agent_registry.list_skill_summaries(
            agent_id,
            locale=resolve_request_locale(request),
        ),
    )


class SkillPackageMountBody(BaseModel):
    package_ids: list[str]


class CopyPackageSkillsBody(BaseModel):
    skill_slugs: list[str]
    overwrite: bool = False


class CopyWorkspaceSkillBody(BaseModel):
    source_agent_id: str
    slug: str
    overwrite: bool = True


class PushSkillToPackageBody(BaseModel):
    package_id: str
    overwrite: bool = False


@router.get(
    "/agents/{agent_id}/skill-packages",
    summary="List global skill packages mounted on an agent",
)
async def list_skill_package_mounts(
    agent_id: str,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    require_agent_owner_row(agent_id, user=user, as_user=as_user, server=server)
    assert server.app_runtime is not None
    package_ids = skill_package_ids_list(server.app_runtime.agent_registry.get_config(agent_id))
    assert server.services is not None
    store = SkillPackageStore(
        repo=server.services.skill_package_repo,
        root=server.paths.skill_packages_dir,
    )
    locale = resolve_request_locale(request)
    packages: list[dict[str, Any]] = []
    for package_id in package_ids:
        package = store.repo.get(package_id)
        if package is None:
            continue
        packages.append(
            {
                "id": package.id,
                "name": package.name,
                "description": package.description,
                "skills": store.list_skill_summaries(package_id, locale=locale),
            }
        )
    return {"package_ids": package_ids, "packages": packages}


@router.put(
    "/agents/{agent_id}/skill-packages",
    summary="Replace global skill packages mounted on an agent",
)
async def replace_skill_package_mounts(
    agent_id: str,
    body: SkillPackageMountBody,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, list[str]]:
    require_agent_owner_row(agent_id, user=user, as_user=as_user, server=server)
    assert server.app_runtime is not None
    package_ids = skill_package_ids_list({"skill_package_ids": body.package_ids})
    await server.app_runtime.agent_registry.persist_skill_package_ids(agent_id, package_ids)
    return {"package_ids": package_ids}


def _skill_package_store(server: Any) -> SkillPackageStore:
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "skill package store not initialized")
    return SkillPackageStore(
        repo=server.services.skill_package_repo,
        root=server.paths.skill_packages_dir,
    )


def _skill_transfer_error(exc: SkillPackageError, *, locale: Locale) -> OctopError:
    if isinstance(exc, SkillTransferConflict):
        return OctopError.localized(
            ErrorCode.SKILL_ALREADY_EXISTS,
            locale,
            name=exc.slug,
        )
    if isinstance(exc, SkillTransferNotFound):
        return OctopError(ErrorCode.NOT_FOUND, str(exc))
    return OctopError(ErrorCode.SLASH_BAD_ARGS, str(exc))


@router.post(
    "/agents/{agent_id}/skill-packages/{package_id}/copy",
    summary="Copy package skills into an agent workspace",
)
async def copy_skill_package_to_workspace(
    agent_id: str,
    package_id: str,
    body: CopyPackageSkillsBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("skill_packages")),
    server: Any = Depends(get_server),
) -> dict[str, list[str]]:
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    store = _skill_package_store(server)
    package_row = store.repo.get(package_id)
    if package_row is None:
        raise OctopError.localized(
            ErrorCode.SKILL_PACKAGE_NOT_FOUND,
            resolve_request_locale(request),
        )
    store.assert_can_copy(package_row, user)
    try:
        requested_slugs = list(
            dict.fromkeys(validate_skill_slug(slug) for slug in body.skill_slugs)
        )
        copied_identity_keys = set(requested_slugs)
        for slug in requested_slugs:
            copied_identity_keys.update(await _skill_disable_keys(ctx, slug))
        copied = await copy_package_skills_to_workspace(
            store=store,
            package_id=package_id,
            slugs=requested_slugs,
            workspace=ctx.workspace,
            overwrite=body.overwrite,
            copy_policy=normalize_copy_policy(package_row.copy_policy),
        )
    except SkillPackageError as exc:
        raise _skill_transfer_error(
            exc,
            locale=resolve_request_locale(request),
        ) from exc

    for slug in copied:
        copied_identity_keys.update(await _skill_disable_keys(ctx, slug))
    disabled = _disabled_set(ctx.config)
    if disabled.intersection(copied_identity_keys):
        disabled.difference_update(copied_identity_keys)
        await _persist_disabled(server, agent_id, disabled)
    if server.services is not None:
        server.services.audit_repo.write(
            actor=user.username,
            action="skill_package.copied",
            target=package_id,
            payload=",".join(copied)[:200],
        )
    return {"copied": copied}


@router.post(
    "/agents/{agent_id}/skills/{name}/push-to-package",
    summary="Copy a workspace skill into a global skill package",
)
async def push_workspace_skill_to_package(
    agent_id: str,
    name: str,
    body: PushSkillToPackageBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("skill_packages")),
    server: Any = Depends(get_server),
) -> dict[str, str]:
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    store = _skill_package_store(server)
    row = store.repo.get(body.package_id)
    if row is None:
        raise OctopError.localized(
            ErrorCode.SKILL_PACKAGE_NOT_FOUND,
            resolve_request_locale(request),
        )
    store.assert_can_mutate(row, user)
    await _guard_package_only_skill_write(ctx.workspace, ctx.config, server, name, user)
    try:
        slug = await copy_workspace_skill_to_package(
            workspace=ctx.workspace,
            store=store,
            package_id=body.package_id,
            slug=name,
            overwrite=body.overwrite,
        )
    except SkillPackageError as exc:
        raise _skill_transfer_error(
            exc,
            locale=resolve_request_locale(request),
        ) from exc

    assert server.app_runtime is not None
    await server.app_runtime.agent_registry.refresh_agents_for_package(body.package_id)
    return {"package_id": body.package_id, "slug": slug}


@router.get("/agents/{agent_id}/skills/{name}")
async def get_skill(
    agent_id: str,
    name: str,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    ctx = await _ctx(
        agent_id,
        user=user,
        as_user=as_user,
        server=server,
        owner_only=False,
    )
    resolved = await _resolve_skill(ctx.workspace, name)
    if resolved is None:
        raise OctopError(ErrorCode.NOT_FOUND, f"skill {name!r} not found")
    manifest_path, kind, _body = resolved
    manifest = await _aread_text(ctx.workspace, manifest_path)
    assert manifest is not None
    meta, body = _parse_frontmatter(manifest)
    disabled = _disabled_set(ctx.config)
    return {
        **_summary_dict(
            name,
            meta,
            enabled=name not in disabled,
            kind=kind,
            locale=resolve_request_locale(request),
        ),
        "frontmatter": meta,
        "body": body,
        "raw": manifest,
    }


# --- write endpoints --------------------------------------------------------


class SkillFilePart(BaseModel):
    path: str
    content_base64: str


class CreateSkillBody(BaseModel):
    name: str
    content: str = ""
    files: list[SkillFilePart] | None = None
    overwrite: bool = False


class UpdateSkillBody(BaseModel):
    content: str = ""
    files: list[SkillFilePart] | None = None


class ImportSkillBody(BaseModel):
    bundle_url: str
    version: str = ""
    enable: bool = True
    overwrite: bool = False


async def _write_skill_files(
    workspace: Any,
    skill_root: str,
    files: Sequence[tuple[str, bytes]],
) -> None:
    """Write skill files into a workspace, creating empty directories first."""
    dirs = [path for path, _content in files if path.endswith("/")]
    payload = [(path, content) for path, content in files if not path.endswith("/")]
    for path in dirs:
        await workspace.amkdir(f"{skill_root}/{path}".rstrip("/"))
    if payload:
        await workspace.aupload_many(
            [(f"{skill_root}/{path}", content) for path, content in payload]
        )


def _files_from_skill_body(
    *,
    content: str,
    files: list[SkillFilePart] | None,
) -> list[tuple[str, bytes]]:
    if files:
        decoded: list[tuple[str, bytes]] = []
        for part in files:
            try:
                decoded.append((part.path, base64.b64decode(part.content_base64, validate=True)))
            except Exception as exc:
                raise OctopError(
                    ErrorCode.SLASH_BAD_ARGS,
                    f"invalid base64 content for {part.path!r}",
                ) from exc
        return decoded
    if not content:
        raise OctopError(ErrorCode.SLASH_BAD_ARGS, "content or files is required")
    return [("SKILL.md", content.encode("utf-8"))]


@router.post("/agents/{agent_id}/skills", status_code=201)
async def create_skill(
    agent_id: str,
    body: CreateSkillBody,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    try:
        name = validate_skill_slug(body.name)
        package = resolve_skill_package(
            slug=name,
            files=_files_from_skill_body(content=body.content, files=body.files),
            source="manual",
        )
    except SkillPackageTooLarge as exc:
        raise OctopError(ErrorCode.SLASH_BAD_ARGS, str(exc)) from exc
    except SkillPackageError:
        raise OctopError(ErrorCode.NOT_FOUND, "invalid skill name") from None
    await _guard_package_only_skill_write(ctx.workspace, ctx.config, server, name, user)
    # Conflict check must use SKILL.md — ZIP payloads often list siblings first,
    # and soft-delete only marks the manifest (leaving sibling files behind).
    existing = await _aread_text(ctx.workspace, f"skills/{name}/SKILL.md")
    if existing is not None:
        meta, _ = _parse_frontmatter(existing)
        if not meta.get("removed") and not body.overwrite:
            raise OctopError(ErrorCode.SKILL_ALREADY_EXISTS, f"skill {name!r} already exists")
    with contextlib.suppress(Exception):
        await ctx.workspace.adelete(f"skills/{name}")
    await _write_skill_files(ctx.workspace, f"skills/{name}", package.files)
    # Reinstall after disable/delete must clear skills_disabled (ZIP create
    # always installs as enabled, matching URL import with enable=True).
    disabled = _disabled_set(ctx.config)
    if name in disabled:
        disabled.discard(name)
        await _persist_disabled(server, agent_id, disabled)
    skill_md = next(
        (content for path, content in package.files if path == "SKILL.md"),
        body.content.encode("utf-8"),
    )
    meta, _body = _parse_frontmatter(skill_md.decode("utf-8", errors="replace"))
    return _summary_dict(name, meta, enabled=True, kind="workspace")


@router.put("/agents/{agent_id}/skills/{name}")
async def update_skill(
    agent_id: str,
    name: str,
    body: UpdateSkillBody,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Overwrite an installed workspace skill via BackendWorkspace only.

    A ``content``-only body (the dashboard editor edits SKILL.md) rewrites just
    the manifest in place - sibling files and directories are preserved. A
    ``files`` payload replaces the whole skill directory, matching
    create-with-overwrite / re-import semantics.
    """
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    try:
        slug = validate_skill_slug(name)
        package = resolve_skill_package(
            slug=slug,
            files=_files_from_skill_body(content=body.content, files=body.files),
            source="manual",
        )
    except SkillPackageTooLarge as exc:
        raise OctopError(ErrorCode.SLASH_BAD_ARGS, str(exc)) from exc
    except SkillPackageError:
        raise OctopError(ErrorCode.NOT_FOUND, "invalid skill name") from None

    await _guard_package_only_skill_write(ctx.workspace, ctx.config, server, slug, user)
    existing = await _aread_text(ctx.workspace, f"skills/{slug}/SKILL.md")
    if existing is None:
        raise OctopError(ErrorCode.NOT_FOUND, f"skill {slug!r} not found")
    meta_existing, _ = _parse_frontmatter(existing)
    if meta_existing.get("removed"):
        raise OctopError(ErrorCode.NOT_FOUND, f"skill {slug!r} not found")

    # ``content``-only updates (the dashboard editor edits SKILL.md) must keep
    # the skill's sibling files and directories (README.md, references/, ...)
    # intact - deleting the whole directory here wiped imported ZIP skills down
    # to a lone SKILL.md. A full ``files`` payload still replaces the directory
    # wholesale, matching create-with-overwrite / re-import semantics. The
    # truthiness check mirrors ``_files_from_skill_body`` so an empty ``files``
    # list falls back to the content path on both sides.
    if body.files:
        with contextlib.suppress(Exception):
            await ctx.workspace.adelete(f"skills/{slug}")
    await _write_skill_files(ctx.workspace, f"skills/{slug}", package.files)
    skill_md = next(
        (content for path, content in package.files if path == "SKILL.md"),
        body.content.encode("utf-8"),
    )
    meta, _body = _parse_frontmatter(skill_md.decode("utf-8", errors="replace"))
    disabled = _disabled_set(ctx.config)
    return _summary_dict(
        slug,
        meta,
        enabled=slug not in disabled,
        kind="workspace",
    )


class _AgentWorkspaceInstallTarget:
    """Install skills into an agent workspace (``skills/<slug>/``)."""

    def __init__(
        self,
        *,
        workspace: Any,
        config: dict[str, Any],
        server: Any,
        agent_id: str,
    ) -> None:
        self._workspace = workspace
        self._config = config
        self._server = server
        self._agent_id = agent_id

    async def skill_exists(self, slug: str) -> bool:
        return await _resolve_skill(self._workspace, slug) is not None

    async def write_files(self, slug: str, files: list[tuple[str, bytes]]) -> None:
        skill_root = f"skills/{slug}"
        with contextlib.suppress(Exception):
            await self._workspace.adelete(skill_root)
        await _write_skill_files(self._workspace, skill_root, files)

    async def after_install(self, slug: str, *, enable: bool | None = None) -> None:
        if not enable:
            return
        disabled = _disabled_set(self._config)
        disabled.discard(slug)
        await _persist_disabled(self._server, self._agent_id, disabled)


@router.post(
    "/agents/{agent_id}/skills/copy",
    status_code=201,
    summary="Copy a workspace skill from another agent",
)
async def copy_skill_from_agent(
    agent_id: str,
    body: CopyWorkspaceSkillBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    dest = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    require_agent_owner_row(body.source_agent_id, user=user, as_user=as_user, server=server)
    assert server.app_runtime is not None
    source = server.app_runtime.agent_registry.workspace_for_agent(body.source_agent_id)
    if source is None:
        raise OctopError(ErrorCode.NOT_FOUND, "source workspace not found")
    locale = resolve_request_locale(request)
    try:
        slug = validate_skill_slug(body.slug)
        copied_identity_keys = set(await _skill_disable_keys(dest, slug))
        copied = await copy_workspace_skill_to_workspace(
            source=source,
            destination=dest.workspace,
            slug=slug,
            overwrite=body.overwrite,
        )
    except SkillPackageError as exc:
        raise _skill_transfer_error(exc, locale=locale) from exc
    copied_identity_keys.update(await _skill_disable_keys(dest, copied))
    disabled = _disabled_set(dest.config)
    if disabled.intersection(copied_identity_keys):
        disabled.difference_update(copied_identity_keys)
        await _persist_disabled(server, agent_id, disabled)
    return {"slug": copied, "copied": True}


@router.post("/agents/{agent_id}/skills/import", status_code=201)
async def import_skill_from_url(
    agent_id: str,
    body: ImportSkillBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Import a skill bundle from a supported external URL into the agent workspace."""
    from urllib.error import HTTPError, URLError

    from octop.infra.skills.install import (  # noqa: PLC0415
        SkillAlreadyExistsError,
        commit_skill_install,
        resolve_url_import,
    )
    from octop.infra.skills.skills_hub import is_supported_skill_url  # noqa: PLC0415

    locale = resolve_request_locale(request)
    bundle_url = body.bundle_url.strip()
    if not bundle_url:
        raise OctopError(ErrorCode.SLASH_BAD_ARGS, "bundle_url is required")
    if not is_supported_skill_url(bundle_url):
        raise OctopError.localized(ErrorCode.SKILL_IMPORT_UNSUPPORTED_URL, locale)

    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    target = _AgentWorkspaceInstallTarget(
        workspace=ctx.workspace,
        config=ctx.config,
        server=server,
        agent_id=agent_id,
    )

    try:
        package = await asyncio.to_thread(
            resolve_url_import,
            bundle_url=bundle_url,
            version=body.version,
        )
        await _guard_package_only_skill_write(ctx.workspace, ctx.config, server, package.slug, user)
        await commit_skill_install(
            target,
            package,
            overwrite=body.overwrite,
            enable=body.enable,
        )
    except SkillAlreadyExistsError as exc:
        raise OctopError.localized(
            ErrorCode.SKILL_ALREADY_EXISTS,
            locale,
            name=exc.slug,
        ) from exc
    except SkillPackageError as exc:
        raise OctopError.localized(
            ErrorCode.SKILL_IMPORT_FAILED,
            locale,
            reason=str(exc),
        ) from exc
    except ValueError as exc:
        raise OctopError.localized(
            ErrorCode.SKILL_IMPORT_FAILED,
            locale,
            reason=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise OctopError.localized(
            ErrorCode.SKILL_IMPORT_FAILED,
            locale,
            reason=str(exc),
        ) from exc
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise OctopError.localized(
            ErrorCode.SKILL_IMPORT_FAILED,
            locale,
            reason=str(exc),
        ) from exc

    skill_md = next(
        (content for path, content in package.files if path == "SKILL.md"),
        b"",
    )
    meta, _body = _parse_frontmatter(skill_md.decode("utf-8"))
    return _summary_dict(
        package.slug,
        meta,
        enabled=body.enable,
        kind="workspace",
    )


@router.delete("/agents/{agent_id}/skills/{name}", status_code=204)
async def delete_skill(
    agent_id: str,
    name: str,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    """Soft-delete via marker — see module docstring for rationale."""
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    try:
        slug = validate_skill_slug(name)
    except SkillPackageError:
        raise OctopError(ErrorCode.NOT_FOUND, "invalid skill name") from None
    await _guard_package_only_skill_write(ctx.workspace, ctx.config, server, slug, user)
    resolved = await _resolve_skill(ctx.workspace, slug)
    if resolved is None:
        raise OctopError(ErrorCode.NOT_FOUND, f"skill {slug!r} not found")
    manifest_path, kind, _body = resolved
    if kind == "builtin":
        raise OctopError(ErrorCode.NOT_FOUND, f"builtin skill {name!r} cannot be deleted")
    target = manifest_path
    existing = await _aread_text(ctx.workspace, target)
    if existing is None:
        raise OctopError(ErrorCode.NOT_FOUND, f"skill {name!r} not found")
    err = await _aoverwrite_text(ctx.workspace, target, "---\nremoved: true\n---\n")
    if err:
        raise OctopError(ErrorCode.NOT_FOUND, f"cannot remove {target!r}: {err}")


# --- enable / disable -------------------------------------------------------


async def _persist_disabled(server: Any, agent_id: str, disabled: set[str]) -> None:
    """Write back ``skills_disabled`` and hot-sync the running harness agent."""
    assert server.app_runtime is not None
    await server.app_runtime.agent_registry.persist_skills_disabled(agent_id, disabled)


async def _skill_disable_keys(ctx: _AgentCtx, name: str) -> set[str]:
    """Return slug / display-name keys to toggle for enable/disable."""
    from octop_harness.skills.catalog import skill_identity_keys

    slug = name.strip()
    keys = {slug} if slug else set()
    resolved = await _resolve_skill(ctx.workspace, slug)
    if resolved is None:
        return keys
    manifest_path, kind, _body = resolved
    manifest = await _aread_text(ctx.workspace, manifest_path)
    if manifest is None:
        return keys
    meta, _ = _parse_frontmatter(manifest)
    summary = _summary_dict(slug, meta, enabled=False, kind=kind)
    keys |= skill_identity_keys(
        {
            "name": summary["name"],
            "slug": summary["slug"],
            "path": manifest_path,
        }
    )
    return keys


@router.post("/agents/{agent_id}/skills/{name}/enable", status_code=204)
async def enable_skill(
    agent_id: str,
    name: str,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    disabled = _disabled_set(ctx.config)
    keys = await _skill_disable_keys(ctx, name)
    if disabled & keys:
        disabled -= keys
        await _persist_disabled(server, agent_id, disabled)


@router.post("/agents/{agent_id}/skills/{name}/disable", status_code=204)
async def disable_skill(
    agent_id: str,
    name: str,
    as_user: int | None = None,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    ctx = await _ctx(agent_id, user=user, as_user=as_user, server=server)
    disabled = _disabled_set(ctx.config)
    disabled |= await _skill_disable_keys(ctx, name)
    await _persist_disabled(server, agent_id, disabled)
