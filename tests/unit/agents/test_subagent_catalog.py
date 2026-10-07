"""Tests for SubagentCatalog bundled library."""

from __future__ import annotations

import json
from pathlib import Path

from octop.infra.agents.subagents.catalog import (
    TRANSLATION_PLACEHOLDER_NAME,
    SubagentCatalog,
    default_package_root,
    slugify,
)


def _make_locale(
    root: Path,
    locale: str,
    divisions: dict[str, dict[str, str]],
    agents: dict[str, dict[str, str]],
) -> None:
    """Stamp out ``root/<locale>/divisions.json`` and per-division .md files."""
    locale_root = root / "library" / locale
    locale_root.mkdir(parents=True, exist_ok=True)
    (locale_root / "divisions.json").write_text(
        json.dumps({"divisions": divisions}, ensure_ascii=False),
        encoding="utf-8",
    )
    # group by division
    by_div: dict[str, list[tuple[str, dict[str, str]]]] = {}
    for slug, spec in agents.items():
        by_div.setdefault(spec["division"], []).append((slug, spec))
    for div_id, entries in by_div.items():
        div_dir = locale_root / div_id
        div_dir.mkdir(parents=True, exist_ok=True)
        for _slug, spec in entries:
            front_lines = ["---"]
            for key in ("name", "description", "color", "emoji"):
                if key in spec:
                    front_lines.append(f"{key}: {spec[key]}")
            front_lines.append("---")
            front = "\n".join(front_lines) + "\n"
            body = f"# {spec['name']}\n\n{spec.get('body', '')}"
            # File stem = "{div_id}-{slug}" — this is the canonical slug used
            # by the catalog (file-stem-based slug scheme).
            (div_dir / f"{div_id}-{_slug}.md").write_text(
                front + "\n" + body,
                encoding="utf-8",
            )


def _make_library(tmp_path: Path) -> Path:
    root = tmp_path / "subagents"
    root.mkdir()
    divisions = {
        "engineering": {"label": "Engineering", "icon": "Code", "color": "#3B82F6"},
        "testing": {"label": "Testing", "icon": "FlaskConical", "color": "#F59E0B"},
    }
    # English source of truth
    en_agents = {
        "software-architect": {
            "division": "engineering",
            "name": "Software Architect",
            "description": "Designs scalable systems",
            "emoji": "🏛️",
            "color": "indigo",
            "body": "Original English body.",
        },
        "api-tester": {
            "division": "testing",
            "name": "API Tester",
            "description": "Tests HTTP APIs",
            "body": "Original English API tester body.",
        },
    }
    _make_locale(root, "en", divisions, en_agents)
    # Translated zh version for software-architect; api-tester is a placeholder
    zh_divisions = {
        "engineering": {"label": "Engineering", "icon": "Code", "color": "#3B82F6"},
        "testing": {"label": "Testing", "icon": "FlaskConical", "color": "#F59E0B"},
    }
    zh_agents = {
        "software-architect": {
            "division": "engineering",
            "name": "Software Architect",
            "description": "Design scalable systems",
            "body": "Sample body",
        },
        "api-tester": {
            "division": "testing",
            "name": TRANSLATION_PLACEHOLDER_NAME,
            "description": "TODO",
        },
    }
    _make_locale(root, "zh", zh_divisions, zh_agents)
    return root


# Canonical slug is the file stem: "{division}-{agent-key}"
_SA_SLUG = "engineering-software-architect"
_AT_SLUG = "testing-api-tester"


def test_slugify() -> None:
    assert slugify("Software Architect") == "software-architect"


def test_catalog_loads_agent_files(tmp_path: Path) -> None:
    catalog = SubagentCatalog(_make_library(tmp_path))
    catalog.refresh()

    assert len(catalog.list_summaries()) == 2
    item = catalog.get(_SA_SLUG)
    assert item is not None
    assert item.summary.division == "engineering"
    # summary.name reflects the authoritative (default=en) locale name.
    assert item.summary.name == "Software Architect"
    assert "Software Architect" in item.content_for("en")


def test_catalog_filters_by_division_and_query(tmp_path: Path) -> None:
    catalog = SubagentCatalog(_make_library(tmp_path))
    catalog.refresh()

    eng_only = catalog.list_summaries(division="engineering")
    assert len(eng_only) == 1
    assert eng_only[0].slug == _SA_SLUG

    searched = catalog.list_summaries(query="api")
    assert len(searched) == 1
    assert searched[0].slug == _AT_SLUG


def test_catalog_localized_names(tmp_path: Path) -> None:
    catalog = SubagentCatalog(_make_library(tmp_path))
    catalog.refresh()

    sa = catalog.get(_SA_SLUG)
    assert sa is not None
    # English-only catalog: every locale request resolves to the English
    # frontmatter text (``zh`` is an alias for ``en``).
    assert sa.name_for("en") == "Software Architect"
    assert sa.name_for("zh") == "Software Architect"
    assert sa.description_for("en") == "Designs scalable systems"
    assert sa.description_for("zh") == "Designs scalable systems"
    assert "Original English body." in sa.content_for("en")
    assert "Original English body." in sa.content_for("zh")


def test_catalog_locale_alias_resolves_to_english(tmp_path: Path) -> None:
    catalog = SubagentCatalog(_make_library(tmp_path))
    catalog.refresh()

    api = catalog.get(_AT_SLUG)
    assert api is not None
    # Only the English library ships; there is no separate translation, so a
    # "zh" request is normalized to English rather than returning empty text.
    assert api.content_for("zh") == api.content_for("en")
    assert "Original English API tester body." in api.content_for("zh")
    assert api.summary.available_locales == ("en",)
    # A "zh" locale listing is the same as the English listing.
    assert any(r.slug == _AT_SLUG for r in catalog.list_summaries(locale="zh"))


def test_catalog_list_summaries_localized(tmp_path: Path) -> None:
    catalog = SubagentCatalog(_make_library(tmp_path))
    catalog.refresh()

    zh_rows = catalog.list_summaries(locale="zh")
    sa = next(r for r in zh_rows if r.slug == _SA_SLUG)
    assert sa.description == "Designs scalable systems"
    en_rows = catalog.list_summaries(locale="en")
    sa_en = next(r for r in en_rows if r.slug == _SA_SLUG)
    assert sa_en.description == "Designs scalable systems"


def test_catalog_list_divisions_localized(tmp_path: Path) -> None:
    catalog = SubagentCatalog(_make_library(tmp_path))
    catalog.refresh()

    zh_divs = catalog.list_divisions(locale="zh")
    eng = next(d for d in zh_divs if d["id"] == "engineering")
    assert eng["label"] == "Engineering"
    # Only the English locale ships; no zh label set is exposed.
    assert eng["labels"] == {"en": "Engineering"}
    en_divs = catalog.list_divisions(locale="en")
    eng_en = next(d for d in en_divs if d["id"] == "engineering")
    assert eng_en["label"] == "Engineering"


def test_bundled_library_non_empty() -> None:
    catalog = SubagentCatalog(default_package_root())
    catalog.refresh()
    assert len(catalog.list_summaries()) > 100
    assert len(catalog.list_divisions()) == 16
    assert catalog.get("engineering-software-architect") is not None


def test_bundled_library_en_path_exists() -> None:
    """The migration produced ``library/en/`` with the English agent files."""
    library_root = default_package_root() / "library"
    en_root = library_root / "en"
    assert en_root.is_dir(), "library/en/ should exist after migration"
    en_agents = sum(1 for _ in en_root.rglob("*.md"))
    assert en_agents > 100
