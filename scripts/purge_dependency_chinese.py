#!/usr/bin/env python3
"""Remove Chinese content from the installed ``octop_*`` runtime packages.

Why this exists
---------------
This fork is English-only. The repository source is 100% free of Chinese text,
but the bundled third-party runtime wheels pulled from PyPI
(``octop-harness``, ``octop-gateway``, ``octop-memory``, ``octop-browser``)
still ship bilingual, **Chinese-first** content:

* ``octop_harness/builtin/skills/zh/**``        - Chinese translations of builtin skills
* ``octop_harness/builtin/md_files/zh/**``      - Chinese workspace templates
* ``octop_harness/slash/core.py``               - ``{"en": ..., "zh": ...}`` message tables
* various ``language = "zh"`` / ``normalize_locale -> "zh"`` defaults

Those wheels are installed artifacts, not repository files, so this script
patches the *installed* copies. It is idempotent and safe to re-run, and it is
**not** wired into the test suite - it is an explicit post-install step::

    uv run python scripts/purge_dependency_chinese.py          # apply
    uv run python scripts/purge_dependency_chinese.py --check  # report only

What it changes
---------------
1. Deletes Chinese-only *data* trees (``builtin/skills/zh``, ``builtin/md_files/zh``).
   These are pure data - deleting them cannot break code paths.
2. Rewrites single-line bilingual message tables ``{"en": "A", "zh": "B"}`` to
   ``{"en": "A", "zh": "A"}``, so the ``zh`` slot stays populated (callers that
   index it keep working) but holds English.
3. Flips the known ``language``/``locale`` defaults from ``"zh"`` to ``"en"``.

It deliberately does NOT rewrite multi-line prompt prose or Chinese matching
keywords inside ``octop_memory``: those are Python code, and blind rewriting
risks breaking the packages. Whatever remains is reported at the end.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys

CJK_RE = re.compile(
    "[\u2e80-\u2eff\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff60]"
)

# Chinese-only data trees inside the installed wheels, relative to site-packages.
ZH_DATA_TREES = (
    "octop_harness/builtin/skills/zh",
    "octop_harness/builtin/md_files/zh",
    "octop_harness/builtin/agents/zh",
)

# ``"en": "...", "zh": "..."`` -> make the zh slot hold the English text.
# Handles both single-line and multi-line dict entries (the latter is common in
# ``octop_harness.slash.core._MESSAGES``); layout is preserved because only the
# zh literal is swapped, not the surrounding structure.
BILINGUAL_ENTRY = re.compile(
    r'("en":\s*(?P<en>"(?:[^"\\]|\\.)*")\s*,\s*"zh":\s*)"(?:[^"\\]|\\.)*"',
    re.DOTALL,
)

# Explicit Chinese-first defaults introduced by the upstream packages.
DEFAULT_FLIPS = (
    (re.compile(r'(language\s*:\s*(?:Literal\["en",\s*"zh"\]|Language|str)\s*=\s*)"zh"'), r'\1"en"'),
    (re.compile(r'(base\s*==\s*)"zh"'), r'\1"en"'),
    (re.compile(r'(\bif\s+not\s+locale:\s*\n\s*return\s*)"zh"'), r'\1"en"'),
)

SKIP_DIRS = {"__pycache__", ".dist-info"}


def site_packages_roots() -> list[str]:
    """Best-effort list of site-packages roots for the active interpreter."""
    roots: list[str] = []
    for entry in sys.path:
        if entry and os.path.isdir(entry) and os.path.basename(entry) == "site-packages":
            if entry not in roots:
                roots.append(entry)
    # Fall back to a repo-local venv when run outside it.
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for extra in (os.path.join(here, ".venv"),):
        lib = os.path.join(extra, "lib")
        if os.path.isdir(lib):
            for name in os.listdir(lib):
                cand = os.path.join(lib, name, "site-packages")
                if os.path.isdir(cand) and cand not in roots:
                    roots.append(cand)
    return roots


def target_roots(site: str) -> list[str]:
    return [
        os.path.join(site, name)
        for name in sorted(os.listdir(site))
        if name.startswith("octop_") and os.path.isdir(os.path.join(site, name))
    ]


def count_cjk(text: str) -> int:
    return len(CJK_RE.findall(text))


def scrub_python(path: str, check: bool) -> int:
    """Rewrite bilingual one-liners + known defaults. Returns chars removed."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()
    except (UnicodeDecodeError, OSError):
        return 0
    if not count_cjk(original):
        return 0

    updated = BILINGUAL_ENTRY.sub(lambda m: "%s%s" % (m.group(1), m.group("en")), original)
    for pattern, repl in DEFAULT_FLIPS:
        updated = pattern.sub(repl, updated)

    removed = count_cjk(original) - count_cjk(updated)
    if removed and not check:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(updated)
    return removed


