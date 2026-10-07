"""Connector credential probe — validate connectivity and list tools."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from mcp.shared.exceptions import McpError

from octop.config import OctopConfig
from octop.infra.connectors.builder import (
    build_http_mcp_spec,
    validate_create_credentials,
)
from octop.infra.connectors.catalog import (
    ConnectorCatalogEntry,
    get_catalog_entry,
    is_mcp_oauth_remote,
)
from octop.infra.connectors.gateway.protocol import handle_mcp_request
from octop.infra.connectors.gateway.registry import probe_gateway_credentials
from octop.infra.connectors.oauth.discovery import discover_oauth_from_mcp_url
from octop.infra.errors import OctopError
from octop.infra.utils.ssrf_guard import UnsafeOutboundUrl, safe_request

logger = logging.getLogger(__name__)

def normalize_tools(raw: list[Any] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "name": name,
                "description": str(item.get("description") or ""),
            }
        )
    return out


def http_error_message(response: httpx.Response) -> str | None:
    if response.status_code < 400:
        return None
    try:
        body = response.json()
        if isinstance(body, dict):
            for key in ("show_msg", "message", "desc", "detail", "error"):
                val = body.get(key)
                if val and str(val).strip() and not str(val).strip().isdigit():
                    return str(val).strip()
    except Exception:
        pass
    if response.status_code == 401:
        return "Authentication failed; check the token or authorization code"
    return f"HTTP {response.status_code}"


async def prepare_probe_credentials(
    kind: str,
    credentials: dict[str, Any],
    *,
    full_prepare: Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Like credential creation but allows empty token for remote connectivity probes."""
    entry = get_catalog_entry(kind)
    if entry is None:
        raise ValueError(f"unknown connector kind: {kind}")
    if full_prepare is not None:
        return await full_prepare(kind, credentials)
    return validate_create_credentials(kind, credentials)


def _probe_mcp_http_error(exc: httpx.HTTPStatusError, *, kind: str) -> dict[str, Any]:
    """Map an HTTP status error from a remote MCP probe to a clear result.

    ``401``/``403`` are definitive auth rejections (bad key), everything else
    (5xx, 429, network proxy errors) is treated as a connection/upstream
    problem so callers can distinguish "key is wrong" from "can't reach host".
    """
    status = exc.response.status_code
    if status in (401, 403):
        err = http_error_message(exc.response)
        return {
            "ok": False,
            "error_type": "auth",
            "error": err or str(exc),
            "status_code": status,
        }
    err = http_error_message(exc.response)
    return {
        "ok": False,
        "error_type": "connection",
        "error": err or str(exc),
        "status_code": status,
    }


async def _maybe_attach_oauth_discovery(
    result: dict[str, Any],
    *,
    url: str,
    headers: dict[str, str],
) -> dict[str, Any]:
    """When auth fails without a bearer token, try MCP OAuth discovery."""
    if result.get("ok") is not False or result.get("error_type") != "auth":
        return result
    auth_header = str(headers.get("Authorization") or "").strip()
    if auth_header.lower().startswith("bearer ") and len(auth_header) > 7:
        return result
    discovery = await discover_oauth_from_mcp_url(url)
    if discovery.get("available"):
        result["oauth"] = {
            "available": True,
            "issuer": discovery.get("issuer"),
            "resource": discovery.get("resource"),
        }
    else:
        result["oauth"] = {"available": False}
    return result


def _probe_mcp_mcp_error(exc: McpError, *, kind: str) -> dict[str, Any]:
    """Map an MCP-level error (e.g. server closing the initialize stream).

    ``Connection closed`` means the upstream dropped the SSE stream — a
    transport/network issue (proxy timeout, geo/network restriction), NOT an
    auth rejection. The credential may still be perfectly valid; report it as
    a connection problem so it is not mistaken for a bad key.
    """
    msg = str(exc).lower()
    if "connection closed" in msg or "connection" in msg:
        return {
            "ok": False,
            "error_type": "connection",
            "error": "the connection to the upstream MCP service was interrupted (possibly network/proxy/region restrictions); this is not an invalid key",
        }
    return {"ok": False, "error_type": "connection", "error": str(exc)}

def _unwrap_probe_exception_group(exc: BaseExceptionGroup, *, kind: str) -> dict[str, Any] | None:
    """Unwrap a nested TaskGroup exception group to a concrete probe result.

    The mcp SSE client raises nested exception groups whose members are
    transport-level errors. Surface the most actionable one: HTTP status
    errors (auth/permission) and MCP errors (server rejected initialize).
    """
    for sub in exc.exceptions:
        if isinstance(sub, httpx.HTTPStatusError):
            return _probe_mcp_http_error(sub, kind=kind)
        if isinstance(sub, McpError):
            return _probe_mcp_mcp_error(sub, kind=kind)
    for sub in exc.exceptions:
        if isinstance(sub, BaseExceptionGroup):
            nested = _unwrap_probe_exception_group(sub, kind=kind)
            if nested is not None:
                return nested
    return None


