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
