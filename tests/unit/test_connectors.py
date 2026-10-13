"""Unit tests for connector builder and repo."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import pytest

from octop.config import OctopConfig
from octop.infra.connectors.builder import (
    build_http_mcp_spec,
    mcp_server_name,
    validate_create_credentials,
)
from octop.infra.connectors.catalog import get_catalog_entry
from octop.infra.connectors.gateway.protocol import handle_mcp_request
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.connectors import ConnectorRepo
from octop.infra.utils.ulid import new_ulid


@pytest.fixture
def db(tmp_path: Path) -> SqlitePool:
    pool = SqlitePool(tmp_path / "octop.db")
    run_migrations(pool)
    return pool


def test_mcp_server_name_format():
    iid = new_ulid()
    assert mcp_server_name("notion", iid) == f"notion__{iid}"


def test_build_notion_remote_spec():
    entry = get_catalog_entry("notion")
    assert entry is not None
    assert entry.oauth_issuer == "https://mcp.notion.com"
    assert entry.mcp_url == "https://mcp.notion.com/mcp"
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds={"access_token": "ntn_xxx"},
        config=OctopConfig(),
    )
    assert spec["url"] == "https://mcp.notion.com/mcp"
    assert spec["headers"]["Authorization"] == "Bearer ntn_xxx"
    assert spec["headers"]["Accept"] == "application/json, text/event-stream"
    assert spec["headers"]["User-Agent"] == "octop-connector/0.1"


<<<<<<< HEAD
=======
def test_mcp_oauth_remote_catalog_helpers():
    from octop.infra.connectors.catalog import (
        get_mcp_oauth_remote,
        is_mcp_oauth_remote,
        mcp_oauth_remote_kinds,
    )
    from octop.infra.connectors.oauth.mcp import resource_for_kind

    notion = get_catalog_entry("notion")
    ardot = get_catalog_entry("tencent-ardot")
    dida = get_catalog_entry("dida365")
    assert notion is not None and ardot is not None and dida is not None
    assert is_mcp_oauth_remote(notion)
    assert is_mcp_oauth_remote(ardot)
    assert is_mcp_oauth_remote(dida)
    assert mcp_oauth_remote_kinds() >= {"notion", "tencent-ardot", "dida365"}
    assert get_mcp_oauth_remote("notion") is notion
    assert get_mcp_oauth_remote("tencent-docs") is None
    assert resource_for_kind("tencent-ardot") == "https://ardot.tencent.com/mcp"
    assert resource_for_kind("dida365") == "https://mcp.dida365.com/"
    assert resource_for_kind("notion") is None
    assert dida.mcp_url == "https://mcp.dida365.com"
    assert dida.oauth_scopes == "tasks:read tasks:write"


def test_mcp_oauth_scopes_prefer_metadata_then_catalog():
    from octop.infra.connectors.oauth.registry import _scopes_for_kind

    assert _scopes_for_kind("dida365", {"scopes_supported": ["a", "b"]}) == "a b"
    assert _scopes_for_kind("dida365", {}) == "tasks:read tasks:write"
    assert _scopes_for_kind("notion", {}) is None


def test_oauth2_accepts_token_alias_for_access_token():
    payload = validate_create_credentials("dida365", {"token": "paste-tok"})
    assert payload == {"access_token": "paste-tok"}


def test_build_dida365_remote_spec():
    entry = get_catalog_entry("dida365")
    assert entry is not None
    assert entry.name.resolve("zh") == "滴答清单"
    assert entry.name.resolve("en") == "TickTick"
    assert entry.auth_kind == "oauth2"
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds={"access_token": "dida-tok"},
        config=OctopConfig(),
    )
    assert spec["transport"] == "http"
    assert spec["url"] == "https://mcp.dida365.com"
    assert spec["headers"]["Authorization"] == "Bearer dida-tok"
    assert spec["headers"]["Accept"] == "application/json, text/event-stream"


def test_weknora_catalog_and_credentials():
    from octop.infra.connectors.catalog import catalog_entry_to_dict

    entry = get_catalog_entry("weknora")
    assert entry is not None
    assert entry.mcp_mode == "gateway"
    data = catalog_entry_to_dict(entry)
    fields = {item["key"]: item for item in data["credential_fields"]}
    assert fields["base_url"]["field_type"] == "url"
    assert fields["api_key"]["secret"] is True

    payload = validate_create_credentials(
        "weknora",
        {
            "base_url": "http://127.0.0.1:8080/",
            "api_key": "sk-secret",
            "tenant_id": "tenant-1",
            "knowledge_base_ids": "kb-1, kb-2, kb-1",
        },
    )
    assert payload["base_url"] == "http://127.0.0.1:8080/api/v1"
    assert payload["api_key"] == "sk-secret"
    assert payload["tenant_id"] == "tenant-1"
    assert payload["knowledge_base_ids"] == ["kb-1", "kb-2"]
    assert payload["internal_token"]


def test_obsidian_cli_catalog_and_credentials(tmp_path: Path):
    from octop.infra.connectors.catalog import list_catalog

    entry = get_catalog_entry("obsidian-cli")
    assert entry is not None
    assert entry.mcp_mode == "gateway"
    assert entry.auth_kind == "custom_fields"
    assert entry.category == "knowledge"
    kinds = [item.kind for item in list_catalog()]
    assert kinds.index("obsidian-cli") < kinds.index("weknora")
    assert kinds[-2:] == ["weknora", "dify"]

    binary = tmp_path / "obsidian"
    binary.write_text("", encoding="utf-8")
    payload = validate_create_credentials(
        "obsidian-cli",
        {"vault": "My Vault", "binary_path": str(binary)},
    )
    assert payload["vault"] == "My Vault"
    assert payload["binary_path"] == str(binary)
    assert payload["internal_token"]

    bare = validate_create_credentials("obsidian-cli", {"vault": "Notes", "binary_path": "  "})
    assert bare["vault"] == "Notes"
    assert "binary_path" not in bare

    with pytest.raises(ValueError, match="vault is required"):
        validate_create_credentials("obsidian-cli", {"vault": "  "})
    with pytest.raises(ValueError, match="cannot contain newlines"):
        validate_create_credentials("obsidian-cli", {"vault": "A\nB"})
    with pytest.raises(ValueError, match="existing file"):
        validate_create_credentials(
            "obsidian-cli",
            {"vault": "Notes", "binary_path": str(tmp_path / "missing")},
        )


def test_weknora_rejects_non_https_remote_url():
    from octop.infra.errors import ErrorCode, OctopError

    with pytest.raises(OctopError) as exc:
        validate_create_credentials(
            "weknora",
            {"base_url": "http://weknora.example.com", "api_key": "sk-secret"},
        )
    assert exc.value.code is ErrorCode.CONNECTOR_MCP_HTTPS_REQUIRED
    with pytest.raises(ValueError, match="query string or fragment"):
        validate_create_credentials(
            "weknora",
            {"base_url": "https://weknora.example.com?token=secret"},
        )


def test_weknora_allows_lan_http_base_url():
    payload = validate_create_credentials(
        "weknora",
        {
            "base_url": "http://10.0.0.5:8080/",
            "api_key": "sk-secret",
            "tenant_id": "tenant-1",
            "knowledge_base_ids": "kb-1",
        },
    )
    assert payload["base_url"] == "http://10.0.0.5:8080/api/v1"


>>>>>>> upstream/main
def test_dify_builds_streamable_http_spec():
    entry = get_catalog_entry("dify")
    assert entry is not None
    assert entry.remote_transport == "streamable_http"
    creds = validate_create_credentials(
        "dify",
        {"mcp_url": "https://dify.example.com/mcp/server/server-code/mcp"},
    )
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds=creds,
        config=OctopConfig(),
    )
    assert spec == {
        "transport": "http",
        "url": "https://dify.example.com/mcp/server/server-code/mcp",
        "headers": {"Accept": "application/json, text/event-stream"},
    }


def test_dify_rejects_non_server_url():
    with pytest.raises(ValueError, match="Dify MCP Server URL"):
        validate_create_credentials("dify", {"mcp_url": "https://dify.example.com/v1/chat"})


def test_dify_server_code_is_redacted_from_logs():
    from octop.infra.connectors.builder import _redact_mcp_configs_for_log

    redacted = _redact_mcp_configs_for_log(
        {
            "dify__x": {
                "transport": "http",
                "url": "https://dify.example.com/mcp/server/secret-code/mcp",
            }
        }
    )
    assert redacted["dify__x"]["url"] == "https://dify.example.com/mcp/server/***/mcp"


def test_custom_field_preview_redacts_secrets():
    from octop.api.routers.connectors import _credentials_preview

    dify = _credentials_preview(
        "dify",
        {"mcp_url": "https://dify.example.com/mcp/server/secret-code/mcp"},
    )
    assert dify == {"mcp_url_configured": True}


async def test_dify_probe_uses_streamable_http(monkeypatch: pytest.MonkeyPatch):
    from octop.infra.connectors.probe import probe_connector

    seen: dict[str, object] = {}

    async def _probe(url: str, headers: dict[str, str], *, kind: str) -> dict[str, object]:
        seen.update(url=url, headers=headers, kind=kind)
        return {"ok": True, "tool_count": 1, "tools": [{"name": "run", "description": ""}]}

    monkeypatch.setattr("octop.infra.connectors.probe.probe_streamable_http_mcp", _probe)
    entry = get_catalog_entry("dify")
    assert entry is not None
    result = await probe_connector(
        entry,
        {"mcp_url": "https://dify.example.com/mcp/server/code/mcp"},
        instance_id="probe",
        config=OctopConfig(),
    )
    assert result["ok"] is True
    assert seen == {
        "url": "https://dify.example.com/mcp/server/code/mcp",
        "headers": {"Accept": "application/json, text/event-stream"},
        "kind": "dify",
    }


def test_catalog_entry_dict_has_no_tools():
    from octop.infra.connectors.catalog import catalog_entry_to_dict, get_catalog_entry

    entry = get_catalog_entry("notion")
    assert entry is not None
    data = catalog_entry_to_dict(entry)
    assert "tools" not in data
    assert data["category"] == "knowledge"


def test_every_catalog_entry_has_category():
    from octop.infra.connectors.catalog import get_catalog_entry, list_catalog

    allowed = {
        "office",
        "knowledge",
        "travel",
        "productivity",
        "media",
        "professional",
        "self_hosted",
    }
    expected = {
        "notion": "knowledge",
        "openalex": "knowledge",
        "dify": "self_hosted",
    }
    for entry in list_catalog():
        assert entry.category in allowed, entry.kind
    for kind, category in expected.items():
        entry = get_catalog_entry(kind)
        assert entry is not None
        assert entry.category == category


def test_oauth_ready_notion():
    from octop.infra.connectors.oauth import oauth_ready_for_kind

    class _Settings:
        def get(self, _key: str) -> str:
            return ""

    assert oauth_ready_for_kind("notion", _Settings()) is True
    assert oauth_ready_for_kind("dify", _Settings()) is False


def test_mcp_args_model_drops_nulls_before_validation():
    from octop_harness.mcp import mcp_args_model

    model = mcp_args_model(
        "search_place",
        {
            "type": "object",
            "required": ["query", "region"],
            "properties": {
                "query": {"type": "string"},
                "region": {"type": "string"},
            },
        },
    )
    # Null region is omitted, then required validation fires clearly.
    with pytest.raises(Exception, match="region"):
        model.model_validate({"query": "parking near the central station", "region": None})
    ok = model.model_validate({"query": "parking near the central station", "region": "Berlin"})
    assert ok.model_dump() == {"query": "parking near the central station", "region": "Berlin"}


def test_probe_notion_routes_to_streamable(monkeypatch: pytest.MonkeyPatch):
    from octop.infra.connectors.probe import probe_connector

    captured: dict[str, object] = {}

    async def _fake(url: str, headers: dict[str, str], *, kind: str) -> dict[str, object]:
        captured["url"] = url
        captured["headers"] = headers
        captured["kind"] = kind
        return {
            "ok": True,
            "tool_count": 1,
            "tools": [{"name": "notion-search", "description": "Search"}],
        }

    monkeypatch.setattr("octop.infra.connectors.probe.probe_streamable_http_mcp", _fake)
    entry = get_catalog_entry("notion")
    assert entry is not None

    out = asyncio.run(
        probe_connector(
            entry,
            {"access_token": "ntn_tok"},
            instance_id="probe",
            config=OctopConfig(),
        )
    )
    assert captured["kind"] == "notion"
    assert captured["url"] == "https://mcp.notion.com/mcp"
    assert out["ok"] is True
    assert out["tools"][0]["name"] == "notion-search"


<<<<<<< HEAD
=======
def test_personal_token_meeting():
    payload = validate_create_credentials(
        "tencent-meeting",
        {"token": "meeting-token"},
    )
    assert payload["token"] == "meeting-token"


def test_build_tencent_meeting_remote_spec():
    entry = get_catalog_entry("tencent-meeting")
    assert entry is not None
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds={"token": "tok"},
        config=OctopConfig(),
    )
    assert spec["transport"] == "http"
    assert spec["url"] == "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1"
    assert spec["headers"]["X-Tencent-Meeting-Token"] == "tok"
    assert spec["headers"]["X-Skill-Version"] == "v1.0.1"


def test_build_tencent_ardot_remote_spec():
    entry = get_catalog_entry("tencent-ardot")
    assert entry is not None
    assert entry.name.resolve("zh") == "腾讯设计 Ardot"
    assert entry.name.resolve("en") == "Tencent Ardot"
    assert entry.auth_kind == "oauth2"
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds={"access_token": "ardot-tok"},
        config=OctopConfig(),
    )
    assert spec["transport"] == "http"
    assert spec["url"] == "https://ardot.tencent.com/mcp"
    assert spec["headers"]["Authorization"] == "Bearer ardot-tok"
    assert spec["headers"]["Accept"] == "application/json, text/event-stream"


def test_tencent_ardot_oauth_credentials():
    payload = validate_create_credentials(
        "tencent-ardot",
        {"access_token": "ardot-tok"},
    )
    assert payload["access_token"] == "ardot-tok"


def test_probe_tencent_ardot_routes_to_streamable(monkeypatch: pytest.MonkeyPatch):
    from octop.infra.connectors.probe import probe_connector

    captured: dict[str, object] = {}

    async def _fake(url: str, headers: dict[str, str], *, kind: str) -> dict[str, object]:
        captured["url"] = url
        captured["headers"] = headers
        captured["kind"] = kind
        return {
            "ok": True,
            "tool_count": 1,
            "tools": [{"name": "fetch_editor_state", "description": "Editor state"}],
        }

    monkeypatch.setattr("octop.infra.connectors.probe.probe_streamable_http_mcp", _fake)
    entry = get_catalog_entry("tencent-ardot")
    assert entry is not None

    out = asyncio.run(
        probe_connector(
            entry,
            {"access_token": "ardot-tok"},
            instance_id="probe",
            config=OctopConfig(),
        )
    )
    assert captured["kind"] == "tencent-ardot"
    assert captured["url"] == "https://ardot.tencent.com/mcp"
    assert captured["headers"]["Authorization"] == "Bearer ardot-tok"
    assert out["ok"] is True
    assert out["tools"][0]["name"] == "fetch_editor_state"


def test_oauth_ready_tencent_ardot():
    from octop.infra.connectors.oauth import oauth_ready_for_kind

    class _Settings:
        def get(self, _key: str) -> str:
            return ""

    assert oauth_ready_for_kind("tencent-ardot", _Settings()) is True


def test_ardot_token_exchange_includes_resource(monkeypatch: pytest.MonkeyPatch):
    from octop.infra.connectors.oauth import mcp as oauth_mcp

    captured: dict[str, object] = {}

    class _Resp:
        status_code = 200
        text = ""

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "access_token": "tok",
                "refresh_token": "ref",
                "expires_in": 3600,
            }

    async def _fake_request(
        method: str,
        url: str,
        *,
        data: dict[str, str] | None = None,
        **_kwargs: object,
    ) -> _Resp:
        del method, url
        captured["data"] = dict(data or {})
        return _Resp()

    async def _fake_ensure(url: str, **_kwargs: object) -> str:
        return url

    monkeypatch.setattr(oauth_mcp, "safe_request", _fake_request)
    monkeypatch.setattr(oauth_mcp, "_ensure_mcp_oauth_url", _fake_ensure)

    out = asyncio.run(
        oauth_mcp.exchange_authorization_code(
            {
                "token_endpoint": "https://ardot.tencent.com/oauth/token",
            },
            issuer="https://ardot.tencent.com",
            client_id="cid",
            client_secret=None,
            code="code",
            redirect_uri="http://127.0.0.1:9000/api/connectors/oauth/callback",
            code_verifier="verifier",
            resource="https://ardot.tencent.com/mcp",
        )
    )
    assert out["access_token"] == "tok"
    assert captured["data"]["resource"] == "https://ardot.tencent.com/mcp"
    assert captured["data"]["code_verifier"] == "verifier"


def test_build_youdao_remote_spec():
    entry = get_catalog_entry("youdao-note")
    assert entry is not None
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds={"token": "api-key"},
        config=OctopConfig(),
    )
    assert spec["transport"] == "sse"
    assert spec["url"] == "https://open.mail.163.com/api/ynote/mcp/sse"
    assert spec["headers"]["x-api-key"] == "api-key"


def test_youdao_probe_invalid_api_key(monkeypatch: pytest.MonkeyPatch):
    from contextlib import asynccontextmanager

    import httpx

    from octop.infra.connectors.probe import probe_youdao_note

    class _FakeResponse(httpx.Response):
        def __init__(self) -> None:
            super().__init__(
                401,
                json={"error": 10002, "desc": "get api key info error"},
                request=httpx.Request("GET", "https://open.mail.163.com/api/ynote/mcp/sse"),
            )

    @asynccontextmanager
    async def _failing_sse_client(*_args: object, **_kwargs: object):
        req = httpx.Request("GET", "https://open.mail.163.com/api/ynote/mcp/sse")
        raise httpx.HTTPStatusError("401", request=req, response=_FakeResponse())
        yield  # pragma: no cover

    monkeypatch.setattr("mcp.client.sse.sse_client", _failing_sse_client)

    out = asyncio.run(probe_youdao_note("bad"))
    assert out["ok"] is False
    assert "api key" in out["error"].lower()


def test_probe_youdao_routes_to_sse_probe(monkeypatch: pytest.MonkeyPatch):
    from octop.infra.connectors.probe import probe_connector

    captured: dict[str, str] = {}

    async def _fake(api_key: str) -> dict[str, object]:
        captured["api_key"] = api_key
        return {"ok": True, "tool_count": 1, "tools": [{"name": "list", "description": ""}]}

    monkeypatch.setattr("octop.infra.connectors.probe.probe_youdao_note", _fake)
    entry = get_catalog_entry("youdao-note")
    assert entry is not None

    out = asyncio.run(
        probe_connector(
            entry,
            {"token": "yn-key"},
            instance_id="probe",
            config=OctopConfig(),
        )
    )
    assert captured["api_key"] == "yn-key"
    assert out["ok"] is True


def test_build_tencent_lexiang_remote_spec():
    entry = get_catalog_entry("tencent-lexiang")
    assert entry is not None
    spec = build_http_mcp_spec(
        entry=entry,
        instance_id="x",
        creds={"api_key": "lx-tok", "company_from": "csig"},
        config=OctopConfig(),
    )
    assert spec["url"] == "https://mcp.lexiang-app.com/mcp?company_from=csig&preset=meta"
    assert spec["headers"]["Authorization"] == "Bearer lx-tok"


def test_tencent_lexiang_credentials():
    payload = validate_create_credentials(
        "tencent-lexiang",
        {"api_key": "lx-tok", "client_id": "csig"},
    )
    assert payload == {"api_key": "lx-tok", "company_from": "csig"}


>>>>>>> upstream/main
def test_connector_repo_supports_multiple_kinds_and_unique_names(db: SqlitePool):
    repo = ConnectorRepo(db)
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, ?, 0)",
            ("u", "h", "user"),
        )
        uid = conn.execute("SELECT id FROM users").fetchone()["id"]
    iid = new_ulid()
    repo.create(
        instance_id=iid,
        user_id=uid,
        kind="notion",
        display_name="doc",
        mcp_server_name=mcp_server_name("notion", iid),
    )
    repo.upsert_credentials(instance_id=iid, blob=b"enc", expires_at=None)
    mcp_name = mcp_server_name("notion", iid)
    assert repo.validate_mcp_servers_for_user(uid, [mcp_name]) == [mcp_name]
    with pytest.raises(ValueError):
        repo.validate_mcp_servers_for_user(uid, ["other"])

    second = new_ulid()
    repo.create(
        instance_id=second,
        user_id=uid,
        kind="notion",
        display_name="doc 2",
        mcp_server_name=mcp_server_name("notion", second),
        shared=True,
    )
    assert [row.instance_id for row in repo.list_visible(uid)] == [iid, second]

    duplicate_name = new_ulid()
    with pytest.raises(sqlite3.IntegrityError):
        repo.create(
            instance_id=duplicate_name,
            user_id=uid,
            kind="openalex",
            display_name="doc",
            mcp_server_name=mcp_server_name("openalex", duplicate_name),
        )


def test_validate_mcp_servers_for_user(db: SqlitePool):
    repo = ConnectorRepo(db)
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO users(username, password_hash, role, created_at) VALUES (?, ?, ?, 0)",
            ("u2", "h", "user"),
        )
        uid = conn.execute("SELECT id FROM users WHERE username = 'u2'").fetchone()["id"]
    iid = new_ulid()
    mcp_name = mcp_server_name("notion", iid)
    repo.create(
        instance_id=iid,
        user_id=uid,
        kind="notion",
        display_name="doc",
        mcp_server_name=mcp_name,
    )
    repo.upsert_credentials(instance_id=iid, blob=b"enc", expires_at=None)
    assert repo.validate_mcp_servers_for_user(uid, [mcp_name]) == [mcp_name]
    with pytest.raises(ValueError):
        repo.validate_mcp_servers_for_user(uid, ["other"])
