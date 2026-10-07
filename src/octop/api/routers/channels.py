"""Channels router."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, cast

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel

from octop.api.common.agent import require_agent_owner_row
from octop.api.deps import get_server, require_permission
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.gateway.channels import qr_bind
from octop.infra.gateway.gateway import ChannelKind
from octop.infra.utils.locale import DEFAULT_LOCALE, resolve_request_locale

logger = logging.getLogger(__name__)

router = APIRouter()


class ChannelCreateBody(BaseModel):
    kind: ChannelKind
    name: str
    config: dict[str, Any] = {}


class ChannelPatchBody(BaseModel):
    kind: ChannelKind | None = None
    name: str | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class ChannelProbeBody(BaseModel):
    kind: ChannelKind
    config: dict[str, Any] = {}


def _row_to_dict(
    r: Any, *, gateway: Any | None = None, locale: Any = DEFAULT_LOCALE
) -> dict[str, Any]:
    out = {
        "id": r.channel_id,
        "agent_id": r.agent_id,
        "kind": r.kind,
        "name": r.name,
        "enabled": bool(r.enabled),
    }
    if gateway is not None:
        runtime = gateway.runtime_status_to_dict(r.channel_id, locale=locale)
        if runtime is not None:
            out["runtime"] = runtime
    return out


def _row_to_detail(
    r: Any, *, gateway: Any | None = None, locale: Any = DEFAULT_LOCALE
) -> dict[str, Any]:
    detail = _row_to_dict(r, gateway=gateway, locale=locale)
    try:
        detail["config"] = json.loads(r.config_json or "{}")
    except json.JSONDecodeError:
        detail["config"] = {}
    return detail


def _require_agent_access(
    agent_id: str,
    *,
    user: Any,
    as_user: int | None,
    server: Any,
) -> Any:
    return require_agent_owner_row(agent_id, user=user, as_user=as_user, server=server)


def _acting_user_id(user: Any, as_user: int | None) -> int:
    return int(as_user if as_user is not None else user.id)


@router.get("/agents/{agent_id}/channels")
async def list_channels(
    agent_id: str,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    gw = server.app_runtime.gateway
    rows = gw.list_channels(agent_id)
    locale = resolve_request_locale(request)
    return [_row_to_dict(r, gateway=gw, locale=locale) for r in rows]


@router.post("/agents/{agent_id}/channels", status_code=201)
async def create_channel(
    agent_id: str,
    body: ChannelCreateBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    from octop.infra.gateway.gateway import ChannelCreateSpec  # noqa: PLC0415
    from octop.infra.utils.ulid import new_ulid as _new_ulid  # noqa: PLC0415

    spec = ChannelCreateSpec(
        channel_id=_new_ulid(),
        agent_id=agent_id,
        user_id=_acting_user_id(user, as_user),
        kind=body.kind,
        name=body.name,
        config=body.config,
    )
    row = await server.app_runtime.gateway.create_channel(spec)
    return _row_to_dict(
        row, gateway=server.app_runtime.gateway, locale=resolve_request_locale(request)
    )


@router.get("/agents/{agent_id}/channels/{channel_id}")
async def get_channel(
    agent_id: str,
    channel_id: str,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    row = server.app_runtime.gateway.get_channel(channel_id)
    if row is None or row.agent_id != agent_id:
        raise OctopError(ErrorCode.NOT_FOUND, "channel not found")
    return _row_to_detail(
        row, gateway=server.app_runtime.gateway, locale=resolve_request_locale(request)
    )


@router.patch("/agents/{agent_id}/channels/{channel_id}")
async def patch_channel(
    agent_id: str,
    channel_id: str,
    body: ChannelPatchBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    existing = server.app_runtime.gateway.get_channel(channel_id)
    if existing is None or existing.agent_id != agent_id:
        raise OctopError(ErrorCode.NOT_FOUND, "channel not found")
    row = await server.app_runtime.gateway.update_channel(
        channel_id,
        kind=str(body.kind) if body.kind is not None else None,
        name=body.name,
        config_json=json.dumps(body.config) if body.config is not None else None,
        enabled=int(body.enabled) if body.enabled is not None else None,
    )
    return _row_to_dict(
        row, gateway=server.app_runtime.gateway, locale=resolve_request_locale(request)
    )


@router.delete("/agents/{agent_id}/channels/{channel_id}", status_code=204)
async def delete_channel(
    agent_id: str,
    channel_id: str,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> None:
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    existing = server.app_runtime.gateway.get_channel(channel_id)
    if existing is None or existing.agent_id != agent_id:
        raise OctopError(ErrorCode.NOT_FOUND, "channel not found")
    await server.app_runtime.gateway.delete_channel(channel_id)


@router.post("/agents/{agent_id}/channels/{channel_id}/test")
async def test_channel(
    agent_id: str,
    channel_id: str,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Probe a channel via Gateway.probe_channel()."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    existing = server.app_runtime.gateway.get_channel(channel_id)
    if existing is None or existing.agent_id != agent_id:
        raise OctopError(ErrorCode.NOT_FOUND, "channel not found")
    return cast(
        dict[str, Any],
        await server.app_runtime.gateway.probe_channel(
            channel_id, locale=resolve_request_locale(request)
        ),
    )


@router.post("/agents/{agent_id}/channels/probe")
async def probe_channel_config(
    agent_id: str,
    body: ChannelProbeBody,
    request: Request,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Probe channel credentials from a draft config (no save required)."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    return cast(
        dict[str, Any],
        await server.app_runtime.gateway.probe_config(
            agent_id=agent_id,
            kind=str(body.kind),
            config=body.config,
            locale=resolve_request_locale(request),
        ),
    )


# ─── QR scan helpers ────────────────────────────────────────────────────────

_MAX_ARG_LEN = 2048
_TOKEN_RE = re.compile(r"^[a-zA-Z0-9_.\-]{1,512}$")


def _sanitize_token(value: str, field_name: str) -> str:
    """Validate opaque tokens passed to downstream services."""
    if not value or len(value) > _MAX_ARG_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: must be 1-{_MAX_ARG_LEN} characters.",
        )
    if not _TOKEN_RE.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: contains disallowed characters.",
        )
    return value


# ─── WeCom QR code ─────────────────────────────────


@router.post("/agents/{agent_id}/channels/wecom/qrcode/generate")
async def wecom_qrcode_generate(
    agent_id: str,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Generate WeCom AI Bot QR code for registration."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    try:
        return await qr_bind.wecom_qr_generate()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to fetch WeCom QR code")
        raise HTTPException(status_code=502, detail=f"Failed to fetch QR code: {exc}") from exc


@router.post("/agents/{agent_id}/channels/wecom/qrcode/poll")
async def wecom_qrcode_poll(
    agent_id: str,
    as_user: int | None = None,
    scode: str = Body(..., embed=True),
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Poll WeCom QR scan result."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    scode = _sanitize_token(scode, "scode")
    try:
        return await qr_bind.wecom_qr_poll(scode)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to poll WeCom QR result")
        raise HTTPException(status_code=502, detail=f"Failed to poll QR result: {exc}") from exc


# ─── QQ Bot QR code ─────────────────────────────────────────────────────────


@router.post(
    "/agents/{agent_id}/channels/qq/qrcode/generate",
    summary="Generate a QQ Bot binding QR code",
)
async def qq_qrcode_generate(
    agent_id: str,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Create an in-memory QQ Bot binding session and return its QR target URL."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    try:
        return await qr_bind.qq_qr_generate(f"api:{agent_id}")
    except Exception as exc:
        logger.exception("Failed to fetch QQ Bot QR code")
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch QQ Bot QR code: {exc}"
        ) from exc


@router.post(
    "/agents/{agent_id}/channels/qq/qrcode/poll",
    summary="Poll a QQ Bot binding QR code",
)
async def qq_qrcode_poll(
    agent_id: str,
    as_user: int | None = None,
    qrcode_token: str = Body(..., embed=True),
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Poll the active QQ Bot binding task and return credentials after confirmation."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    qrcode_token = _sanitize_token(qrcode_token, "qrcode_token")
    try:
        return await qr_bind.qq_qr_poll(f"api:{agent_id}", qrcode_token)
    except Exception as exc:
        logger.exception("Failed to poll QQ Bot QR result")
        raise HTTPException(
            status_code=502, detail=f"Failed to poll QQ Bot QR result: {exc}"
        ) from exc


# ─── WeChat (Weixin) QR code ─────────────────────────────────────────────────


def _get_weixin_qr_login() -> Any:
    """Import WeixinQRLogin lazily from octop-gateway weixin channel."""
    try:
        from octop_gateway.channels.weixin.login_qr import WeixinQRLogin

        return WeixinQRLogin
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="WeChat QR login requires octop-gateway with weixin channel support.",
        ) from None


@router.post("/agents/{agent_id}/channels/weixin/qrcode/generate")
async def weixin_qrcode_generate(
    agent_id: str,
    as_user: int | None = None,
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Generate WeChat iLink Bot QR code."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    cls = _get_weixin_qr_login()
    try:
        login = cls()
        result = await login.fetch_qr_code()
        return {
            "qrcode_token": result.qrcode,
            "qrcode_url": result.qrcode_img_content,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to fetch WeChat QR code")
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch WeChat QR code: {exc}"
        ) from exc


@router.post("/agents/{agent_id}/channels/weixin/qrcode/poll")
async def weixin_qrcode_poll(
    agent_id: str,
    as_user: int | None = None,
    qrcode_token: str = Body(..., embed=True),
    user: Any = Depends(require_permission("channels")),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    """Poll WeChat QR scan result (single long-poll, ~40s)."""
    _require_agent_access(agent_id, user=user, as_user=as_user, server=server)
    qrcode_token = _sanitize_token(qrcode_token, "qrcode_token")
    cls = _get_weixin_qr_login()
    try:
        login = cls()
        result = await asyncio.wait_for(
            login.wait_for_login(qrcode_token),
            timeout=40.0,
        )
    except TimeoutError:
        return {"status": "wait"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to poll WeChat QR result")
        raise HTTPException(
            status_code=502, detail=f"Failed to poll WeChat QR result: {exc}"
        ) from exc

    if not result.connected:
        return {"status": "error", "message": result.message}

    return {
        "status": "success",
        "account_id": result.account_id,
        "token": result.bot_token,
        "base_url": result.base_url,
    }
