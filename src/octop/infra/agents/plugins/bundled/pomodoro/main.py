"""Pomodoro and countdown cards — timing runs in the Dashboard UI."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from octop_harness.plugins import PluginContext


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "timer_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


async def start_pomodoro(minutes: int = 25, label: str = "Focus") -> str:
    """Start a focus timer. The chat card counts down locally."""
    mins = max(1, min(int(minutes or 25), 180))
    title = (label or "Focus").strip() or "Focus"
    started = datetime.now(tz=UTC).isoformat()
    data = {
        "kind": "pomodoro",
        "label": title,
        "duration_sec": mins * 60,
        "started_at": started,
        "paused": False,
    }
    return _payload(data, f"started a {mins}-minute pomodoro: {title}")


async def start_countdown(title: str, target_iso: str) -> str:
    """Count down to an ISO-8601 datetime."""
    name = (title or "").strip() or "Countdown"
    raw = (target_iso or "").strip()
    if not raw:
        return _payload({"kind": "countdown", "error": "target required"}, "Please provide target_iso.")
    try:
        datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return _payload(
            {"kind": "countdown", "error": "invalid datetime"},
            "target_iso must be an ISO datetime, e.g. 2026-12-31T18:00:00+08:00.",
        )
    data = {"kind": "countdown", "title": name, "target_iso": raw}
    return _payload(data, f"countdown {name!r} target {raw}")


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "start_pomodoro",
        start_pomodoro,
        description="Start a pomodoro timer. minutes defaults to 25 (1–180); label is the display name.",
    )
    ctx.tool(
        "start_countdown",
        start_countdown,
        description="Count down to a date/time. title is the heading; target_iso is the ISO datetime.",
    )
