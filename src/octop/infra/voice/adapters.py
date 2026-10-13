"""Voice adapter implementations."""

from __future__ import annotations

import json
import math
import struct
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from octop.i18n.domains.voice import (
    format_voice_probe_error,
    voice_credentials_error,
    voice_not_configured,
)
from octop.infra.db.repos.voice_providers import VoiceProviderRow
from octop.infra.utils.ssrf_guard import validate_https_url_resolved


@dataclass(frozen=True)
class STTResult:
    text: str
    confidence: float | None = None


class BrowserOnlyError(Exception):
    """Raised when the active provider must run in the browser."""


<<<<<<< HEAD
=======
def parse_tencent_credentials(row: VoiceProviderRow) -> tuple[str, str]:
    extra = row.get_extra()
    secret_id = extra.get("secret_id") or ""
    secret_key = extra.get("secret_key") or ""
    if row.api_key and ":" in row.api_key:
        sid, _, sk = row.api_key.partition(":")
        secret_id = secret_id or sid
        secret_key = secret_key or sk
    if not secret_id or not secret_key:
        raise ValueError("Tencent Cloud requires secret_id and secret_key")
    return str(secret_id), str(secret_key)


def _voice_format(mime: str) -> str:
    """Map an upload MIME type onto a Tencent ASR ``VoiceFormat`` token."""
    lowered = mime.lower()
    if "mp3" in lowered or "mpeg" in lowered:
        return "mp3"
    if "wav" in lowered:
        return "wav"
    if "ogg" in lowered:
        return "ogg-opus"
    if "mp4" in lowered or "m4a" in lowered or "aac" in lowered:
        return "m4a"
    if "amr" in lowered:
        return "amr"
    if "silk" in lowered:
        return "silk"
    if "speex" in lowered:
        return "speex"
    if "pcm" in lowered:
        return "pcm"
    raise OctopError(
        ErrorCode.VOICE_KIND_UNSUPPORTED,
        f"unsupported audio format {mime!r}",
        details={"mime": mime},
    )


>>>>>>> upstream/main
async def transcribe_browser() -> STTResult:
    raise BrowserOnlyError()


async def synthesize_browser(_text: str) -> AsyncIterator[bytes]:
    raise BrowserOnlyError()
    yield b""  # pragma: no cover


async def _guard_voice_base_url(base_url: str) -> None:
    """Reject SSRF: the voice provider base_url must be a public https host."""
    await validate_https_url_resolved(f"{base_url}/v1/audio")


async def transcribe_openai(
    row: VoiceProviderRow, audio: bytes, *, mime: str, language: str
) -> STTResult:
    api_key = row.api_key or ""
    if not api_key:
        raise ValueError("OpenAI API key is required")
    base_url = (row.base_url or "https://api.openai.com/v1").rstrip("/")
    await _guard_voice_base_url(base_url)
    extra = row.get_extra()
    model = str(extra.get("model") or "whisper-1")
    ext = "webm" if "webm" in mime else "wav"
    files = {"file": (f"audio.{ext}", audio, mime or "audio/webm")}
    data: dict[str, str] = {"model": model}
    if language:
        data["language"] = language.split("-")[0]
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{base_url}/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            files=files,
            data=data,
        )
        resp.raise_for_status()
        body = resp.json()
    text = str(body.get("text") or "").strip()
    return STTResult(text=text)


async def synthesize_openai(
    row: VoiceProviderRow,
    text: str,
    *,
    voice_id: str | None,
    speed: float,
) -> AsyncIterator[bytes]:
    api_key = row.api_key or ""
    if not api_key:
        raise ValueError("OpenAI API key is required")
    base_url = (row.base_url or "https://api.openai.com/v1").rstrip("/")
    await _guard_voice_base_url(base_url)
    extra = row.get_extra()
    model = str(extra.get("model") or "tts-1")
    voice = voice_id or str(extra.get("voice_id") or "alloy")
    payload = {
        "model": model,
        "input": text,
        "voice": voice,
        "speed": speed,
        "response_format": "mp3",
    }
    async with (
        httpx.AsyncClient(timeout=120.0) as client,
        client.stream(
            "POST",
            f"{base_url}/audio/speech",
            headers={"Authorization": f"Bearer {api_key}"},
            json=payload,
        ) as resp,
    ):
        resp.raise_for_status()
        async for chunk in resp.aiter_bytes():
            if chunk:
                yield chunk


