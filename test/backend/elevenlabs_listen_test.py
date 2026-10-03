"""
Hear onboarding-style lines with ElevenLabs.

1. Paste your API key in ELEVENLABS_API_KEY below, or put it in test/backend/.env
2. Run from test/backend:

     python3 elevenlabs_listen_test.py
     python3 elevenlabs_listen_test.py --list-voices

Free API accounts cannot use Voice Library IDs (e.g. Rachel). Use --list-voices
and set VOICE_ID to one of your voices, or leave VOICE_ID empty to auto-pick
the first voice that works (often a default premade or a Voice Design voice).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent

# Paste key here, or use ELEVENLABS_API_KEY= in test/backend/.env (this file wins if set).
ELEVENLABS_API_KEY = "sk_05e7773b2037422fc506c55ca390e8abc6bd7b738b984f81"

# Leave empty to auto-pick; library voices (Rachel, etc.) fail on free API with 402.
VOICE_ID = ""

MODEL_ID = "eleven_turbo_v2_5"

PHRASES = [
    "Hi. I'm your guide. I'll ask a few questions, one at a time. Just answer out loud.",
    "Which state would you like to be able to return to?",
    "Can you remember a specific time when you were totally calm? Go back to that time and step into it.",
    "Good. Stay there for a moment. See what you saw. Hear what you heard.",
    "What was the very first thing that caused you to be totally calm? Something you saw, something you heard, or the touch of something?",
    "What did you see?",
    "That's your path to calm. When you drift, I'll walk you back through it, in this order.",
]

API = "https://api.elevenlabs.io/v1"

# Default premade IDs to try when VOICE_ID is empty (no voices_read scope needed).
FALLBACK_VOICES: list[tuple[str, str]] = [
    ("JBFqnCBsd6RMkjVDRZzb", "George"),
    ("pNInz6obpgDQGcFmaJgB", "Adam"),
    ("EXAVITQu4vr4xnSDxMaL", "Bella"),
    ("ErXwobaYiN019PkySvjV", "Antoni"),
    ("MF3mGyEYCl7XYWbV9V6O", "Elli"),
]


def _clean_key(value: str) -> str:
    return value.strip().strip('"').strip("'")


def resolve_api_key() -> str:
    key = _clean_key(ELEVENLABS_API_KEY)
    if key:
        return key
    env_path = _BACKEND_DIR / ".env"
    if env_path.is_file():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() == "ELEVENLABS_API_KEY":
                return _clean_key(value)
    return ""


def _api_headers() -> dict[str, str]:
    key = resolve_api_key()
    if not key:
        sys.exit(
            "No API key. Set ELEVENLABS_API_KEY in this file or in test/backend/.env"
        )
    return {"xi-api-key": key}


def _api_request(req: urllib.request.Request, timeout: int = 60) -> bytes:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ElevenLabs HTTP {exc.code}: {detail}") from exc


def _exit_on_auth_failure(err: RuntimeError) -> None:
    msg = str(err)
    if "missing_permissions" in msg or "voices_read" in msg:
        sys.exit(
            "Your API key works but is missing permission for this call.\n"
            "  • elevenlabs.io → Profile → API Keys → edit or create a key\n"
            "  • Enable at least: Text to Speech, and Voices (read) for --list-voices\n"
            "  • Or run without --list-voices — playback tries default voice IDs automatically"
        )
    if "401" in msg:
        sys.exit(
            "ElevenLabs rejected the API key (401).\n"
            "  • Create a new key at Profile → API Keys\n"
            "  • Update ELEVENLABS_API_KEY in this file or test/backend/.env"
        )
    raise err


def list_voices() -> list[dict]:
    req = urllib.request.Request(f"{API}/voices", headers=_api_headers(), method="GET")
    try:
        data = json.loads(_api_request(req).decode("utf-8"))
    except RuntimeError as exc:
        if "voices_read" in str(exc) or "missing_permissions" in str(exc):
            return []
        _exit_on_auth_failure(exc)
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
    try:
        return _api_request(req, timeout=120)
    except RuntimeError as exc:
        _exit_on_auth_failure(exc)
        raise


def is_payment_required(err: RuntimeError) -> bool:
    msg = str(err)
    return "402" in msg or "payment_required" in msg or "paid_plan_required" in msg


def pick_working_voice() -> tuple[str, str]:
    """Try voices until one succeeds on a short sample (free tier blocks library IDs)."""
    candidates: list[tuple[str, str]] = []
    if VOICE_ID.strip():
        candidates.append((VOICE_ID.strip(), "configured VOICE_ID"))

    candidates.extend(FALLBACK_VOICES)

    for v in list_voices():
        vid = v.get("voice_id") or ""
        name = v.get("name") or vid
        category = v.get("category") or "?"
        label = f"{name} ({category})"
        if vid and (vid, label) not in candidates:
            candidates.append((vid, label))

    seen: set[str] = set()
    sample = "Hi. I'm your guide."
    for vid, label in candidates:
        if vid in seen:
            continue
        seen.add(vid)
        try:
            synthesize(sample, vid)
            return vid, label
        except RuntimeError as exc:
            if is_payment_required(exc):
                print(f"  skip (paid/library): {label}")
                continue
            raise

    sys.exit(
        "No voice worked on your plan via API.\n"
        "  • Run: python3 elevenlabs_listen_test.py --list-voices\n"
        "  • Create a voice under Voice Design (free), paste its voice_id into VOICE_ID\n"
        "  • Or upgrade to use library voices like Rachel"
    )


def play_mp3(data: bytes) -> None:
    tmp = Path("/tmp/peak_elevenlabs_test.mp3")
    tmp.write_bytes(data)
    if sys.platform == "darwin":
        subprocess.run(["afplay", str(tmp)], check=False)
        return
    print(f"Wrote {tmp} — open it to listen.")


def cmd_list_voices() -> None:
    voices = list_voices()
    if not voices:
        print(
            "Could not list voices (often: API key lacks voices_read permission).\n"
            "Default voice IDs you can set in VOICE_ID:"
        )
        for vid, name in FALLBACK_VOICES:
            print(f"  {name:<12} {vid}")
        return
    print(f"{'name':<24} {'category':<12} voice_id")
    print("-" * 72)
    for v in voices:
        print(f"{(v.get('name') or ''):<24} {(v.get('category') or ''):<12} {v.get('voice_id')}")


def main() -> None:
    _api_headers()  # validate key early

    parser = argparse.ArgumentParser(description="Play onboarding lines with ElevenLabs")
    parser.add_argument("--list-voices", action="store_true", help="Show voices on your account")
    args = parser.parse_args()

    if args.list_voices:
        cmd_list_voices()
        return

    print("Finding a voice that works on your API plan…")
    voice_id, voice_label = pick_working_voice()
    print(f"Using: {voice_label}\n  id={voice_id}\n  model={MODEL_ID}")
    print(f"Playing {len(PHRASES)} line(s)…\n")

    for i, line in enumerate(PHRASES, start=1):
        preview = line if len(line) <= 72 else line[:72] + "…"
        print(f"[{i}/{len(PHRASES)}] {preview}")
        play_mp3(synthesize(line, voice_id))

    print("\nDone.")


if __name__ == "__main__":
    main()
