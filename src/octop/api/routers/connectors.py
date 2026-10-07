"""Connector and agent-binding HTTP API."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from html import escape
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, model_validator

from octop.api.common.public_base import resolve_public_base
from octop.api.deps import current_user, get_server
from octop.i18n import tr
from octop.infra.auth.sso.redirect_after import sanitize_redirect_after
from octop.infra.connectors.builder import (
    mcp_server_name,
    validate_create_credentials,
)
from octop.infra.connectors.catalog import (
    catalog_entry_to_dict,
    get_catalog_entry,
    list_catalog,
)
from octop.infra.connectors.custom_mcp import (
    CUSTOM_MCP_KIND,
    is_custom_mcp_kind,
    oauth_configured,
    parse_synthetic_instance_id,
    redact_servers_for_api,
)
from octop.infra.connectors.default_open import (
    build_instance_config_json,
    read_default_open,
)
from octop.infra.connectors.oauth import (
    auth_info_for_kind,
    delete_oauth_ctx,
    exchange_oauth_code,
    exchange_pasted_auth_code,
    load_oauth_ctx,
    oauth_ready_for_kind,
    save_oauth_ctx,
    start_oauth_for_target,
)
from octop.infra.connectors.oauth.registry import (
    oauth_state_kind_for_target,
    oauth_target_requires_https,
)
from octop.infra.connectors.probe import (
    prepare_probe_credentials,
    probe_connector,
    probe_custom_mcp_server,
)
from octop.infra.connectors.service import ConnectorNameTakenError, ConnectorService
from octop.infra.db.repos.connectors import ConnectorRepo
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.utils.locale import resolve_request_locale
from octop.infra.utils.ulid import new_ulid

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateInstanceBody(BaseModel):
    kind: str
    display_name: str
    description: str | None = Field(default=None, max_length=500)
    credentials: dict[str, Any] = Field(default_factory=dict)
    shared: bool = False
    default_open: bool = Field(
        default=False,
        description=(
            "Per-account default: when true, inject this connector's tools for "
            "the owner on IM and on Cron jobs with no explicit connector picks. "
            "Dashboard and Cron with explicit picks follow the selection."
        ),
    )


class PatchInstanceBody(BaseModel):
    status: str | None = None
    display_name: str | None = None
    description: str | None = Field(default=None, max_length=500)
    credentials: dict[str, Any] | None = None
    shared: bool | None = None
    default_open: bool | None = Field(
        default=None,
        description=(
            "When set, update per-account default-open. IM / empty Cron follow "
            "it for this user; Dashboard and Cron with explicit picks use the "
            "selection."
        ),
    )


class OAuthStartBody(BaseModel):
    redirect_after: str | None = None
    target: dict[str, Any] | None = Field(
        default=None,
        description='OAuth target, e.g. {"type":"catalog","kind":"notion"} or '
        '{"type":"custom_mcp","server_name":"my-server"}',
    )


class OAuthStartLegacyBody(BaseModel):
    redirect_after: str | None = None


class ExchangeAuthCodeBody(BaseModel):
    code: str
    bkn: str | None = None
    knowledge_base_id: str | None = None


class TestCredentialsBody(BaseModel):
    kind: str
    credentials: dict[str, Any] = Field(default_factory=dict)


class CustomMcpPutBody(BaseModel):
    servers: dict[str, Any] = Field(default_factory=dict)


class CustomMcpServerPatchBody(BaseModel):
    enabled: bool | None = None
    default_open: bool | None = None
    shared: bool | None = None

    @model_validator(mode="after")
    def _require_one_field(self) -> CustomMcpServerPatchBody:
        if self.enabled is None and self.default_open is None and self.shared is None:
            raise ValueError("provide enabled, default_open and/or shared")
        return self


class CustomMcpTestBody(BaseModel):
    """Probe one server by name (saved) or by inline spec."""

    name: str | None = None
    server: dict[str, Any] | None = None


def _oauth_callback_html(
    request: Request,
    message_key: str,
    *,
    status_code: int = 200,
    **fmt: Any,
) -> HTMLResponse:
    locale = resolve_request_locale(request)
    message = tr(f"connector.oauth.{message_key}", locale, **fmt)
    return HTMLResponse(f"<html><body>{escape(message)}</body></html>", status_code=status_code)


def _resolve_custom_mcp_url(svc: ConnectorService, user_id: int, server_name: str) -> str:
    saved = svc.get_custom_servers(user_id)
    raw = saved.get(server_name)
    if not isinstance(raw, dict):
        raise OctopError(
            ErrorCode.CONNECTOR_NOT_FOUND,
            f"custom MCP server {server_name!r} not found; save configuration before OAuth",
        )
    if str(raw.get("transport") or "") not in ("streamable_http", "http"):
        raise OctopError(
            ErrorCode.CONNECTOR_KIND_UNSUPPORTED,
            "OAuth is only supported for streamable HTTP custom MCP servers",
        )
    mcp_url = str(raw.get("url") or "").strip()
    if not mcp_url:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "server url is required")
    return mcp_url


async def _begin_oauth_flow(
    *,
    request: Request,
    user: Any,
    server: Any,
    target: dict[str, Any],
    redirect_after: str | None,
) -> dict[str, Any]:
    target_type = str(target.get("type") or "").strip()
    if target_type == "catalog":
        kind = str(target.get("kind") or "").strip()
        if not oauth_ready_for_kind(kind, server.services.settings_repo):
            raise OctopError(
                ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
                f"OAuth for {kind} is not available",
            )
    elif target_type != "custom_mcp":
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "unsupported oauth target")

    state = secrets.token_urlsafe(24)
    state_id = new_ulid()
    base = resolve_public_base(request)
    redirect_uri = f"{base}/api/connectors/oauth/callback"
    if oauth_target_requires_https(target) and _is_public_http_uri(redirect_uri):
        label = str(target.get("kind") or target.get("server_name") or "MCP")
        raise OctopError(
            ErrorCode.CONNECTOR_OAUTH_HTTPS_REQUIRED,
            f"{label} OAuth callbacks require HTTPS for non-loopback addresses",
        )

    mcp_url: str | None = None
    if target_type == "custom_mcp":
        server_name = str(target.get("server_name") or "").strip()
        if not server_name:
            raise OctopError(
                ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
                "custom_mcp target requires server_name",
            )
        mcp_url = _resolve_custom_mcp_url(_connector_service(server), user.id, server_name)

    try:
        authorize_url, verifier, ctx = await start_oauth_for_target(
            target=target,
            redirect_uri=redirect_uri,
            state=state,
            settings_repo=server.services.settings_repo,
            mcp_url=mcp_url,
        )
    except ValueError as exc:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc
    except Exception as exc:
        logger.exception("oauth start failed for target %s", target)
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc

    server.services.repos.connector_repo.create_oauth_state(
        state_id=state_id,
        state=state,
        user_id=user.id,
        kind=oauth_state_kind_for_target(target),
        code_verifier=verifier,
        redirect_after=redirect_after,
    )
    save_oauth_ctx(server.services.settings_repo, state_id, ctx)
    return {"authorize_url": authorize_url, "state_id": state_id}


def _connector_service(server: Any) -> ConnectorService:
    return ConnectorService(
        repo=server.services.repos.connector_repo,
        secret_repo=server.services.secret_repo,
        settings_repo=server.services.settings_repo,
        config=server.services.config,
    )


def _instance_to_dict(inst: Any) -> dict[str, Any]:
    config = ConnectorRepo.parse_config_json(inst) if hasattr(inst, "config_json") else {}
    return {
        "instance_id": inst.instance_id,
        "kind": inst.kind,
        "display_name": inst.display_name,
        "description": config.get("description"),
        "status": inst.status,
        "mcp_server_name": inst.mcp_server_name,
        "has_credentials": inst.has_credentials,
        "default_open": read_default_open(config),
        "shared": bool(inst.shared),
        "owner_user_id": inst.user_id,
        "created_at": inst.created_at,
        "updated_at": inst.updated_at,
    }


async def _prepare_credentials(
    kind: str,
    credentials: dict[str, Any],
    settings_repo: Any,
) -> dict[str, Any]:
    entry = get_catalog_entry(kind)
    if entry is None:
        raise ValueError(f"unknown connector kind: {kind}")
    cred_payload = dict(credentials)
    if entry.auth_kind == "auth_code" and cred_payload.get("code"):
        code = str(cred_payload.pop("code")).strip()
        extra = {
            k: cred_payload.pop(k) for k in ("bkn", "knowledge_base_id") if cred_payload.get(k)
        }
        exchanged = await exchange_pasted_auth_code(
            kind=kind,
            code=code,
            settings_repo=settings_repo,
            extra=extra or None,
        )
        cred_payload.update(exchanged)
    return validate_create_credentials(kind, cred_payload)


def _merge_credentials(
    old: dict[str, Any],
    new: dict[str, Any],
) -> dict[str, Any]:
    merged = dict(old)
    for key, value in new.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        merged[key] = value
    return merged


def _credentials_preview(kind: str, creds: dict[str, Any]) -> dict[str, Any]:
    entry = get_catalog_entry(kind)
    if entry is None or not creds:
        return {}
    preview: dict[str, Any] = {}
    if entry.auth_kind == "personal_token":
        if str(creds.get("token") or creds.get("access_token") or "").strip():
            preview["token_configured"] = True
    elif entry.auth_kind == "oauth2":
        if str(creds.get("access_token") or "").strip():
            preview["oauth_configured"] = True
        if creds.get("expires_at") is not None:
            preview["expires_at"] = creds.get("expires_at")
    elif entry.auth_kind == "auth_code":
        if str(creds.get("access_token") or creds.get("cookie") or "").strip():
            preview["auth_configured"] = True
        if creds.get("bkn"):
            preview["bkn"] = str(creds["bkn"])
        if creds.get("knowledge_base_id"):
            preview["knowledge_base_id"] = str(creds["knowledge_base_id"])
    elif entry.auth_kind == "api_key":
        if str(creds.get("api_key") or "").strip():
            preview["api_key_configured"] = True
    elif entry.auth_kind == "imap_app_password":
        if creds.get("email"):
            preview["email"] = str(creds["email"])
        if creds.get("mail_provider"):
            preview["mail_provider"] = str(creds["mail_provider"])
        if creds.get("imap_host"):
            preview["imap_host"] = str(creds["imap_host"])
        if creds.get("smtp_host"):
            preview["smtp_host"] = str(creds["smtp_host"])
        if str(creds.get("password") or "").strip():
            preview["password_configured"] = True
    elif entry.auth_kind == "api_credentials":
        if creds.get("app_id"):
            preview["app_id"] = str(creds["app_id"])
        if creds.get("sdk_id"):
            preview["sdk_id"] = str(creds["sdk_id"])
        if str(creds.get("secret_key") or "").strip():
            preview["secret_key_configured"] = True
    elif entry.auth_kind == "custom_fields":
        for field in entry.credential_fields:
            value = creds.get(field.key)
            if field.secret:
                if str(value or "").strip():
                    preview[f"{field.key}_configured"] = True
            elif value not in (None, "", []):
                preview[field.key] = value
    return preview


def _schedule_connector_reload(
    server: Any,
    user_id: int,
    *,
    all_users: bool = False,
) -> None:
    assert server.app_runtime is not None

    async def _run() -> None:
        try:
            if all_users:
                await server.app_runtime.agent_registry.reload_all()
            else:
                await server.app_runtime.agent_registry.reload_connectors_for_user(user_id)
        except Exception:
            logger.exception("background connector reload failed for user %s", user_id)

    asyncio.create_task(_run())


def _can_manage_connector(inst: Any, user: Any) -> bool:
    return bool(inst.user_id == user.id or user.role == "admin")


def _assert_can_manage_connector(inst: Any, user: Any) -> None:
    if not _can_manage_connector(inst, user):
        raise OctopError(ErrorCode.FORBIDDEN, "not your connector instance")


def _raise_name_taken(name: str) -> None:
    raise OctopError(
        ErrorCode.CONNECTOR_NAME_TAKEN,
        f"connector name {name!r} is already in use",
    )


def _custom_name_exists(svc: ConnectorService, user_id: int, name: str) -> bool:
    return any(
        item["display_name"] == name
        for item in svc.list_instances_for_api(user_id)
        if item["kind"] == CUSTOM_MCP_KIND and int(item.get("owner_user_id") or user_id) == user_id
    )


def _resolve_custom_target(
    instance_id: str,
    *,
    user: Any,
    server: Any,
) -> tuple[int, str] | None:
    raw = parse_synthetic_instance_id(instance_id)
    if raw is None:
        return None
    parent_id, separator, server_name = raw.partition(":")
    if separator:
        parent = server.services.repos.connector_repo.get(parent_id)
        if parent is not None and is_custom_mcp_kind(parent.kind):
            _assert_can_manage_connector(parent, user)
            return parent.user_id, server_name
    return user.id, raw


def _is_public_http_uri(uri: str) -> bool:
    parsed = urlparse(uri)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "http" and host not in {"localhost", "127.0.0.1", "::1"}


@router.get("/connectors/catalog", summary="Connector catalog")
async def get_catalog(
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    """List supported connector kinds and whether OAuth is configured for each."""
    del user
    settings = server.services.settings_repo
    return [
        catalog_entry_to_dict(
            e,
            oauth_ready=oauth_ready_for_kind(e.kind, settings),
            locale=resolve_request_locale(request),
        )
        for e in list_catalog()
    ]


@router.get("/connector-instances", summary="List connector instances")
async def list_instances(
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    """List the current user's connected accounts (custom MCP expanded per server)."""
    rows = _connector_service(server).list_instances_for_api(user.id)
    for item in rows:
        owner_id = int(item.get("owner_user_id") or user.id)
        owner = server.services.user_repo.get(owner_id)
        item["owner_username"] = owner.username if owner is not None else None
        item["owner_display_name"] = (
            owner.display_name or owner.username if owner is not None else None
        )
        item["can_manage"] = owner_id == user.id or user.role == "admin"
    return rows


