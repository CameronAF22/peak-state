"""ElevenLabs text-to-speech for the test app backend."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent

# Optional paste-in key for local dev (same as elevenlabs_listen_test.py). Prefer .env in production.
_FILE_API_KEY = ""

MODEL_ID = "eleven_turbo_v2_5"
# 1.0 = default; slightly above for a calmer but not sluggish guide pace.
SPEECH_SPEED = 1.1
API = "https://api.elevenlabs.io/v1"

# Default premade IDs to try when no voice is configured (no voices_read scope needed).
FALLBACK_VOICES: list[tuple[str, str]] = [
    ("JBFqnCBsd6RMkjVDRZzb", "George"),
    ("pNInz6obpgDQGcFmaJgB", "Adam"),
    ("EXAVITQu4vr4xnSDxMaL", "Bella"),
    ("ErXwobaYiN019PkySvjV", "Antoni"),
    ("MF3mGyEYCl7XYWbV9V6O", "Elli"),
]

_cached_voice_id: str | None = None


def _clean_key(value: str) -> str:
    return value.strip().strip('"').strip("'")


def load_dotenv() -> None:
    """Load test/backend/.env into os.environ (does not override existing vars)."""
    env_path = _BACKEND_DIR / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        if name and name not in os.environ:
            os.environ[name] = _clean_key(value)


def resolve_api_key() -> str:
    key = _clean_key(_FILE_API_KEY)
    if key:
        return key
    load_dotenv()
    key = _clean_key(os.environ.get("ELEVENLABS_API_KEY", ""))
    if key:
        return key
    return _read_env_value("ELEVENLABS_API_KEY")


def sync_key_from_listen_test() -> None:
    """Use the paste-in key from elevenlabs_listen_test.py when .env is empty."""
    if resolve_api_key():
        return
    try:
        import elevenlabs_listen_test as listen_test
    except ImportError:
        return
    key = _clean_key(getattr(listen_test, "ELEVENLABS_API_KEY", ""))
    if key:
        os.environ["ELEVENLABS_API_KEY"] = key


def _api_headers() -> dict[str, str]:
    key = resolve_api_key()
    if not key:
        raise RuntimeError(
            "No ElevenLabs API key. Set ELEVENLABS_API_KEY in test/backend/.env"
        )
    return {"xi-api-key": key}


def _api_request(req: urllib.request.Request, timeout: int = 60) -> bytes:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ElevenLabs HTTP {exc.code}: {detail}") from exc


def list_voices() -> list[dict]:
    req = urllib.request.Request(f"{API}/voices", headers=_api_headers(), method="GET")
    try:
        data = json.loads(_api_request(req).decode("utf-8"))
    except RuntimeError as exc:
        if "voices_read" in str(exc) or "missing_permissions" in str(exc):
            return []
        raise
    return data.get("voices") or []


def synthesize(text: str, voice_id: str) -> bytes:
    url = f"{API}/text-to-speech/{voice_id}"
    body = {
        "text": text.strip(),
        "model_id": MODEL_ID,
        "voice_settings": {
            "stability": 0.55,
            "similarity_boost": 0.8,
            "style": 0.15,
            "use_speaker_boost": True,
            "speed": SPEECH_SPEED,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            **_api_headers(),
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )
    return _api_request(req, timeout=120)


def _is_payment_required(err: RuntimeError) -> bool:
    msg = str(err)
    return "402" in msg or "payment_required" in msg or "paid_plan_required" in msg


def pick_working_voice() -> str:
    global _cached_voice_id
    if _cached_voice_id:
        return _cached_voice_id

    configured = _clean_key(
        _read_env_value("ELEVENLABS_VOICE_ID") or _read_env_value("VOICE_ID") or ""
    )
    candidates: list[str] = []
    if configured:
        candidates.append(configured)
    candidates.extend(vid for vid, _ in FALLBACK_VOICES)

    try:
        for v in list_voices():
            vid = v.get("voice_id") or ""
            if vid and vid not in candidates:
                candidates.append(vid)
    except RuntimeError:
        pass

    sample = "Hi."
    seen: set[str] = set()
    for vid in candidates:
        if vid in seen:
            continue
        seen.add(vid)
        try:
            synthesize(sample, vid)
            _cached_voice_id = vid
            return vid
        except RuntimeError as exc:
            if _is_payment_required(exc):
                continue
            raise

    raise RuntimeError(
        "No ElevenLabs voice worked on your API plan. "
        "Set ELEVENLABS_VOICE_ID in test/backend/.env or create a Voice Design voice."
    )


def _read_env_value(name: str) -> str:
    env_path = _BACKEND_DIR / ".env"
    if not env_path.is_file():
        return ""
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == name:
            return _clean_key(value)
    return ""


def text_to_speech(text: str) -> bytes:
    sync_key_from_listen_test()
    voice_id = pick_working_voice()
    return synthesize(text, voice_id)
