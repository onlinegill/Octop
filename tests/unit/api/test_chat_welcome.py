"""Unit tests for agent chat welcome (workspace / catalog / default)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
from deepagents.backends.local_shell import LocalShellBackend
from octop_harness.backends.workspace import BackendWorkspace

from octop.infra.agents.experts.catalog import (
    ExpertCatalog,
    default_task_examples,
    default_welcome_payload,
    normalize_task_examples_for_display,
    parse_task_examples,
    read_workspace_manifest_task_examples,
    read_workspace_manifest_welcome,
    seed_expert_directory,
    snap_task_examples,
    welcome_payload_has_content,
)


def _workspace(root: str) -> BackendWorkspace:
    backend = LocalShellBackend(root_dir=root, virtual_mode=False)
    return BackendWorkspace(backend, root)


@pytest.mark.asyncio
async def test_read_workspace_manifest_welcome() -> None:
    with tempfile.TemporaryDirectory() as ws_dir:
        workspace = _workspace(ws_dir)
        await workspace.awrite_text(
            ".octop/manifest.json",
            json.dumps(
                {
                    "id": "demo",
                    "welcome_message": {"zh": "Hello", "en": "Hi"},
                    "quick_prompts": [
                        {
                            "title": {"zh": "Title", "en": "Title"},
                            "description": {"zh": "Desc", "en": "Desc"},
                            "prompt": {"zh": "Prompt", "en": "Prompt"},
                            "color": "#eee",
                            "icon_name": "zap",
                        }
                    ],
                }
            ),
            force=True,
        )
        payload = await read_workspace_manifest_welcome(workspace)
        assert payload is not None
        assert payload["welcome_message"]["en"] == "Hi"
        assert len(payload["quick_prompts"]) == 1
        assert payload["quick_prompts"][0]["title"]["en"] == "Title"


@pytest.mark.asyncio
async def test_read_workspace_manifest_welcome_falls_back_to_root() -> None:
    with tempfile.TemporaryDirectory() as ws_dir:
        workspace = _workspace(ws_dir)
        await workspace.awrite_text(
            "manifest.json",
            json.dumps({"welcome_message": {"zh": "Legacy path", "en": "Legacy"}}),
            force=True,
        )
        payload = await read_workspace_manifest_welcome(workspace)
        assert payload is not None
        assert payload["welcome_message"]["en"] == "Legacy"


@pytest.mark.asyncio
async def test_seed_expert_directory_includes_manifest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        expert_dir = Path(tmp) / "demo"
        expert_dir.mkdir()
        (expert_dir / "SOUL.md").write_text("# Soul", encoding="utf-8")
        (expert_dir / "manifest.json").write_text(
            json.dumps({"id": "demo", "welcome_message": {"zh": "x", "en": "y"}}),
            encoding="utf-8",
        )
        ws_dir = Path(tmp) / "ws"
        ws_dir.mkdir()
        workspace = _workspace(str(ws_dir))
        count = await seed_expert_directory(
            expert_dir=expert_dir,
            workspace=workspace,
            seed_paths=["SOUL.md"],
        )
        assert count == 2
        text = await workspace.aread_text(".octop/manifest.json")
        assert text is not None
        assert json.loads(text)["id"] == "demo"
        soul = await workspace.aread_text("SOUL.md")
        assert soul == "# Soul"


def test_welcome_payload_has_content() -> None:
    assert (
        welcome_payload_has_content({"welcome_message": {"en": ""}, "quick_prompts": []}) is False
    )
    assert (
        welcome_payload_has_content({"welcome_message": {"en": "hi"}, "quick_prompts": []})
        is True
    )


def test_default_welcome_uses_general_assistant_when_catalog_present() -> None:
    catalog = ExpertCatalog.__new__(ExpertCatalog)
    # Use real library if available
    from octop.infra.agents.experts.catalog import default_library_root

    catalog = ExpertCatalog(default_library_root())
    catalog.refresh()
    payload = default_welcome_payload(catalog)
    assert welcome_payload_has_content(payload)
    assert len(payload["quick_prompts"]) > 0


def test_default_welcome_builtin_without_catalog() -> None:
    payload = default_welcome_payload(None)
    assert welcome_payload_has_content(payload)
    assert len(payload["quick_prompts"]) >= 1


def test_parse_task_examples_missing_field_is_none() -> None:
    assert parse_task_examples({"id": "demo"}) is None
    assert parse_task_examples({"task_examples": "nope"}) is None


def test_parse_task_examples_plain_string_list() -> None:
    assert parse_task_examples({"task_examples": ["  Morning report  ", "", "Retrospective"]}) == {
        "en": ["Morning report", "Retrospective"],
    }


def test_parse_task_examples_locale_keyed_lists() -> None:
    assert parse_task_examples({"task_examples": {"zh": ["Chinese text", " "], "en": ["English"]}}) == {
        "en": ["English"],
    }


def test_default_task_examples_are_six_and_named() -> None:
    examples = default_task_examples("Patrol Expert")
    assert len(examples["en"]) == 6
    assert "Patrol Expert" in examples["en"][0]


def test_resolve_display_task_examples_prefers_workspace() -> None:
    from octop.infra.agents.experts.catalog import resolve_display_task_examples

    out = resolve_display_task_examples(
        parsed={"en": ["Workspace"]},
        label="Ignored",
    )
    assert out == {"en": ["Workspace"]}


def test_resolve_display_task_examples_empty_lists_stay_empty() -> None:
    from octop.infra.agents.experts.catalog import resolve_display_task_examples

    assert resolve_display_task_examples(parsed={"en": []}) == {
        "en": [],
    }


def test_resolve_display_task_examples_falls_back_to_name() -> None:
    from octop.infra.agents.experts.catalog import resolve_display_task_examples

    out = resolve_display_task_examples(
        parsed=None,
        label="Patrol Expert",
    )
    assert len(out["en"]) == 6
    assert "Patrol Expert" in out["en"][0]


def test_display_task_examples_for_agent_reads_row_labels() -> None:
    from types import SimpleNamespace

    from octop.infra.agents.experts.catalog import display_task_examples_for_agent

    named = display_task_examples_for_agent(
        parsed=None,
        row=SimpleNamespace(name="Patrol Expert", template_name=None),
    )
    assert "Patrol Expert" in named["en"][0]

    preferred = display_task_examples_for_agent(
        parsed={"en": ["Workspace"]},
        row=SimpleNamespace(name="Ignored", template_name=None),
    )
    assert preferred == {"en": ["Workspace"]}


def test_normalize_task_examples_for_display_keeps_three_or_six() -> None:
    assert normalize_task_examples_for_display(None) is None
    assert normalize_task_examples_for_display({"en": ["A"]}) == {
        "en": ["A"],
    }
    assert normalize_task_examples_for_display(
        {"en": ["a", "b", "c", "d", "e"]}
    ) == {"en": ["a", "b", "c"]}
    assert (
        len(
            normalize_task_examples_for_display(
                {"en": [str(i) for i in range(8)]}
            )["en"]
        )
        == 6
    )


def test_snap_task_examples_keeps_three_or_six() -> None:
    fillers_en = [f"filler {idx}" for idx in range(1, 7)]
    three = snap_task_examples(
        ["Daily patrol"],
        fillers_en=fillers_en,
    )
    assert three == {
        "en": ["Daily patrol", "filler 1", "filler 2"],
    }
    six = snap_task_examples(
        ["a", "b", "c", "d"],
        fillers_en=fillers_en,
    )
    assert len(six["en"]) == 6
    assert six["en"][:4] == ["a", "b", "c", "d"]


def test_parse_task_examples_empty_lists_stay_present() -> None:
    assert parse_task_examples({"task_examples": []}) == {"en": []}
    assert parse_task_examples({"task_examples": {"zh": [], "en": []}}) == {
        "en": [],
    }


@pytest.mark.asyncio
async def test_read_workspace_manifest_task_examples() -> None:
    with tempfile.TemporaryDirectory() as ws_dir:
        workspace = _workspace(ws_dir)
        await workspace.awrite_text(
            ".octop/manifest.json",
            json.dumps({"id": "demo", "task_examples": {"zh": ["Patrol"], "en": ["Patrol"]}}),
            force=True,
        )
        assert await read_workspace_manifest_task_examples(workspace) == {
            "en": ["Patrol"],
        }


@pytest.mark.asyncio
async def test_read_workspace_manifest_task_examples_missing() -> None:
    with tempfile.TemporaryDirectory() as ws_dir:
        workspace = _workspace(ws_dir)
        await workspace.awrite_text(
            ".octop/manifest.json",
            json.dumps({"id": "demo"}),
            force=True,
        )
        assert await read_workspace_manifest_task_examples(workspace) is None