<<<<<<< HEAD
=======
async def transcribe_tencent(
    row: VoiceProviderRow,
    audio: bytes,
    *,
    mime: str,
    language: str,
) -> STTResult:
    secret_id, secret_key = parse_tencent_credentials(row)
    extra = row.get_extra()
    eng = str(extra.get("eng_service_type") or "16k_zh")
    if language.lower().startswith("en"):
        eng = str(extra.get("eng_service_type_en") or "16k_en")
    payload: dict[str, Any] = {
        "EngSerViceType": eng,
        "SourceType": 1,
        "VoiceFormat": _voice_format(mime),
        "Data": base64.b64encode(audio).decode("ascii"),
        "DataLen": len(audio),
    }
    headers, body = tc3_headers(
        secret_id=secret_id,
        secret_key=secret_key,
        service="asr",
        host="asr.tencentcloudapi.com",
        action="SentenceRecognition",
        version="2019-06-14",
        payload=payload,
        region=str(extra.get("region") or "ap-guangzhou"),
        language=tencent_api_language(_ui_locale.get()),
    )
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://asr.tencentcloudapi.com/",
            headers=headers,
            content=body.encode("utf-8"),
        )
        resp.raise_for_status()
        data = resp.json()
    response = data.get("Response") or {}
    if "Error" in response:
        err = response["Error"]
        raise RuntimeError(f"{err.get('Code')}: {err.get('Message')}")
    text = str(response.get("Result") or "").strip()
    return STTResult(text=text)


async def synthesize_tencent(
    row: VoiceProviderRow,
    text: str,
    *,
    voice_id: str | None,
    speed: float,
) -> AsyncIterator[bytes]:
    secret_id, secret_key = parse_tencent_credentials(row)
    extra = row.get_extra()
    voice_type = int(voice_id or extra.get("voice_type") or 101001)
    payload: dict[str, Any] = {
        "Text": text,
        "SessionId": str(uuid.uuid4()),
        "ModelType": 1,
        "VoiceType": voice_type,
        "Codec": "mp3",
        "Speed": max(0.5, min(2.0, speed)),
    }
    headers, body = tc3_headers(
        secret_id=secret_id,
        secret_key=secret_key,
        service="tts",
        host="tts.tencentcloudapi.com",
        action="TextToVoice",
        version="2019-08-23",
        payload=payload,
        region=str(extra.get("region") or "ap-guangzhou"),
        language=tencent_api_language(_ui_locale.get()),
    )
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://tts.tencentcloudapi.com/",
            headers=headers,
            content=body.encode("utf-8"),
        )
        resp.raise_for_status()
        data = resp.json()
    response = data.get("Response") or {}
    if "Error" in response:
        err = response["Error"]
        raise RuntimeError(f"{err.get('Code')}: {err.get('Message')}")
    audio_b64 = response.get("Audio")
    if not audio_b64:
        raise RuntimeError("Tencent TTS returned empty audio")
    yield base64.b64decode(str(audio_b64))


>>>>>>> upstream/main
async def synthesize_edge(
    row: VoiceProviderRow,
    text: str,
    *,
    voice_id: str | None,
    speed: float,
) -> AsyncIterator[bytes]:
    import edge_tts

    extra = row.get_extra()
    voice = voice_id or str(extra.get("voice_id") or "en-US-AriaNeural")
    rate_pct = int((speed - 1.0) * 100)
    rate = f"{rate_pct:+d}%"
    communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            yield chunk["data"]


# WAV header for raw streaming output: 24kHz PCM16LE mono.
_DEFAULT_WAV_SAMPLE_RATE = 24000


