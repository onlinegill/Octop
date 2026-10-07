"""Integration tests for connector APIs."""

from __future__ import annotations

import json
import re
from html import escape
from pathlib import Path
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

import pytest

from octop.infra.connectors.custom_mcp import CUSTOM_MCP_KIND
from octop.infra.connectors.oauth.registry import save_oauth_ctx
from octop.infra.utils.ulid import new_ulid
from tests.support.app import octop_client, write_octop_config
from tests.support.auth import auth_header, bootstrap_admin, create_user, resolve_user_id
from tests.support.http import ws_chat_turn


DIFY_MCP_URL = "https://dify.example.com/mcp/server/srv123/mcp"


def _dify_payload(display_name: str, **extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "kind": "dify",
        "display_name": display_name,
        "credentials": {"mcp_url": DIFY_MCP_URL},
    }
    payload.update(extra)
    return payload


@pytest.fixture
async def env(env_with_agent):
    yield env_with_agent


async def test_catalog(env):
    c, _, auth, _ = env
    r = await c.get("/api/connectors/catalog", headers=auth)
    assert r.status_code == 200
    entries = r.json()
    kinds = {e["kind"] for e in entries}
    assert kinds == {"notion", "openalex", "dify"}
    assert "figma" not in kinds
    for kind in ("notion", "openalex", "dify"):
        entry = next(e for e in entries if e["kind"] == kind)
        assert entry["phase"] == "available", kind

    notion = next(e for e in entries if e["kind"] == "notion")
    assert notion["auth_kind"] == "oauth2"
    assert notion["mcp_mode"] == "remote"
    assert notion["category"] == "knowledge"
    assert notion["oauth_mode"] == "dynamic"
    assert notion["oauth_ready"] is True
    assert notion.get("color")
    assert notion.get("quick_auth_url") is None
    assert "tools" not in notion

    dify = next(e for e in entries if e["kind"] == "dify")
    assert dify["auth_kind"] == "custom_fields"
    assert dify["mcp_mode"] == "remote"
    assert dify["category"] == "self_hosted"
    assert dify["oauth_ready"] is False

    openalex = next(e for e in entries if e["kind"] == "openalex")
    assert openalex == {
        "kind": "openalex",
        "name": "OpenAlex",
        "description": "Open catalog of academic research, authors, venues, and institutions",
        "auth_kind": "custom_fields",
        "doc_url": "https://openalex.org/",
        "icon": "openalex",
        "color": "#ff7f50",
        "phase": "available",
        "mcp_mode": "remote",
        "category": "knowledge",
        "quick_auth_url": None,
        "login_url": None,
        "guide_url": "https://openalex.org/",
        "manual_url": "https://openalex.org/",
        "auth_hint": "OpenAlex API is free; optionally provide an email for the polite pool",
        "oauth_mode": None,
        "oauth_ready": False,
        "credential_fields": [
            {
                "key": "email",
                "label": "Email (Polite pool)",
                "field_type": "text",
                "required": False,
                "placeholder": "your.email@example.com",
                "help": "Recommended by OpenAlex for faster rate limits",
                "secret": False,
            }
        ],
        "supports_quick_auth": True,
    }


async def test_create_dify_instance(env):
    c, _, auth, _ = env
    r = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("My docs"),
    )
    assert r.status_code == 201
    inst = r.json()
    assert inst["kind"] == "dify"
    assert inst["description"]
    assert inst["mcp_server_name"].startswith("dify__")
    assert inst.get("default_open") is False


async def test_create_instance_default_open(env):
    c, _, auth, _ = env
    r = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("My docs", default_open=True),
    )
    assert r.status_code == 201
    inst = r.json()
    assert inst["default_open"] is True

    listed = await c.get("/api/connector-instances", headers=auth)
    assert listed.status_code == 200
    row = next(i for i in listed.json() if i["instance_id"] == inst["instance_id"])
    assert row["default_open"] is True

    detail = await c.get(f"/api/connector-instances/{inst['instance_id']}", headers=auth)
    assert detail.status_code == 200
    assert detail.json()["config"]["default_open"] is True
    assert detail.json()["default_open"] is True


