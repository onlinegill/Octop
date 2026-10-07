"""Daily English vocabulary — local, date-seeded."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any

from octop_harness.plugins import PluginContext

_VOCAB: tuple[tuple[str, str, str, str], ...] = (
    (
        "serendipity",
        "/ˌserənˈdɪpəti/",
        "the ability to find serendipitous discoveries",
        "Finding that café was pure serendipity.",
    ),
    (
        "resilience",
        "/rɪˈzɪliəns/",
        "resilience; the ability to recover",
        "Her resilience after setbacks inspired the team.",
    ),
    ("ambiguous", "/æmˈbɪɡjuəs/", "unclear; open to more than one interpretation", "The email was ambiguous about the deadline."),
    (
        "meticulous",
        "/məˈtɪkjələs/",
        "meticulous",
        "He kept meticulous notes during the experiment.",
    ),
    ("pragmatic", "/præɡˈmætɪk/", "practical", "We need a pragmatic plan, not ideals only."),
    ("eloquent", "/ˈeləkwənt/", "fluent and persuasive in speech", "She gave an eloquent speech at the ceremony."),
    ("obsolete", "/ˌɒbsəˈliːt/", "outdated", "Floppy disks are largely obsolete now."),
    ("hypothesis", "/haɪˈpɒθəsɪs/", "hypothesis; a proposed explanation", "We tested the hypothesis with fresh data."),
    ("diligent", "/ˈdɪlɪdʒənt/", "hard-working and careful", "Diligent practice beats talent alone."),
    ("inevitable", "/ɪnˈevɪtəbl/", "unavoidable", "Change is inevitable in any startup."),
    ("authentic", "/ɔːˈθentɪk/", "genuine; true to the original", "Authentic feedback helps you grow."),
    ("curiosity", "/ˌkjʊəriˈɒsəti/", "curiosity; a desire to learn", "Curiosity drives good research questions."),
    ("gratitude", "/ˈɡrætɪtjuːd/", "gratitude; thankfulness", "Express gratitude before you ask for more."),
    ("navigate", "/ˈnævɪɡeɪt/", "to navigate; to cope with", "Learn to navigate uncertainty calmly."),
    ("compromise", "/ˈkɒmprəmaɪz/", "a middle ground; a settlement", "Sometimes compromise keeps teams moving."),
    ("perspective", "/pəˈspektɪv/", "a point of view", "Try her perspective before you decide."),
    ("sustainable", "/səˈsteɪnəbl/", "able to be kept up long term", "Sustainable habits beat short bursts."),
    ("intricate", "/ˈɪntrɪkət/", "complex and detailed", "The watch has an intricate mechanism."),
    ("versatile", "/ˈvɜːsətaɪl/", "useful for many purposes", "Python is versatile for automation."),
    ("empathy", "/ˈempəθi/", "the ability to share others\u2019 feelings", "Empathy improves difficult conversations."),
    ("concise", "/kənˈsaɪs/", "brief and clear", "Keep the summary concise and clear."),
    ("deliberate", "/dɪˈlɪbərət/", "careful; intentional", "Make deliberate choices about scope."),
    ("fragment", "/ˈfræɡmənt/", "a small piece; a snippet", "Break the problem into small fragments."),
    ("innovative", "/ˈɪnəveɪtɪv/", "introducing new ideas", "The team proposed an innovative fix."),
    ("tenacious", "/təˈneɪʃəs/", "persistent and determined", "Tenacious effort wins long projects."),
    ("priority", "/praɪˈɒrəti/", "the thing ranked first", "Set one priority for this week."),
    ("relevant", "/ˈreləvənt/", "closely connected; applicable", "Only cite relevant sources."),
    ("threshold", "/ˈθreʃhəʊld/", "a limit or boundary", "Cross the error threshold and alert."),
    ("volatile", "/ˈvɒlətaɪl/", "quick to change; unstable", "Markets can be volatile near news."),
    ("wholesome", "/ˈhəʊlsəm/", "good for your health and well-being", "A wholesome routine includes sleep."),
)


def _payload(data: dict[str, Any], text: str) -> str:
    return json.dumps(
        {"octop_ui": {"renderer": "daily_english_card", "version": 1}, "data": data, "text": text},
        ensure_ascii=False,
    )


def _pick_index(seed: str) -> int:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % len(_VOCAB)


def _find_word(word: str) -> tuple[str, str, str, str] | None:
    key = word.strip().lower()
    for entry in _VOCAB:
        if entry[0].lower() == key:
            return entry
    return None


async def daily_english(word: str = "") -> str:
    """Return daily word or lookup a word from the built-in list."""
    custom = (word or "").strip()
    if custom:
        entry = _find_word(custom)
        if entry is None:
            return _payload({"error": "not found", "word": custom}, f"word not found in the dictionary: {custom}")
        w, phonetic, zh, example = entry
        data = {
            "word": w,
            "phonetic": phonetic,
            "meaning_zh": zh,
            "example": example,
            "daily": False,
        }
        return _payload(data, f"{w} {phonetic} — {zh}\nExample: {example}")
    idx = _pick_index(date.today().isoformat())
    w, phonetic, zh, example = _VOCAB[idx]
    data = {
        "word": w,
        "phonetic": phonetic,
        "meaning_zh": zh,
        "example": example,
        "daily": True,
        "date": date.today().isoformat(),
    }
    return _payload(data, f"Word of the day {w} {phonetic} — {zh}")


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "daily_english",
        daily_english,
        description="One English word a day; when word is empty a word is chosen by date, or pass a word to look it up in the built-in dictionary.",
    )