@router.get("/connectors/custom-mcp", summary="Get custom MCP servers")
async def get_custom_mcp(
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Return the user's custom MCP server map (langchain-mcp-adapters shape)."""
    servers = _connector_service(server).get_custom_servers_for_api(user.id)
    return {"servers": servers}


@router.put("/connectors/custom-mcp", summary="Save custom MCP servers")
async def put_custom_mcp(
    body: CustomMcpPutBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Replace the user's custom MCP servers document and reload agents."""
    svc = _connector_service(server)
    try:
        servers = svc.put_custom_servers(user.id, body.servers)
    except ConnectorNameTakenError as exc:
        _raise_name_taken(str(exc))
    except ValueError as exc:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc
    server.services.audit_repo.write(
        actor=user.username,
        action="connector.custom_mcp.save",
        target=CUSTOM_MCP_KIND,
        payload=str(len(servers)),
    )
    _schedule_connector_reload(
        server,
        user.id,
        all_users=any(
            isinstance(spec, dict) and spec.get("shared") is True for spec in servers.values()
        ),
    )
    return {"servers": redact_servers_for_api(servers)}


@router.patch(
    "/connectors/custom-mcp/servers/{server_name}",
    summary="Patch one custom MCP server",
)
async def patch_custom_mcp_server(
    server_name: str,
    body: CustomMcpServerPatchBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Update ``enabled`` and/or ``default_open`` for one custom MCP server."""
    svc = _connector_service(server)
    try:
        servers = svc.patch_custom_server(
            user.id,
            server_name,
            enabled=body.enabled,
            default_open=body.default_open,
            shared=body.shared,
        )
    except KeyError as exc:
        raise OctopError(
            ErrorCode.CONNECTOR_NOT_FOUND, f"custom MCP server {server_name!r} not found"
        ) from exc
    except ValueError as exc:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc
    _schedule_connector_reload(server, user.id, all_users=body.shared is not None)
    return {"servers": redact_servers_for_api(servers)}


@router.post("/connectors/custom-mcp/test", summary="Probe a custom MCP server")
async def test_custom_mcp(
    body: CustomMcpTestBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Probe connectivity for one custom MCP server (saved name or inline spec)."""
    svc = _connector_service(server)
    spec: dict[str, Any] | None = None
    if body.server is not None:
        spec = dict(body.server)
    elif body.name:
        saved = svc.get_custom_servers(user.id)
        raw = saved.get(body.name)
        if not isinstance(raw, dict):
            raise OctopError(
                ErrorCode.CONNECTOR_NOT_FOUND, f"custom MCP server {body.name!r} not found"
            )
        spec = dict(raw)
    else:
        raise OctopError(
            ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
            "provide name or server spec to probe",
        )
    result = await probe_custom_mcp_server(spec)
    if body.name:
        try:
            if result.get("oauth", {}).get("available") and not oauth_configured(spec):
                svc.note_custom_server_oauth_required(user.id, body.name, required=True)
            elif result.get("ok") or not result.get("oauth", {}).get("available"):
                svc.note_custom_server_oauth_required(user.id, body.name, required=False)
        except KeyError:
            pass
    return result


@router.get("/connector-instances/{instance_id}", summary="Get connector instance")
async def get_instance(
    instance_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Return one connector instance with config and a redacted credentials preview."""
    repo = server.services.repos.connector_repo
    inst = repo.get(instance_id)
    if inst is None:
        raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
    _assert_can_manage_connector(inst, user)

    data = _instance_to_dict(inst)
    config: dict[str, Any] = {}
    if inst.config_json:
        try:
            parsed = json.loads(inst.config_json)
            if isinstance(parsed, dict):
                config = parsed
        except json.JSONDecodeError:
            config = {}
    data["config"] = config
    if inst.has_credentials:
        svc = _connector_service(server)
        creds = svc.decrypt(instance_id)
        data["credentials_preview"] = _credentials_preview(inst.kind, creds)
    else:
        data["credentials_preview"] = {}
    return data


@router.post("/connector-instances", status_code=201, summary="Create connector instance")
async def create_instance(
    body: CreateInstanceBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Connect a third-party account as a new named instance."""
    if is_custom_mcp_kind(body.kind):
        raise OctopError(
            ErrorCode.CONNECTOR_KIND_UNSUPPORTED,
            "use PUT /connectors/custom-mcp for custom MCP servers",
        )
    entry = get_catalog_entry(body.kind)
    if entry is None:
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"unknown kind {body.kind!r}")
    if entry.phase != "available":
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"{body.kind} not available")

    repo = server.services.repos.connector_repo
    svc = _connector_service(server)
    display_name = body.display_name.strip()
    if not display_name:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "display_name is required")
    description = body.description.strip() if body.description is not None else entry.description
    if not description:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "description is required")
    if repo.name_exists(user.id, display_name) or _custom_name_exists(svc, user.id, display_name):
        _raise_name_taken(display_name)
    cred_input = dict(body.credentials)

    try:
        cred_payload = await _prepare_credentials(
            body.kind, cred_input, server.services.settings_repo
        )
    except ValueError as exc:
        raise OctopError(
            ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
            str(exc),
            details={"reason": str(exc)},
        ) from exc

    instance_id = new_ulid()
    repo.create(
        instance_id=instance_id,
        user_id=user.id,
        kind=body.kind,
        display_name=display_name,
        mcp_server_name=mcp_server_name(body.kind, instance_id),
        shared=body.shared,
        config_json=build_instance_config_json(
            kind=body.kind,
            default_open=bool(body.default_open),
            email=cred_payload.get("email"),
            description=description,
        ),
    )
    svc.encrypt_and_store(instance_id=instance_id, payload=cred_payload)
    server.services.audit_repo.write(
        actor=user.username,
        action="connector.instance.create",
        target=instance_id,
        payload=body.kind,
    )
    inst = repo.get(instance_id)
    assert inst is not None
    _schedule_connector_reload(
        server,
        user.id,
        all_users=body.shared,
    )
    return _instance_to_dict(inst)


