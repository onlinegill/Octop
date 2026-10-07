"""Forex, crypto, and A-share quotes from public endpoints."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from octop_harness.plugins import PluginContext

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "market_quotes_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


def _client(**kwargs: Any) -> httpx.Client:
    headers = {"User-Agent": _UA, **(kwargs.pop("headers", {}) or {})}
    return httpx.Client(timeout=15.0, headers=headers, follow_redirects=True, **kwargs)


async def get_forex(base: str = "USD", quote: str = "CNY") -> str:
    """ECB rates via frankfurter.app."""
    b = (base or "USD").strip().upper() or "USD"
    q = (quote or "CNY").strip().upper() or "CNY"
    try:
        with _client() as client:
            resp = client.get(
                "https://api.frankfurter.app/latest",
                params={"from": b, "to": q},
            )
            resp.raise_for_status()
            payload = resp.json()
        rate = (payload.get("rates") or {}).get(q)
        if rate is None:
            raise RuntimeError("no rate")
        rows = [{"symbol": f"{b}/{q}", "price": rate, "change": None, "pct": None}]
        return _payload(
            {"kind": "forex", "rows": rows, "as_of": payload.get("date")},
            f"{b}/{q} = {rate} ({payload.get('date')})",
        )
    except Exception as exc:
        return _payload({"kind": "forex", "rows": [], "error": str(exc)}, f"exchange-rate lookup failed: {exc}")


async def get_crypto(ids: str = "bitcoin,ethereum") -> str:
    """CoinGecko simple price in USD and CNY."""
    raw_ids = (ids or "bitcoin,ethereum").strip() or "bitcoin,ethereum"
    try:
        with _client() as client:
            resp = client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={
                    "ids": raw_ids,
                    "vs_currencies": "usd,cny",
                    "include_24hr_change": "true",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
        if not isinstance(payload, dict):
            raise RuntimeError("unexpected payload")
        rows: list[dict[str, Any]] = []
        lines: list[str] = []
        for cid, info in payload.items():
            if not isinstance(info, dict):
                continue
            usd = info.get("usd")
            cny = info.get("cny")
            pct = info.get("usd_24h_change")
            rows.append(
                {
                    "symbol": cid,
                    "price": usd,
                    "price_cny": cny,
                    "pct": pct,
                    "change": None,
                },
            )
            extra = f" {pct:+.2f}%" if isinstance(pct, int | float) else ""
            lines.append(f"{cid} ${usd}{extra}")
        return _payload({"kind": "crypto", "rows": rows}, "Crypto: " + "; ".join(lines))
    except Exception as exc:
        return _payload(
            {"kind": "crypto", "rows": [], "error": str(exc)}, f"crypto lookup failed: {exc}"
        )


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "get_forex",
        get_forex,
        description="Look up an exchange rate. base/quote are currency codes, defaulting to USD against CNY.",
    )
    ctx.tool(
        "get_crypto",
        get_crypto,
        description="Look up crypto prices in USD/CNY. ids are CoinGecko ids, comma-separated, defaulting to bitcoin,ethereum.",
    )
