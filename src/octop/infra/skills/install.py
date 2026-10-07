"""Shared skill install pipeline for agent workspace and global packages."""

from __future__ import annotations

from typing import Protocol
from urllib.parse import urlparse

from octop.infra.skills import skills_hub
from octop.infra.skills.skill_packages import (
    ResolvedSkillPackage,
    resolve_workspace_uploads,
)


class SkillAlreadyExistsError(Exception):
    """Skill slug already exists in the install target and overwrite is false."""

    def __init__(self, slug: str) -> None:
        self.slug = slug
        super().__init__(f"skill already exists: {slug}")


class SkillInstallTarget(Protocol):
    """Destination for a resolved skill package (agent workspace or package store)."""

    async def skill_exists(self, slug: str) -> bool: ...

    async def write_files(self, slug: str, files: list[tuple[str, bytes]]) -> None: ...

    async def after_install(self, slug: str, *, enable: bool | None = None) -> None: ...


def _valid_skillhub_icon_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def resolve_url_import(
    *,
    bundle_url: str,
    version: str | None = None,
) -> ResolvedSkillPackage:
    """Download/resolve a skill URL into a canonical package."""
    resolved = skills_hub.resolve_bundle_from_url(
        bundle_url=bundle_url,
        version=version or "",
    )
    return resolve_workspace_uploads(
        slug=resolved.name,
        uploads=resolved.uploads,
        source="url",
        source_url=resolved.source_url,
    )


async def commit_skill_install(
    target: SkillInstallTarget,
    package: ResolvedSkillPackage,
    *,
    overwrite: bool = False,
    enable: bool | None = None,
) -> ResolvedSkillPackage:
    """Write a resolved package into the target and run post-install hooks."""
    if await target.skill_exists(package.slug) and not overwrite:
        raise SkillAlreadyExistsError(package.slug)
    await target.write_files(package.slug, list(package.files))
    await target.after_install(package.slug, enable=enable)
    return package


async def install_skill_from_url(
    target: SkillInstallTarget,
    *,
    bundle_url: str,
    version: str | None = None,
    overwrite: bool = False,
    enable: bool | None = None,
) -> ResolvedSkillPackage:
    """Resolve a skill URL and commit it into the target."""
    package = resolve_url_import(bundle_url=bundle_url, version=version)
    return await commit_skill_install(
        target,
        package,
        overwrite=overwrite,
        enable=enable,
    )



def valid_skillhub_icon_url(value: str) -> bool:
    """Public alias used by HTTP routers for icon URL validation."""
    return _valid_skillhub_icon_url(value)


__all__ = [
    "SkillAlreadyExistsError",
    "SkillInstallTarget",
    "commit_skill_install",
    "install_skill_from_url",
    "resolve_url_import",
    "valid_skillhub_icon_url",
]
