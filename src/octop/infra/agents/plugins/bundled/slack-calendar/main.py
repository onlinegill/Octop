"""Slack-off calendar: weekend / holiday countdown (China mainland holidays)."""

from __future__ import annotations

import json
import random
from datetime import date
from typing import Any

from octop_harness.plugins import PluginContext

# (start, end inclusive, name)
_HOLIDAYS: list[tuple[date, date, str]] = [
    (date(2025, 10, 1), date(2025, 10, 8), "National Day & Mid-Autumn"),
    (date(2026, 1, 1), date(2026, 1, 3), "New Year"),
    (date(2026, 2, 15), date(2026, 2, 23), "Spring Festival"),
    (date(2026, 4, 4), date(2026, 4, 6), "Qingming"),
    (date(2026, 5, 1), date(2026, 5, 5), "Labour Day"),
    (date(2026, 6, 19), date(2026, 6, 21), "Dragon Boat Festival"),
    (date(2026, 9, 25), date(2026, 9, 27), "Mid-Autumn"),
    (date(2026, 10, 1), date(2026, 10, 7), "National Day"),
]

_DO = ("Drink more water", "Stand up and stretch", "Write down three todos", "Pause with a song", "Reply to important messages")
_DONT = ("Skip water in back-to-back meetings", "Pretend to be busy while scrolling", "Blame Friday-you for everything", "Live on coffee on an empty stomach")


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {
            "octop_ui": {"renderer": "slack_calendar_card", "version": 1},
            "data": data,
            "text": text,
        },
        ensure_ascii=False,
    )


def _days_until_weekend(today: date) -> int:
    return (5 - today.weekday()) % 7


def _next_holiday(today: date) -> tuple[str, int] | None:
    best: tuple[str, int] | None = None
    for start, end, name in _HOLIDAYS:
        if end < today:
            continue
        if start <= today <= end:
            return (f"on holiday: {name}", 0)
        delta = (start - today).days
        if best is None or delta < best[1]:
            best = (name, delta)
    return best


async def slack_calendar() -> str:
    """Today's fish-touching calendar card."""
    today = date.today()
    to_weekend = _days_until_weekend(today)
    holiday = _next_holiday(today)
    weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][today.weekday()]
    do = random.choice(_DO)
    dont = random.choice(_DONT)
    data = {
        "date": today.isoformat(),
        "weekday": weekday,
        "days_to_weekend": to_weekend,
        "holiday_name": holiday[0] if holiday else None,
        "days_to_holiday": holiday[1] if holiday else None,
        "do": do,
        "dont": dont,
    }
    parts = [f"Today is {weekday}"]
    if to_weekend == 0:
        parts.append("It is the weekend — guilt-free slacking")
    else:
        parts.append(f"{to_weekend} days until the weekend")
    if holiday:
        if holiday[1] == 0:
            parts.append(holiday[0])
        else:
            parts.append(f"{holiday[1]} days until {holiday[0]}")
    parts.append(f"Do: {do}; Don't: {dont}")
    return _payload(data, " · ".join(parts))


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "slack_calendar",
        slack_calendar,
        description="Slacking-off calendar: countdown to the weekend/holidays with today's do's and don'ts. No arguments.",
    )