@router.patch("/connector-instances/{instance_id}", summary="Update connector instance")
async def patch_instance(
    instance_id: str,
    body: PatchInstanceBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Edit a connector instance without replacing its identity."""
    custom_target = _resolve_custom_target(instance_id, user=user, server=server)
    if custom_target is not None:
        custom_user_id, synthetic_name = custom_target
        svc = _connector_service(server)
        if body.status is None and body.default_open is None and body.shared is None:
            raise OctopError(
                ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
                "status or default_open is required",
            )
        try:
            if body.status is not None:
                status = body.status.strip()
                if status not in ("active", "disabled"):
                    raise OctopError(
                        ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
                        "status must be active or disabled",
                    )
                svc.patch_custom_server_enabled(
                    custom_user_id, synthetic_name, enabled=(status == "active")
                )
            if body.default_open is not None:
                svc.patch_custom_server_default_open(
                    custom_user_id, synthetic_name, default_open=bool(body.default_open)
                )
            if body.shared is not None:
                svc.patch_custom_server(custom_user_id, synthetic_name, shared=body.shared)
        except KeyError as exc:
            raise OctopError(
                ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found"
            ) from exc
        except ValueError as exc:
            raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc
        _schedule_connector_reload(server, custom_user_id, all_users=True)
        for item in svc.list_instances_for_api(custom_user_id):
            if item["instance_id"] in {instance_id, f"custom:{synthetic_name}"}:
                return item
        raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")

    repo = server.services.repos.connector_repo
    inst = repo.get(instance_id)
    if inst is None:
        raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
    _assert_can_manage_connector(inst, user)
    if is_custom_mcp_kind(inst.kind):
        raise OctopError(
            ErrorCode.CONNECTOR_KIND_UNSUPPORTED,
            "use PATCH /connectors/custom-mcp/servers/{name} for custom MCP servers",
        )
    if (
        body.status is None
        and body.default_open is None
        and body.display_name is None
        and body.description is None
        and body.credentials is None
        and body.shared is None
    ):
        raise OctopError(
            ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
            "status or default_open is required",
        )
    if body.display_name is not None:
        display_name = body.display_name.strip()
        if not display_name:
            raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "display_name is required")
        svc = _connector_service(server)
        if repo.name_exists(
            inst.user_id, display_name, exclude_instance_id=instance_id
        ) or _custom_name_exists(svc, inst.user_id, display_name):
            _raise_name_taken(display_name)
        repo.update_metadata(instance_id, display_name=display_name)
    if body.shared is not None:
        repo.update_metadata(instance_id, shared=body.shared)
    if body.credentials is not None:
        svc = _connector_service(server)
        merged = _merge_credentials(svc.decrypt(instance_id), body.credentials)
        try:
            prepared = await _prepare_credentials(inst.kind, merged, server.services.settings_repo)
        except ValueError as exc:
            raise OctopError(
                ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
                str(exc),
                details={"reason": str(exc)},
            ) from exc
        svc.encrypt_and_store(instance_id=instance_id, payload=prepared)
    if body.status is not None:
        status = body.status.strip()
        if status not in ("active", "disabled"):
            raise OctopError(
                ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "status must be active or disabled"
            )
        repo.update_status(instance_id, status)
    if body.default_open is not None or body.description is not None:
        config = dict(ConnectorRepo.parse_config_json(inst))
        if body.default_open is not None:
            if body.default_open:
                config["default_open"] = True
            else:
                config.pop("default_open", None)
        if body.description is not None:
            description = body.description.strip()
            if not description:
                raise OctopError(
                    ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
                    "description is required",
                )
            config["description"] = description
        repo.update_config_json(
            instance_id, json.dumps(config, ensure_ascii=False) if config else None
        )
    inst = repo.get(instance_id)
    assert inst is not None
    _schedule_connector_reload(
        server,
        inst.user_id,
        all_users=inst.shared or body.shared is True or body.shared is False,
    )
    return _instance_to_dict(inst)


@router.delete("/connector-instances/{instance_id}", status_code=204, summary="Delete connector")
async def delete_instance(
    instance_id: str,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    """Disconnect and delete stored credentials for a connector instance."""
    custom_target = _resolve_custom_target(instance_id, user=user, server=server)
    if custom_target is not None:
        custom_user_id, synthetic_name = custom_target
        svc = _connector_service(server)
        servers = dict(svc.get_custom_servers(custom_user_id))
        if synthetic_name not in servers:
            raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
        del servers[synthetic_name]
        try:
            svc.put_custom_servers(custom_user_id, servers)
        except ValueError as exc:
            raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc
        server.services.audit_repo.write(
            actor=user.username,
            action="connector.custom_mcp.delete_server",
            target=synthetic_name,
            payload=CUSTOM_MCP_KIND,
        )
        _schedule_connector_reload(server, custom_user_id, all_users=True)
        return

    repo = server.services.repos.connector_repo
    inst = repo.get(instance_id)
    if inst is None:
        raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
    _assert_can_manage_connector(inst, user)
    user_id = inst.user_id
    repo.delete(instance_id)
    _schedule_connector_reload(
        server,
        user_id,
        all_users=inst.shared,
    )
    server.services.audit_repo.write(
        actor=user.username,
        action="connector.instance.delete",
        target=instance_id,
    )


@router.post("/connector-instances/{instance_id}/test", summary="Test connector")
async def test_instance(
    instance_id: str,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Probe the connector with stored credentials and return success or error details."""
    custom_target = _resolve_custom_target(instance_id, user=user, server=server)
    if custom_target is not None:
        custom_user_id, synthetic_name = custom_target
        svc = _connector_service(server)
        saved = svc.get_custom_servers(custom_user_id)
        raw = saved.get(synthetic_name)
        if not isinstance(raw, dict):
            raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
        return await probe_custom_mcp_server(dict(raw))

    repo = server.services.repos.connector_repo
    inst = repo.get(instance_id)
    if inst is None:
        raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
    _assert_can_manage_connector(inst, user)

    entry = get_catalog_entry(inst.kind)
    if entry is None:
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, inst.kind)

    svc = _connector_service(server)
    creds = await svc.ensure_fresh_credentials(instance_id, inst.kind)
    if not creds:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "missing credentials")

    try:
        return await probe_connector(
            entry,
            creds,
            instance_id=instance_id,
            config=server.services.config,
        )
    except Exception as exc:
        logger.exception("connector test failed for %s", instance_id)
        return {"ok": False, "error": str(exc)}


