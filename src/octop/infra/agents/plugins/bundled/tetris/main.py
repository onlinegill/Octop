"""Start an in-chat Tetris board. Gameplay runs in the Dashboard UI."""

from __future__ import annotations

import json

from octop_harness.plugins import PluginContext


async def start_tetris() -> str:
    """Open a playable Tetris card. The user clicks the card, then uses keys or buttons."""
    return json.dumps(
        {
            "octop_ui": {"renderer": "tetris_game", "version": 1},
            "data": {"kind": "tetris"},
            "text": "Tetris started. After clicking the card use ← → to move, ↑ or space to rotate, ↓ to soften-drop, space to hard-drop.",
        },
        ensure_ascii=False,
    )


def setup(ctx: PluginContext) -> None:
    ctx.tool(
        "start_tetris",
        start_tetris,
        description=(
            "Open a playable Tetris in chat. Call when the user asks to play Tetris or a block game. "
            "Takes no arguments; the game runs inside the card, so no further tool calls are needed."
        ),
    )