async def test_same_connector_kind_supports_multiple_named_instances(env):
    c, _, auth, _ = env
    first = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("Doc one"),
    )
    second = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("Doc two"),
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["instance_id"] != second.json()["instance_id"]

    duplicate = await c.post(
        "/api/connector-instances",
        headers=auth,
        json={
            "kind": "notion",
            "display_name": "Doc one",
            "credentials": {"access_token": "token"},
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "CONNECTOR_NAME_TAKEN"


async def test_connector_names_are_unique_across_builtin_and_custom(env):
    c, _, auth, _ = env
    custom = await c.put(
        "/api/connectors/custom-mcp",
        headers=auth,
        json={
            "servers": {
                "custom-server": {
                    "display_name": "Duplicate name",
                    "transport": "streamable_http",
                    "url": "https://mcp.example.com/mcp",
                }
            }
        },
    )
    assert custom.status_code == 200

    builtin = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("Duplicate name"),
    )
    assert builtin.status_code == 409
    assert builtin.json()["error"]["code"] == "CONNECTOR_NAME_TAKEN"


async def test_custom_name_cannot_duplicate_builtin_connector(env):
    c, _, auth, _ = env
    builtin = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("Builtin name"),
    )
    assert builtin.status_code == 201

    custom = await c.put(
        "/api/connectors/custom-mcp",
        headers=auth,
        json={
            "servers": {
                "custom-server": {
                    "display_name": "Builtin name",
                    "transport": "streamable_http",
                    "url": "https://mcp.example.com/mcp",
                }
            }
        },
    )
    assert custom.status_code == 409
    assert custom.json()["error"]["code"] == "CONNECTOR_NAME_TAKEN"


async def test_shared_connector_is_visible_but_not_manageable_by_other_user(env):
    c, _, admin_auth, _ = env
    created = await c.post(
        "/api/connector-instances",
        headers=admin_auth,
        json=_dify_payload("Shared docs", shared=True, default_open=True),
    )
    assert created.status_code == 201
    instance_id = created.json()["instance_id"]

    user_auth = await create_user(c, admin_auth, username="connector_reader")
    listed = await c.get("/api/connector-instances", headers=user_auth)
    assert listed.status_code == 200
    shared = next(row for row in listed.json() if row["instance_id"] == instance_id)
    assert shared["shared"] is True
    assert shared["default_open"] is True
    assert shared["can_manage"] is False

    patched = await c.patch(
        f"/api/connector-instances/{instance_id}",
        headers=user_auth,
        json={"display_name": "cannot change"},
    )
    assert patched.status_code == 403


async def test_chat_rejects_unknown_mcp(env):
    c, _, auth, agent_id = env
    chunks = await ws_chat_turn(c, agent_id, auth, mcp_servers=["unknown__instance"])
    assert chunks[0].get("type") == "error"


async def test_get_instance_detail(env):
    c, _, auth, _ = env
    r = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("Workflows"),
    )
    inst = r.json()
    r2 = await c.get(f"/api/connector-instances/{inst['instance_id']}", headers=auth)
    assert r2.status_code == 200
    detail = r2.json()
    assert detail["display_name"] == "Workflows"
    assert detail["credentials_preview"]["mcp_url_configured"] is True


