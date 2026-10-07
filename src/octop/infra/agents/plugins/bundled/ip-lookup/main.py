"""IP geolocation via ip-api.com."""

from __future__ import annotations

import json
from typing import Any

import httpx
from octop_harness.plugins import PluginContext


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "ip_lookup_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


async def lookup_ip(ip: str = "") -> str:
    """Look up IP info; empty ip uses caller's public address."""
    target = (ip or "").strip()
    url = "http://ip-api.com/json/" if not target else f"http://ip-api.com/json/{target}"
    try:
        with httpx.Client(timeout=12.0, follow_redirects=True) as client:
            resp = client.get(
                url,
                params={"fields": "status,message,country,regionName,city,isp,query"},
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:
        return _payload({"error": str(exc)}, f"IP lookup failed: {exc}")
    if body.get("status") != "success":
        msg = str(body.get("message") or "lookup failed")
        return _payload({"error": msg}, f"IP lookup failed: {msg}")
    data = {
        "country": str(body.get("country") or ""),
        "regionName": str(body.get("regionName") or ""),
        "city": str(body.get("city") or ""),
        "isp": str(body.get("isp") or ""),
        "query": str(body.get("query") or target),
    }
    text = (
        f"{data['query']} · {data['country']} {data['regionName']} {data['city']} · {data['isp']}"
    )
    return _payload(data, text)


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "lookup_ip",
        lookup_ip,
        description="Look up an IP\u2019s location. When ip is empty, look up this host\u2019s public IP.",
    )
