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
