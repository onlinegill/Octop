"""Meme images via memegen.link."""

from __future__ import annotations

import json
from typing import Any

import httpx
from octop_harness.plugins import PluginContext

_TEMPLATES: tuple[tuple[str, str, str], ...] = (
    ("doge", "Doge", "classic Shiba Inu"),
    ("buzz", "Buzz Lightyear", "Buzz Lightyear"),
    ("drake", "Drake Hotline Bling", "Drake two-choice meme"),
    ("success", "Success Kid", "Success Kid"),
    ("distracted", "Distracted Boyfriend", "Distracted Boyfriend"),
)


def _payload(data: dict[str, Any], text: str, renderer: str = "meme_maker_card") -> str:
    return json.dumps(
        {"octop_ui": {"renderer": renderer, "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


def _encode_segment(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return "_"
    out: list[str] = []
    for ch in raw:
        if ch == "-":
            out.append("--")
        elif ch == "_":
            out.append("__")
        elif ch == " ":
            out.append("_")
        elif ch == "?":
            out.append("~q")
        elif ch == "&":
            out.append("~a")
        elif ch == "#":
            out.append("~h")
        elif ch == "%":
            out.append("~p")
        else:
            out.append(ch)
    return "".join(out)


async def make_meme(template: str = "doge", top: str = "", bottom: str = "") -> str:
    """Build a meme image URL from template id and top/bottom text."""
    tpl = (template or "doge").strip().lower()
    top_seg = _encode_segment(top)
    bottom_seg = _encode_segment(bottom)
    image_url = f"https://api.memegen.link/images/{tpl}/{top_seg}/{bottom_seg}.png"
    try:
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            resp = client.head(image_url)
            if resp.status_code >= 400:
                resp = client.get(image_url)
            if resp.status_code >= 400:
                return _payload(
                    {"error": f"HTTP {resp.status_code}", "template": tpl},
                    f"template {tpl!r} may not exist.",
                )
    except Exception as exc:
        return _payload({"error": str(exc), "template": tpl}, f"meme generation failed: {exc}")
    data = {"template": tpl, "top": top, "bottom": bottom, "image_url": image_url}
    return _payload(data, f"meme {tpl}: {image_url}")


async def list_meme_templates() -> str:
    """List built-in meme template ids."""
    items = [{"id": t[0], "name": t[1], "hint": t[2]} for t in _TEMPLATES]
    data = {"items": items}
    lines = [f"{r['id']} — {r['name']}" for r in items]
    return _payload(data, "Available templates:\n" + "\n".join(lines), renderer="meme_templates_list")


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "make_meme",
        make_meme,
        description="Generate a meme. template such as doge/drake; top/bottom are the captions.",
    )
    ctx.tool(
        "list_meme_templates",
        list_meme_templates,
        description="List the built-in memegen template ids.",
    )