@router.post("/connectors/test-credentials", summary="Test credentials")
async def test_credentials(
    body: TestCredentialsBody,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Validate credentials before creating an instance (no persistence)."""
    del user
    entry = get_catalog_entry(body.kind)
    if entry is None:
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"unknown kind {body.kind!r}")
    if entry.phase != "available":
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"{body.kind} not available")
    try:
        cred_payload = await prepare_probe_credentials(
            body.kind,
            body.credentials,
            full_prepare=lambda k, c: _prepare_credentials(k, c, server.services.settings_repo),
        )
    except ValueError as exc:
        raise OctopError(
            ErrorCode.CONNECTOR_INVALID_CREDENTIALS,
            str(exc),
            details={"reason": str(exc)},
        ) from exc
    try:
        return await probe_connector(
            entry,
            cred_payload,
            instance_id="probe",
            config=server.services.config,
        )
    except Exception as exc:
        logger.exception("connector credential test failed for %s", body.kind)
        return {"ok": False, "error": str(exc)}


@router.post("/connector-instances/{instance_id}/refresh", summary="Refresh OAuth tokens")
async def refresh_instance(
    instance_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Refresh expiring OAuth tokens for a connector instance."""
    repo = server.services.repos.connector_repo
    inst = repo.get(instance_id)
    if inst is None:
        raise OctopError(ErrorCode.CONNECTOR_NOT_FOUND, f"instance {instance_id!r} not found")
    if inst.user_id != user.id:
        raise OctopError(ErrorCode.FORBIDDEN, "not your connector instance")
    svc = _connector_service(server)
    creds = await svc.ensure_fresh_credentials(instance_id, inst.kind)
    return {"ok": True, "expires_at": creds.get("expires_at")}


@router.get("/connectors/auth/{kind}/info", summary="Connector auth info")
async def auth_info(
    kind: str,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, str | None]:
    """Return auth flow metadata (OAuth URLs, required fields) for a connector kind."""
    del user
    if get_catalog_entry(kind) is None:
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"unknown kind {kind!r}")
    info = auth_info_for_kind(kind, server.services.settings_repo)
    return info