async def _probe_mcp_sse(
    url: str,
    headers: dict[str, str] | None = None,
    *,
    kind: str,
) -> dict[str, Any]:
    """Probe a remote MCP server over SSE transport.

    A single retry tolerates transient connection drops (e.g. a proxy or the
    upstream closing the SSE stream on the first ``initialize``). Auth
    rejections (HTTP 401/403) are definitive and returned immediately so a
    bad key is never masked by a retry.
    """
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    for attempt in range(2):
        result: dict[str, Any] | None = None
        try:
            async with (
                sse_client(url, headers or {}, timeout=20, sse_read_timeout=20) as (read, write),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                listed = await session.list_tools()
                tools = normalize_tools(
                    [{"name": t.name, "description": t.description or ""} for t in listed.tools]
                )
                return {"ok": True, "tool_count": len(tools), "tools": tools}
        except httpx.HTTPStatusError as exc:
            result = _probe_mcp_http_error(exc, kind=kind)
            if result.get("error_type") != "connection" or attempt > 0:
                return result
            logger.warning("%s SSE probe connection failure, retrying: %s", kind, exc)
            continue
        except McpError as exc:
            result = _probe_mcp_mcp_error(exc, kind=kind)
            if result.get("error_type") != "connection" or attempt > 0:
                return result
            logger.warning("%s SSE probe connection failure, retrying: %s", kind, exc)
            continue
        except BaseExceptionGroup as exc:
            result = _unwrap_probe_exception_group(exc, kind=kind)
            if result is not None:
                if result.get("error_type") != "connection" or attempt > 0:
                    return result
                logger.warning("%s SSE probe connection failure, retrying: %s", kind, exc)
                continue
            if attempt == 0:
                logger.warning("%s SSE probe transient failure, retrying: %s", kind, exc)
                continue
            logger.exception("%s SSE probe failed", kind)
            return {"ok": False, "error": str(exc)}
        except Exception as exc:
            if attempt == 0:
                logger.warning("%s SSE probe transient failure, retrying: %s", kind, exc)
                continue
            logger.exception("%s SSE probe failed", kind)
            return {"ok": False, "error": str(exc)}
    return {"ok": False, "error": "SSE probe failed after retry"}


async def probe_streamable_http_mcp(
    url: str,
    headers: dict[str, str],
    *,
    kind: str,
) -> dict[str, Any]:
    """Probe Notion/Figma-style remote MCP via Streamable HTTP (session + SSE).

    A single retry tolerates transient connection drops (e.g. a proxy or the
    upstream closing the session on the first ``initialize``), matching
    :func:`_probe_mcp_sse`. Auth rejections (HTTP 401/403) are definitive and
    returned immediately so a bad key is never masked by a retry.
    """
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    for attempt in range(2):
        try:
            async with (
                streamablehttp_client(url, headers=headers, timeout=20, sse_read_timeout=20) as (
                    read,
                    write,
                    _get_session_id,
                ),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                listed = await session.list_tools()
                tools = normalize_tools(
                    [{"name": t.name, "description": t.description or ""} for t in listed.tools]
                )
                return {"ok": True, "tool_count": len(tools), "tools": tools}
        except httpx.HTTPStatusError as exc:
            result = _probe_mcp_http_error(exc, kind=kind)
            if result.get("error_type") != "connection" or attempt > 0:
                return result
            logger.warning("%s streamable HTTP probe connection failure, retrying: %s", kind, exc)
            continue
        except McpError as exc:
            result = _probe_mcp_mcp_error(exc, kind=kind)
            if result.get("error_type") != "connection" or attempt > 0:
                return result
            logger.warning("%s streamable HTTP probe connection failure, retrying: %s", kind, exc)
            continue
        except BaseExceptionGroup as exc:
            unwrapped = _unwrap_probe_exception_group(exc, kind=kind)
            if unwrapped is not None:
                if unwrapped.get("error_type") != "connection" or attempt > 0:
                    return unwrapped
                logger.warning(
                    "%s streamable HTTP probe connection failure, retrying: %s", kind, exc
                )
                continue
            if attempt == 0:
                logger.warning(
                    "%s streamable HTTP probe transient failure, retrying: %s", kind, exc
                )
                continue
            logger.exception("streamable HTTP MCP probe failed for %s", kind)
            return {"ok": False, "error": str(exc)}
        except Exception as exc:
            if attempt == 0:
                logger.warning(
                    "%s streamable HTTP probe transient failure, retrying: %s", kind, exc
                )
                continue
            logger.exception("streamable HTTP MCP probe failed for %s", kind)
            return {"ok": False, "error": str(exc)}
    return {"ok": False, "error": "streamable HTTP probe failed after retry"}


async def probe_connector(
    entry: ConnectorCatalogEntry,
    cred_payload: dict[str, Any],
    *,
    instance_id: str,
    config: OctopConfig,
) -> dict[str, Any]:
    if entry.mcp_mode == "gateway":
        try:
            await asyncio.to_thread(probe_gateway_credentials, entry.kind, cred_payload)
        except Exception as exc:
            logger.info("gateway credential probe failed for %s: %s", entry.kind, exc)
            return {"ok": False, "error": str(exc)}
        resp = handle_mcp_request(
            kind=entry.kind,
            creds=cred_payload,
            body={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        )
        if isinstance(resp, dict) and resp.get("error"):
            msg = str((resp.get("error") or {}).get("message") or "gateway error")
            return {"ok": False, "error": msg}
        tools = normalize_tools(
            (resp.get("result") or {}).get("tools") if isinstance(resp, dict) else None
        )
        return {"ok": True, "tool_count": len(tools), "tools": tools}

    spec = build_http_mcp_spec(
        entry=entry,
        instance_id=instance_id,
        creds=cred_payload,
        config=config,
    )
    headers = dict(spec.get("headers") or {})
    url = str(spec["url"])

    if is_mcp_oauth_remote(entry) or entry.remote_transport == "streamable_http":
        return await probe_streamable_http_mcp(url, headers, kind=entry.kind)

    try:
        r = await safe_request(
            "POST",
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "octop", "version": "0.1"},
                },
            },
            headers=headers,
            timeout=20.0,
        )
    except UnsafeOutboundUrl as exc:
        logger.warning("connector probe blocked (SSRF guard): %s", exc)
        return {"ok": False, "error": str(exc)}
    except Exception as exc:
        logger.exception("connector probe failed for %s", entry.kind)
        return {"ok": False, "error": str(exc)}

    err = http_error_message(r)
    if err:
        return {"ok": False, "error": err, "status_code": r.status_code}
    if r.status_code >= 500:
        return {
            "ok": False,
            "error": f"remote service error HTTP {r.status_code}",
            "status_code": r.status_code,
        }

    probed_tools: list[dict[str, str]] = []
    try:
        r2 = await safe_request(
            "POST",
            url,
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            },
            headers=headers,
            timeout=20.0,
        )
        list_err = http_error_message(r2)
        if list_err:
            return {"ok": False, "error": list_err, "status_code": r2.status_code}
        if r2.status_code < 400:
            body = r2.json()
            if isinstance(body, dict):
                probed_tools = normalize_tools((body.get("result") or {}).get("tools"))
    except Exception:
        logger.debug("connector tools/list probe skipped for %s", entry.kind)

    return {
        "ok": True,
        "status_code": r.status_code,
        "tool_count": len(probed_tools),
        "tools": probed_tools,
    }


