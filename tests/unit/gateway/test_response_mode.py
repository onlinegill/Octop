"""Tests for external IM response delivery modes."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from octop_gateway.models import (
    FileContent,
    InboundMessage,
    MessageEvent,
    MessageEventType,
    TextContent,
)

from octop.infra.gateway.process.response_mode import (
    collapse_to_invoke_response,
    normalize_channel_response_mode,
    processor_for_response_mode,
    qq_channel_response_mode,
)


async def _events(*events: MessageEvent) -> AsyncIterator[MessageEvent]:
    for event in events:
        yield event


@pytest.mark.asyncio
async def test_invoke_discards_progress_before_tool_and_emits_final_once() -> None:
    source = _events(
        MessageEvent.typing(),
        MessageEvent.delta("Let me check first."),
        MessageEvent.flush(),
        MessageEvent.tool_start("web_fetch"),
        MessageEvent.tool_end("web_fetch"),
        MessageEvent.delta("This is "),
        MessageEvent.delta("the final answer."),
        MessageEvent.completed(),
    )

    result = [event async for event in collapse_to_invoke_response(source)]

    assert [event.type for event in result] == [
        MessageEventType.MESSAGE,
        MessageEventType.COMPLETED,
    ]
    text = result[0].content[0]
    assert isinstance(text, TextContent)
    assert text.text == "This is the final answer."


@pytest.mark.asyncio
async def test_invoke_strips_orphan_thinking_prefix_from_final_text() -> None:
    source = _events(
        MessageEvent.delta("Let me inspect another source. "),
        MessageEvent.delta("This is internal reasoning."),
        MessageEvent.delta("</think>"),
        MessageEvent.delta("[Daily guide study] final content"),
        MessageEvent.completed(),
    )

    result = [event async for event in collapse_to_invoke_response(source)]

    assert [event.type for event in result] == [
        MessageEventType.MESSAGE,
        MessageEventType.COMPLETED,
    ]
    text = result[0].content[0]
    assert isinstance(text, TextContent)
    assert text.text == "[Daily guide study] final content"


@pytest.mark.asyncio
async def test_invoke_preserves_tool_media_with_final_text() -> None:
    attachment = FileContent(filename="report.pdf", data="cGRm")
    source = _events(
        MessageEvent.tool_start("write_file"),
        MessageEvent.tool_end("write_file"),
        MessageEvent(type=MessageEventType.MESSAGE, content=[attachment]),
        MessageEvent.delta("The report is ready."),
        MessageEvent.completed(),
    )

    result = [event async for event in collapse_to_invoke_response(source)]

    assert result[0].type == MessageEventType.MESSAGE
    assert len(result[0].content) == 2
    assert isinstance(result[0].content[0], TextContent)
    assert result[0].content[1] is attachment


@pytest.mark.asyncio
async def test_invoke_forwards_error_without_partial_text() -> None:
    error = MessageEvent.error_event("upstream failed")
    source = _events(
        MessageEvent.delta("partial"),
        error,
        MessageEvent.completed(),
    )

    result = [event async for event in collapse_to_invoke_response(source)]

    assert result == [error, MessageEvent.completed()]


@pytest.mark.asyncio
async def test_invoke_keeps_ask_agent_dispatch_narration() -> None:
    """Team hosts often narrate before ask_agent — keep that line on invoke IM."""
    source = _events(
        MessageEvent.delta("Let me ask the clinical assistant first."),
        MessageEvent.tool_start("Consult expert", tool_key="ask_agent"),
        MessageEvent.tool_end("Consult expert"),
        MessageEvent.completed(),
    )

    result = [event async for event in collapse_to_invoke_response(source)]

    assert [event.type for event in result] == [
        MessageEventType.MESSAGE,
        MessageEventType.COMPLETED,
    ]
    text = result[0].content[0]
    assert isinstance(text, TextContent)
    assert text.text == "Let me ask the clinical assistant first."


@pytest.mark.asyncio
async def test_invoke_still_discards_progress_before_other_tools() -> None:
    source = _events(
        MessageEvent.delta("Let me check first."),
        MessageEvent.tool_start("web_fetch", tool_key="web_fetch"),
        MessageEvent.tool_end("web_fetch"),
        MessageEvent.delta("the final answer."),
        MessageEvent.completed(),
    )

    result = [event async for event in collapse_to_invoke_response(source)]
    text = result[0].content[0]
    assert isinstance(text, TextContent)
    assert text.text == "the final answer."


def test_response_mode_defaults_to_invoke_and_accepts_stream() -> None:
    assert normalize_channel_response_mode(None) == "invoke"
    assert normalize_channel_response_mode("unknown") == "invoke"
    assert normalize_channel_response_mode(" STREAM ") == "stream"


def test_stream_mode_uses_original_processor() -> None:
    async def processor(_message: InboundMessage) -> AsyncIterator[MessageEvent]:
        yield MessageEvent.completed()

    assert processor_for_response_mode(processor, "stream") is processor
    assert processor_for_response_mode(processor, "invoke") is not processor


def test_qq_channel_streams_by_default() -> None:
    assert qq_channel_response_mode({}) == "stream"
    assert qq_channel_response_mode({"response_mode": "invoke"}) == "stream"
    assert qq_channel_response_mode({"streaming": False}) == "stream"
    assert qq_channel_response_mode({"c2c_streaming": True}) == "stream"
    assert qq_channel_response_mode({"c2c_streaming": False}) == "invoke"
    assert qq_channel_response_mode({"c2c_streaming": "false"}) == "invoke"
