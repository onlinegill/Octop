"""tests/unit/i18n/test_channel.py"""

from __future__ import annotations

from octop.i18n import channel_tool_hint_end, channel_tool_hint_start


def test_channel_tool_hint_start_zh():
    text = channel_tool_hint_start("Read file", "zh")
    assert text.startswith("🔧")
    assert "Calling tool" in text
    assert "Read file" in text


def test_channel_tool_hint_end_en():
    assert channel_tool_hint_end("Read file", "en") == "✅ Read file done"
