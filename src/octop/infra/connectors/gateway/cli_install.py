"""Helpers for locating the user-level npm global binary directory."""

from __future__ import annotations

import os
from pathlib import Path

# On fnOS / containers Octop often runs as a non-root user, where the npm global
# directory (/usr/local) is not writable, so installs fall back to a user-level
# directory; the name follows npm's recommended ~/.npm-global.
_NPM_USER_PREFIX_NAME = ".npm-global"


def _prefix_bin_dir(prefix: str) -> str:
    # npm places global binaries in <prefix>/bin on POSIX and the <prefix> root on Windows.
    return prefix if os.name == "nt" else str(Path(prefix) / "bin")


def _user_npm_prefix() -> tuple[str, str]:
    """Return ``(prefix, bin_dir)`` for the user-level npm global directory."""
    prefix = os.path.join(os.path.expanduser("~"), _NPM_USER_PREFIX_NAME)
    return prefix, _prefix_bin_dir(prefix)


def ensure_cli_path() -> str:
    """Prepend the user-level npm global bin dir to the in-process PATH.

    Octop often runs as a non-root user on fnOS, where the npm global directory
    under ``/usr/local`` is not writable and installs fall back to a user-level
    directory (~/.npm-global). This ensures that bin directory is present on the
    process PATH so ``shutil.which`` and later CLI subprocess calls can find
    commands. The directory is left untouched when it does not exist; the bin
    directory (possibly an empty string) is returned.
    """
    _, bin_dir = _user_npm_prefix()
    if bin_dir and os.path.isdir(bin_dir):
        current = os.environ.get("PATH", "")
        if bin_dir not in [part for part in current.split(os.pathsep) if part]:
            os.environ["PATH"] = bin_dir + os.pathsep + current
    return bin_dir
