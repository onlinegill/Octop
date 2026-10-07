"""Travel destination inspiration — local."""

from __future__ import annotations

import hashlib
import json
import random
from datetime import date
from typing import Any

from octop_harness.plugins import PluginContext

_DESTINATIONS: tuple[dict[str, Any], ...] = (
    {
        "city": "Kyoto",
        "country": "Japan",
        "blurb": "Gardens, shrines and Japanese cuisine, best explored slowly.",
        "best_season": "Mar–May, Oct–Nov",
        "tags": ["city", "food", "nature"],
    },
    {
        "city": "Queenstown",
        "country": "New Zealand",
        "blurb": "Lakes and snow-capped mountains; a paradise for outdoor sports.",
        "best_season": "Dec–Feb (southern-hemisphere summer)",
        "tags": ["nature", "sea"],
    },
    {
        "city": "Lisbon",
        "country": "Portugal",
        "blurb": "Trams, sea breezes and custard tarts, with gentle prices.",
        "best_season": "Apr–Jun, Sep–Oct",
        "tags": ["city", "sea", "food"],
    },
    {
        "city": "Chiang Mai",
        "country": "Thailand",
        "blurb": "Night markets, temples and coffee; an easy holiday.",
        "best_season": "Nov–Feb",
        "tags": ["food", "city", "nature"],
    },
    {
        "city": "Reykjavik",
        "country": "Iceland",
        "blurb": "Auroras, hot springs and black-sand beaches.",
        "best_season": "Sep–Mar for auroras; Jun–Aug for a ring-road trip",
        "tags": ["nature", "sea"],
    },
    {
        "city": "Barcelona",
        "country": "Spain",
        "blurb": "Gaudí architecture and tapas bars.",
        "best_season": "May–Jun, Sep",
        "tags": ["city", "food", "sea"],
    },
    {
        "city": "Guilin",
        "country": "China",
        "blurb": "Karst scenery along the Li River, great for rafting and cycling.",
        "best_season": "Apr–Oct",
        "tags": ["nature"],
    },
    {
        "city": "Maldives",
        "country": "Maldives",
        "blurb": "Overwater villas and diving; pure island relaxation.",
        "best_season": "Nov–Apr",
        "tags": ["sea"],
    },
    {
        "city": "Chengdu",
        "country": "China",
        "blurb": "Hotpot, teahouses and the giant panda base.",
        "best_season": "Mar–May, Sep–Nov",
        "tags": ["food", "city"],
    },
    {
        "city": "Vancouver",
        "country": "Canada",
        "blurb": "Mountains, sea and city parks side by side.",
        "best_season": "Jun–Sep",
        "tags": ["nature", "city", "sea"],
    },
    {
        "city": "Istanbul",
        "country": "Turkey",
        "blurb": "Where Europe meets Asia; bazaars and mosques.",
        "best_season": "Apr–May, Sep–Oct",
        "tags": ["city", "food"],
    },
    {
        "city": "Great Barrier Reef",
        "country": "Australia",
        "blurb": "Diving and island hopping.",
        "best_season": "Jun–Oct",
        "tags": ["sea", "nature"],
    },
)


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "travel_inspire_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


def _filter_mood(mood: str) -> list[dict[str, Any]]:
    key = (mood or "").strip().lower()
    if not key:
        return list(_DESTINATIONS)
    return [d for d in _DESTINATIONS if key in d.get("tags", [])] or list(_DESTINATIONS)


async def travel_inspire(mood: str = "") -> str:
    """Pick a destination; optional mood tag: sea, city, nature, food."""
    pool = _filter_mood(mood)
    seed = f"{date.today().isoformat()}|{mood.strip().lower()}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    rng = random.Random(int(digest[:16], 16))
    pick = rng.choice(pool)
    data = {**pick, "mood": (mood or "").strip()}
    text = f"Recommendation: {pick['city']} ({pick['country']}) — {pick['blurb']} Best: {pick['best_season']}"
    return _payload(data, text)


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "travel_inspire",
        travel_inspire,
        description="Travel destination inspiration. mood filters tags: sea/city/nature/food.",
    )