def format_probe_exception(exc: BaseException) -> str:
    """Flatten TaskGroup / ExceptionGroup errors for API responses."""
    if isinstance(exc, BaseExceptionGroup):
        parts = [format_probe_exception(sub) for sub in exc.exceptions]
        joined = "; ".join(part for part in parts if part)
        return joined or str(exc)
    msg = str(exc).strip()
    return msg or type(exc).__name__


async def probe_custom_mcp_server(spec: dict[str, Any]) -> dict[str, Any]:
    """Probe one user-defined MCP server (streamable_http or stdio)."""
    from octop.infra.connectors.custom_mcp import harness_spec_for_server, normalize_server_spec

    try:
        normalized = normalize_server_spec("probe", spec)
    except OctopError as exc:
        return {
            "ok": False,
            "error": exc.message,
            "error_code": exc.code.value,
            "error_type": "validation",
        }
    except ValueError as exc:
        return {"ok": False, "error": str(exc), "error_type": "validation"}

    connection = harness_spec_for_server(normalized)
    transport = str(connection.get("transport") or "")

    if transport == "streamable_http":
        url = str(connection["url"])
        headers = {str(k): str(v) for k, v in dict(connection.get("headers") or {}).items()}
        # Ensure streamable Accept if caller omitted it.
        headers.setdefault("Accept", "application/json, text/event-stream")
        result = await probe_streamable_http_mcp(url, headers, kind="custom-mcp")
        return await _maybe_attach_oauth_discovery(result, url=url, headers=headers)

    if transport == "stdio":
        return await _probe_stdio_mcp(connection)

    return {"ok": False, "error": f"unsupported transport: {transport}"}


async def _probe_stdio_mcp(connection: dict[str, Any]) -> dict[str, Any]:
    """List tools from a stdio MCP server with a short timeout."""
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    command = str(connection.get("command") or "").strip()
    if not command:
        return {"ok": False, "error": "command is required"}
    args = [str(a) for a in (connection.get("args") or [])]
    env = connection.get("env")
    env_map = {str(k): str(v) for k, v in dict(env or {}).items()} or None
    params = StdioServerParameters(command=command, args=args, env=env_map)

    try:
        async with asyncio.timeout(25):
            async with (
                stdio_client(params) as (read, write),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                listed = await session.list_tools()
                tools = normalize_tools(
                    [{"name": t.name, "description": t.description or ""} for t in listed.tools]
                )
                return {"ok": True, "tool_count": len(tools), "tools": tools}
    except TimeoutError:
        return {"ok": False, "error": "stdio MCP probe timed out"}
    except Exception as exc:
        logger.exception("stdio MCP probe failed")
        return {"ok": False, "error": format_probe_exception(exc)}