@router.get("/connectors/auth/{kind}/authorize-url", summary="OAuth authorize URL")
async def auth_authorize_url(
    kind: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, str | None]:
    """Build the provider authorization URL for manual or embedded OAuth."""
    del user
    if get_catalog_entry(kind) is None:
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"unknown kind {kind!r}")
    info = auth_info_for_kind(kind, server.services.settings_repo)
    return {"authorize_url": info.get("authorize_url")}


@router.post("/connectors/auth/{kind}/exchange-code", summary="Exchange auth code")
async def auth_exchange_code(
    kind: str,
    body: ExchangeAuthCodeBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Exchange a pasted authorization code for connector credentials (device/OOB flow)."""
    del user
    entry = get_catalog_entry(kind)
    if entry is None:
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"unknown kind {kind!r}")
    if entry.auth_kind != "auth_code":
        raise OctopError(ErrorCode.CONNECTOR_KIND_UNSUPPORTED, f"{kind} does not use auth code")
    try:
        extra: dict[str, Any] = {}
        if body.bkn:
            extra["bkn"] = body.bkn
        if body.knowledge_base_id:
            extra["knowledge_base_id"] = body.knowledge_base_id
        tokens = await exchange_pasted_auth_code(
            kind=kind,
            code=body.code,
            settings_repo=server.services.settings_repo,
            extra=extra or None,
        )
    except ValueError as exc:
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, str(exc)) from exc
    return {"credentials": tokens}


@router.post("/connectors/oauth/start", summary="Start OAuth flow (unified)")
async def oauth_start_unified(
    body: OAuthStartBody,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Begin browser OAuth for a catalog connector or custom MCP server."""
    if not body.target or not isinstance(body.target, dict):
        raise OctopError(ErrorCode.CONNECTOR_INVALID_CREDENTIALS, "oauth target is required")
    return await _begin_oauth_flow(
        request=request,
        user=user,
        server=server,
        target=body.target,
        redirect_after=body.redirect_after,
    )


@router.post("/connectors/oauth/{kind}/start", summary="Start OAuth flow (legacy)")
async def oauth_start_legacy(
    kind: str,
    body: OAuthStartLegacyBody,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Legacy catalog-only alias for :func:`oauth_start_unified`."""
    return await _begin_oauth_flow(
        request=request,
        user=user,
        server=server,
        target={"type": "catalog", "kind": kind},
        redirect_after=body.redirect_after,
    )


@router.get("/connectors/oauth/callback", summary="OAuth callback")
async def oauth_callback(
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    server: Any = Depends(get_server),
) -> HTMLResponse:
    """OAuth redirect target. Exchanges the code and stores credentials. No JWT required."""
    if error:
        return _oauth_callback_html(
            request,
            "callback_auth_failed",
            status_code=400,
            error=error,
        )
    if not code or not state:
        return _oauth_callback_html(
            request,
            "callback_missing_params",
            status_code=400,
        )

    repo = server.services.repos.connector_repo
    row = repo.consume_oauth_state(state)
    if row is None:
        return _oauth_callback_html(
            request,
            "callback_invalid_state",
            status_code=400,
        )

    base = resolve_public_base(request)
    redirect_uri = f"{base}/api/connectors/oauth/callback"

    try:
        tokens = await exchange_oauth_code(
            kind=row.kind,
            code=code,
            redirect_uri=redirect_uri,
            code_verifier=row.code_verifier,
            settings_repo=server.services.settings_repo,
            state_id=row.state_id,
        )
        ctx = load_oauth_ctx(server.services.settings_repo, row.state_id)
        if ctx.get("client_id"):
            tokens["oauth_client_id"] = ctx["client_id"]
        if ctx.get("client_secret"):
            tokens["oauth_client_secret"] = ctx["client_secret"]
        delete_oauth_ctx(server.services.settings_repo, row.state_id)
    except Exception as exc:
        logger.exception("oauth callback failed for %s", row.kind)
        return _oauth_callback_html(
            request,
            "callback_token_exchange_failed",
            status_code=400,
            detail=str(exc),
        )

    pending_payload: dict[str, Any] = {
        "user_id": row.user_id,
        "kind": row.kind,
        "tokens": tokens,
    }
    if row.kind == CUSTOM_MCP_KIND:
        server_name = str(ctx.get("server_name") or "")
        issuer = str(ctx.get("issuer") or "")
        resource = str(ctx.get("resource") or "").strip() or None
        try:
            svc = _connector_service(server)
            svc.apply_custom_server_oauth(
                row.user_id,
                server_name,
                tokens,
                issuer=issuer,
                resource=resource,
            )
            _schedule_connector_reload(server, row.user_id)
            pending_payload["server_name"] = server_name
            pending_payload["applied"] = True
        except Exception as exc:
            logger.exception("custom MCP oauth apply failed")
            return _oauth_callback_html(
                request,
                "callback_save_failed",
                status_code=400,
                detail=str(exc),
            )

    # Store tokens in a short-lived settings key for frontend pickup, or auto-create instance.
    pending_key = f"connector.oauth.pending.{row.state_id}"
    server.services.settings_repo.set(
        pending_key,
        json.dumps(pending_payload),
    )
    redirect = urlsplit(sanitize_redirect_after(row.redirect_after, default="/connectors"))
    query = [
        (key, value)
        for key, value in parse_qsl(redirect.query, keep_blank_values=True)
        if key != "oauth_state"
    ]
    query.append(("oauth_state", row.state_id))
    redirect_target = redirect._replace(query=urlencode(query)).geturl()
    locale = resolve_request_locale(request)
    success_message = tr("connector.oauth.callback_success", locale)
    # JSON-encode for the JS string literal (quotes/backslashes/newlines) and
    # escape "<" so a stored "</script>" cannot terminate the script element.
    target = json.dumps(redirect_target).replace("<", "\\u003c")
    html = f"""<!DOCTYPE html><html><body>
<script>
  if (window.opener) {{
    window.opener.postMessage({{ type: 'octop:connector-oauth', state_id: {json.dumps(row.state_id)} }}, window.location.origin);
    window.close();
  }} else {{
    window.location.href = {target};
  }}
</script>
<p>{escape(success_message)}</p>
</body></html>"""
    return HTMLResponse(html)


@router.get("/connectors/oauth/pending/{state_id}", summary="Poll OAuth result")
async def oauth_pending(
    state_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Poll after OAuth redirect until credentials are ready for instance creation."""
    key = f"connector.oauth.pending.{state_id}"
    raw = server.services.settings_repo.get(key)
    if not raw:
        raise OctopError(ErrorCode.NOT_FOUND, "pending oauth not found")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "corrupt pending oauth") from exc
    if int(data.get("user_id") or 0) != user.id:
        raise OctopError(ErrorCode.FORBIDDEN, "not your oauth session")
    server.services.settings_repo.delete(key)
    return {
        "kind": data.get("kind"),
        "tokens": data.get("tokens") or {},
        "server_name": data.get("server_name"),
        "applied": data.get("applied"),
    }


async def validate_chat_mcp_servers(
    server: Any,
    *,
    user_id: int,
    names: list[str] | None,
) -> list[str] | None:
    from octop.api.common.validators import validate_chat_mcp_servers as _validate

    return await _validate(server, user_id=user_id, names=names)
