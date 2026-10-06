"""Gateway adapter registry — kind -> list_tools / call_tool / probe."""

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
