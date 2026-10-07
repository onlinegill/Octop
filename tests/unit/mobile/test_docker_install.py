"""tests/unit/mobile/test_docker_install.py"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from octop.infra.mobile import docker_install
from octop.infra.mobile.docker_install import select_download_source


_NEUTRAL_SOURCES = (
    "https://download.docker.com",
    "https://mirror-eu.example/docker-ce",
    "https://mirror-us.example/docker-ce",
    "https://mirror-ap.example/docker-ce",
    "https://mirror-backup.example/docker-ce",
)


def _with_measure(delays: dict[str, float | None]):
    def deco(fn):
        async def wrapper():
            async def fake(url: str) -> float | None:
                return delays[url]

            with patch.object(docker_install, "_DOCKER_CE_SOURCES", _NEUTRAL_SOURCES), patch.object(
                docker_install, "_measure_source_delay", fake
            ):
                return await fn()

        wrapper.__name__ = fn.__name__
        return wrapper

    return deco


@pytest.mark.asyncio
@_with_measure(
    {
        "https://download.docker.com": 0.1,
        "https://mirror-eu.example/docker-ce": 0.4,
        "https://mirror-us.example/docker-ce": 0.5,
        "https://mirror-ap.example/docker-ce": 0.6,
        "https://mirror-backup.example/docker-ce": 0.7,
    }
)
async def test_select_download_source_official_wins_no_override() -> None:
    source, delay = await select_download_source()
    assert source is None  # official wins → no DOWNLOAD_URL override
    assert delay == pytest.approx(0.1)


@pytest.mark.asyncio
@_with_measure(
    {
        "https://download.docker.com": 0.9,
        "https://mirror-eu.example/docker-ce": 0.2,
        "https://mirror-us.example/docker-ce": 0.5,
        "https://mirror-ap.example/docker-ce": 0.6,
        "https://mirror-backup.example/docker-ce": 0.7,
    }
)
async def test_select_download_source_mirror_wins() -> None:
    source, delay = await select_download_source()
    assert source == "https://mirror-eu.example/docker-ce"
    assert delay == pytest.approx(0.2)


@pytest.mark.asyncio
@_with_measure(
    {
        "https://download.docker.com": None,
        "https://mirror-eu.example/docker-ce": None,
        "https://mirror-us.example/docker-ce": None,
        "https://mirror-ap.example/docker-ce": None,
        "https://mirror-backup.example/docker-ce": None,
    }
)
async def test_select_download_source_all_unreachable_falls_back() -> None:
    source, delay = await select_download_source()
    assert source is None
    assert delay is None


def test_classify_script_error_maps_known_failures() -> None:
    assert (
        docker_install._classify_script_error(["ERROR: Unsupported distribution 'sles'"])
        == "docker_hint_unsupported_distro"
    )
    assert (
        docker_install._classify_script_error(
            ["Error: this installer needs the ability to run commands as root."]
        )
        == "docker_hint_no_root"
    )
    assert (
        docker_install._classify_script_error(
            ["+ curl -fsSL https://example/gpg", "curl: (7) Failed to connect"]
        )
        == "docker_hint_network"
    )
    assert (
        docker_install._classify_script_error(["E: Could not get lock /var/lib/dpkg/lock-frontend"])
        == "docker_hint_pkg_manager"
    )
    assert (
        docker_install._classify_script_error(["No space left on device"])
        == "docker_hint_disk_full"
    )
    # Unrelated output → no hint.
    assert docker_install._classify_script_error(["All good"]) is None


def test_bundled_install_script_ships_with_package() -> None:
    script = docker_install.bundled_install_script()
    assert script.is_file()
    assert script.name == "install-docker.sh"


@pytest.mark.asyncio
async def test_auto_install_missing_script_reports_error() -> None:
    async def collect():
        return [line async for line in docker_install.auto_install_docker_stream(locale="en")]

    with patch.object(docker_install, "bundled_install_script", return_value=Path("/nonexistent")):
        lines = await collect()
    assert any("missing from the Octop package" in line for line in lines)


@pytest.mark.asyncio
async def test_auto_install_script_failure_emits_friendly_hint() -> None:
    class FakeProc:
        def __init__(self) -> None:
            self.stdout = self
            self._lines = [b"Installing...", b"ERROR: Unsupported distribution 'xyz'"]

        async def readline(self) -> bytes:
            return self._lines.pop(0) if self._lines else b""

        async def wait(self) -> int:
            return 1

    async def fake_exec(*args: object, **kwargs: object) -> FakeProc:
        return FakeProc()

    async def collect():
        return [line async for line in docker_install.auto_install_docker_stream(locale="en")]

    with (
        patch.object(docker_install, "select_download_source", return_value=(None, 0.1)),
        patch.object(docker_install.asyncio, "create_subprocess_exec", new=fake_exec),
    ):
        lines = await collect()

    assert any("exit 1" in line for line in lines)
    assert any("not supported by the Docker install script" in line for line in lines)