ASCII_WORD = re.compile(r"[A-Za-z]{2,}")


def _humanize(slug: str) -> str:
    return slug.replace("-", " ").replace("_", " ").strip().capitalize()


def scrub_markdown(path: str, check: bool, slug: str) -> tuple[int, bool]:
    """Strip CJK out of a data markdown file.

    Returns ``(chars_removed, should_delete)``. A file whose remaining body has
    almost no English prose was a Chinese-only document (upstream misfiles some
    of those under ``skills/en/``); those are better deleted than left empty.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            original = fh.read()
    except (UnicodeDecodeError, OSError):
        return 0, False
    had = count_cjk(original)
    if not had:
        return 0, False

    updated = CJK_RE.sub("", original)
    # Tidy the gaps the removal leaves behind.
    updated = re.sub(r"[ \t]{2,}", " ", updated)
    updated = re.sub(r"[ \t]+$", "", updated, flags=re.M)
    # Repair frontmatter scalars that were Chinese-only (now empty). An empty
    # `description:` would break skill discovery, so fall back to the slug.
    updated = re.sub(
        r"^(\s*)(description|name|title):\s*$",
        lambda m: '%s%s: "%s"' % (m.group(1), m.group(2), _humanize(slug)),
        updated,
        flags=re.M,
    )

    body = updated.split("---", 2)[-1] if updated.startswith("---") else updated
    # Upstream misfiles some Chinese-only documents under ``skills/en/``. Those
    # cannot be salvaged by stripping characters, and leaving the shreds behind
    # is worse than not shipping the document at all.
    should_delete = had > 200 or len(ASCII_WORD.findall(body)) < 30

    if not check and not should_delete:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(updated)
    return had - count_cjk(updated), should_delete


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report only, change nothing")
    args = parser.parse_args()

    sites = site_packages_roots()
    if not sites:
        print("No site-packages directory found.", file=sys.stderr)
        return 1

    deleted = rewritten = removed = purged_md = 0
    for site in sites:
        # 1. Chinese-only data trees (paths are relative to site-packages).
        for rel in ZH_DATA_TREES:
            tree = os.path.join(site, rel)
            if os.path.isdir(tree):
                if args.check:
                    print(f"[check] would delete {rel}")
                else:
                    shutil.rmtree(tree)
                    print(f"deleted {rel}")
                deleted += 1

        for pkg_root in target_roots(site):
            # 2./3. Python message tables and defaults.
            for dirpath, dirnames, filenames in os.walk(pkg_root):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    if not name.endswith(".py"):
                        continue
                    full = os.path.join(dirpath, name)
                    got = scrub_python(full, args.check)
                    if got:
                        rewritten += 1
                        removed += got
                        verb = "would rewrite" if args.check else "rewrote"
                        print(f"{verb} {os.path.relpath(full, site)} (-{got} chars)")

            # 3b. Data markdown (builtin skills / workspace templates).
            builtin = os.path.join(pkg_root, "builtin")
            if not os.path.isdir(builtin):
                continue
            for dirpath, dirnames, filenames in os.walk(builtin):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    if not name.endswith(".md"):
                        continue
                    full = os.path.join(dirpath, name)
                    slug = os.path.basename(dirpath)
                    got, kill = scrub_markdown(full, args.check, slug)
                    if kill:
                        if not args.check:
                            os.remove(full)
                        print(f"{'[check] would delete' if args.check else 'deleted'} "
                              f"{os.path.relpath(full, site)} (Chinese-only doc)")
                        purged_md += 1
                    elif got:
                        removed += got
                        purged_md += 1
                        verb = "would strip" if args.check else "stripped"
                        print(f"{verb} CJK from {os.path.relpath(full, site)} (-{got} chars)")

    # 4. Report whatever is left that we refuse to touch blindly.
    residual: list[tuple[int, str]] = []
    for site in sites:
        for pkg_root in target_roots(site):
            for dirpath, dirnames, filenames in os.walk(pkg_root):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for name in filenames:
                    if not name.endswith((".py", ".json", ".txt", ".md", ".yaml", ".yml")):
                        continue
                    full = os.path.join(dirpath, name)
                    try:
                        with open(full, "r", encoding="utf-8") as fh:
                            n = count_cjk(fh.read())
                    except (UnicodeDecodeError, OSError):
                        continue
                    if n:
                        residual.append((n, full))

    residual.sort(reverse=True)
    total_residual = sum(n for n, _ in residual)
    print()
    print(f"data trees deleted : {deleted}")
    print(f"python files edited: {rewritten} (-{removed} chars)")
    print(f"markdown files     : {purged_md}")
    print(f"residual files     : {len(residual)} ({total_residual} chars)")
    for n, full in residual[:15]:
        print(f"  {n}\t{full}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
