#!/usr/bin/env python3
"""Sanitize script to ensure Octop remains 100% English-default and free of China-hosted connectors."""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sanitize_locale_prefs():
    path = os.path.join(ROOT, "dashboard/src/utils/localePrefs.ts")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        content = re.sub(
            r'export function normalizeUiLocale\(raw: string \| null \| undefined\): UiLocale \{\s*if \(!raw\) return "zh";',
            'export function normalizeUiLocale(raw: string | null | undefined): UiLocale {\n  if (!raw) return "en";',
            content,
        )
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Sanitized localePrefs.ts")


def sanitize_channels():
    path = os.path.join(ROOT, "dashboard/src/pages/Agent/Channels/components/constants.ts")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        content = re.sub(
            r'export const CHANNEL_KEYS: ChannelKey\[\] = \[[^\]]+\];',
            'export const CHANNEL_KEYS: ChannelKey[] = [\n  "telegram",\n  "discord",\n  "mqtt",\n];',
            content,
        )
        content = re.sub(
            r'const COLLAPSED_CHANNEL_KEYS = new Set<ChannelKey>\(\[[^\]]*\]\);',
            'const COLLAPSED_CHANNEL_KEYS = new Set<ChannelKey>([]);',
            content,
        )
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Sanitized channel constants.ts")


