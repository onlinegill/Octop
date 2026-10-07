"""tests/unit/gateway/test_stream_project_tools.py"""

from __future__ import annotations

from octop.infra.gateway.process.stream_project import enrich_tool_stream_chunk


def test_enrich_tool_stream_chunk_adds_display_name():
    chunk = {"type": "tool_call_chunk", "name": "read_file", "args": "{"}
    out = enrich_tool_stream_chunk(chunk, "zh")
    assert out["display_name"] == "Read file"
    assert out["name"] == "read_file"


def test_enrich_tool_stream_chunk_ignores_non_tool():
    chunk = {"type": "token", "content": "hi"}
    assert enrich_tool_stream_chunk(chunk, "zh") is chunk


def test_tool_start_event_carries_localized_hint():
    from octop_gateway.models import MessageEvent

    from octop.i18n import channel_tool_hint_start

    label = "Read file"
    event = MessageEvent.tool_start(
        label,
        tool_hint_text=channel_tool_hint_start(label, "zh"),
    )
    assert event.metadata["tool_hint_text"] == channel_tool_hint_start(label, "zh")
    assert "Calling tool" in event.metadata["tool_hint_text"]
