"""Short links via is.gd."""

from __future__ import annotations

import json
from typing import Any

import httpx
from octop_harness.plugins import PluginContext


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "short_link_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


async def make_short_link(url: str) -> str:
    """Create a short URL with is.gd."""
    raw = (url or "").strip()
    if not raw.startswith(("http://", "https://")):
        return _payload(
            {"error": "invalid url", "url": raw}, "Please provide a URL starting with http:// or https://."
        )
    try:
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            resp = client.get(
                "https://is.gd/create.php",
                params={"format": "json", "url": raw},
            )
            resp.raise_for_status()
            body = resp.json()
    except Exception as exc:
        return _payload({"error": str(exc), "url": raw}, f"short-link creation failed: {exc}")
    if body.get("errorcode"):
        msg = str(body.get("errormessage") or body.get("errorcode"))
        return _payload({"error": msg, "url": raw}, f"short-link creation failed: {msg}")
    short = str(body.get("shorturl") or "")
    data = {"url": raw, "shorturl": short}
    return _payload(data, f"short link: {short}")


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "make_short_link",
        make_short_link,
        description="Create a short link with is.gd. url is the original long link.",
    )
