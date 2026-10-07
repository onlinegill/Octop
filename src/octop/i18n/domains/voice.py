"""``voice.*`` — probe error copy."""

from __future__ import annotations

from octop.i18n.loader import tr
from octop.infra.utils.locale import Locale


def voice_not_configured(locale: str | Locale) -> str:
    return tr("voice.probe.not_configured", locale)


def voice_credentials_error(kind: str, locale: str | Locale) -> str:
    del kind
    return tr("voice.probe.credentials_missing", locale)


def format_voice_probe_error(exc: BaseException, locale: str | Locale) -> str:
    """Map probe-time exceptions to localized copy; unknown text stays as-is."""
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        return tr("voice.probe.http_status", locale, status=exc.response.status_code)
    if isinstance(exc, httpx.HTTPError):
        return tr("voice.probe.network_error", locale, name=type(exc).__name__)
    return str(exc).strip() or type(exc).__name__