def _wav_header(data_len: int, sample_rate: int = _DEFAULT_WAV_SAMPLE_RATE) -> bytes:
    """Minimal canonical WAV header for PCM16LE mono audio.

    ``data_len`` is clamped to uint32 range; streaming callers pass a max-size
    sentinel (players that trust it simply read until the body ends).
    """
    data = min(data_len, 0xFFFF_FFFF)
    riff = min(36 + data, 0xFFFF_FFFF)
    byte_rate = sample_rate * 2
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        riff,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        1,  # mono
        sample_rate,
        byte_rate,
        2,  # block align
        16,  # bits per sample
        b"data",
        data,
    )


_PROBE_TONE_RATE = 16000
_PROBE_TONE_SECONDS = 1.0


def _probe_tone_wav() -> bytes:
    """Deterministic probe payload: 1s 440Hz tone as 16kHz mono PCM16 WAV."""
    n = int(_PROBE_TONE_RATE * _PROBE_TONE_SECONDS)
    pcm = struct.pack(
        f"<{n}h",
        *[int(1000 * math.sin(2 * math.pi * 440 * i / _PROBE_TONE_RATE)) for i in range(n)],
    )
    return _wav_header(len(pcm), _PROBE_TONE_RATE) + pcm


def _missing_credentials(row: VoiceProviderRow, kind: str, *, locale: str = "en") -> str | None:
    """Probe-time credential check; returns an error message when incomplete."""
<<<<<<< HEAD
    if kind == "openai" and not row.api_key:
=======
    if kind == "tencent":
        try:
            parse_tencent_credentials(row)
        except ValueError:
            return voice_credentials_error(kind, locale)
        return None
    if kind in {"openai", "mimo"} and not row.api_key:
>>>>>>> upstream/main
        return voice_credentials_error(kind, locale)
    return None


def _probe_failure(exc: Exception, *, locale: str = "en") -> dict[str, Any]:
    """Turn a probe-time exception into an ``ok: false`` payload instead of a 500."""
    return {"ok": False, "error": format_voice_probe_error(exc, locale)}


async def _drain(stream: AsyncIterator[bytes]) -> list[bytes]:
    return [part async for part in stream]


async def test_stt(
    row: VoiceProviderRow | None, kind: str, *, locale: str = "en"
) -> dict[str, Any]:
    if kind == "browser":
        return {"ok": True, "mode": "browser"}
    if row is None:
        return {"ok": False, "error": voice_not_configured(locale)}
    if kind != "openai":
        # edge is TTS-only and unknown kinds have no adapter: keep offline pass.
        return {"ok": True, "mode": kind}
    missing = _missing_credentials(row, kind, locale=locale)
    if missing:
        return {"ok": False, "error": missing}
    try:
        await transcribe_openai(row, _probe_tone_wav(), mime="audio/wav", language="en-US")
    except Exception as exc:  # probe reports failures, never 500s
        return _probe_failure(exc, locale=locale)
    return {"ok": True, "mode": kind}


async def test_tts(
    row: VoiceProviderRow | None, kind: str, *, locale: str = "en"
) -> dict[str, Any]:
    if kind == "browser":
        return {"ok": True, "mode": "browser"}
    if kind == "edge":
        edge_row = row or VoiceProviderRow(
            id=0,
            name="edge",
            kind="edge",
            capability="tts",
            base_url=None,
            api_key=None,
            extra_json=None,
            note=None,
            enabled=1,
            created_at=0,
            updated_at=0,
        )
        try:
            chunks = await _drain(synthesize_edge(edge_row, "ping", voice_id=None, speed=1.0))
        except Exception as exc:  # probe reports failures, never 500s
            return _probe_failure(exc, locale=locale)
        return {"ok": bool(chunks), "bytes": sum(len(c) for c in chunks)}
    if row is None:
        return {"ok": False, "error": voice_not_configured(locale)}
    missing = _missing_credentials(row, kind, locale=locale)
    if missing:
        return {"ok": False, "error": missing}
    try:
        chunks = await _drain(synthesize_openai(row, "ping", voice_id=None, speed=1.0))
    except Exception as exc:  # probe reports failures, never 500s
        return _probe_failure(exc, locale=locale)
    return {"ok": bool(chunks), "bytes": sum(len(c) for c in chunks)}