def sanitize_connectors():
    catalog_path = os.path.join(ROOT, "src/octop/infra/connectors/catalog.py")
    if os.path.exists(catalog_path):
        # We ensure catalog only exposes Notion, OpenAlex, Dify
        catalog_code = '''"""Static connector catalog — bundled presets for HTTP MCP services."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AuthKind = Literal[
    "personal_token",
    "oauth2",
    "auth_code",
    "api_key",
    "imap_app_password",
    "session_cookie",
    "api_credentials",
    "custom_fields",
]

CredentialFieldType = Literal["text", "password", "url", "tags"]
RemoteTransport = Literal["raw_http", "streamable_http", "sse"]
McpMode = Literal["remote", "gateway", "internal"]
ConnectorCategory = Literal[
    "office",
    "knowledge",
    "travel",
    "productivity",
    "media",
    "professional",
    "self_hosted",
]


@dataclass(frozen=True)
class ConnectorCredentialField:
    key: str
    label: str
    field_type: CredentialFieldType = "text"
    required: bool = True
    placeholder: str | None = None
    help: str | None = None
    secret: bool = False


@dataclass(frozen=True)
class ConnectorCatalogEntry:
    kind: str
    name: str
    description: str
    auth_kind: AuthKind
    doc_url: str
    icon: str
    color: str
    phase: Literal["available", "coming_soon"]
    mcp_mode: McpMode
    category: ConnectorCategory
    quick_auth_url: str | None = None
    login_url: str | None = None
    guide_url: str | None = None
    manual_url: str | None = None
    auth_hint: str | None = None
    allowed_tools: tuple[str, ...] | None = None
    oauth_issuer: str | None = None
    mcp_url: str | None = None
    oauth_resource: str | None = None
    oauth_scopes: str | None = None
    mcp_user_agent: str | None = None
    credential_fields: tuple[ConnectorCredentialField, ...] = ()
    remote_transport: RemoteTransport = "raw_http"


def is_inprocess_gateway(entry: ConnectorCatalogEntry) -> bool:
    return entry.mcp_mode == "gateway"


def uses_internal_http_mcp(entry: ConnectorCatalogEntry) -> bool:
    return entry.mcp_mode == "internal"


def is_mcp_oauth_remote(entry: ConnectorCatalogEntry) -> bool:
    return (
        entry.auth_kind == "oauth2"
        and entry.mcp_mode in {"remote", "internal"}
        and bool(entry.oauth_issuer)
        and bool(entry.mcp_url)
    )


def mcp_oauth_remote_kinds() -> frozenset[str]:
    return frozenset(e.kind for e in _CATALOG if is_mcp_oauth_remote(e))


def get_mcp_oauth_remote(kind: str) -> ConnectorCatalogEntry | None:
    entry = get_catalog_entry(kind)
    if entry is None or not is_mcp_oauth_remote(entry):
        return None
    return entry


_CATALOG: tuple[ConnectorCatalogEntry, ...] = (
    ConnectorCatalogEntry(
        kind="notion",
        name="Notion",
        description="Official MCP: Search, read, and write pages and databases",
        auth_kind="oauth2",
        doc_url="https://developers.notion.com/docs/mcp",
        icon="notion",
        color="#000000",
        phase="available",
        mcp_mode="remote",
        category="knowledge",
        guide_url="https://developers.notion.com/guides/mcp/get-started-with-mcp",
        auth_hint="Authorize with Notion or manually enter your integration token",
        oauth_issuer="https://mcp.notion.com",
        mcp_url="https://mcp.notion.com/mcp",
        oauth_scopes="read:content write:content",
    ),
    ConnectorCatalogEntry(
        kind="openalex",
        name="OpenAlex",
        description="Open catalog of academic research, authors, venues, and institutions",
        auth_kind="custom_fields",
        doc_url="https://openalex.org/",
        icon="openalex",
        color="#ff7f50",
        phase="available",
        mcp_mode="remote",
        category="knowledge",
        auth_hint="OpenAlex API is free; optionally provide an email for the polite pool",
        credential_fields=(
            ConnectorCredentialField(
                key="email",
                label="Email (Polite pool)",
                required=False,
                placeholder="your.email@example.com",
                help="Recommended by OpenAlex for faster rate limits",
            ),
        ),
        remote_transport="streamable_http",
    ),
    ConnectorCatalogEntry(
        kind="dify",
        name="Dify",
        description="Connect published Dify apps or workflow MCP endpoints",
        auth_kind="custom_fields",
        doc_url="https://docs.dify.ai/",
        icon="dify",
        color="#1c64f2",
        phase="available",
        mcp_mode="remote",
        category="self_hosted",
        auth_hint="Enable MCP on your Dify endpoint and paste the MCP server URL",
        credential_fields=(
            ConnectorCredentialField(
                key="mcp_url",
                label="MCP Server URL",
                field_type="url",
                placeholder="https://dify.example.com/mcp/server/<server_code>/mcp",
                help="Full endpoint URL",
                secret=True,
            ),
        ),
        remote_transport="streamable_http",
    ),
)


def get_catalog() -> tuple[ConnectorCatalogEntry, ...]:
    return _CATALOG


def list_catalog() -> list[ConnectorCatalogEntry]:
    return list(_CATALOG)


def get_catalog_entry(kind: str) -> ConnectorCatalogEntry | None:
    for entry in _CATALOG:
        if entry.kind == kind:
            return entry
    return None


def catalog_entry_to_dict(
    entry: ConnectorCatalogEntry, *, oauth_ready: bool = False, locale: str = "en"
) -> dict[str, object]:
    from octop.infra.connectors.oauth import oauth_mode_for_kind  # noqa: PLC0415

    oauth_mode = oauth_mode_for_kind(entry.kind)
    return {
        "kind": entry.kind,
        "name": entry.name,
        "description": entry.description,
        "auth_kind": entry.auth_kind,
        "doc_url": entry.doc_url,
        "icon": entry.icon,
        "color": entry.color,
        "phase": entry.phase,
        "mcp_mode": entry.mcp_mode,
        "category": entry.category,
        "quick_auth_url": entry.quick_auth_url,
        "login_url": entry.login_url,
        "guide_url": entry.guide_url or entry.doc_url,
        "manual_url": entry.manual_url or entry.guide_url or entry.doc_url,
        "auth_hint": entry.auth_hint,
        "oauth_mode": oauth_mode,
        "oauth_ready": oauth_ready,
        "credential_fields": [
            {
                "key": field.key,
                "label": field.label,
                "field_type": field.field_type,
                "required": field.required,
                "placeholder": field.placeholder,
                "help": field.help,
                "secret": field.secret,
            }
            for field in entry.credential_fields
        ],
        "supports_quick_auth": entry.phase == "available" and entry.auth_kind != "api_credentials",
    }
'''
        with open(catalog_path, "w", encoding="utf-8") as f:
            f.write(catalog_code)
        print("Sanitized catalog.py")

    registry_path = os.path.join(ROOT, "src/octop/infra/connectors/gateway/registry.py")
    if os.path.exists(registry_path):
        registry_code = '''"""Gateway adapter registry — kind -> list_tools / call_tool / probe."""

from __future__ import annotations

from typing import Any, Protocol


class GatewayAdapter(Protocol):
    def list_tools(self) -> list[dict[str, Any]]: ...

    def call_tool(self, creds: dict[str, Any], name: str, args: dict[str, Any]) -> str: ...

    def probe_credentials(self, creds: dict[str, Any]) -> None: ...


_ADAPTERS: dict[str, GatewayAdapter] = {}


def get_gateway_adapter(kind: str) -> GatewayAdapter | None:
    return _ADAPTERS.get(kind)


def mcp_tools_for_kind(kind: str) -> list[dict[str, Any]]:
    adapter = get_gateway_adapter(kind)
    if adapter is None:
        return []
    return adapter.list_tools()


def call_gateway_tool(
    kind: str,
    creds: dict[str, Any],
    name: str,
    args: dict[str, Any],
) -> str:
    adapter = get_gateway_adapter(kind)
    if adapter is None:
        raise ValueError(f"unknown tool: {name}")
    return adapter.call_tool(creds, name, args)


def probe_gateway_credentials(kind: str, creds: dict[str, Any]) -> None:
    adapter = get_gateway_adapter(kind)
    if adapter is None:
        raise ValueError(f"unknown gateway connector kind: {kind}")
    adapter.probe_credentials(creds)
'''
        with open(registry_path, "w", encoding="utf-8") as f:
            f.write(registry_code)
        print("Sanitized registry.py")


def sanitize_roles():
    migrate_path = os.path.join(ROOT, "src/octop/infra/db/migrate.py")
    if os.path.exists(migrate_path):
        with open(migrate_path, "r", encoding="utf-8") as f:
            c = f.read()
        c = c.replace('("管理员", ts, ts)', '("Admin", ts, ts)')
        c = c.replace('("用户", ts, ts)', '("User", ts, ts)')
        with open(migrate_path, "w", encoding="utf-8") as f:
            f.write(c)

    setup_path = os.path.join(ROOT, "src/octop/api/routers/setup.py")
    if os.path.exists(setup_path):
        with open(setup_path, "r", encoding="utf-8") as f:
            c = f.read()
        c = c.replace('"管理员"', '"Admin"')
        with open(setup_path, "w", encoding="utf-8") as f:
            f.write(c)
    print("Sanitized role names in DB seeds")


if __name__ == "__main__":
    sanitize_locale_prefs()
    sanitize_channels()
    sanitize_connectors()
    sanitize_roles()
    print("All sanitization completed successfully.")