async def test_create_and_edit_instance_description(env):
    c, _, auth, _ = env
    created = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("Docs", description="Team docs connector"),
    )
    assert created.status_code == 201, created.text
    instance_id = created.json()["instance_id"]
    assert created.json()["description"] == "Team docs connector"

    listed = await c.get("/api/connector-instances", headers=auth)
    row = next(item for item in listed.json() if item["instance_id"] == instance_id)
    assert row["description"] == "Team docs connector"

    patched = await c.patch(
        f"/api/connector-instances/{instance_id}",
        headers=auth,
        json={"description": "Updated description"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["description"] == "Updated description"

    detail = await c.get(f"/api/connector-instances/{instance_id}", headers=auth)
    assert detail.status_code == 200, detail.text
    assert detail.json()["description"] == "Updated description"
    assert detail.json()["config"]["description"] == "Updated description"


async def test_auth_info(env):
    c, _, auth, _ = env
    r = await c.get("/api/connectors/auth/notion/info", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert data["login_url"] is None
    assert data["guide_url"] == "https://developers.notion.com/guides/mcp/get-started-with-mcp"
    assert data["auth_hint"]


async def test_oauth_start_public_http_notion_error_is_actionable(tmp_octop_home: Path):
    write_octop_config(tmp_octop_home)
    async with octop_client(tmp_octop_home) as (c, _srv):
        await bootstrap_admin(c, tmp_octop_home)
        auth = await auth_header(c)
        mocked_start = AsyncMock()
        with patch("octop.api.routers.connectors.start_oauth_for_target", mocked_start):
            r = await c.post(
                "/api/connectors/oauth/notion/start",
                headers={**auth, "host": "203.0.113.10"},
                json={"redirect_after": "/connectors"},
            )
    assert r.status_code == 400
    body = r.json()
    assert body["error"]["code"] == "CONNECTOR_OAUTH_HTTPS_REQUIRED"
    assert "OAuth" in body["error"]["message"]
    assert "HTTPS" in body["error"]["message"]
    mocked_start.assert_not_awaited()


async def test_patch_instance_status(env):
    c, _, auth, _ = env
    r = await c.post(
        "/api/connector-instances",
        headers=auth,
        json=_dify_payload("doc"),
    )
    inst = r.json()
    r2 = await c.patch(
        f"/api/connector-instances/{inst['instance_id']}",
        headers=auth,
        json={"status": "disabled"},
    )
    assert r2.status_code == 200
    assert r2.json()["status"] == "disabled"


async def test_patch_custom_mcp_server_default_open_only(env):
    c, _, auth, _ = env
    put = await c.put(
        "/api/connectors/custom-mcp",
        headers=auth,
        json={
            "servers": {
                "linear": {
                    "transport": "streamable_http",
                    "url": "https://mcp.linear.app/mcp",
                    "enabled": True,
                }
            }
        },
    )
    assert put.status_code == 200

    patch = await c.patch(
        "/api/connectors/custom-mcp/servers/linear",
        headers=auth,
        json={"default_open": True},
    )
    assert patch.status_code == 200
    servers = patch.json()["servers"]
    assert servers["linear"]["default_open"] is True
    assert servers["linear"]["enabled"] is True

    patch_off = await c.patch(
        "/api/connectors/custom-mcp/servers/linear",
        headers=auth,
        json={"default_open": False},
    )
    assert patch_off.status_code == 200
    assert "default_open" not in patch_off.json()["servers"]["linear"]


async def test_shared_custom_mcp_is_visible_with_collision_safe_name(env):
    c, _, admin_auth, _ = env
    put = await c.put(
        "/api/connectors/custom-mcp",
        headers=admin_auth,
        json={
            "servers": {
                "linear": {
                    "transport": "streamable_http",
                    "url": "https://mcp.linear.app/mcp",
                    "shared": True,
                }
            }
        },
    )
    assert put.status_code == 200

    user_auth = await create_user(c, admin_auth, username="custom_reader")
    listed = await c.get("/api/connector-instances", headers=user_auth)
    assert listed.status_code == 200
    shared = next(
        row
        for row in listed.json()
        if row["kind"] == CUSTOM_MCP_KIND and row["display_name"] == "linear"
    )
    assert shared["shared"] is True
    assert shared["can_manage"] is False
    assert shared["mcp_server_name"].startswith("custom__")
    assert shared["mcp_server_name"].endswith("__linear")


async def test_custom_mcp_oauth_callback_applies_tokens(env):
    c, srv, auth, _ = env
    user_id = await resolve_user_id(c, auth, "admin")

    put = await c.put(
        "/api/connectors/custom-mcp",
        headers=auth,
        json={
            "servers": {
                "my-oauth-mcp": {
                    "transport": "streamable_http",
                    "url": "https://mcp.example.com/mcp",
                    "enabled": False,
                }
            }
        },
    )
    assert put.status_code == 200

    oauth_state = "test-oauth-state-xyz"
    state_id = new_ulid()
    srv.services.repos.connector_repo.create_oauth_state(
        state_id=state_id,
        state=oauth_state,
        user_id=user_id,
        kind=CUSTOM_MCP_KIND,
        code_verifier="verifier123",
        redirect_after="/connectors",
    )
    save_oauth_ctx(
        srv.services.settings_repo,
        state_id,
        {
            "flow": "custom_mcp",
            "kind": CUSTOM_MCP_KIND,
            "server_name": "my-oauth-mcp",
            "issuer": "https://auth.example.com",
            "resource": "https://mcp.example.com/mcp",
            "client_id": "cid",
            "client_secret": None,
            "redirect_uri": "http://testserver/api/connectors/oauth/callback",
            "metadata": {
                "authorization_endpoint": "https://auth.example.com/authorize",
                "token_endpoint": "https://auth.example.com/token",
            },
        },
    )

    with patch(
        "octop.api.routers.connectors.exchange_oauth_code",
        new_callable=AsyncMock,
        return_value={
            "access_token": "new-access-token",
            "refresh_token": "refresh-tok",
            "expires_at": 9_999_999_999,
        },
    ):
        callback = await c.get(
            f"/api/connectors/oauth/callback?code=authcode&state={oauth_state}",
            follow_redirects=False,
        )
    assert callback.status_code == 200
    assert "octop:connector-oauth" in callback.text

    stored = await c.get("/api/connectors/custom-mcp", headers=auth)
    assert stored.status_code == 200
    assert stored.json()["servers"]["my-oauth-mcp"]["oauth"]["configured"] is True

    pending = await c.get(f"/api/connectors/oauth/pending/{state_id}", headers=auth)
    assert pending.status_code == 200
    body = pending.json()
    assert body["applied"] is True
    assert body["server_name"] == "my-oauth-mcp"


async def test_custom_mcp_oauth_start_unified(env):
    c, _, auth, _ = env
    put = await c.put(
        "/api/connectors/custom-mcp",
        headers=auth,
        json={
            "servers": {
                "oauth-srv": {
                    "transport": "streamable_http",
                    "url": "https://mcp.example.com/mcp",
                }
            }
        },
    )
    assert put.status_code == 200

    mocked_start = AsyncMock(
        return_value=(
            "https://auth.example.com/authorize?state=x",
            "verifier",
            {"flow": "custom_mcp"},
        )
    )
    with (
        patch("octop.api.routers.connectors._is_public_http_uri", return_value=False),
        patch("octop.api.routers.connectors.start_oauth_for_target", mocked_start),
    ):
        r = await c.post(
            "/api/connectors/oauth/start",
            headers=auth,
            json={
                "target": {"type": "custom_mcp", "server_name": "oauth-srv"},
                "redirect_after": "/connectors",
            },
        )
    assert r.status_code == 200
    data = r.json()
    assert data["authorize_url"].startswith("https://auth.example.com/")
    assert data["state_id"]
    mocked_start.assert_awaited_once()
    call_kwargs = mocked_start.await_args.kwargs
    assert call_kwargs["target"] == {"type": "custom_mcp", "server_name": "oauth-srv"}
    assert call_kwargs["mcp_url"] == "https://mcp.example.com/mcp"


@pytest.mark.parametrize(
    ("redirect_after", "expected_path"),
    [
        ("/connectors", "/connectors"),
        ("/connectors?tab=custom&empty=#oauth", "/connectors"),
        ("/connectors?oauth_state=stale", "/connectors"),
        ("/x'+alert(document.cookie)+'", "/x'+alert(document.cookie)+'"),
        ("/</script><script>alert(1)</script>", "/</script><script>alert(1)</script>"),
        ("https://attacker.example", "/connectors"),
        ("//attacker.example", "/connectors"),
        ("/\\attacker.example", "/connectors"),
        ("/\n/attacker.example", "/connectors"),
        ("/\r/attacker.example", "/connectors"),
        ("/\t/attacker.example", "/connectors"),
        ("javascript:alert(1)", "/connectors"),
    ],
)
async def test_oauth_callback_safely_renders_stored_redirect(env, redirect_after, expected_path):
    c, srv, auth, _ = env
    user_id = await resolve_user_id(c, auth, "admin")
    state_id = new_ulid()
    srv.services.repos.connector_repo.create_oauth_state(
        state_id=state_id,
        state=state_id,
        user_id=user_id,
        kind="notion",
        code_verifier="verifier",
        redirect_after=redirect_after,
    )
    with patch(
        "octop.api.routers.connectors.exchange_oauth_code",
        new_callable=AsyncMock,
        return_value={"access_token": "test-token"},
    ):
        response = await c.get(
            "/api/connectors/oauth/callback", params={"code": "code", "state": state_id}
        )
    assert response.status_code == 200
    # A tag payload must stay inside one JSON string, not create another script.
    assert response.text.count("<script>") == response.text.count("</script>") == 1
    assignment = re.search(r"window.location.href = (.*);", response.text)
    assert assignment is not None
    target = urlsplit(json.loads(assignment.group(1)))
    assert not target.scheme and not target.netloc
    assert target.path == expected_path
    query = parse_qs(target.query, keep_blank_values=True)
    assert query["oauth_state"] == [state_id]
    if "tab=custom" in redirect_after:
        assert query["tab"] == ["custom"]
        assert query["empty"] == [""]
        assert target.fragment == "oauth"
    assert "}, window.location.origin);" in response.text
    pending = await c.get(f"/api/connectors/oauth/pending/{state_id}", headers=auth)
    assert pending.status_code == 200
    assert pending.json()["tokens"]["access_token"] == "test-token"


@pytest.mark.parametrize("exchange_error", [False, True])
async def test_oauth_callback_escapes_error_html(env, exchange_error):
    c, srv, auth, _ = env
    payload = '<img src=x onerror="alert(1)">'
    user_id = await resolve_user_id(c, auth, "admin")
    state_id = new_ulid()
    srv.services.repos.connector_repo.create_oauth_state(
        state_id=state_id,
        state=state_id,
        user_id=user_id,
        kind="notion",
        code_verifier="verifier",
        redirect_after="/connectors",
    )
    with patch(
        "octop.api.routers.connectors.exchange_oauth_code",
        new_callable=AsyncMock,
        side_effect=ValueError(payload),
    ):
        response = await c.get(
            "/api/connectors/oauth/callback",
            params={"code": "code", "state": state_id} if exchange_error else {"error": payload},
        )
    assert response.status_code == 400
    assert payload not in response.text
    assert escape(payload) in response.text
