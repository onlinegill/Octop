"""Random Chinese fun facts and jokes — local."""

from __future__ import annotations

import json
import random
from typing import Any

from octop_harness.plugins import PluginContext

_FACTS = (
    "Hummingbirds are the only birds that can fly backwards.",
    "Octopuses have three hearts, and their blood is blue.",
    "Bananas are botanically berries, but strawberries are not.",
    "A day has about 86,400 seconds; leap seconds occasionally add one more.",
    "A polar bear\u2019s skin is actually black, and its fur is transparent and hollow.",
    "Human DNA is about 60% similar to a banana\u2019s (in protein-coding regions).",
    "The Moon drifts about 3.8 cm away from Earth each year.",
    "A snail can sleep for three years without waking.",
    "Lightning can be hotter than the surface of the Sun.",
    "A courting penguin offers a small pebble as a \u2018gift\u2019.",
    "The red liquid hippos secrete is often mistaken for blood, but it is actually a sunscreen-like mucus.",
    "A cat\u2019s slit pupils let it see prey in low light.",
    "One of the world\u2019s longest place names is in New Zealand: Taumatawhakatangihangakoauauotamateapokaiwhenuakitanatahu.",
    "The speed of light in a vacuum is about 299,792,458 metres per second.",
    "Under the right conditions, bamboo can grow nearly a metre in a day.",
    "Dolphins sleep with one eye closed, resting half their brain at a time.",
    "Honey almost never spoils; archaeologists have found ancient honey that is still edible.",
)

_JOKES = (
    "A programmer orders a melon: \u2018Is it ripe?\u2019 The grocer replies: \u2018It compiles.\u2019",
    "I asked an AI whether it would replace me. It said: \u2018Let me finish fixing your bugs first.\u2019",
    "Manager: \u2018Just change one line.\u2019 Engineer: \u2018Which one? In which universe?\u2019",
    "Today\u2019s horoscope: good for commits, bad for force push.",
    "Backend: the API is ready. Frontend: the format is wrong. Backend: did you clear your cache? Frontend: I rebooted my laptop.",
    "Ops: the service is down. Dev: works on my machine. Ops: production is not your machine.",
    "Student: I memorised the formula. Teacher: can you derive it? Student: I can search it.",
    "A cat walks into a meeting: \u2018I object to this requirement.\u2019",
    "Diet plan: start tomorrow. Tomorrow: start the day after.",
    "Me: I\u2019ll sleep early. Also me: just one more episode.",
    "Boss: think big picture. Me: does the big picture get reimbursed?",
    "The docs say \u2018omitted here\u2019. Me: so is my whole life.",
)


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "fun_facts_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


async def random_fun_fact(kind: str = "fact") -> str:
    """Return a random fact or joke. kind: fact | joke."""
    key = (kind or "fact").strip().lower()
    if key.startswith("j"):
        pool, label = _JOKES, "joke"
    else:
        pool, label = _FACTS, "fact"
    body = random.choice(pool)
    data = {"kind": label, "content": body}
    return _payload(data, body)


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "random_fun_fact",
        random_fun_fact,
        description="Random trivia or a joke. kind is fact or joke.",
    )
