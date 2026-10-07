"""Static connector catalog — bundled presets for HTTP MCP services."""

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
        mcp_user_agent="octop-connector/0.1",
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
